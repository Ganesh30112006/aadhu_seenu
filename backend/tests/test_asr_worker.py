"""ASR processor end-to-end on PostgreSQL + fakeredis with a deterministic fake transcriber."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import fakeredis
import numpy as np
from sqlalchemy import select

from app.audio.frames import Codec, build_frame, parse_frame
from app.audio.storage import DiskStore, chunk_key
from app.config import Settings
from app.db.models import GapState, LatencyMark, Lecture, LectureGap, LectureStatus, TranscriptSegment
from app.gateway import service
from tests.conftest import run
from tests.helpers import seed_basics
from worker.asr.local_agreement import Word
from worker.asr.processor import AsrContext, process_lecture


class FakeTranscriber:
    """Each chunk is a constant signal whose level encodes its seq; every constant run of ≥ 0.2 s
    becomes the word "w<seq>" (with "." after every 4th), so hypotheses are repeatable."""

    name = "fake"

    def transcribe(
        self, audio: np.ndarray, *, language: str | None, prompt: str | None, beam_size: int
    ) -> list[Word]:
        values = np.round(audio * 32768).astype(int)
        words: list[Word] = []
        i = 0
        while i < len(values):
            j = i
            while j < len(values) and values[j] == values[i]:
                j += 1
            if values[i] > 0 and (j - i) >= 0.2 * 16000:
                seq = values[i] // 100 - 1
                text = f" w{seq}" + ("." if seq % 4 == 3 else "")
                words.append(Word(text, i / 16000, j / 16000, 0.9))
            i = j
        return words


def chunk(seq: int) -> bytes:
    return np.full(8000, (seq + 1) * 100, dtype="<i2").tobytes()


async def add_chunks(factory, store: DiskStore, lecture_id: uuid.UUID, seqs: list[int]) -> None:  # type: ignore[no-untyped-def]
    sessions = factory()
    async with sessions() as db:
        for seq in seqs:
            frame = parse_frame(build_frame(Codec.PCM16, seq, 0, chunk(seq)))
            key = chunk_key(str(lecture_id), seq, 0)
            await store.put(key, frame.payload)
            await service.store_chunk(db, lecture_id, frame, key, 0)
    await sessions.kw["bind"].dispose()


async def db_call(factory, fn):  # type: ignore[no-untyped-def]
    sessions = factory()
    async with sessions() as db:
        result = await fn(db)
    await sessions.kw["bind"].dispose()
    return result


def test_live_gap_backfill_and_finalize(sessions_factory, redis_server, sync_redis, audio_dir: Path) -> None:  # type: ignore[no-untyped-def]
    seed = run(seed_basics(sessions_factory))
    store = DiskStore(audio_dir)

    async def start(db):  # type: ignore[no-untyped-def]
        lecture, _ = await service.bind_session(db, seed.device_id, uuid.uuid4(), None, 0)
        return lecture.id

    lecture_id = run(db_call(sessions_factory, start))

    async def step() -> bool:
        ctx = state["ctx"]
        ctx.redis = fakeredis.aioredis.FakeRedis(server=redis_server, decode_responses=True)
        ctx.sessions = sessions_factory()
        try:
            return await process_lecture(ctx, lecture_id)
        finally:
            await ctx.sessions.kw["bind"].dispose()

    settings = Settings(asr_live_interval_s=1.0)
    state = {"ctx": AsrContext(None, None, store, FakeTranscriber(), settings)}  # type: ignore[arg-type]

    def events() -> list[dict[str, object]]:
        return [json.loads(f["e"]) for _, f in sync_redis.xrange(f"live:{lecture_id}")]

    # Live: 2 s of audio → partial only (nothing agreed yet).
    run(add_chunks(sessions_factory, store, lecture_id, [0, 1, 2, 3]))
    run(step())
    assert [e["type"] for e in events()] == ["transcript.partial"]
    # More audio → the first sentence is agreed and finalised.
    run(add_chunks(sessions_factory, store, lecture_id, [4, 5, 6]))
    run(step())
    finals = [e for e in events() if e["type"] == "transcript.final"]
    assert [f["text"] for f in finals] == ["w0 w1 w2 w3."]
    assert finals[0]["start_ms"] == 0 and finals[0]["end_ms"] == 2000 and finals[0]["language"] == "en"

    # Outage: chunks 7..8 arrive late; 9..10 (live) first. The gateway recorded the gap.
    async def add_gap(db):  # type: ignore[no-untyped-def]
        db.add(LectureGap(lecture_id=lecture_id, gap_id="gap-7", start_seq=7, end_seq=8, state=GapState.open))
        await db.commit()

    run(db_call(sessions_factory, add_gap))
    run(add_chunks(sessions_factory, store, lecture_id, [9, 10, 11]))
    run(step())  # pointer jumps over the gap, live continues after it
    run(step())

    run(add_chunks(sessions_factory, store, lecture_id, [7, 8]))

    async def fill(db):  # type: ignore[no-untyped-def]
        gap = (await db.execute(select(LectureGap))).scalars().one()
        gap.state = GapState.filled
        await db.commit()

    run(db_call(sessions_factory, fill))
    run(step())
    backfill = [e for e in events() if e["type"] == "transcript.backfill"]
    assert len(backfill) == 1
    assert backfill[0]["gap_id"] == "gap-7"
    assert [s["text"] for s in backfill[0]["segments"]] == ["w7.", "w8"]  # type: ignore[index]  # "." closes a segment
    assert backfill[0]["gap"] == {"start_ms": 3500, "end_ms": 4500}

    # Stop → everything flushed, status processing, notes queued.
    run(db_call(sessions_factory, lambda db: service.mark_stop(db, lecture_id, 11)))
    assert run(step()) is False

    async def check(db):  # type: ignore[no-untyped-def]
        segments = list(
            (
                await db.execute(
                    select(TranscriptSegment)
                    .where(TranscriptSegment.lecture_id == lecture_id)
                    .order_by(TranscriptSegment.start_ms)
                )
            ).scalars()
        )
        lecture = await db.get(Lecture, lecture_id)
        marks = (
            (
                await db.execute(
                    select(LatencyMark.stage).where(LatencyMark.lecture_id == lecture_id).distinct()
                )
            )
            .scalars()
            .all()
        )
        return segments, lecture, set(marks)

    segments, lecture, stages = run(db_call(sessions_factory, check))
    words = " ".join(s.text for s in segments).replace(".", "").split()
    assert words == [f"w{i}" for i in range(12)]  # every word exactly once, in timeline order
    assert {s.source.value for s in segments} == {"live", "backfill"}
    assert lecture.status is LectureStatus.processing
    assert {"gateway_receive", "asr_start", "asr_end", "published"} <= stages
    assert json.loads(sync_redis.lpop("jobs:notes"))["lecture_id"] == str(lecture_id)
    assert events()[-1] == {"type": "lecture.status", "status": "processing", "duration_ms": 6000}
    # Superseded partials were trimmed from the replay log (D5).
    remaining = {e.get("segment_id") for e in events() if e["type"] == "transcript.partial"}
    assert not remaining & {s["segment_id"] for s in [e for e in events() if e["type"] == "transcript.final"]}


def test_requeue_recording_lectures_on_start(sessions_factory, redis_server, sync_redis) -> None:  # type: ignore[no-untyped-def]
    """After Redis loses `asr:pending`, a starting worker re-queues lectures still recording."""
    from app.events import ASR_PENDING
    from worker.asr.main import requeue_recording_lectures

    seed = run(seed_basics(sessions_factory))

    async def start(db):  # type: ignore[no-untyped-def]
        lecture, _ = await service.bind_session(db, seed.device_id, uuid.uuid4(), None, 0)
        return lecture.id

    recording = run(db_call(sessions_factory, start))
    finished = run(db_call(sessions_factory, start))

    async def complete(db):  # type: ignore[no-untyped-def]
        lecture = await db.get(Lecture, finished)
        lecture.status = LectureStatus.completed
        await db.commit()

    run(db_call(sessions_factory, complete))
    sync_redis.delete(ASR_PENDING)  # e.g. Redis restarted without persistence

    async def requeue() -> int:
        sessions = sessions_factory()
        ctx = AsrContext(
            sessions,
            fakeredis.aioredis.FakeRedis(server=redis_server, decode_responses=True),
            None,
            FakeTranscriber(),
            Settings(),
        )  # type: ignore[arg-type]
        try:
            return await requeue_recording_lectures(ctx)
        finally:
            await sessions.kw["bind"].dispose()

    assert run(requeue()) == 1
    assert sync_redis.smembers(ASR_PENDING) == {str(recording)}
