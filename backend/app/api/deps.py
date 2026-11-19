"""Request dependencies: context, DB session, cookie-session auth with CSRF, roles, visibility."""

from __future__ import annotations

import hmac
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

import redis.asyncio as aioredis
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.client import Embedder, LlmClient
from app.api.errors import ApiError, forbidden
from app.api.security import token_hash
from app.audio.storage import AudioStore
from app.config import Settings
from app.db.models import Lecture, Role, User, WebSession

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class ApiContext:
    settings: Settings
    sessions: async_sessionmaker[AsyncSession]
    redis: aioredis.Redis
    store: AudioStore
    llm: Callable[[], LlmClient]
    embedder: Callable[[], Embedder]


def get_ctx(request: Request) -> ApiContext:
    ctx: ApiContext = request.app.state.ctx
    return ctx


Ctx = Annotated[ApiContext, Depends(get_ctx)]


async def get_db(ctx: Ctx) -> AsyncIterator[AsyncSession]:
    async with ctx.sessions() as db:
        yield db


Db = Annotated[AsyncSession, Depends(get_db)]


async def session_for_token(db: AsyncSession, token: str | None) -> WebSession | None:
    if not token:
        return None
    web_session = (
        (await db.execute(select(WebSession).where(WebSession.token_hash == token_hash(token))))
        .scalars()
        .first()
    )
    if web_session is None or web_session.expires_at < datetime.now(UTC) or not web_session.user.active:
        return None
    return web_session


async def current_session(request: Request, db: Db, ctx: Ctx) -> WebSession:
    web_session = await session_for_token(db, request.cookies.get(ctx.settings.session_cookie))
    if web_session is None:
        raise ApiError(401, "not_authenticated", "Sign in to continue.")
    if request.method not in SAFE_METHODS:
        header = request.headers.get("X-CSRF-Token", "")
        if not hmac.compare_digest(header, web_session.csrf_token):
            raise ApiError(403, "csrf_failed", "Security token missing. Reload the page and try again.")
    return web_session


async def current_user(web_session: Annotated[WebSession, Depends(current_session)]) -> User:
    return web_session.user


CurrentUser = Annotated[User, Depends(current_user)]


def require_roles(*roles: Role) -> Callable[[User], User]:
    def check(user: CurrentUser) -> User:
        if user.role not in roles:
            raise forbidden()
        return user

    return check


LecturerUser = Annotated[User, Depends(require_roles(Role.lecturer, Role.admin))]
AdminUser = Annotated[User, Depends(require_roles(Role.admin))]


def can_view(user: User, lecture: Lecture) -> bool:
    """Students see lectures with confirmed consent; lecturers also their own; admins all.
    (The UI hides things too, but this is the enforcement point.)"""
    return user.role == Role.admin or lecture.consent_confirmed or lecture.lecturer_id == user.id


def can_edit(user: User, lecture: Lecture) -> bool:
    return user.role == Role.admin or (user.role == Role.lecturer and lecture.lecturer_id == user.id)
