"""Lectures: list/prepare/get/update/delete and the paginated transcript."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response
from sqlalchemy import Date, and_, cast, delete, func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import schemas
from app.api.deps import Ctx, CurrentUser, Db, LecturerUser, can_edit
from app.api.errors import ApiError, forbidden
from app.api.lectures_view import lecture_views, visible_lecture
from app.db.models import (
    AuditLog,
    Device,
    DeviceLecturer,
    GapState,
    Lecture,
    LectureGap,
    LectureStatus,
    Role,
    Subject,
    TranscriptSegment,
    User,
)
from app.events import live_counter, live_stream, publish_live, send_device_control
from app.gateway.protocol import assign_msg, command_msg
from app.logs import get_logger
from worker.asr.language import transliterate

router = APIRouter(prefix="/lectures", tags=["lectures"])
E404: dict[int | str, dict[str, Any]] = {404: {"model": schemas.ErrorResponse}}
TRANSCRIPT_DEFAULT = 200
log = get_logger("api")


def _visibility(user: User) -> object:
    if user.role == Role.admin:
        return True
    if user.role == Role.lecturer:
        return or_(Lecture.consent_confirmed.is_(True), Lecture.lecturer_id == user.id)
    return Lecture.consent_confirmed.is_(True)


@router.get("", response_model=schemas.LecturePage)
async def list_lectures(
    user: CurrentUser,
    db: Db,
    subject_id: uuid.UUID | None = None,
    q: str | None = None,
    from_: Annotated[date | None, Query(alias="from")] = None,
    to: date | None = None,
    status: schemas.LectureStatus | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 30,
) -> schemas.LecturePage:
    when = func.coalesce(Lecture.started_at, Lecture.created_at)
    local_day = cast(func.timezone("Asia/Kolkata", when), Date)
    conditions: list[object] = [_visibility(user)]
    if subject_id is not None:
        conditions.append(Lecture.subject_id == subject_id)
    if status is not None:
        conditions.append(Lecture.status == LectureStatus(status))
    if from_ is not None:
        conditions.append(local_day >= from_)
    if to is not None:
        conditions.append(local_day <= to)
    query = (
        select(Lecture)
        .outerjoin(Subject, Subject.id == Lecture.subject_id)
        .outerjoin(User, User.id == Lecture.lecturer_id)
    )
    if q:
        pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        conditions.append(
            or_(
                Lecture.title.ilike(pattern),
                Subject.name.ilike(pattern),
                Subject.code.ilike(pattern),
                User.name.ilike(pattern),
            )
        )
    where = and_(*conditions)  # type: ignore[arg-type]
    total = (await db.execute(select(func.count()).select_from(query.where(where).subquery()))).scalar_one()
    rows = await db.execute(
        query.where(where).order_by(when.desc()).offset((page - 1) * page_size).limit(page_size)
    )
    items = await lecture_views(db, list(rows.unique().scalars()))
    return schemas.LecturePage(items=items, page=page, page_size=page_size, total=total)


async def _device_busy(db: AsyncSession, device_id: uuid.UUID) -> bool:
    busy = await db.execute(
        select(Lecture.id).where(
            Lecture.device_id == device_id,
            Lecture.status == LectureStatus.recording,
            Lecture.stop_received.is_(False),
        )
    )
    return busy.first() is not None


@router.post(
    "",
    response_model=schemas.Lecture,
    status_code=201,
    responses={403: {"model": schemas.ErrorResponse}, 409: {"model": schemas.ErrorResponse}},
)
async def create_lecture(
    body: schemas.LectureCreate, user: LecturerUser, db: Db, ctx: Ctx
) -> schemas.Lecture:
    if await db.get(Subject, body.subject_id) is None:
        raise ApiError(422, "unknown_subject", "Choose a subject from the list.")
    device = await db.get(Device, body.device_id)
    assigned = await db.execute(
        select(DeviceLecturer).where(
            DeviceLecturer.device_id == body.device_id, DeviceLecturer.user_id == user.id
        )
    )
    if device is None or (user.role != Role.admin and assigned.first() is None):
        raise ApiError(403, "device_not_assigned", "This device is not assigned to you.")
    if await _device_busy(db, device.id):
        raise ApiError(409, "device_busy", "This device is already recording another lecture.")
    lecture = Lecture(
        title=body.title.strip(),
        subject_id=body.subject_id,
        lecturer_id=user.id,
        device_id=device.id,
        language_hint=body.language,
        consent_confirmed=True,
        status=LectureStatus.scheduled,
    )
    db.add(lecture)
    await db.flush()
    db.add(AuditLog(actor_id=user.id, action="lecture.prepare", target=str(lecture.id)))
    await db.commit()
    await db.refresh(lecture)
    # The OLED shows the title; the lecturer then presses Start on the device.
    await send_device_control(ctx.redis, str(device.id), assign_msg(lecture.id, lecture.title))
    return (await lecture_views(db, [lecture]))[0]


@router.get("/{lecture_id}", response_model=schemas.Lecture, responses=E404)
async def get_lecture(lecture_id: uuid.UUID, user: CurrentUser, db: Db) -> schemas.Lecture:
    return (await lecture_views(db, [await visible_lecture(db, user, lecture_id)]))[0]


@router.patch(
    "/{lecture_id}", response_model=schemas.Lecture, responses={**E404, 403: {"model": schemas.ErrorResponse}}
)
async def update_lecture(
    lecture_id: uuid.UUID, body: schemas.LectureUpdate, user: LecturerUser, db: Db
) -> schemas.Lecture:
    lecture = await visible_lecture(db, user, lecture_id)
    if not can_edit(user, lecture):
        raise forbidden()
    if body.title is not None:
        lecture.title = body.title.strip()
    if body.subject_id is not None:
        if await db.get(Subject, body.subject_id) is None:
            raise ApiError(422, "unknown_subject", "Choose a subject from the list.")
        lecture.subject_id = body.subject_id
    if body.consent_confirmed:
        lecture.consent_confirmed = True
    db.add(AuditLog(actor_id=user.id, action="lecture.update", target=str(lecture.id)))
    await db.commit()
    await db.refresh(lecture)
    return (await lecture_views(db, [lecture]))[0]


@router.delete("/{lecture_id}", status_code=204, responses={**E404, 403: {"model": schemas.ErrorResponse}})
async def delete_lecture(lecture_id: uuid.UUID, user: LecturerUser, db: Db, ctx: Ctx) -> Response:
    lecture = await visible_lecture(db, user, lecture_id)
    if not can_edit(user, lecture):
        raise forbidden()
    if lecture.status == LectureStatus.recording and not lecture.stop_received:
        raise ApiError(409, "lecture_recording", "Stop the recording on the device before deleting.")
    await db.execute(
        delete(Lecture).where(Lecture.id == lecture.id)
    )  # cascades to chunks, segments, artifacts
    db.add(AuditLog(actor_id=user.id, action="lecture.delete", target=str(lecture.id)))
    await db.commit()
    await ctx.store.delete_prefix(f"audio/{lecture.id}")
    await ctx.redis.delete(live_stream(str(lecture.id)), live_counter(str(lecture.id)))
    return Response(status_code=204)


@router.get("/{lecture_id}/transcript", response_model=schemas.TranscriptPage, responses=E404)
async def get_transcript(
    lecture_id: uuid.UUID,
    user: CurrentUser,
    db: Db,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = TRANSCRIPT_DEFAULT,
) -> schemas.TranscriptPage:
    lecture = await visible_lecture(db, user, lecture_id)
    query = select(TranscriptSegment).where(TranscriptSegment.lecture_id == lecture.id)
    if cursor:
        try:
            start_ms, segment_id = cursor.split(":", 1)
            query = query.where(
                tuple_(TranscriptSegment.start_ms, TranscriptSegment.id)
                > (int(start_ms), uuid.UUID(segment_id))
            )
        except ValueError as exc:
            raise ApiError(422, "invalid_cursor", "Invalid transcript cursor.") from exc
    rows = list(
        (
            await db.execute(
                query.order_by(TranscriptSegment.start_ms, TranscriptSegment.id).limit(limit + 1)
            )
        ).scalars()
    )
    page, more = rows[:limit], len(rows) > limit
    gaps = await db.execute(
        select(LectureGap)
        .where(LectureGap.lecture_id == lecture.id, LectureGap.state == GapState.missing)
        .order_by(LectureGap.start_seq)
    )
    return schemas.TranscriptPage(
        items=[
            schemas.TranscriptSegment(
                segment_id=str(s.id),
                start_ms=s.start_ms,
                end_ms=s.end_ms,
                text=s.text,
                language=s.language,
                confidence=s.confidence,
                transliteration=s.transliteration,
                source=s.source.value,
                edited=s.edited,
            )
            for s in page
        ],
        next_cursor=f"{page[-1].start_ms}:{page[-1].id}" if more and page else None,
        gaps=[
            schemas.TranscriptGap(
                gap_id=g.gap_id, start_ms=g.start_seq * 500, end_ms=((g.end_seq or g.start_seq) + 1) * 500
            )
            for g in gaps.scalars()
        ],
    )


def _segment_view(s: TranscriptSegment) -> schemas.TranscriptSegment:
    return schemas.TranscriptSegment(
        segment_id=str(s.id),
        start_ms=s.start_ms,
        end_ms=s.end_ms,
        text=s.text,
        language=s.language,
        confidence=s.confidence,
        transliteration=s.transliteration,
        source=s.source.value,
        edited=s.edited,
    )


E_CONTROL: dict[int | str, dict[str, Any]] = {
    **E404,
    403: {"model": schemas.ErrorResponse},
    409: {"model": schemas.ErrorResponse},
}


@router.post(
    "/{lecture_id}/control", response_model=schemas.ControlAccepted, status_code=202, responses=E_CONTROL
)
async def control_recording(
    lecture_id: uuid.UUID, body: schemas.LectureControl, user: LecturerUser, db: Db, ctx: Ctx
) -> schemas.ControlAccepted:
    """Start/Pause/Resume/Stop from the web Live page. The command goes to the device, which acts as if
    its button was pressed; the result arrives as `lecture.status` on the live socket (202 = sent)."""
    lecture = await visible_lecture(db, user, lecture_id)
    if not can_edit(user, lecture):
        raise forbidden()
    device = await db.get(Device, lecture.device_id) if lecture.device_id is not None else None
    if device is None:
        raise ApiError(409, "no_device", "This lecture has no microphone assigned.")
    if not device.online:
        raise ApiError(409, "device_offline", "The microphone is not connected to the server.")
    active = lecture.status == LectureStatus.recording and not lecture.stop_received
    allowed = {
        "start": lecture.status == LectureStatus.scheduled,
        "pause": active and not lecture.paused,
        "resume": active and lecture.paused,
        "stop": active,
    }[body.action]
    if not allowed:
        raise ApiError(409, "invalid_state", f"Can't {body.action} a lecture that is {lecture.status.value}.")
    if body.action == "start":
        if await _device_busy(db, device.id):
            raise ApiError(409, "device_busy", "This device is already recording another lecture.")
        await send_device_control(ctx.redis, str(device.id), assign_msg(lecture.id, lecture.title))
    await send_device_control(ctx.redis, str(device.id), command_msg(body.action, lecture.id))
    db.add(AuditLog(actor_id=user.id, action=f"lecture.{body.action}", target=str(lecture.id)))
    await db.commit()
    return schemas.ControlAccepted(lecture_id=lecture.id, action=body.action, device_id=device.id)


@router.patch(
    "/{lecture_id}/segments/{segment_id}",
    response_model=schemas.TranscriptSegment,
    responses={**E404, 403: {"model": schemas.ErrorResponse}},
)
async def edit_segment(
    lecture_id: uuid.UUID,
    segment_id: uuid.UUID,
    body: schemas.SegmentUpdate,
    user: LecturerUser,
    db: Db,
    ctx: Ctx,
) -> schemas.TranscriptSegment:
    """Lecturer correction of one transcript line (master plan: manual transcript editing)."""
    lecture = await visible_lecture(db, user, lecture_id)
    if not can_edit(user, lecture):
        raise forbidden()
    segment = await db.get(TranscriptSegment, segment_id)
    if segment is None or segment.lecture_id != lecture.id:
        raise ApiError(404, "segment_not_found", "This transcript line does not exist.")
    segment.text = body.text.strip()
    segment.edited = True
    language = segment.language if segment.language in ("en", "te", "hi") else "en"
    segment.transliteration = transliterate(segment.text, language)  # type: ignore[arg-type]
    try:  # keep Ask retrieval in step with the corrected text; the old vector is kept on failure
        segment.embedding = (await ctx.embedder().embed([segment.text], "document"))[0]
    except Exception:
        log.warning("segment_reembed_failed", segment_id=str(segment.id))
    db.add(AuditLog(actor_id=user.id, action="segment.edit", target=str(segment.id)))
    await db.commit()
    await db.refresh(segment)
    view = _segment_view(segment)
    if lecture.status == LectureStatus.recording:
        # Live viewers replace the line in place (a final with the same segment_id).
        await publish_live(ctx.redis, str(lecture.id), {"type": "transcript.final", **view.model_dump()})
    return view
