"""AI study material: notes (edit/regenerate/publish), summary, key terms, questions, flashcards,
revision notes, Ask."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter
from sqlalchemy import case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import prompts
from app.ai.client import AiUnavailableError
from app.ai.schemas import QaAnswer
from app.api import schemas
from app.api.deps import Ctx, CurrentUser, Db, LecturerUser, can_edit
from app.api.errors import ApiError, forbidden
from app.api.lectures_view import visible_lecture
from app.api.text import escape_like
from app.db.models import (
    ArtifactKind,
    AuditLog,
    Lecture,
    LectureArtifact,
    QaMessage,
    Role,
    TranscriptSegment,
    User,
)
from app.events import enqueue_notes

router = APIRouter(prefix="/lectures/{lecture_id}", tags=["study"])
E: dict[int | str, dict[str, Any]] = {
    404: {"model": schemas.ErrorResponse},
    403: {"model": schemas.ErrorResponse},
    409: {"model": schemas.ErrorResponse},
}
ASK_PER_MINUTE = 10
RETRIEVE_K = 8


async def _artifact(db: AsyncSession, lecture: Lecture, kind: ArtifactKind) -> LectureArtifact | None:
    row = await db.execute(
        select(LectureArtifact).where(LectureArtifact.lecture_id == lecture.id, LectureArtifact.kind == kind)
    )
    return row.scalars().first()


async def _readable(
    db: AsyncSession, user: User, lecture: Lecture, kind: ArtifactKind, what: str
) -> LectureArtifact:
    artifact = await _artifact(db, lecture, kind)
    if artifact is None or (artifact.status in ("pending", "failed") and artifact.version <= 1):
        raise ApiError(404, f"{what}_not_ready", "Not generated yet.")
    staff = can_edit(user, lecture) or user.role == Role.admin
    if not staff and artifact.published_at is None and artifact.status != "live":
        raise ApiError(404, f"{what}_not_published", "The lecturer has not published this yet.")
    return artifact


def _notes(lecture: Lecture, artifact: LectureArtifact) -> schemas.Notes:
    status = artifact.status if artifact.status in ("pending", "ready", "failed") else "ready"
    return schemas.Notes(
        lecture_id=lecture.id,
        published=artifact.published_at is not None,
        generation_status=status,
        updated_at=artifact.updated_at,
        version=artifact.version,
        sections=[schemas.NoteSection.model_validate(s) for s in artifact.content.get("sections", [])],
    )


@router.get("/notes", response_model=schemas.Notes, responses=E)
async def get_notes(lecture_id: uuid.UUID, user: CurrentUser, db: Db) -> schemas.Notes:
    lecture = await visible_lecture(db, user, lecture_id)
    return _notes(lecture, await _readable(db, user, lecture, ArtifactKind.notes, "notes"))


@router.patch("/notes", response_model=schemas.Notes, responses=E)
async def update_notes(
    lecture_id: uuid.UUID, body: schemas.NotesUpdate, user: LecturerUser, db: Db
) -> schemas.Notes:
    lecture = await visible_lecture(db, user, lecture_id)
    if not can_edit(user, lecture):
        raise forbidden()
    artifact = await _artifact(db, lecture, ArtifactKind.notes)
    if artifact is None:
        raise ApiError(404, "notes_not_ready", "Notes have not been generated yet.")
    if body.version != artifact.version:
        raise ApiError(409, "version_conflict", "These notes were changed elsewhere.")
    previous = {s["id"]: s for s in artifact.content.get("sections", [])}
    artifact.content = {
        "sections": [
            {
                "id": s.id or str(uuid.uuid4()),
                "heading": s.heading.strip(),
                "body_markdown": s.body_markdown,
                "start_ms": previous.get(s.id or "", {}).get("start_ms"),
            }
            for s in body.sections
        ]
    }
    artifact.version += 1
    artifact.edited_by = user.id
    artifact.updated_at = datetime.now(UTC)
    db.add(AuditLog(actor_id=user.id, action="notes.edit", target=str(lecture.id)))
    await db.commit()
    return _notes(lecture, artifact)


@router.post("/notes/regenerate", response_model=schemas.Notes, status_code=202, responses=E)
async def regenerate_notes(lecture_id: uuid.UUID, user: LecturerUser, db: Db, ctx: Ctx) -> schemas.Notes:
    lecture = await visible_lecture(db, user, lecture_id)
    if not can_edit(user, lecture):
        raise forbidden()
    artifact = await _artifact(db, lecture, ArtifactKind.notes)
    if artifact is None:
        raise ApiError(404, "notes_not_ready", "Notes have not been generated yet.")
    artifact.status = "pending"
    artifact.version += 1
    db.add(AuditLog(actor_id=user.id, action="notes.regenerate", target=str(lecture.id)))
    await db.commit()
    await enqueue_notes(ctx.redis, str(lecture.id), kind="regenerate")
    return _notes(lecture, artifact)


@router.post("/publish", response_model=schemas.Notes, responses=E)
async def publish_notes(lecture_id: uuid.UUID, user: LecturerUser, db: Db) -> schemas.Notes:
    """Publishes the lecture's study material (notes, summary, key terms, questions) to students."""
    lecture = await visible_lecture(db, user, lecture_id)
    if not can_edit(user, lecture):
        raise forbidden()
    if not lecture.consent_confirmed:
        raise ApiError(409, "consent_required", "Confirm recording consent before publishing.")
    notes = await _artifact(db, lecture, ArtifactKind.notes)
    if notes is None or notes.status != "ready":
        raise ApiError(409, "notes_pending", "Wait for generation to finish.")
    now = datetime.now(UTC)
    for kind in ArtifactKind:
        artifact = await _artifact(db, lecture, kind)
        if artifact is not None and artifact.status == "ready":
            artifact.published_at = now
    db.add(AuditLog(actor_id=user.id, action="notes.publish", target=str(lecture.id)))
    await db.commit()
    return _notes(lecture, notes)


