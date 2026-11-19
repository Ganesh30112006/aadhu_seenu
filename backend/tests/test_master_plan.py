"""Master-plan additions: web recording control + device pause, live device monitoring, transcript
corrections, flashcards and revision notes, profile/password, device settings, system info and
audio retention."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import fakeredis
import pytest
from sqlalchemy import func, select, update
from starlette.testclient import TestClient

from app.audio.storage import DiskStore
from app.db.models import (
    ArtifactKind,
    AudioChunk,
    Device,
    Lecture,
    LectureArtifact,
    LectureStatus,
    TranscriptSegment,
)
from app.gateway import service
from app.gateway.main import create_app as create_gateway
from tests import test_api as api_tests
from tests.conftest import run
from tests.helpers import Seed, prepare_lecture, receive_until, seed_basics, wait_for
from tests.test_gateway_flow import hello, live_events, pcm_frame, start
from tools.retention import purge

api = api_tests.api  # the REST app fixture, shared with test_api.py
add_artifacts, add_lecture, login = api_tests.add_artifacts, api_tests.add_lecture, api_tests.login


async def db_do(factory, fn):  # type: ignore[no-untyped-def]
    sessions = factory()
    async with sessions() as db:
        result = await fn(db)
        await db.commit()
    await sessions.kw["bind"].dispose()
    return result


def set_device(factory, device_id: uuid.UUID, **values: object) -> None:  # type: ignore[no-untyped-def]
    run(db_do(factory, lambda db: db.execute(update(Device).where(Device.id == device_id).values(**values))))


# ── gateway: pause, monitoring, per-device config ───────────────────────────────────────────────


@pytest.fixture
def gateway(sessions_factory, redis_server, audio_dir: Path):  # type: ignore[no-untyped-def]
    seed = run(seed_basics(sessions_factory))
    app = create_gateway(
        redis_factory=lambda: fakeredis.aioredis.FakeRedis(server=redis_server, decode_responses=True),
        store_factory=lambda: DiskStore(audio_dir),
        sessions_factory=sessions_factory,
        run_background=False,
    )
    with TestClient(app) as client:
        yield client, seed


def status_msg(**extra: object) -> str:
    return json.dumps(
        {
            "type": "status",
            "wifi_rssi": -55,
            "psram_buffer_pct": 3.0,
            "flash_buffer_pct": 0.0,
            "uptime_s": 120,
            "recording": True,
            "state": "RECORDING",
            "pending_chunks": 2,
            **extra,
        }
    )


def lecture_row(factory, lecture_id: uuid.UUID) -> Lecture:  # type: ignore[no-untyped-def]
    found = run(db_do(factory, lambda db: db.get(Lecture, lecture_id)))
    assert found is not None
    return found


def test_pause_resume_and_live_monitoring(gateway, sessions_factory, sync_redis) -> None:  # type: ignore[no-untyped-def]
    client, seed = gateway
    lecture_id = run(prepare_lecture(sessions_factory, seed, "Paging"))
    session_id = uuid.uuid4()
    with client.websocket_connect("/ws/device") as ws:
        ws.send_text(hello(seed))
        receive_until(ws, "config")
        ws.send_text(start(session_id, lecture_id))
        receive_until(ws, "lecture.started")
        ws.send_bytes(pcm_frame(0))
        receive_until(ws, "ack")

        ws.send_text(json.dumps({"type": "pause", "session_id": str(session_id), "paused": True}))
        wait_for(lambda: lecture_row(sessions_factory, lecture_id).paused)
        ws.send_text(status_msg(level_dbfs=-18.5, mic_ok=True, paused=True, state="PAUSED"))
        ws.send_text(status_msg(level_dbfs=-20.0, mic_ok=False, paused=True, state="PAUSED"))
        ws.send_text(json.dumps({"type": "pause", "session_id": str(session_id), "paused": False}))
        wait_for(lambda: not lecture_row(sessions_factory, lecture_id).paused)

        events = live_events(sync_redis, str(lecture_id))
        statuses = [e for e in events if e["type"] == "lecture.status"]
        assert [s.get("paused") for s in statuses if "paused" in s] == [True, False]
        assert statuses[-1]["status"] == "recording" and statuses[-1]["duration_ms"] == 500
        wait_for(
            lambda: [e for e in live_events(sync_redis, str(lecture_id)) if e["type"] == "device.status"]
        )
        devices = [e for e in live_events(sync_redis, str(lecture_id)) if e["type"] == "device.status"]
        # Only the newest status is kept for replay; it carries the monitoring fields.
        assert len(devices) == 1
        assert devices[0]["level_dbfs"] == -20.0 and devices[0]["mic_ok"] is False
        assert devices[0]["paused"] is True and devices[0]["pending_chunks"] == 2
        assert devices[0]["last_audio_at"] is not None

        ws.send_text(json.dumps({"type": "stop", "session_id": str(session_id), "last_seq": 0}))
        wait_for(lambda: lecture_row(sessions_factory, lecture_id).stop_received)
    assert not lecture_row(sessions_factory, lecture_id).paused


def test_pause_for_unknown_session_is_an_error(gateway) -> None:  # type: ignore[no-untyped-def]
    client, seed = gateway
    with client.websocket_connect("/ws/device") as ws:
        ws.send_text(hello(seed))
        receive_until(ws, "config")
        ws.send_text(json.dumps({"type": "pause", "session_id": str(uuid.uuid4()), "paused": True}))
        assert receive_until(ws, "error")["code"] == "unknown_session"


def test_config_uses_per_device_settings(gateway, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed = gateway
    set_device(sessions_factory, seed.device_id, gain=8.0, vad_enabled=False)
    with client.websocket_connect("/ws/device") as ws:
        ws.send_text(hello(seed))
        config = receive_until(ws, "config")
    assert config["gain"] == 8.0 and config["vad_enabled"] is False


def test_paused_lecture_is_not_auto_finalized(sessions_factory) -> None:  # type: ignore[no-untyped-def]
    seed = run(seed_basics(sessions_factory))
    lecture_id = run(prepare_lecture(sessions_factory, seed, "Long pause"))
    old = datetime.now(UTC) - timedelta(hours=2)

    async def make_stale(db):  # type: ignore[no-untyped-def]
        await db.execute(
            update(Lecture)
            .where(Lecture.id == lecture_id)
            .values(status=LectureStatus.recording, started_at=old, created_at=old, paused=True)
        )
        await db.execute(
            update(Device)
            .where(Device.id == seed.device_id)
            .values(online=True, last_status={"recording": False})
        )

    run(db_do(sessions_factory, make_stale))
    assert run(db_do(sessions_factory, lambda db: service.stale_sessions(db, 10))) == []
    run(db_do(sessions_factory, lambda db: db.execute(update(Lecture).values(paused=False))))
    stale = run(db_do(sessions_factory, lambda db: service.stale_sessions(db, 10)))
    assert [lecture.id for lecture in stale] == [lecture_id]


# ── API: recording control ──────────────────────────────────────────────────────────────────────


def test_control_checks_state_device_and_role(api, sessions_factory, redis_server) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    lecture_id = run(prepare_lecture(sessions_factory, seed, "Deadlocks"))
    url = f"/lectures/{lecture_id}/control"

    headers = login(client, "lecturer")
    offline = client.post(url, json={"action": "start"}, headers=headers)
    assert offline.status_code == 409 and offline.json()["code"] == "device_offline"

    set_device(sessions_factory, seed.device_id, online=True)
    assert client.post(url, json={"action": "pause"}, headers=headers).json()["code"] == "invalid_state"

    listener = fakeredis.FakeRedis(server=redis_server, decode_responses=True).pubsub()
    listener.subscribe(f"device:{seed.device_id}")
    listener.get_message(timeout=1)  # subscribe confirmation
    accepted = client.post(url, json={"action": "start"}, headers=headers)
    assert accepted.status_code == 202, accepted.text
    assert accepted.json() == {
        "lecture_id": str(lecture_id),
        "action": "start",
        "device_id": str(seed.device_id),
    }
    sent = []
    for _ in range(20):
        message = listener.get_message(timeout=0.2)
        if message is not None:
            sent.append(json.loads(message["data"]))
        if len(sent) == 2:
            break
    assert [m["type"] for m in sent] == ["lecture.assign", "command"]
    assert sent[1] == {"type": "command", "action": "start", "lecture_id": str(lecture_id)}

    student = login(client, "student")
    assert client.post(url, json={"action": "stop"}, headers=student).status_code == 403


def test_pause_and_resume_follow_the_lecture_state(api, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    lecture_id = run(
        add_lecture(sessions_factory, seed, consent=True, segments=[], status=LectureStatus.recording)
    )
    set_device(sessions_factory, seed.device_id, online=True)
    headers = login(client, "lecturer")
    url = f"/lectures/{lecture_id}/control"
    assert client.post(url, json={"action": "resume"}, headers=headers).status_code == 409
    assert client.post(url, json={"action": "pause"}, headers=headers).status_code == 202
    run(db_do(sessions_factory, lambda db: db.execute(update(Lecture).values(paused=True))))
    assert client.get(f"/lectures/{lecture_id}", headers=headers).json()["paused"] is True
    assert client.post(url, json={"action": "pause"}, headers=headers).status_code == 409
    assert client.post(url, json={"action": "resume"}, headers=headers).status_code == 202
    assert client.post(url, json={"action": "stop"}, headers=headers).status_code == 202


# ── API: transcript corrections ─────────────────────────────────────────────────────────────────


def test_lecturer_corrects_a_segment(api, sessions_factory, sync_redis) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    lecture_id = run(
        add_lecture(
            sessions_factory,
            seed,
            consent=True,
            segments=[(0, "Round robbin uses a quantum.", "en")],
            status=LectureStatus.recording,
        )
    )
    headers = login(client, "lecturer")
    segment_id = client.get(f"/lectures/{lecture_id}/transcript", headers=headers).json()["items"][0][
        "segment_id"
    ]
    url = f"/lectures/{lecture_id}/segments/{segment_id}"

    edited = client.patch(url, json={"text": "  Round robin uses a quantum. "}, headers=headers)
    assert edited.status_code == 200, edited.text
    assert edited.json()["text"] == "Round robin uses a quantum." and edited.json()["edited"] is True
    page = client.get(f"/lectures/{lecture_id}/transcript", headers=headers).json()
    assert page["items"][0]["edited"] is True
    finals = [e for e in live_events(sync_redis, str(lecture_id)) if e["type"] == "transcript.final"]
    assert finals[-1]["segment_id"] == segment_id and finals[-1]["text"] == "Round robin uses a quantum."

    assert (
        client.patch(
            f"/lectures/{lecture_id}/segments/{uuid.uuid4()}", json={"text": "x"}, headers=headers
        ).status_code
        == 404
    )
    assert client.patch(url, json={"text": ""}, headers=headers).status_code == 422
    student = login(client, "student")
    assert client.patch(url, json={"text": "hacked"}, headers=student).status_code == 403


# ── API: flashcards and revision notes ──────────────────────────────────────────────────────────


def test_flashcards_and_revision_follow_publishing(api, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    lecture_id = run(add_lecture(sessions_factory, seed, consent=True, segments=[(0, "Text.", "en")]))
    run(add_artifacts(sessions_factory, lecture_id))

    async def add(db):  # type: ignore[no-untyped-def]
        db.add_all(
            [
                LectureArtifact(
                    lecture_id=lecture_id,
                    kind=ArtifactKind.flashcards,
                    model="m",
                    prompt_version="v",
                    content={
                        "cards": [{"id": "f1", "front": "Quantum?", "back": "A CPU slice.", "source_ms": 0}]
                    },
                ),
                LectureArtifact(
                    lecture_id=lecture_id,
                    kind=ArtifactKind.revision,
                    model="m",
                    prompt_version="v",
                    content={"points": ["RR is fair."], "takeaways": ["Pick the quantum carefully."]},
                ),
            ]
        )

    run(db_do(sessions_factory, add))
    student = login(client, "student")
    hidden = client.get(f"/lectures/{lecture_id}/flashcards", headers=student)
    assert hidden.status_code == 404 and hidden.json()["code"] == "flashcards_not_published"

    lecturer = login(client, "lecturer")
    cards = client.get(f"/lectures/{lecture_id}/flashcards", headers=lecturer).json()
    assert cards["cards"] == [{"id": "f1", "front": "Quantum?", "back": "A CPU slice.", "source_ms": 0}]
    assert client.post(f"/lectures/{lecture_id}/publish", headers=lecturer).status_code == 200

    student = login(client, "student")
    revision = client.get(f"/lectures/{lecture_id}/revision", headers=student).json()
    assert revision["points"] == ["RR is fair."] and revision["takeaways"] == ["Pick the quantum carefully."]
    exported = client.get(f"/lectures/{lecture_id}/export?format=md", headers=student).text
    assert "## Revision notes" in exported and "**Q:** Quantum?" in exported


def test_flashcards_not_generated_yet(api, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    lecture_id = run(add_lecture(sessions_factory, seed, consent=True, segments=[]))
    response = client.get(f"/lectures/{lecture_id}/revision", headers=login(client, "lecturer"))
    assert response.status_code == 404 and response.json()["code"] == "revision_not_ready"


# ── API: profile, password, device settings, system info ───────────────────────────────────────


def test_profile_and_password_change(api) -> None:  # type: ignore[no-untyped-def]
    client, _, _ = api
    headers = login(client, "student")
    profile = client.patch("/auth/me", json={"full_name": "Arjun K."}, headers=headers)
    assert profile.status_code == 200 and profile.json()["full_name"] == "Arjun K."

    wrong = client.post(
        "/auth/password", json={"current_password": "nope", "new_password": "new-pass-123"}, headers=headers
    )
    assert wrong.status_code == 400 and wrong.json()["code"] == "wrong_password"
    changed = client.post(
        "/auth/password",
        json={"current_password": "student-pass-1", "new_password": "new-pass-123"},
        headers=headers,
    )
    assert changed.status_code == 204
    assert client.get("/auth/me").status_code == 200  # this session survives

    client.cookies.clear()
    old = client.post("/auth/login", json={"email": "arjun@college.example", "password": "student-pass-1"})
    assert old.status_code == 401
    new = client.post("/auth/login", json={"email": "arjun@college.example", "password": "new-pass-123"})
    assert new.status_code == 200


def test_admin_updates_device_settings_and_reads_system_info(api) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    lecturer = login(client, "lecturer")
    assert client.patch(f"/devices/{seed.device_id}", json={"gain": 6}, headers=lecturer).status_code == 403
    assert client.get("/system", headers=lecturer).status_code == 403

    admin = login(client, "admin")
    updated = client.patch(
        f"/devices/{seed.device_id}", json={"gain": 6, "vad_enabled": False, "room": "Lab 3"}, headers=admin
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["gain"] == 6 and body["vad_enabled"] is False and body["room"] == "Lab 3"
    assert body["pending_chunks"] == 0 and body["level_dbfs"] is None and body["paused"] is False
    assert client.patch(f"/devices/{seed.device_id}", json={"gain": 99}, headers=admin).status_code == 422

    info = client.get("/system", headers=admin).json()
    assert info["audio_retention_days"] == 0 and info["device_gain_default"] == 4.0
    assert "token" not in json.dumps(info).lower() and "password" not in json.dumps(info).lower()


# ── retention ──────────────────────────────────────────────────────────────────────────────────


def test_retention_deletes_old_audio_but_keeps_the_transcript(sessions_factory, audio_dir: Path) -> None:  # type: ignore[no-untyped-def]
    seed: Seed = run(seed_basics(sessions_factory))
    store = DiskStore(audio_dir)
    now = datetime.now(UTC)

    async def lecture_with_audio(db, ended: datetime) -> uuid.UUID:  # type: ignore[no-untyped-def]
        lecture = Lecture(
            title="t",
            lecturer_id=seed.lecturer_id,
            consent_confirmed=True,
            status=LectureStatus.completed,
            ended_at=ended,
        )
        db.add(lecture)
        await db.flush()
        key = f"audio/{lecture.id}/0-0.pcm"
        await store.put(key, b"\x00" * 10)
        db.add(
            AudioChunk(
                lecture_id=lecture.id,
                seq=0,
                sample_offset=0,
                codec=0,
                duration_ms=500,
                storage_key=key,
                capture_unix_ms=0,
            )
        )
        db.add(
            TranscriptSegment(
                lecture_id=lecture.id, start_ms=0, end_ms=500, text="kept", language="en", source="live"
            )
        )
        return lecture.id

    old = run(db_do(sessions_factory, lambda db: lecture_with_audio(db, now - timedelta(days=40))))
    recent = run(db_do(sessions_factory, lambda db: lecture_with_audio(db, now - timedelta(days=5))))

    assert run(db_do(sessions_factory, lambda db: purge(db, store, 0))) == []
    assert run(db_do(sessions_factory, lambda db: purge(db, store, 30, dry_run=True))) == [old]
    assert run(db_do(sessions_factory, lambda db: purge(db, store, 30))) == [old]
    assert run(db_do(sessions_factory, lambda db: purge(db, store, 30))) == []  # idempotent

    async def counts(db, lecture_id: uuid.UUID) -> tuple[int, int, datetime | None]:  # type: ignore[no-untyped-def]
        chunks = (
            await db.execute(select(func.count()).where(AudioChunk.lecture_id == lecture_id))
        ).scalar_one()
        segments = (
            await db.execute(select(func.count()).where(TranscriptSegment.lecture_id == lecture_id))
        ).scalar_one()
        lecture = await db.get(Lecture, lecture_id)
        return chunks, segments, lecture.audio_purged_at

    chunks, segments, purged_at = run(db_do(sessions_factory, lambda db: counts(db, old)))
    assert (chunks, segments) == (0, 1) and purged_at is not None
    assert not (audio_dir / "audio" / str(old)).exists() or not any(
        (audio_dir / "audio" / str(old)).iterdir()
    )
    chunks, segments, purged_at = run(db_do(sessions_factory, lambda db: counts(db, recent)))
    assert (chunks, segments, purged_at) == (1, 1, None)
