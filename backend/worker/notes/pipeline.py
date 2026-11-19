"""Notes pipeline (brief §4.4): topics → per-topic notes + key terms → summary → questions →
segment embeddings. Every LLM output is validated (app/ai/schemas.py) and stored with the model
name and prompt version. Live key terms during recording (D4) are in `live_key_terms`."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai import prompts
from app.ai.client import AiUnavailableError, Embedder, LlmClient
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
from app.db.models import ArtifactKind, Lecture, LectureArtifact, LectureStatus, TranscriptSegment
from app.events import expire_live, publish_live
from app.logs import get_logger
from worker.asr.language import script_language

log = get_logger("notes")
MAX_LINES_PER_CALL = 900


@dataclass
class NotesContext:
    sessions: async_sessionmaker[AsyncSession]
    redis: aioredis.Redis
    llm: LlmClient
    embedder: Embedder
    settings: Settings


def numbered_lines(segments: list[TranscriptSegment]) -> list[str]:
    return [
        f"[{i}|{s.id}|{s.start_ms // 60000}:{s.start_ms // 1000 % 60:02d}] {s.text}"
        for i, s in enumerate(segments)
    ]


def term_id(lecture_id: uuid.UUID, term: str) -> str:
    return str(uuid.uuid5(lecture_id, term.strip().lower()))


def first_mention(segments: list[TranscriptSegment], term: str, default: int | None) -> int | None:
    needle = term.lower()
    return next((s.start_ms for s in segments if needle in s.text.lower()), default)


async def _upsert(
    db: AsyncSession,
    lecture_id: uuid.UUID,
    kind: ArtifactKind,
    content: dict[str, Any],
    model: str,
    prompt_version: str,
    status: str = "ready",
) -> None:
    artifact = (
        (
            await db.execute(
                select(LectureArtifact).where(
                    LectureArtifact.lecture_id == lecture_id, LectureArtifact.kind == kind
                )
            )
        )
        .scalars()
        .first()
    )
    if artifact is None:
        db.add(
            LectureArtifact(
                lecture_id=lecture_id,
                kind=kind,
                content=content,
                model=model,
                prompt_version=prompt_version,
                status=status,
            )
        )
    else:
        artifact.content = content
        artifact.model = model
        artifact.prompt_version = prompt_version
        artifact.status = status
        artifact.version += 1
        artifact.updated_at = datetime.now(UTC)


def _clamp(i: int, n: int) -> int:
    return max(0, min(i, n - 1))


async def build_material(
    ctx: NotesContext, lecture: Lecture, segments: list[TranscriptSegment]
) -> dict[ArtifactKind, dict[str, Any]]:
    lines = numbered_lines(segments)[:MAX_LINES_PER_CALL]
    n = len(segments)
    split = await ctx.llm.generate(prompts.SYSTEM, prompts.topics_prompt(lines), TopicSplit)
    sections: list[dict[str, Any]] = []
    terms: dict[str, dict[str, Any]] = {}
    for topic in split.topics:
        lo, hi = _clamp(topic.start_segment, n), _clamp(topic.end_segment, n)
        if hi < lo:
            lo, hi = hi, lo
        notes = await ctx.llm.generate(
            prompts.SYSTEM,
            prompts.topic_notes_prompt(topic.title, numbered_lines(segments)[lo : hi + 1]),
            TopicNotes,
        )
        sections.append(
            {
                "id": str(uuid.uuid4()),
                "heading": notes.heading,
                "body_markdown": notes.body_markdown,
                "start_ms": segments[lo].start_ms,
            }
        )
        for t in notes.key_terms:
            key = t.term.strip().lower()
            if key not in terms:
                terms[key] = {
                    "id": term_id(lecture.id, t.term),
                    "term": t.term.strip(),
                    "definition": t.definition.strip(),
                    "language": script_language(t.term),
                    "first_mentioned_ms": first_mention(segments, t.term, segments[lo].start_ms),
                }
    summary = await ctx.llm.generate(prompts.SYSTEM, prompts.summary_prompt(lines), LectureSummary)
    questions = await ctx.llm.generate(prompts.SYSTEM, prompts.questions_prompt(lines), QuestionsOut)
    flashcards = await ctx.llm.generate(prompts.SYSTEM, prompts.flashcards_prompt(lines), FlashcardsOut)
    revision = await ctx.llm.generate(prompts.SYSTEM, prompts.revision_prompt(lines), RevisionOut)

    def source(i: int | None) -> int | None:
        return None if i is None else segments[_clamp(i, n)].start_ms

    return {
        ArtifactKind.notes: {"sections": sections},
        ArtifactKind.key_terms: {"items": sorted(terms.values(), key=lambda t: t["first_mentioned_ms"] or 0)},
        ArtifactKind.summary: {"overview": summary.overview, "key_points": summary.key_points},
        ArtifactKind.questions: {
            "mcq": [
                {
                    "id": f"q{i + 1}",
                    "prompt": q.prompt,
                    "options": q.options,
                    "correct_index": q.correct_index,
                    "explanation": q.explanation,
                    "source_ms": source(q.source_segment),
                }
                for i, q in enumerate(questions.mcq)
            ],
            "short_answer": [
                {
                    "id": f"s{i + 1}",
                    "prompt": q.prompt,
                    "model_answer": q.model_answer,
                    "source_ms": source(q.source_segment),
                }
                for i, q in enumerate(questions.short_answer)
            ],
        },
        ArtifactKind.flashcards: {
            "cards": [
                {"id": f"f{i + 1}", "front": c.front, "back": c.back, "source_ms": source(c.source_segment)}
                for i, c in enumerate(flashcards.cards)
            ]
        },
        ArtifactKind.revision: {"points": revision.points, "takeaways": revision.takeaways},
    }


async def embed_segments(ctx: NotesContext, db: AsyncSession, segments: list[TranscriptSegment]) -> bool:
    if not segments:
        return True
    try:
        vectors = await ctx.embedder.embed([s.text for s in segments], "document")
    except AiUnavailableError:
        log.warning("embedding_failed_lexical_fallback")
        return False
    for segment, vector in zip(segments, vectors, strict=True):
        await db.execute(
            update(TranscriptSegment).where(TranscriptSegment.id == segment.id).values(embedding=vector)
        )
    return True


async def generate_lecture_material(ctx: NotesContext, lecture_id: uuid.UUID) -> None:
    async with ctx.sessions() as db:
        lecture = await db.get(Lecture, lecture_id)
        if lecture is None:
            return
        segments = list(
            (
                await db.execute(
                    select(TranscriptSegment)
                    .where(TranscriptSegment.lecture_id == lecture_id)
                    .order_by(TranscriptSegment.start_ms)
                )
            ).scalars()
        )
        model, version = ctx.llm.model_name, ctx.settings.prompt_version
        kinds: list[str] = []
        if segments:
            try:
                material = await build_material(ctx, lecture, segments)
                for kind, content in material.items():
                    await _upsert(db, lecture_id, kind, content, model, version)
                kinds = [k.value for k in material]
            except AiUnavailableError as exc:
                log.error("notes_generation_failed", lecture_id=str(lecture_id), error=str(exc))
                for kind in ArtifactKind:
                    await _upsert(db, lecture_id, kind, {}, model, version, status="failed")
            await embed_segments(ctx, db, segments)
        # The lecture is complete either way: the transcript stays useful without AI material.
        lecture.status = LectureStatus.completed
        await db.commit()
    if kinds:
        await publish_live(ctx.redis, str(lecture_id), {"type": "notes.ready", "kinds": kinds})
    await publish_live(
        ctx.redis,
        str(lecture_id),
        {"type": "lecture.status", "status": "completed", "duration_ms": lecture.duration_ms},
    )
    await expire_live(ctx.redis, str(lecture_id))
    log.info("lecture_completed", lecture_id=str(lecture_id), kinds=kinds)


async def live_key_terms(ctx: NotesContext, lecture_id: uuid.UUID, since_ms: int) -> int:
    """Extracts terms from final text newer than `since_ms`; returns the new high-water mark."""
    async with ctx.sessions() as db:
        segments = list(
            (
                await db.execute(
                    select(TranscriptSegment)
                    .where(TranscriptSegment.lecture_id == lecture_id, TranscriptSegment.start_ms > since_ms)
                    .order_by(TranscriptSegment.start_ms)
                )
            ).scalars()
        )
        if not segments:
            return since_ms
        artifact = (
            (
                await db.execute(
                    select(LectureArtifact).where(
                        LectureArtifact.lecture_id == lecture_id,
                        LectureArtifact.kind == ArtifactKind.key_terms,
                    )
                )
            )
            .scalars()
            .first()
        )
        existing: list[dict[str, Any]] = list(artifact.content.get("items", [])) if artifact else []
        known = [t["term"] for t in existing]
        try:
            out = await ctx.llm.generate(
                prompts.SYSTEM, prompts.live_terms_prompt(known, numbered_lines(segments)), LiveKeyTerms
            )
        except AiUnavailableError:
            return since_ms  # try again next round
        known_lower = {k.lower() for k in known}
        fresh = [
            {
                "id": term_id(lecture_id, t.term),
                "term": t.term.strip(),
                "definition": t.definition.strip(),
                "language": script_language(t.term),
                "first_mentioned_ms": first_mention(segments, t.term, segments[0].start_ms),
            }
            for t in out.terms
            if t.term.strip().lower() not in known_lower
        ]
        if fresh:
            await _upsert(
                db,
                lecture_id,
                ArtifactKind.key_terms,
                {"items": existing + fresh},
                ctx.llm.model_name,
                ctx.settings.prompt_version,
                status="live",
            )
            await db.commit()
            await publish_live(ctx.redis, str(lecture_id), {"type": "key_terms.update", "terms": fresh})
        return segments[-1].start_ms