@router.get("/summary", response_model=schemas.Summary, responses=E)
async def get_summary(lecture_id: uuid.UUID, user: CurrentUser, db: Db) -> schemas.Summary:
    lecture = await visible_lecture(db, user, lecture_id)
    artifact = await _readable(db, user, lecture, ArtifactKind.summary, "summary")
    return schemas.Summary(lecture_id=lecture.id, generated_at=artifact.updated_at, **artifact.content)


@router.get("/key-terms", response_model=schemas.KeyTermList, responses=E)
async def get_key_terms(lecture_id: uuid.UUID, user: CurrentUser, db: Db) -> schemas.KeyTermList:
    lecture = await visible_lecture(db, user, lecture_id)
    artifact = await _readable(db, user, lecture, ArtifactKind.key_terms, "key_terms")
    return schemas.KeyTermList(
        items=[schemas.KeyTerm.model_validate(t) for t in artifact.content.get("items", [])]
    )


@router.get("/flashcards", response_model=schemas.FlashcardSet, responses=E)
async def get_flashcards(lecture_id: uuid.UUID, user: CurrentUser, db: Db) -> schemas.FlashcardSet:
    lecture = await visible_lecture(db, user, lecture_id)
    artifact = await _readable(db, user, lecture, ArtifactKind.flashcards, "flashcards")
    return schemas.FlashcardSet(
        lecture_id=lecture.id,
        cards=[schemas.Flashcard.model_validate(c) for c in artifact.content.get("cards", [])],
    )


@router.get("/revision", response_model=schemas.RevisionNotes, responses=E)
async def get_revision(lecture_id: uuid.UUID, user: CurrentUser, db: Db) -> schemas.RevisionNotes:
    lecture = await visible_lecture(db, user, lecture_id)
    artifact = await _readable(db, user, lecture, ArtifactKind.revision, "revision")
    return schemas.RevisionNotes(
        lecture_id=lecture.id,
        points=list(artifact.content.get("points", [])),
        takeaways=list(artifact.content.get("takeaways", [])),
        generated_at=artifact.updated_at,
    )


