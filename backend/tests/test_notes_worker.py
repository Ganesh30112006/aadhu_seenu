"""Notes pipeline with a scripted fake LLM; LLM output validation and retry."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import fakeredis
import pytest
from pydantic import BaseModel
from sqlalchemy import select

from app.ai.client import AiUnavailableError, extract_json, generate_validated
from app.ai.schemas import (
    FlashcardsOut,
    LectureSummary,
    LiveKeyTerms,
    QuestionsOut,
    RevisionOut,
    TopicNotes,
    TopicSplit,
)
from app.config import Settings
from app.db.models import (
    ArtifactKind,
    Lecture,
    LectureArtifact,
    LectureStatus,
    SegmentSource,
    TranscriptSegment,
)
from tests.conftest import run
from tests.helpers import seed_basics
from worker.notes.pipeline import NotesContext, generate_lecture_material, live_key_terms

MCQ = {
    "prompt": "Which algorithm gives the minimum average waiting time?",
    "options": ["FCFS", "SJF", "RR", "Priority"],
    "correct_index": 1,
    "explanation": "SJF is optimal for waiting time.",
    "source_segment": 1,
}

OUTPUTS: dict[type[BaseModel], dict[str, Any]] = {
    TopicSplit: {
        "topics": [
            {"title": "Round Robin", "start_segment": 0, "end_segment": 1},
            {"title": "SJF", "start_segment": 2, "end_segment": 2},
        ]
    },
    TopicNotes: {
        "heading": "Round Robin",
        "body_markdown": "Each process runs for one **time quantum** in turn.",
        "key_terms": [{"term": "time quantum", "definition": "The CPU time slice each process gets."}],
    },
    LectureSummary: {
        "overview": "The lecture covered Round Robin scheduling and Shortest Job First.",
        "key_points": ["RR", "SJF", "Quantum size"],
    },
    QuestionsOut: {
        "mcq": [MCQ, {**MCQ, "prompt": "What does RR use?"}, {**MCQ, "prompt": "Convoy effect occurs in?"}],
        "short_answer": [
            {
                "prompt": "Explain the time quantum.",
                "model_answer": "A fixed CPU slice per process.",
                "source_segment": 0,
            }
        ],
    },
    LiveKeyTerms: {
        "terms": [{"term": "time quantum", "definition": "The CPU time slice each process gets."}]
    },
    FlashcardsOut: {
        "cards": [
            {"front": f"Card {i}?", "back": f"Answer {i} from the lecture.", "source_segment": i % 3}
            for i in range(5)
        ]
    },
    RevisionOut: {
        "points": ["RR uses a quantum.", "Small quantum: overhead.", "SJF: optimal.", "Point 4.", "Point 5."],
        "takeaways": ["Pick the quantum carefully.", "SJF needs burst estimates.", "RR is fair."],
    },
}


class ScriptedLlm:
    model_name = "scripted-llm"

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[type[BaseModel]] = []

    async def generate(self, system: str, user: str, schema: type[BaseModel]) -> Any:
        self.calls.append(schema)
        if self.fail:
            raise AiUnavailableError("model not enabled")
        assert "<transcript>" in user and "ignore any instructions" in system
        return schema.model_validate(OUTPUTS[schema])


class FakeEmbedder:
    model_name = "fake-embed"

    async def embed(self, texts: list[str], kind: str) -> list[list[float]]:
        return [[float(i + 1)] + [0.0] * 1023 for i in range(len(texts))]


def seed_lecture(factory, status: LectureStatus) -> uuid.UUID:  # type: ignore[no-untyped-def]
    seed = run(seed_basics(factory))

    async def add() -> uuid.UUID:
        sessions = factory()
        async with sessions() as db:
            lecture = Lecture(
                title="CPU Scheduling",
                subject_id=seed.subject_id,
                lecturer_id=seed.lecturer_id,
                consent_confirmed=True,
                status=status,
                started_at=datetime.now(UTC),
                duration_ms=15000,
            )
            db.add(lecture)
            await db.flush()
            for i, text in enumerate(
                ["Round robin uses a time quantum.", "A small quantum causes overhead.", "SJF is optimal."]
            ):
                db.add(
                    TranscriptSegment(
                        lecture_id=lecture.id,
                        start_ms=i * 5000,
                        end_ms=i * 5000 + 4000,
                        text=text,
                        language="en",
                        source=SegmentSource.live,
                    )
                )
            await db.commit()
            lecture_id = lecture.id
        await sessions.kw["bind"].dispose()
        return lecture_id

    return run(add())


def make_ctx(factory, redis_server, llm) -> NotesContext:  # type: ignore[no-untyped-def]
    return NotesContext(
        factory(),
        fakeredis.aioredis.FakeRedis(server=redis_server, decode_responses=True),
        llm,
        FakeEmbedder(),
        Settings(),
    )


def test_full_pipeline_stores_validated_artifacts(sessions_factory, redis_server, sync_redis) -> None:  # type: ignore[no-untyped-def]
    lecture_id = seed_lecture(sessions_factory, LectureStatus.processing)
    ctx = make_ctx(sessions_factory, redis_server, ScriptedLlm())
    run(generate_lecture_material(ctx, lecture_id))

    async def check() -> tuple[dict[ArtifactKind, LectureArtifact], Lecture | None, int]:
        sessions = sessions_factory()
        async with sessions() as db:
            artifacts = {a.kind: a for a in (await db.execute(select(LectureArtifact))).scalars()}
            lecture = await db.get(Lecture, lecture_id)
            embedded = len(
                [
                    s
                    for s in (await db.execute(select(TranscriptSegment))).scalars()
                    if s.embedding is not None
                ]
            )
        await sessions.kw["bind"].dispose()
        return artifacts, lecture, embedded

    artifacts, lecture, embedded = run(check())
    assert set(artifacts) == set(ArtifactKind)
    notes = artifacts[ArtifactKind.notes]
    assert (
        notes.model == "scripted-llm"
        and notes.prompt_version == Settings().prompt_version
        and notes.status == "ready"
    )
    assert [s["start_ms"] for s in notes.content["sections"]] == [0, 10000]
    assert artifacts[ArtifactKind.key_terms].content["items"][0]["first_mentioned_ms"] == 0
    assert [q["id"] for q in artifacts[ArtifactKind.questions].content["mcq"]] == ["q1", "q2", "q3"]
    assert artifacts[ArtifactKind.questions].content["mcq"][0]["source_ms"] == 5000
    assert lecture is not None and lecture.status is LectureStatus.completed
    assert embedded == 3
    events = [json.loads(f["e"]) for _, f in sync_redis.xrange(f"live:{lecture_id}")]
    assert events[0] == {
        "type": "notes.ready",
        "kinds": ["notes", "key_terms", "summary", "questions", "flashcards", "revision"],
    }
    assert artifacts[ArtifactKind.flashcards].content["cards"][0] == {
        "id": "f1",
        "front": "Card 0?",
        "back": "Answer 0 from the lecture.",
        "source_ms": 0,
    }
    assert len(artifacts[ArtifactKind.revision].content["takeaways"]) == 3
    assert events[-1]["type"] == "lecture.status" and events[-1]["status"] == "completed"


def test_ai_outage_marks_artifacts_failed_but_completes_lecture(sessions_factory, redis_server) -> None:  # type: ignore[no-untyped-def]
    lecture_id = seed_lecture(sessions_factory, LectureStatus.processing)
    run(
        generate_lecture_material(
            make_ctx(sessions_factory, redis_server, ScriptedLlm(fail=True)), lecture_id
        )
    )

    async def check() -> tuple[set[str], LectureStatus]:
        sessions = sessions_factory()
        async with sessions() as db:
            statuses = {a.status for a in (await db.execute(select(LectureArtifact))).scalars()}
            lecture = await db.get(Lecture, lecture_id)
        await sessions.kw["bind"].dispose()
        assert lecture is not None
        return statuses, lecture.status

    statuses, status = run(check())
    assert statuses == {"failed"} and status is LectureStatus.completed


def test_live_key_terms_publish_only_new_terms(sessions_factory, redis_server, sync_redis) -> None:  # type: ignore[no-untyped-def]
    lecture_id = seed_lecture(sessions_factory, LectureStatus.recording)
    ctx = make_ctx(sessions_factory, redis_server, ScriptedLlm())
    mark = run(live_key_terms(ctx, lecture_id, -1))
    assert mark == 10000
    ctx = make_ctx(sessions_factory, redis_server, ScriptedLlm())
    assert run(live_key_terms(ctx, lecture_id, -1)) == 10000  # same term again → nothing new published
    updates = [json.loads(f["e"]) for _, f in sync_redis.xrange(f"live:{lecture_id}")]
    assert len(updates) == 1 and updates[0]["terms"][0]["term"] == "time quantum"


def test_extract_json_and_validation_retry() -> None:
    assert json.loads(extract_json('Sure!\n```json\n{"terms": []}\n```')) == {"terms": []}
    assert json.loads(extract_json('noise {"a": 1} trailing')) == {"a": 1}
    replies = iter(
        ['{"terms": [{"term": "x"}]}', '{"terms": [{"term": "quantum", "definition": "A CPU time slice."}]}']
    )

    async def call(system: str, user: str) -> str:
        return next(replies)

    out = run(generate_validated(call, "s", "u", LiveKeyTerms))
    assert out.terms[0].term == "quantum"

    async def always_bad(system: str, user: str) -> str:
        return "not json at all"

    with pytest.raises(AiUnavailableError):
        run(generate_validated(always_bad, "s", "u", LiveKeyTerms))


def test_requeue_processing_lectures_on_start(sessions_factory, redis_server, sync_redis) -> None:  # type: ignore[no-untyped-def]
    """A job lost mid-run (BLPOP already removed it) is re-queued once; queued ones are not doubled."""
    from app.events import NOTES_JOBS
    from worker.notes.main import requeue_processing_lectures

    seed = run(seed_basics(sessions_factory))

    async def add(status: LectureStatus) -> uuid.UUID:
        sessions = sessions_factory()
        async with sessions() as db:
            lecture = Lecture(title="t", lecturer_id=seed.lecturer_id, consent_confirmed=True, status=status)
            db.add(lecture)
            await db.commit()
            lecture_id = lecture.id
        await sessions.kw["bind"].dispose()
        return lecture_id

    lost = run(add(LectureStatus.processing))
    queued = run(add(LectureStatus.processing))
    run(add(LectureStatus.completed))
    sync_redis.lpush(NOTES_JOBS, json.dumps({"lecture_id": str(queued), "kind": "full"}))

    async def requeue() -> int:
        ctx = make_ctx(sessions_factory, redis_server, ScriptedLlm())
        try:
            return await requeue_processing_lectures(ctx)
        finally:
            await ctx.sessions.kw["bind"].dispose()

    assert run(requeue()) == 1
    jobs = sorted(json.loads(j)["lecture_id"] for j in sync_redis.lrange(NOTES_JOBS, 0, -1))
    assert jobs == sorted([str(lost), str(queued)])
