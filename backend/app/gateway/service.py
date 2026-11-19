"""Gateway database operations (one short transaction each)."""

from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.audio.frames import CHUNK_MS, Frame
from app.db.models import (
    AudioChunk,
    Device,
    DeviceLecturer,
    GapState,
    LatencyMark,
    Lecture,
    LectureGap,
    LectureStatus,
)

DISPLAY_TZ = ZoneInfo("Asia/Kolkata")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def authenticate(db: AsyncSession, device_id: uuid.UUID, token: str) -> Device | None:
    device = await db.get(Device, device_id)
    if device is None or not hmac.compare_digest(device.token_hash, hash_token(token)):
        return None
    return device


async def set_device_seen(
    db: AsyncSession,
    device_id: uuid.UUID,
    *,
    online: bool,
    firmware: str | None = None,
    status: dict[str, object] | None = None,
) -> None:
    values: dict[str, object] = {"online": online, "last_seen_at": datetime.now(UTC)}
    if firmware is not None:
        values["firmware_version"] = firmware
    if status is not None:
        values["last_status"] = status
    await db.execute(update(Device).where(Device.id == device_id).values(**values))
    await db.commit()


async def pending_assignment(db: AsyncSession, device_id: uuid.UUID) -> Lecture | None:
    """The newest prepared lecture for this device that hasn't started yet."""
    result = await db.execute(
        select(Lecture)
        .where(
            Lecture.device_id == device_id,
            Lecture.status == LectureStatus.scheduled,
            Lecture.session_id.is_(None),
        )
        .order_by(Lecture.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def _sole_lecturer(db: AsyncSession, device_id: uuid.UUID) -> uuid.UUID | None:
    rows = (
        await db.execute(select(DeviceLecturer.user_id).where(DeviceLecturer.device_id == device_id))
    ).all()
    return rows[0][0] if len(rows) == 1 else None


async def bind_session(
    db: AsyncSession,
    device_id: uuid.UUID,
    session_id: uuid.UUID,
    lecture_id: uuid.UUID | None,
    started_unix_ms: int,
) -> tuple[Lecture, bool]:
    """Maps a device session to a lecture, idempotently. Returns (lecture, newly_started)."""
    existing = (await db.execute(select(Lecture).where(Lecture.session_id == session_id))).scalars().first()
    if existing is not None:
        return existing, False
    started = (
        datetime.fromtimestamp(started_unix_ms / 1000, UTC) if started_unix_ms > 0 else datetime.now(UTC)
    )
    lecture: Lecture | None = None
    if lecture_id is not None:
        candidate = await db.get(Lecture, lecture_id)
        if (
            candidate is not None
            and candidate.device_id == device_id
            and candidate.session_id is None
            and candidate.status == LectureStatus.scheduled
        ):
            lecture = candidate
    if lecture is None:
        # Start pressed without a prepared lecture (brief §2.4): "Untitled – <date time>".
        # Consent was not confirmed in the web app, so students can't see it until the lecturer does.
        local = started.astimezone(DISPLAY_TZ)
        lecture = Lecture(
            title=f"Untitled – {local:%d %b %Y %H:%M}",
            device_id=device_id,
            lecturer_id=await _sole_lecturer(db, device_id),
            consent_confirmed=False,
        )
        db.add(lecture)
    lecture.session_id = session_id
    lecture.status = LectureStatus.recording
    lecture.started_at = started
    await db.commit()
    await db.refresh(lecture)
    return lecture, True


async def lecture_for_session(db: AsyncSession, session_id: uuid.UUID) -> Lecture | None:
    return (await db.execute(select(Lecture).where(Lecture.session_id == session_id))).scalars().first()


async def stored_seqs(db: AsyncSession, lecture_id: uuid.UUID) -> list[int]:
    rows = await db.execute(select(AudioChunk.seq).where(AudioChunk.lecture_id == lecture_id))
    return [row[0] for row in rows]


async def store_chunk(
    db: AsyncSession, lecture_id: uuid.UUID, frame: Frame, storage_key: str, received_ms: int
) -> bool:
    """Inserts the chunk row; False if (lecture_id, seq) already exists (duplicate)."""
    stmt = (
        insert(AudioChunk)
        .values(
            lecture_id=lecture_id,
            seq=frame.seq,
            sample_offset=frame.sample_offset,
            codec=int(frame.codec),
            duration_ms=frame.duration_ms,
            storage_key=storage_key,
            capture_unix_ms=frame.capture_unix_ms,
        )
        .on_conflict_do_nothing(constraint="uq_audio_chunks_lecture_seq")
        .returning(AudioChunk.id)
    )
    inserted = (await db.execute(stmt)).first() is not None
    if inserted:
        marks = [
            LatencyMark(lecture_id=lecture_id, seq=frame.seq, stage="gateway_receive", ts_ms=received_ms)
        ]
        if frame.capture_unix_ms > 0:
            marks.append(
                LatencyMark(
                    lecture_id=lecture_id, seq=frame.seq, stage="capture", ts_ms=frame.capture_unix_ms
                )
            )
        db.add_all(marks)
        end_ms = (frame.seq + 1) * CHUNK_MS
        await db.execute(
            update(Lecture)
            .where(Lecture.id == lecture_id, Lecture.duration_ms < end_ms)
            .values(duration_ms=end_ms)
        )
    await db.commit()
    return inserted


async def open_gaps(db: AsyncSession, lecture_id: uuid.UUID) -> list[LectureGap]:
    rows = await db.execute(
        select(LectureGap).where(LectureGap.lecture_id == lecture_id, LectureGap.state == GapState.open)
    )
    return list(rows.scalars())


async def upsert_gap(
    db: AsyncSession, lecture_id: uuid.UUID, start_seq: int, end_seq: int | None
) -> LectureGap:
    """Creates the gap starting at start_seq, or sets the end of an open-ended one."""
    gap_id = f"gap-{start_seq}"
    gap = (
        (
            await db.execute(
                select(LectureGap).where(LectureGap.lecture_id == lecture_id, LectureGap.gap_id == gap_id)
            )
        )
        .scalars()
        .first()
    )
    if gap is None:
        gap = LectureGap(lecture_id=lecture_id, gap_id=gap_id, start_seq=start_seq, end_seq=end_seq)
        db.add(gap)
    elif end_seq is not None:
        gap.end_seq = end_seq
    await db.commit()
    await db.refresh(gap)
    return gap


async def set_gap_state(
    db: AsyncSession, gap_pk: uuid.UUID, state: GapState, end_seq: int | None = None
) -> None:
    values: dict[str, object] = {"state": state}
    if end_seq is not None:
        values["end_seq"] = end_seq
    await db.execute(update(LectureGap).where(LectureGap.id == gap_pk).values(**values))
    await db.commit()


async def mark_stop(db: AsyncSession, lecture_id: uuid.UUID, last_seq: int) -> None:
    max_seq = (
        await db.execute(select(func.max(AudioChunk.seq)).where(AudioChunk.lecture_id == lecture_id))
    ).scalar()
    final_seq = max(last_seq, max_seq if max_seq is not None else -1)
    await db.execute(
        update(Lecture)
        .where(Lecture.id == lecture_id)
        .values(stop_received=True, last_seq=final_seq, ended_at=datetime.now(UTC), paused=False)
    )
    await db.commit()


async def set_paused(db: AsyncSession, lecture_id: uuid.UUID, paused: bool) -> Lecture | None:
    """Records a pause/resume reported by the device. Returns the lecture, or None if unknown."""
    lecture = await db.get(Lecture, lecture_id)
    if lecture is None or lecture.stop_received:
        return lecture
    lecture.paused = paused
    await db.commit()
    return lecture


async def recording_lecture_for_device(db: AsyncSession, device_id: uuid.UUID) -> Lecture | None:
    result = await db.execute(
        select(Lecture)
        .where(
            Lecture.device_id == device_id,
            Lecture.status == LectureStatus.recording,
            Lecture.stop_received.is_(False),
        )
        .order_by(Lecture.started_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def stale_sessions(db: AsyncSession, idle_minutes: int) -> list[Lecture]:
    """Recording lectures whose stop was never received, with no audio for `idle_minutes`
    while the device says it is not recording (or has been offline for a day)."""
    now = datetime.now(UTC)
    last_chunk = (
        select(AudioChunk.lecture_id, func.max(AudioChunk.received_at).label("last_at"))
        .group_by(AudioChunk.lecture_id)
        .subquery()
    )
    rows = await db.execute(
        select(Lecture, Device, last_chunk.c.last_at)
        .join(Device, Device.id == Lecture.device_id)
        .outerjoin(last_chunk, last_chunk.c.lecture_id == Lecture.id)
        .where(Lecture.status == LectureStatus.recording, Lecture.stop_received.is_(False))
    )
    stale: list[Lecture] = []
    for lecture, device, last_at in rows.all():
        reference = last_at or lecture.started_at or lecture.created_at
        idle = now - reference
        # A paused lecture is idle on purpose; only the 24-hour offline rule can end it.
        device_idle = (
            device.online and not lecture.paused and not bool(device.last_status.get("recording", True))
        )
        offline_long = not device.online and idle > timedelta(hours=24)
        if (device_idle and idle > timedelta(minutes=idle_minutes)) or offline_long:
            stale.append(lecture)
    return stale
