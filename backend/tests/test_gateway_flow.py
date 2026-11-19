"""Gateway end-to-end over a real WebSocket, PostgreSQL and (fake) Redis."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import fakeredis
import pytest
from sqlalchemy import func, select
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.audio.frames import Codec, build_frame
from app.audio.storage import DiskStore
from app.db.models import AudioChunk, GapState, Lecture, LectureGap
from app.gateway.main import create_app
from tests.conftest import run
from tests.helpers import DEVICE_TOKEN, Seed, prepare_lecture, receive_until, seed_basics, wait_for


@pytest.fixture
def gateway(sessions_factory, redis_server, audio_dir: Path):  # type: ignore[no-untyped-def]
    seed = run(seed_basics(sessions_factory))
    app = create_app(
        redis_factory=lambda: fakeredis.aioredis.FakeRedis(server=redis_server, decode_responses=True),
        store_factory=lambda: DiskStore(audio_dir),
        sessions_factory=sessions_factory,
        run_background=False,
    )
    with TestClient(app) as client:
        yield client, seed


def hello(seed: Seed, token: str = DEVICE_TOKEN) -> str:
    return json.dumps(
        {
            "type": "hello",
            "device_id": str(seed.device_id),
            "firmware_version": "1.0.0",
            "token": token,
            "protocol_version": 1,
        }
    )


def start(session_id: uuid.UUID, lecture_id: uuid.UUID | None = None) -> str:
    return json.dumps(
        {
            "type": "start",
            "session_id": str(session_id),
            "lecture_id": None if lecture_id is None else str(lecture_id),
            "started_unix_ms": 1_763_532_000_000,
            "sample_rate": 16000,
        }
    )


def pcm_frame(seq: int) -> bytes:
    return build_frame(Codec.PCM16, seq, 1_763_532_000_000 + seq * 500, bytes(16000))


def live_events(sync_redis: fakeredis.FakeRedis, lecture_id: str) -> list[dict[str, object]]:
    return [json.loads(fields["e"]) for _, fields in sync_redis.xrange(f"live:{lecture_id}")]


def test_rejects_wrong_token(gateway) -> None:  # type: ignore[no-untyped-def]
    client, seed = gateway
    with client.websocket_connect("/ws/device") as ws:
        ws.send_text(hello(seed, token="wrong-token-0000000000"))
        assert ws.receive_json() == {
            "type": "error",
            "code": "auth_failed",
            "message": "unknown device or wrong token",
        }
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4401


def test_start_without_prepared_lecture_creates_untitled(gateway, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed = gateway
    session_id = uuid.uuid4()
    with client.websocket_connect("/ws/device") as ws:
        ws.send_text(hello(seed))
        config = receive_until(ws, "config")
        assert config["gain"] == 4.0 and config["vad_enabled"] is True
        ws.send_text(start(session_id))
        started = receive_until(ws, "lecture.started")
        assert started["session_id"] == str(session_id)

    async def check() -> Lecture:
        sessions = sessions_factory()
        async with sessions() as db:
            lecture = await db.get(Lecture, uuid.UUID(started["lecture_id"]))
        await sessions.kw["bind"].dispose()
        assert lecture is not None
        return lecture

    lecture = run(check())
    assert lecture.title.startswith("Untitled – ")
    assert lecture.consent_confirmed is False
    assert lecture.lecturer_id == seed.lecturer_id  # the device's only lecturer


def test_prepared_lecture_is_assigned_and_bound(gateway, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed = gateway
    lecture_id = run(prepare_lecture(sessions_factory, seed, "Deadlocks: Banker's algorithm"))
    session_id = uuid.uuid4()
    with client.websocket_connect("/ws/device") as ws:
        ws.send_text(hello(seed))
        assign = receive_until(ws, "lecture.assign")
        assert assign == {
            "type": "lecture.assign",
            "lecture_id": str(lecture_id),
            "title": "Deadlocks: Banker's algorithm",
        }
        ws.send_text(start(session_id, lecture_id))
        assert receive_until(ws, "lecture.started")["lecture_id"] == str(lecture_id)
        # Idempotent: a repeated start (after reconnect) maps to the same lecture.
        ws.send_text(start(session_id, None))
        assert receive_until(ws, "lecture.started")["lecture_id"] == str(lecture_id)


def test_live_first_resend_fills_gap_without_duplicates(gateway, sessions_factory, sync_redis) -> None:  # type: ignore[no-untyped-def]
    client, seed = gateway
    session_id = uuid.uuid4()
    with client.websocket_connect("/ws/device") as ws:
        ws.send_text(hello(seed))
        receive_until(ws, "config")
        ws.send_text(start(session_id))
        lecture_id = receive_until(ws, "lecture.started")["lecture_id"]
        for seq in (0, 1):
            ws.send_bytes(pcm_frame(seq))
        ack = receive_until(ws, "ack")
        while ack["seq"] < 1:
            ack = receive_until(ws, "ack")
        assert ack == {"type": "ack", "session_id": str(session_id), "seq": 1, "ranges": []}

    # Connection lost while recording → open-ended gap announced to students.
    wait_for(lambda: any(e["type"] == "transcript.gap" for e in live_events(sync_redis, lecture_id)))
    events = live_events(sync_redis, lecture_id)
    gap_open = [e for e in events if e["type"] == "transcript.gap"]
    assert gap_open[-1] == {
        "type": "transcript.gap",
        "gap_id": "gap-2",
        "gap": {"start_ms": 1000, "end_ms": None},
    }
    assert any(e["type"] == "device.status" and e["online"] is False for e in events)

    with client.websocket_connect("/ws/device") as ws:
        ws.send_text(hello(seed))
        receive_until(ws, "config")
        ws.send_text(start(session_id))
        receive_until(ws, "lecture.started")
        ws.send_bytes(pcm_frame(5))  # live chunk first
        ack = receive_until(ws, "ack")
        while ack["ranges"] != [[5, 5]]:
            ack = receive_until(ws, "ack")
        assert ack["seq"] == 1
        for seq in (2, 3, 3, 4, 1):  # backlog, including duplicates
            ws.send_bytes(pcm_frame(seq))
        ack = receive_until(ws, "ack")
        while ack["seq"] < 5:
            ack = receive_until(ws, "ack")
        assert ack["ranges"] == []
        ws.send_text(json.dumps({"type": "stop", "session_id": str(session_id), "last_seq": 5}))
        assert receive_until(ws, "ack")["seq"] == 5

    gap_closed = [e for e in live_events(sync_redis, lecture_id) if e["type"] == "transcript.gap"][-1]
    assert gap_closed == {
        "type": "transcript.gap",
        "gap_id": "gap-2",
        "gap": {"start_ms": 1000, "end_ms": 2500},
    }

    async def check() -> tuple[int, GapState, Lecture | None]:
        sessions = sessions_factory()
        async with sessions() as db:
            count = (await db.execute(select(func.count()).select_from(AudioChunk))).scalar_one()
            gap = (await db.execute(select(LectureGap))).scalars().one()
            lecture = await db.get(Lecture, uuid.UUID(lecture_id))
        await sessions.kw["bind"].dispose()
        return count, gap.state, lecture

    count, state, lecture = run(check())
    assert count == 6  # seqs 0..5 exactly once
    assert state is GapState.filled
    assert lecture is not None and lecture.stop_received and lecture.last_seq == 5
    assert lecture.duration_ms == 3000
    assert sync_redis.sismember("asr:pending", lecture_id)


def test_rejects_malformed_frames_without_dropping_connection(gateway) -> None:  # type: ignore[no-untyped-def]
    client, seed = gateway
    with client.websocket_connect("/ws/device") as ws:
        ws.send_text(hello(seed))
        receive_until(ws, "config")
        ws.send_bytes(pcm_frame(0))
        assert receive_until(ws, "error")["code"] == "protocol_error"  # frame before start
        ws.send_text(start(uuid.uuid4()))
        receive_until(ws, "lecture.started")
        ws.send_bytes(b"LC\x01\x00garbage")
        assert receive_until(ws, "error")["code"] == "protocol_error"
        ws.send_text('{"type": "status"}')
        assert receive_until(ws, "error")["code"] == "protocol_error"
