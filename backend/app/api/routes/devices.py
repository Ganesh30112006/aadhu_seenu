"""Devices: health view for lecturers/admins, registration and lecturer assignment for admins."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import schemas
from app.api.deps import AdminUser, Db, LecturerUser
from app.api.errors import ApiError, not_found
from app.api.security import new_token, token_hash
from app.config import get_settings
from app.db.models import AuditLog, Device, DeviceLecturer, Lecture, LectureStatus, Role, User

router = APIRouter(prefix="/devices", tags=["devices"])
E: dict[int | str, dict[str, Any]] = {
    403: {"model": schemas.ErrorResponse},
    404: {"model": schemas.ErrorResponse},
    409: {"model": schemas.ErrorResponse},
}


def _opt_float(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _opt_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


async def device_views(db: AsyncSession, devices: list[Device]) -> list[schemas.Device]:
    ids = [d.id for d in devices]
    lecturers: dict[uuid.UUID, list[uuid.UUID]] = {i: [] for i in ids}
    recording: dict[uuid.UUID, uuid.UUID] = {}
    if ids:
        for device_id, user_id in (
            await db.execute(
                select(DeviceLecturer.device_id, DeviceLecturer.user_id).where(
                    DeviceLecturer.device_id.in_(ids)
                )
            )
        ).all():
            lecturers[device_id].append(user_id)
        rows = await db.execute(
            select(Lecture.device_id, Lecture.id).where(
                Lecture.device_id.in_(ids),
                Lecture.status == LectureStatus.recording,
                Lecture.stop_received.is_(False),
            )
        )
        recording = {device_id: lecture_id for device_id, lecture_id in rows.all() if device_id is not None}
    settings = get_settings()
    out = []
    for d in devices:
        status = d.last_status or {}
        out.append(
            schemas.Device(
                id=d.id,
                name=d.name,
                room=d.room,
                serial=d.serial,
                firmware_version=d.firmware_version,
                online=d.online,
                wifi_rssi=status.get("wifi_rssi") if d.online else None,
                psram_buffer_pct=float(status.get("psram_buffer_pct", 0)),
                flash_buffer_pct=float(status.get("flash_buffer_pct", 0)),
                recording=bool(status.get("recording", False)) and d.online,
                last_seen_at=d.last_seen_at,
                current_lecture_id=recording.get(d.id),
                lecturer_ids=lecturers.get(d.id, []),
                paused=bool(status.get("paused", False)) and d.online,
                level_dbfs=_opt_float(status.get("level_dbfs")) if d.online else None,
                mic_ok=_opt_bool(status.get("mic_ok")) if d.online else None,
                pending_chunks=int(status.get("pending_chunks", 0)),
                gain=d.gain if d.gain is not None else settings.device_gain,
                vad_enabled=d.vad_enabled if d.vad_enabled is not None else settings.device_vad_enabled,
            )
        )
    return out


async def _visible_devices(db: AsyncSession, user: User) -> list[Device]:
    query = select(Device).order_by(Device.name)
    if user.role != Role.admin:
        query = query.join(DeviceLecturer, DeviceLecturer.device_id == Device.id).where(
            DeviceLecturer.user_id == user.id
        )
    return list((await db.execute(query)).scalars())


@router.get("", response_model=list[schemas.Device], responses=E)
async def list_devices(user: LecturerUser, db: Db) -> list[schemas.Device]:
    return await device_views(db, await _visible_devices(db, user))


@router.get("/{device_id}", response_model=schemas.Device, responses=E)
async def get_device(device_id: uuid.UUID, user: LecturerUser, db: Db) -> schemas.Device:
    device = next((d for d in await _visible_devices(db, user) if d.id == device_id), None)
    if device is None:
        raise not_found("device")
    return (await device_views(db, [device]))[0]


@router.post("", response_model=schemas.DeviceRegistered, status_code=201, responses=E)
async def register_device(body: schemas.DeviceCreate, admin: AdminUser, db: Db) -> schemas.DeviceRegistered:
    if (await db.execute(select(Device).where(Device.serial == body.serial))).scalars().first():
        raise ApiError(409, "device_exists", "A device with this serial is already registered.")
    token = new_token(24)
    device = Device(
        name=body.name.strip(), room=body.room.strip(), serial=body.serial, token_hash=token_hash(token)
    )
    db.add(device)
    await db.flush()
    for user_id in body.lecturer_ids:
        db.add(DeviceLecturer(device_id=device.id, user_id=user_id))
    db.add(AuditLog(actor_id=admin.id, action="device.register", target=body.serial))
    await db.commit()
    return schemas.DeviceRegistered(device=(await device_views(db, [device]))[0], token=token)


@router.put("/{device_id}/lecturers", response_model=schemas.Device, responses=E)
async def assign_lecturers(
    device_id: uuid.UUID, body: schemas.DeviceLecturers, admin: AdminUser, db: Db
) -> schemas.Device:
    device = await db.get(Device, device_id)
    if device is None:
        raise not_found("device")
    await db.execute(delete(DeviceLecturer).where(DeviceLecturer.device_id == device_id))
    for user_id in dict.fromkeys(body.lecturer_ids):
        db.add(DeviceLecturer(device_id=device_id, user_id=user_id))
    db.add(AuditLog(actor_id=admin.id, action="device.assign", target=str(device_id)))
    await db.commit()
    return (await device_views(db, [device]))[0]


@router.patch("/{device_id}", response_model=schemas.Device, responses=E)
async def update_device(
    device_id: uuid.UUID, body: schemas.DeviceUpdate, admin: AdminUser, db: Db
) -> schemas.Device:
    """Admin: rename/move a device or change its microphone settings (sent on its next connection)."""
    device = await db.get(Device, device_id)
    if device is None:
        raise not_found("device")
    if body.name is not None:
        device.name = body.name.strip()
    if body.room is not None:
        device.room = body.room.strip()
    if body.gain is not None:
        device.gain = body.gain
    if body.vad_enabled is not None:
        device.vad_enabled = body.vad_enabled
    db.add(AuditLog(actor_id=admin.id, action="device.update", target=str(device_id)))
    await db.commit()
    return (await device_views(db, [device]))[0]
