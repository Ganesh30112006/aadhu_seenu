"""Seeding helpers shared by integration tests."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.testclient import WebSocketTestSession

from app.api.security import hash_password
from app.db.models import Device, DeviceLecturer, Lecture, LectureStatus, Role, Subject, User
from app.gateway.service import hash_token

DEVICE_TOKEN = "device-token-0123456789abcdef"


@dataclass
class Seed:
    lecturer_id: uuid.UUID
    student_id: uuid.UUID
    admin_id: uuid.UUID
    device_id: uuid.UUID
    subject_id: uuid.UUID


async def seed_basics(factory: Callable[[], async_sessionmaker[AsyncSession]]) -> Seed:
    sessions = factory()
    async with sessions() as db:
        lecturer = User(
            name="Dr. Priya Raghavan",
            email="priya@college.example",
            password_hash=hash_password("lecturer-pass-1"),
            role=Role.lecturer,
        )
        student = User(
            name="Arjun Kumar",
            email="arjun@college.example",
            password_hash=hash_password("student-pass-1"),
            role=Role.student,
        )
        admin = User(
            name="Meena Iyer",
            email="admin@college.example",
            password_hash=hash_password("admin-pass-1"),
            role=Role.admin,
        )
        device = Device(
            name="Desk mic · Room 204",
            room="Block A, Room 204",
            serial="24A160C3F1B8",
            token_hash=hash_token(DEVICE_TOKEN),
        )
        db.add_all([lecturer, student, admin, device])
        await db.flush()
        subject = Subject(code="CS501", name="Operating Systems", lecturer_id=lecturer.id)
        db.add(subject)
        db.add(DeviceLecturer(device_id=device.id, user_id=lecturer.id))
        await db.commit()
        seed = Seed(lecturer.id, student.id, admin.id, device.id, subject.id)
    await sessions.kw["bind"].dispose()
    return seed


async def prepare_lecture(
    factory: Callable[[], async_sessionmaker[AsyncSession]], seed: Seed, title: str
) -> uuid.UUID:
    sessions = factory()
    async with sessions() as db:
        lecture = Lecture(
            title=title,
            subject_id=seed.subject_id,
            lecturer_id=seed.lecturer_id,
            device_id=seed.device_id,
            consent_confirmed=True,
            status=LectureStatus.scheduled,
        )
        db.add(lecture)
        await db.commit()
        lecture_id = lecture.id
    await sessions.kw["bind"].dispose()
    return lecture_id


def wait_for(predicate: Callable[[], bool], timeout_s: float = 5.0) -> None:
    """Polls until predicate() holds; server-side work after a client disconnect is asynchronous."""
    import time

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError("condition not reached in time")


def receive_until(ws: WebSocketTestSession, kind: str, limit: int = 30) -> dict[str, Any]:
    """Reads JSON messages until one of `type == kind` arrives (fails after `limit`)."""
    for _ in range(limit):
        message: dict[str, Any] = ws.receive_json()
        if message.get("type") == kind:
            return message
    raise AssertionError(f"no {kind!r} message within {limit} messages")