@router.get("/questions", response_model=schemas.QuestionSet, responses=E)
async def get_questions(lecture_id: uuid.UUID, user: CurrentUser, db: Db) -> schemas.QuestionSet:
    lecture = await visible_lecture(db, user, lecture_id)
    artifact = await _readable(db, user, lecture, ArtifactKind.questions, "questions")
    return schemas.QuestionSet(lecture_id=lecture.id, **artifact.content)


async def _retrieve(db: AsyncSession, ctx: Any, lecture: Lecture, question: str) -> list[TranscriptSegment]:
    has_embeddings = (
        await db.execute(
            select(func.count())
            .select_from(TranscriptSegment)
            .where(TranscriptSegment.lecture_id == lecture.id, TranscriptSegment.embedding.is_not(None))
        )
    ).scalar_one() > 0
    if has_embeddings:
        try:
            vector = (await ctx.embedder().embed([question], "query"))[0]
            rows = await db.execute(
                select(TranscriptSegment)
                .where(TranscriptSegment.lecture_id == lecture.id, TranscriptSegment.embedding.is_not(None))
                .order_by(TranscriptSegment.embedding.cosine_distance(vector))
                .limit(RETRIEVE_K)
            )
            return list(rows.scalars())
        except AiUnavailableError:
            pass  # fall back to lexical retrieval below
    # Lexical fallback that works for every script: score = number of question keywords contained.
    keywords = [w for w in (k.strip(".,?!;:'\"()") for k in question.lower().split()) if len(w) >= 4][:8]
    if not keywords:
        return []
    score = sum(
        (
            case((TranscriptSegment.text.ilike(f"%{escape_like(w)}%", escape="\\"), 1), else_=0)
            for w in keywords
        ),
        start=literal(0),
    )
    rows = await db.execute(
        select(TranscriptSegment)
        .where(TranscriptSegment.lecture_id == lecture.id, score > 0)
        .order_by(score.desc(), TranscriptSegment.start_ms)
        .limit(RETRIEVE_K)
    )
    return list(rows.scalars())


@router.post(
    "/ask",
    response_model=schemas.AskResponse,
    responses={**E, 429: {"model": schemas.ErrorResponse}, 503: {"model": schemas.ErrorResponse}},
)
async def ask_lecture(
    lecture_id: uuid.UUID, body: schemas.AskRequest, user: CurrentUser, db: Db, ctx: Ctx
) -> schemas.AskResponse:
    lecture = await visible_lecture(db, user, lecture_id)
    key = f"ask:{user.id}"
    count = int(await ctx.redis.incr(key))
    if count == 1:
        await ctx.redis.expire(key, 60)
    if count > ASK_PER_MINUTE:
        raise ApiError(429, "rate_limited", "You're asking quickly. Wait a moment and try again.")
    segments = sorted(await _retrieve(db, ctx, lecture, body.question), key=lambda s: s.start_ms)
    if not segments:
        answer = QaAnswer(covered=False, answer="This is not covered in this lecture.", cited_segment_ids=[])
    else:
        lines = [
            f"[{i}|{s.id}|{s.start_ms // 60000}:{s.start_ms // 1000 % 60:02d}] {s.text}"
            for i, s in enumerate(segments)
        ]
        try:
            answer = await ctx.llm().generate(
                prompts.SYSTEM, prompts.qa_prompt(body.question, lines), QaAnswer
            )
        except AiUnavailableError as exc:
            raise ApiError(
                503, "ai_unavailable", "The answering service is unavailable. Try again later."
            ) from exc
    retrieved = {str(s.id) for s in segments}
    cited = [sid for sid in answer.cited_segment_ids if sid in retrieved]  # never trust ids the model invents
    if not answer.covered:
        cited = []
    db.add(
        QaMessage(
            lecture_id=lecture.id,
            user_id=user.id,
            question=body.question,
            answer=answer.answer,
            cited_segment_ids=[uuid.UUID(c) for c in cited],
        )
    )
    await db.commit()
    return schemas.AskResponse(answer=answer.answer, cited_segment_ids=cited)
