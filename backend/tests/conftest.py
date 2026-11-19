"""Test fixtures: a real PostgreSQL 16 + pgvector (embedded via pgserver, or TEST_DATABASE_URL),
fakeredis, and a temporary audio directory."""

from __future__ import annotations

import asyncio
import os
import tempfile
from collections.abc import Callable, Iterator
from pathlib import Path

import fakeredis
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.db.models import Base

os.environ.setdefault("COOKIE_SECURE", "false")


def _to_asyncpg(url: str) -> str:
    return url.replace("postgresql://", "postgresql+asyncpg://", 1)


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    url = os.environ.get("TEST_DATABASE_URL")
    server = None
    if url is None:
        import pgserver

        server = pgserver.get_server(Path(tempfile.gettempdir()) / "smartclass_test_pg", cleanup_mode="stop")
        server.psql("DROP DATABASE IF EXISTS smartclass_test;")
        server.psql("CREATE DATABASE smartclass_test;")
        url = server.get_uri("smartclass_test")
    async_url = _to_asyncpg(url)

    async def migrate() -> None:
        engine = create_async_engine(async_url, poolclass=NullPool)
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        await engine.dispose()

    asyncio.run(migrate())
    os.environ["DATABASE_URL"] = async_url
    yield async_url
    del server


@pytest.fixture
def sessions_factory(database_url: str) -> Iterator[Callable[[], async_sessionmaker[AsyncSession]]]:
    """Fresh engine per app/loop (NullPool: asyncpg connections never cross event loops)."""

    async def truncate() -> None:
        engine = create_async_engine(database_url, poolclass=NullPool)
        async with engine.begin() as conn:
            tables = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
            await conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        await engine.dispose()

    asyncio.run(truncate())
    yield lambda: async_sessionmaker(
        create_async_engine(database_url, poolclass=NullPool), expire_on_commit=False
    )


@pytest.fixture
def redis_server() -> fakeredis.FakeServer:
    return fakeredis.FakeServer()


@pytest.fixture
def sync_redis(redis_server: fakeredis.FakeServer) -> fakeredis.FakeRedis:
    return fakeredis.FakeRedis(server=redis_server, decode_responses=True)


@pytest.fixture
def audio_dir(tmp_path: Path) -> Path:
    path = tmp_path / "audio"
    path.mkdir()
    return path


def run(coro):  # type: ignore[no-untyped-def]
    """Runs a coroutine on a fresh loop (for seeding/asserting outside the app's loop)."""
    return asyncio.run(coro)
