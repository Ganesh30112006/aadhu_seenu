"""Device Gateway service: `uvicorn app.gateway.main:app --port 8001` (wss://<host>/ws/device)."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.audio.storage import AudioStore, get_audio_store
from app.config import Settings, get_settings
from app.db.session import get_sessionmaker
from app.events import create_redis, enqueue_asr
from app.gateway import service
from app.gateway.connection import DeviceConnection, Registry
from app.logs import configure_logging, get_logger

log = get_logger("gateway")


async def finalize_stale_sessions(
    sessions: async_sessionmaker[AsyncSession], redis: aioredis.Redis, settings: Settings
) -> None:
    """Fallback when a device's `stop` never arrives (contracts §1.4.7)."""
    while True:
        await asyncio.sleep(60)
        try:
            async with sessions() as db:
                for lecture in await service.stale_sessions(db, settings.stop_fallback_minutes):
                    await service.mark_stop(db, lecture.id, -1)
                    await enqueue_asr(redis, str(lecture.id))
                    log.warning("session_auto_finalized", lecture_id=str(lecture.id))
        except Exception:  # keep the loop alive; the next tick retries
            log.exception("stale_session_check_failed")


def create_app(
    redis_factory: Callable[[], aioredis.Redis] = create_redis,
    store_factory: Callable[[], AudioStore] = get_audio_store,
    sessions_factory: Callable[[], async_sessionmaker[AsyncSession]] = get_sessionmaker,
    run_background: bool = True,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging("gateway")
        app.state.settings = get_settings()
        app.state.redis = redis_factory()
        app.state.store = store_factory()
        app.state.sessions = sessions_factory()
        app.state.registry = Registry()
        task = (
            asyncio.create_task(
                finalize_stale_sessions(app.state.sessions, app.state.redis, app.state.settings)
            )
            if run_background
            else None
        )
        yield
        await app.state.registry.drain()
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await app.state.redis.aclose()

    app = FastAPI(title="Smart Classroom Device Gateway", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.get("/health")
    async def health() -> dict[str, str]:
        await app.state.redis.ping()
        return {"status": "ok"}

    @app.websocket("/ws/device")
    async def device_socket(ws: WebSocket) -> None:
        conn = DeviceConnection(
            ws, app.state.redis, app.state.store, app.state.sessions, app.state.settings, app.state.registry
        )
        await conn.run()

    return app


app = create_app()
