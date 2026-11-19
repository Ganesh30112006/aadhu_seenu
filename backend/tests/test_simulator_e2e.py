"""Device simulator → real gateway server (uvicorn on a free port) with an injected outage.

Checks the brief's network-recovery criteria: every chunk stored exactly once, the backlog
resent as ADPCM, the gap announced and filled, and stop confirmed.
"""

from __future__ import annotations

import asyncio
import math
import socket
import threading
import time
import uuid
from array import array
from collections.abc import Iterator
from pathlib import Path

import fakeredis
import pytest
import uvicorn
from sqlalchemy import func, select

from app.audio.storage import DiskStore
from app.db.models import AudioChunk, GapState, LectureGap
from app.gateway.main import create_app
from tests.conftest import run
from tests.helpers import DEVICE_TOKEN, seed_basics
from tools.device_simulator import Simulator, split_chunks


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
def gateway_server(sessions_factory, redis_server, audio_dir: Path) -> Iterator[tuple[str, object]]:  # type: ignore[no-untyped-def]
    seed = run(seed_basics(sessions_factory))
    app = create_app(
        redis_factory=lambda: fakeredis.aioredis.FakeRedis(server=redis_server, decode_responses=True),
        store_factory=lambda: DiskStore(audio_dir),
        sessions_factory=sessions_factory,
        run_background=False,
    )
    port = free_port()
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    yield f"ws://127.0.0.1:{port}/ws/device", seed
    server.should_exit = True
    thread.join(timeout=10)


def tone_chunks(seconds: float) -> list[array]:
    samples = array(
        "h", (int(6000 * math.sin(2 * math.pi * 220 * i / 16000)) for i in range(int(16000 * seconds)))
    )
    return split_chunks(samples)


@pytest.mark.timeout(120)
def test_outage_recovery_no_loss_no_duplicates(gateway_server, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    url, seed = gateway_server
    chunks = tone_chunks(12.0)  # 24 chunks
    # 4× speed: 12 s of audio in 3 s; network drops from audio second 3 to 7.
    sim = Simulator(url, str(seed.device_id), DEVICE_TOKEN, chunks, outages=[(3.0, 4.0)], speed=4.0)
    summary = asyncio.run(sim.run())

    assert summary.connections == 2
    assert summary.stop_confirmed
    assert len(summary.acked) == len(chunks)
    assert summary.adpcm_frames > 0  # backlog spilled while offline was resent as ADPCM

    async def check() -> tuple[list[int], list[LectureGap]]:
        sessions = sessions_factory()
        async with sessions() as db:
            lecture_id = uuid.UUID(summary.lecture_id or "")
            seqs = [
                r[0]
                for r in (
                    await db.execute(
                        select(AudioChunk.seq)
                        .where(AudioChunk.lecture_id == lecture_id)
                        .order_by(AudioChunk.seq)
                    )
                )
            ]
            dupes = (await db.execute(select(func.count()).select_from(AudioChunk))).scalar_one() - len(
                set(seqs)
            )
            assert dupes == 0
            gaps = list(
                (await db.execute(select(LectureGap).where(LectureGap.lecture_id == lecture_id))).scalars()
            )
        await sessions.kw["bind"].dispose()
        return seqs, gaps

    seqs, gaps = run(check())
    assert seqs == list(range(len(chunks)))  # complete, ordered, exactly once
    assert gaps and all(g.state is GapState.filled for g in gaps if g.end_seq is not None)
