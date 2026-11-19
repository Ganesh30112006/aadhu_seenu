"""Per-lecture ASR processing (brief §4.2): live mode, catch-up, backfill and finalisation."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.audio.frames import CHUNK_MS, SAMPLE_RATE
from app.audio.storage import AudioStore
from app.config import Settings
from app.db.models import (
    AsrProgress,
    AudioChunk,
    GapState,
    LatencyMark,
    Lecture,
    LectureGap,
    LectureStatus,
    SegmentSource,
    TranscriptSegment,
)
from app.events import delete_live_event, enqueue_notes, now_ms, publish_live
from app.gateway.seq_tracker import SeqTracker
from app.logs import get_logger
from worker.asr.audio import load_chunks
from worker.asr.language import script_language, transliterate
from worker.asr.local_agreement import LiveCommitter, Segment, Update, Word
from worker.asr.transcriber import Transcriber

log = get_logger("asr")

CHUNK_S = CHUNK_MS / 1000
WINDOW_S = 20.0  # longest audio per Whisper call (Whisper's context is 30 s)
CATCH_UP_MARGIN_S = 2.0
LIVE_BEAM = 1
BATCH_BEAM = 5


@dataclass
class LiveState:
    committer: LiveCommitter
    decoded_until: float = 0.0
    partial_events: dict[str, list[int]] = field(default_factory=dict)
    last_partial: tuple[str, str] | None = None  # (segment_id, text) last published
    context_text: str = ""


@dataclass
class AsrContext:
    sessions: async_sessionmaker[AsyncSession]
    redis: aioredis.Redis
    store: AudioStore
    transcriber: Transcriber
    settings: Settings
    live: dict[uuid.UUID, LiveState] = field(default_factory=dict)


def _seq_of(t: float) -> int:
    return int(t / CHUNK_S + 1e-9)


class Emitter:
    """Persists final segments and publishes live events for one processing step."""

    def __init__(self, ctx: AsrContext, db: AsyncSession, lecture: Lecture, state: LiveState | None) -> None:
        self.ctx = ctx
        self.db = db
        self.lecture = lecture
        self.state = state
        self.lecture_key = str(lecture.id)

    def _language(self, text: str) -> str:
        return script_language(
            text,
            fallback="hi"
            if self.lecture.language_hint == "hi"
            else "te"
            if self.lecture.language_hint == "te"
            else "en",
        )

    async def store(self, segments: list[Segment], source: SegmentSource) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for seg in segments:
            if not seg.text:
                continue
            language = self._language(seg.text)
            row = {
                "segment_id": seg.segment_id,
                "start_ms": seg.start_ms,
                "end_ms": max(seg.end_ms, seg.start_ms),
                "text": seg.text,
                "language": language,
                "confidence": seg.confidence,
                "transliteration": transliterate(seg.text, language),  # type: ignore[arg-type]
            }
            await self.db.execute(
                insert(TranscriptSegment)
                .values(
                    id=uuid.UUID(seg.segment_id),
                    lecture_id=self.lecture.id,
                    start_ms=row["start_ms"],
                    end_ms=row["end_ms"],
                    text=seg.text,
                    language=language,
                    confidence=seg.confidence,
                    source=source,
                    transliteration=row["transliteration"],
                )
                .on_conflict_do_nothing(index_elements=["id"])
            )
            rows.append(row)
        return rows

    async def live(self, update: Update) -> None:
        assert self.state is not None
        rows = await self.store(update.finals, SegmentSource.live)
        await self.db.commit()
        for row in rows:
            event_seq = await publish_live(
                self.ctx.redis, self.lecture_key, {"type": "transcript.final", **row}
            )
            self.db.add(
                LatencyMark(
                    lecture_id=self.lecture.id,
                    seq=_seq_of(row["end_ms"] / 1000),
                    event_seq=event_seq,
                    stage="published",
                    ts_ms=now_ms(),
                )
            )
            for old in self.state.partial_events.pop(row["segment_id"], []):
                await delete_live_event(self.ctx.redis, self.lecture_key, old)  # D5: trim superseded partials
            self.state.context_text = (self.state.context_text + " " + row["text"])[-200:]
        partial = update.partial
        if partial is not None and self.state.last_partial != (partial.segment_id, partial.text):
            event_seq = await publish_live(
                self.ctx.redis,
                self.lecture_key,
                {
                    "type": "transcript.partial",
                    "segment_id": partial.segment_id,
                    "start_ms": partial.start_ms,
                    "end_ms": max(partial.end_ms, partial.start_ms),
                    "text": partial.text,
                    "language": self._language(partial.text),
                },
            )
            self.state.partial_events.setdefault(partial.segment_id, []).append(event_seq)
            self.state.last_partial = (partial.segment_id, partial.text)
            self.db.add(
                LatencyMark(
                    lecture_id=self.lecture.id,
                    seq=_seq_of(partial.end_ms / 1000),
                    event_seq=event_seq,
                    stage="published",
                    ts_ms=now_ms(),
                )
            )
        await self.db.commit()


async def _transcribe(
    ctx: AsrContext,
    db: AsyncSession,
    lecture: Lecture,
    start_s: float,
    end_s: float,
    beam: int,
    prompt: str | None,
) -> list[Word] | None:
    first, last = _seq_of(start_s), max(_seq_of(start_s), int(np.ceil(end_s / CHUNK_S - 1e-9)) - 1)
    audio = await load_chunks(db, ctx.store, lecture.id, first, last)
    if audio is None:
        return None
    offset = first * CHUNK_S
    window = audio[int((start_s - offset) * SAMPLE_RATE) : int((end_s - offset) * SAMPLE_RATE)]
    language = lecture.language_hint if ctx.settings.asr_language_mode == "fixed" else None
    db.add(LatencyMark(lecture_id=lecture.id, seq=last, stage="asr_start", ts_ms=now_ms()))
    words = await asyncio.to_thread(
        ctx.transcriber.transcribe, window, language=language, prompt=prompt, beam_size=beam
    )
    db.add(LatencyMark(lecture_id=lecture.id, seq=last, stage="asr_end", ts_ms=now_ms()))
    return [Word(w.text, w.start + start_s, w.end + start_s, w.probability) for w in words]


async def _decode_complete_span(
    ctx: AsrContext,
    db: AsyncSession,
    lecture: Lecture,
    committer: LiveCommitter,
    end_s: float,
    beam: int,
    prompt: str | None,
) -> list[Segment]:
    """Transcribes audio that is complete up to end_s, in ≤ 20 s windows (catch-up / backfill)."""
    finals: list[Segment] = []
    while committer.committed_until < end_s - 1e-3:
        start = committer.committed_until
        window_end = min(start + WINDOW_S, end_s)
        words = await _transcribe(ctx, db, lecture, start, window_end, beam, prompt)
        if words is None:
            break
        cut = window_end if window_end >= end_s else window_end - CATCH_UP_MARGIN_S
        finals.extend(committer.force(words, until=max(cut, start + 0.5)).finals)
    return finals


def _gap_at(gaps: list[LectureGap], seq: int) -> LectureGap | None:
    """The gap whose range contains seq (its audio belongs to backfill, never to live)."""
    return next((g for g in gaps if g.start_seq <= seq and (g.end_seq is None or seq <= g.end_seq)), None)


def _next_gap_start(gaps: list[LectureGap], seq: int) -> int | None:
    starts = [g.start_seq for g in gaps if g.start_seq > seq]
    return min(starts) if starts else None


def _contiguous_end(tracker: SeqTracker, seq: int) -> int:
    end = seq
    while tracker.has(end + 1):
        end += 1
    return end


async def _backfill_gap(
    ctx: AsrContext, db: AsyncSession, lecture: Lecture, tracker: SeqTracker, gap: LectureGap, end_seq: int
) -> None:
    """Transcribes every stored run inside the gap and publishes one transcript.backfill."""
    namespace = uuid.uuid5(lecture.id, gap.gap_id)
    segments: list[dict[str, Any]] = []
    emitter = Emitter(ctx, db, lecture, None)
    seq = gap.start_seq
    missing: list[tuple[int, int]] = []
    while seq <= end_seq:
        if not tracker.has(seq):
            hole_start = seq
            while seq + 1 <= end_seq and not tracker.has(seq + 1):
                seq += 1
            missing.append((hole_start, seq))
            seq += 1
            continue
        run_end = min(_contiguous_end(tracker, seq), end_seq)
        committer = LiveCommitter(namespace, committed_until=seq * CHUNK_S)
        finals = await _decode_complete_span(
            ctx, db, lecture, committer, (run_end + 1) * CHUNK_S, BATCH_BEAM, None
        )
        finals.extend(committer.flush())
        segments.extend(await emitter.store(finals, SegmentSource.backfill))
        seq = run_end + 1
    gap.state = GapState.done
    gap.end_seq = end_seq
    for lo, hi in missing:  # audio dropped on the device: shown as "not recorded"
        db.add(
            LectureGap(
                lecture_id=lecture.id,
                gap_id=f"missing-{lo}",
                start_seq=lo,
                end_seq=hi,
                state=GapState.missing,
            )
        )
    await db.commit()
    await publish_live(
        ctx.redis,
        str(lecture.id),
        {
            "type": "transcript.backfill",
            "gap_id": gap.gap_id,
            "segments": segments,
            "gap": {"start_ms": gap.start_seq * CHUNK_MS, "end_ms": (end_seq + 1) * CHUNK_MS},
        },
    )
    log.info(
        "gap_backfilled",
        lecture_id=str(lecture.id),
        gap_id=gap.gap_id,
        segments=len(segments),
        missing=len(missing),
    )


async def process_lecture(ctx: AsrContext, lecture_id: uuid.UUID) -> bool:
    """One processing step. Returns True if more work is immediately available."""
    async with ctx.sessions() as db:
        lecture = await db.get(Lecture, lecture_id)
        if lecture is None or lecture.status != LectureStatus.recording:
            ctx.live.pop(lecture_id, None)
            return False
        progress = await db.get(AsrProgress, lecture_id)
        if progress is None:
            progress = AsrProgress(lecture_id=lecture_id, committed_sample=0)
            db.add(progress)
            await db.commit()
        if progress.finalized:
            return False
        seqs = [
            r[0] for r in await db.execute(select(AudioChunk.seq).where(AudioChunk.lecture_id == lecture_id))
        ]
        tracker = SeqTracker.from_seqs(seqs)
        gaps = list(
            (
                await db.execute(
                    select(LectureGap)
                    .where(LectureGap.lecture_id == lecture_id)
                    .order_by(LectureGap.start_seq)
                )
            ).scalars()
        )

        # 1. Backfill gaps whose audio has fully arrived.
        for gap in gaps:
            if gap.state == GapState.filled and gap.end_seq is not None:
                await _backfill_gap(ctx, db, lecture, tracker, gap, gap.end_seq)

        state = ctx.live.get(lecture_id)
        if state is None:
            state = LiveState(
                LiveCommitter(lecture_id, committed_until=progress.committed_sample / SAMPLE_RATE)
            )
            ctx.live[lecture_id] = state
        emitter = Emitter(ctx, db, lecture, state)
        committer = state.committer

        # 2. Jump the live pointer over gaps whose end is known (their audio belongs to backfill).
        while True:
            at_gap = _gap_at(gaps, _seq_of(committer.committed_until))
            if at_gap is None or at_gap.end_seq is None:
                break
            await emitter.live(Update(finals=committer.flush(until=(at_gap.end_seq + 1) * CHUNK_S)))

        if lecture.stop_received:
            return await _finalize(ctx, db, lecture, progress, tracker, gaps, state, emitter)

        # 3. Live / catch-up step on the contiguous audio after the pointer.
        pointer = _seq_of(committer.committed_until)
        if not tracker.has(pointer) or _gap_at(gaps, pointer) is not None:
            return False
        run_end = _contiguous_end(tracker, pointer)
        next_gap = _next_gap_start(gaps, pointer)
        more = False
        if next_gap is not None and next_gap - 1 <= run_end:
            # Live-first after an outage: the audio before the gap is complete. Commit it fully;
            # the next step jumps the pointer over the gap.
            end = next_gap * CHUNK_S
            finals = await _decode_complete_span(
                ctx, db, lecture, committer, end, LIVE_BEAM, state.context_text or None
            )
            finals.extend(committer.flush(until=end))
            await emitter.live(Update(finals=finals))
            progress.committed_sample = round(committer.committed_until * SAMPLE_RATE)
            await db.commit()
            return True
        audio_end = (run_end + 1) * CHUNK_S
        if audio_end - committer.committed_until > WINDOW_S:
            window_end = committer.committed_until + WINDOW_S
            words = await _transcribe(
                ctx, db, lecture, committer.committed_until, window_end, LIVE_BEAM, state.context_text or None
            )
            if words is not None:
                await emitter.live(committer.force(words, until=window_end - CATCH_UP_MARGIN_S))
            more = True
        elif audio_end - state.decoded_until >= ctx.settings.asr_live_interval_s:
            words = await _transcribe(
                ctx, db, lecture, committer.committed_until, audio_end, LIVE_BEAM, state.context_text or None
            )
            if words is not None:
                await emitter.live(committer.update(words, window_end=audio_end))
                state.decoded_until = audio_end
        progress.committed_sample = round(committer.committed_until * SAMPLE_RATE)
        await db.commit()
        return more


async def _finalize(
    ctx: AsrContext,
    db: AsyncSession,
    lecture: Lecture,
    progress: AsrProgress,
    tracker: SeqTracker,
    gaps: list[LectureGap],
    state: LiveState,
    emitter: Emitter,
) -> bool:
    """After `stop`: every remaining hole is permanent (§1.4.7). Backfill what exists, mark the
    rest missing, transcribe the rest of the live audio, then hand over to the notes worker."""
    last_seq = lecture.last_seq if lecture.last_seq is not None else tracker.max_seq
    for gap in gaps:
        if gap.state == GapState.open:
            await _backfill_gap(
                ctx, db, lecture, tracker, gap, gap.end_seq if gap.end_seq is not None else last_seq
            )
    known = [(g.start_seq, g.end_seq) for g in gaps if g.end_seq is not None]
    for lo, hi in tracker.holes(upto=last_seq):
        if not any(a <= lo and hi <= b for a, b in known):
            db.add(
                LectureGap(
                    lecture_id=lecture.id,
                    gap_id=f"missing-{lo}",
                    start_seq=lo,
                    end_seq=hi,
                    state=GapState.missing,
                )
            )
    await db.commit()

    gaps = list(
        (
            await db.execute(
                select(LectureGap).where(LectureGap.lecture_id == lecture.id).order_by(LectureGap.start_seq)
            )
        ).scalars()
    )
    committer = state.committer
    seq = _seq_of(committer.committed_until)
    while seq <= last_seq:
        covering = _gap_at(gaps, seq)
        if covering is not None:  # backfilled or missing: never transcribed twice
            gap_end = covering.end_seq if covering.end_seq is not None else last_seq
            await emitter.live(Update(finals=committer.flush(until=(gap_end + 1) * CHUNK_S)))
            seq = gap_end + 1
            continue
        if not tracker.has(seq):
            await emitter.live(Update(finals=committer.flush(until=(seq + 1) * CHUNK_S)))
            seq += 1
            continue
        run_end = min(_contiguous_end(tracker, seq), last_seq)
        next_gap = _next_gap_start(gaps, seq)
        if next_gap is not None:
            run_end = min(run_end, next_gap - 1)
        finals = await _decode_complete_span(
            ctx, db, lecture, committer, (run_end + 1) * CHUNK_S, BATCH_BEAM, state.context_text or None
        )
        await emitter.live(Update(finals=finals))
        seq = max(run_end + 1, _seq_of(committer.committed_until))
    await emitter.live(Update(finals=committer.flush()))

    progress.committed_sample = round(committer.committed_until * SAMPLE_RATE)
    progress.finalized = True
    lecture.status = LectureStatus.processing
    lecture.duration_ms = max(lecture.duration_ms, (last_seq + 1) * CHUNK_MS)
    await db.commit()
    await publish_live(
        ctx.redis,
        str(lecture.id),
        {"type": "lecture.status", "status": "processing", "duration_ms": lecture.duration_ms},
    )
    await enqueue_notes(ctx.redis, str(lecture.id))
    ctx.live.pop(lecture.id, None)
    log.info("lecture_transcribed", lecture_id=str(lecture.id), last_seq=last_seq)
    return False
