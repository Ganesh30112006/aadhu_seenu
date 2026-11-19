"""POST /auth/login, POST /auth/logout, GET/PATCH /auth/me, POST /auth/password (httpOnly cookie
session, D13)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import delete, func, select

from app.api import schemas
from app.api.deps import Ctx, CurrentUser, Db, session_for_token
from app.api.errors import ApiError
from app.api.security import hash_password, new_token, token_hash, verify_password
from app.db.models import AuditLog, User, WebSession

router = APIRouter(prefix="/auth", tags=["auth"])

LOGIN_LIMIT = 10  # attempts per minute per address+email


def user_view(user: User) -> schemas.User:
    return schemas.User(
        id=user.id, email=user.email, full_name=user.name, role=user.role.value, active=user.active
    )


@router.post(
    "/login",
    response_model=schemas.User,
    responses={401: {"model": schemas.ErrorResponse}, 429: {"model": schemas.ErrorResponse}},
)
async def login(
    body: schemas.LoginRequest, request: Request, response: Response, db: Db, ctx: Ctx
) -> schemas.User:
    email = body.email.strip().lower()
    client = request.client.host if request.client else "unknown"
    key = f"login:{client}:{email}"
    attempts = int(await ctx.redis.incr(key))
    if attempts == 1:
        await ctx.redis.expire(key, 60)
    if attempts > LOGIN_LIMIT:
        raise ApiError(429, "too_many_attempts", "Too many sign-in attempts. Wait a minute and try again.")
    user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalars().first()
    if user is None or not verify_password(user.password_hash, body.password):
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
    if not user.active:
        raise ApiError(401, "account_disabled", "This account has been disabled.")
    await ctx.redis.delete(key)

    token, csrf = new_token(), new_token(24)
    ttl = timedelta(hours=ctx.settings.session_ttl_hours)
    db.add(
        WebSession(
            token_hash=token_hash(token), csrf_token=csrf, user_id=user.id, expires_at=datetime.now(UTC) + ttl
        )
    )
    db.add(AuditLog(actor_id=user.id, action="auth.login", target=str(user.id)))
    await db.commit()
    secure = ctx.settings.cookie_secure
    max_age = int(ttl.total_seconds())
    response.set_cookie(
        ctx.settings.session_cookie,
        token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    # Readable by the SPA (double-submit CSRF); useless without the httpOnly session cookie.
    response.set_cookie(
        ctx.settings.csrf_cookie,
        csrf,
        max_age=max_age,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )
    return user_view(user)


@router.post("/logout", status_code=204)
async def logout(request: Request, response: Response, db: Db, ctx: Ctx) -> Response:
    web_session = await session_for_token(db, request.cookies.get(ctx.settings.session_cookie))
    if web_session is not None:
        await db.execute(delete(WebSession).where(WebSession.id == web_session.id))
        await db.commit()
    response.status_code = 204
    response.delete_cookie(ctx.settings.session_cookie, path="/")
    response.delete_cookie(ctx.settings.csrf_cookie, path="/")
    return response


@router.get("/me", response_model=schemas.User, responses={401: {"model": schemas.ErrorResponse}})
async def me(user: CurrentUser) -> schemas.User:
    return user_view(user)


@router.patch("/me", response_model=schemas.User, responses={401: {"model": schemas.ErrorResponse}})
async def update_profile(body: schemas.ProfileUpdate, user: CurrentUser, db: Db) -> schemas.User:
    row = await db.get(User, user.id)
    if row is None:
        raise ApiError(401, "not_authenticated", "Sign in to continue.")
    row.name = body.full_name.strip()
    db.add(AuditLog(actor_id=row.id, action="auth.profile", target=str(row.id)))
    await db.commit()
    return user_view(row)


@router.post(
    "/password",
    status_code=204,
    responses={400: {"model": schemas.ErrorResponse}, 401: {"model": schemas.ErrorResponse}},
)
async def change_password(
    body: schemas.PasswordChange, request: Request, user: CurrentUser, db: Db, ctx: Ctx
) -> Response:
    """Changes the password and signs out every other session of this user."""
    row = await db.get(User, user.id)
    if row is None:
        raise ApiError(401, "not_authenticated", "Sign in to continue.")
    if not verify_password(row.password_hash, body.current_password):
        raise ApiError(400, "wrong_password", "The current password is incorrect.")
    row.password_hash = hash_password(body.new_password)
    current = token_hash(request.cookies.get(ctx.settings.session_cookie, ""))
    await db.execute(delete(WebSession).where(WebSession.user_id == row.id, WebSession.token_hash != current))
    db.add(AuditLog(actor_id=row.id, action="auth.password", target=str(row.id)))
    await db.commit()
    return Response(status_code=204)
