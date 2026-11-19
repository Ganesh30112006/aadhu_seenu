"""Subjects (all users read, admins write), user management and system info (admins)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter
from sqlalchemy import func, select

from app.api import schemas
from app.api.deps import AdminUser, Ctx, CurrentUser, Db
from app.api.errors import ApiError, not_found
from app.api.routes.auth import user_view
from app.api.security import hash_password
from app.db.models import AuditLog, Role, Subject, User

router = APIRouter(tags=["admin"])
E: dict[int | str, dict[str, Any]] = {
    403: {"model": schemas.ErrorResponse},
    409: {"model": schemas.ErrorResponse},
}


@router.get("/subjects", response_model=list[schemas.Subject])
async def list_subjects(_: CurrentUser, db: Db) -> list[schemas.Subject]:
    rows = await db.execute(select(Subject).order_by(Subject.code))
    return [schemas.Subject.model_validate(s) for s in rows.scalars()]


@router.post("/subjects", response_model=schemas.Subject, status_code=201, responses=E)
async def create_subject(body: schemas.SubjectCreate, admin: AdminUser, db: Db) -> schemas.Subject:
    code = body.code.strip().upper()
    if (await db.execute(select(Subject).where(Subject.code == code))).scalars().first():
        raise ApiError(409, "subject_exists", f"A subject with code {code} already exists.")
    subject = Subject(code=code, name=body.name.strip())
    db.add(subject)
    db.add(AuditLog(actor_id=admin.id, action="subject.create", target=code))
    await db.commit()
    return schemas.Subject.model_validate(subject)


@router.get("/users", response_model=list[schemas.User], responses=E)
async def list_users(_: AdminUser, db: Db) -> list[schemas.User]:
    rows = await db.execute(select(User).order_by(User.role, User.name))
    return [user_view(u) for u in rows.scalars()]


@router.post("/users", response_model=schemas.User, status_code=201, responses=E)
async def create_user(body: schemas.UserCreate, admin: AdminUser, db: Db) -> schemas.User:
    email = str(body.email).lower()
    if (await db.execute(select(User).where(func.lower(User.email) == email))).scalars().first():
        raise ApiError(409, "user_exists", "A user with this email already exists.")
    user = User(
        name=body.full_name.strip(),
        email=email,
        password_hash=hash_password(body.password),
        role=Role(body.role),
    )
    db.add(user)
    db.add(AuditLog(actor_id=admin.id, action="user.create", target=email))
    await db.commit()
    return user_view(user)


@router.patch(
    "/users/{user_id}", response_model=schemas.User, responses={**E, 404: {"model": schemas.ErrorResponse}}
)
async def update_user(user_id: uuid.UUID, body: schemas.UserUpdate, admin: AdminUser, db: Db) -> schemas.User:
    user = await db.get(User, user_id)
    if user is None:
        raise not_found("user")
    if user.id == admin.id and body.active is False:
        raise ApiError(409, "cannot_disable_self", "You cannot disable your own account.")
    if body.full_name is not None:
        user.name = body.full_name.strip()
    if body.role is not None:
        user.role = Role(body.role)
    if body.active is not None:
        user.active = body.active
    db.add(AuditLog(actor_id=admin.id, action="user.update", target=str(user.id)))
    await db.commit()
    return user_view(user)


@router.get("/system", response_model=schemas.SystemInfo, responses=E)
async def system_info(admin: AdminUser, ctx: Ctx) -> schemas.SystemInfo:
    """Admin: the backend configuration that matters operationally (no secrets)."""
    s = ctx.settings
    return schemas.SystemInfo(
        environment=s.environment,
        llm_model=s.bedrock_llm_model_id,
        embedding_model=s.bedrock_embed_model_id,
        asr_model=s.asr_model,
        asr_device=f"{s.asr_device}/{s.asr_compute_type}",
        prompt_version=s.prompt_version,
        audio_retention_days=s.audio_retention_days,
        device_gain_default=s.device_gain,
        device_vad_default=s.device_vad_enabled,
    )
