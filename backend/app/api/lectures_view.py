"""ORM → API conversion for lectures, including the aggregate fields shown in lists."""

from __future__ import annotations

import uuid
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import errors, schemas
from app.api.deps import can_view
from app.db.models import ArtifactKind, Lecture, LectureArtifact, TranscriptSegment, User


async def lecture_views(db: AsyncSession, lectures: list[Lecture]) -> list[schemas.Lecture]:
    ids = [lecture.id for lecture in lectures]
    languages: dict[uuid.UUID, list[str]] = {}
    notes: dict[uuid.UUID, LectureArtifact] = {}
    if ids:
        rows = await db.execute(
            select(TranscriptSegment.lecture_id, func.array_agg(func.distinct(TranscriptSegment.language)))
            .where(TranscriptSegment.lecture_id.in_(ids))
            .group_by(TranscriptSegment.lecture_id)
        )
        languages = {lecture_id: sorted(langs) for lecture_id, langs in rows.all()}
        artifacts = await db.execute(
            select(LectureArtifact).where(
                LectureArtifact.lecture_id.in_(ids), LectureArtifact.kind == ArtifactKind.notes
            )
        )
        notes = {a.lecture_id: a for a in artifacts.scalars()}
    out: list[schemas.Lecture] = []
    for lecture in lectures:
        artifact = notes.get(lecture.id)
        detected = languages.get(lecture.id) or [lecture.language_hint]
        out.append(
            schemas.Lecture(
                id=lecture.id,
                title=lecture.title,
                subject=schemas.SubjectRef.model_validate(lecture.subject) if lecture.subject else None,
                lecturer_id=lecture.lecturer_id,
                lecturer_name=lecture.lecturer.name if lecture.lecturer else None,
                status=lecture.status.value,
                language=cast(schemas.LanguageCode, lecture.language_hint),
                languages_detected=cast(list[schemas.LanguageCode], detected),
                started_at=lecture.started_at,
                ended_at=lecture.ended_at,
                duration_ms=lecture.duration_ms,
                notes_ready=artifact is not None and artifact.status == "ready",
                notes_published=artifact is not None and artifact.published_at is not None,
                consent_confirmed=lecture.consent_confirmed,
                device_id=lecture.device_id,
                created_at=lecture.created_at,
                paused=lecture.paused,
                audio_available=lecture.audio_purged_at is None,
            )
        )
    return out


async def visible_lecture(db: AsyncSession, user: User, lecture_id: uuid.UUID) -> Lecture:
    lecture = await db.get(Lecture, lecture_id)
    if lecture is None or not can_view(user, lecture):
        raise errors.not_found()  # 404 rather than 403: don't reveal unconsented lectures
    return lecture
