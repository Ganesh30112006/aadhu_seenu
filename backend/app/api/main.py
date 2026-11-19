"""REST API + browser live WebSocket: `uvicorn app.api.main:app --port 8000` (behind Caddy at /api)."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.routing import APIRoute
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.ai.client import Embedder, LlmClient, get_embedder, get_llm
from app.api import schemas
from app.api.deps import ApiContext
from app.api.errors import install_error_handlers
from app.api.routes import admin, auth, devices, export, lectures, live, search, study
from app.audio.storage import AudioStore, get_audio_store
from app.config import get_settings
from app.db.session import get_sessionmaker
from app.events import create_redis
from app.logs import configure_logging


def _operation_id(route: APIRoute) -> str:
    return route.name  # e.g. "login", "list_lectures": stable names for the generated client


def create_app(
    redis_factory: Callable[[], aioredis.Redis] = create_redis,
    store_factory: Callable[[], AudioStore] = get_audio_store,
    sessions_factory: Callable[[], async_sessionmaker[AsyncSession]] = get_sessionmaker,
    llm_factory: Callable[[], LlmClient] = get_llm,
    embedder_factory: Callable[[], Embedder] = get_embedder,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging("api")
        app.state.ctx = ApiContext(
            get_settings(),
            sessions_factory(),
            redis_factory(),
            store_factory(),
            llm_factory,
            embedder_factory,
        )
        yield
        await app.state.ctx.redis.aclose()

    app = FastAPI(
        title="Smart Classroom API",
        version="1.0.0",
        description="REST contract for the web frontend. Errors are {code, message}.",
        lifespan=lifespan,
        generate_unique_id_function=_operation_id,
    )
    install_error_handlers(app)
    for router in (
        auth.router,
        admin.router,
        lectures.router,
        study.router,
        export.router,
        search.router,
        devices.router,
        live.router,
    ):
        app.include_router(router)

    @app.get("/health", response_model=schemas.Health, tags=["health"])
    async def health() -> schemas.Health:
        ctx: ApiContext = app.state.ctx
        database = redis_ok = True
        try:
            async with ctx.sessions() as db:
                await db.execute(text("SELECT 1"))
        except Exception:
            database = False
        try:
            await ctx.redis.ping()
        except Exception:
            redis_ok = False
        return schemas.Health(
            status="ok" if database and redis_ok else "degraded", database=database, redis=redis_ok
        )

    return app


app = create_app()
