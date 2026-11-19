"""REST API + live WebSocket on PostgreSQL + fakeredis, with fake AI clients."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

import fakeredis
import pytest
from pydantic import BaseModel
from starlette.testclient import TestClient

from app.ai.schemas import QaAnswer
from app.api.main import create_app
from app.audio.storage import DiskStore
from app.db.models import (
    ArtifactKind,
    Lecture,
    LectureArtifact,
    LectureStatus,
    SegmentSource,
    TranscriptSegment,
)
from app.events import publish_live
from tests.conftest import run
from tests.helpers import Seed, seed_basics

PASSWORDS = {
    "lecturer": ("priya@college.example", "lecturer-pass-1"),
    "student": ("arjun@college.example", "student-pass-1"),
    "admin": ("admin@college.example", "admin-pass-1"),
}


class FakeLlm:
    model_name = "fake-llm"

    def __init__(self) -> None:
        self.cited: list[str] = []

    async def generate(self, system: str, user: str, schema: type[BaseModel]) -> Any:
        assert schema is QaAnswer
        return QaAnswer(
            covered=True,
            answer="A small quantum causes many context switches.",
            cited_segment_ids=[*self.cited, "not-a-real-id"],
        )


class FakeEmbedder:
    model_name = "fake-embed"

    async def embed(self, texts: list[str], kind: str) -> list[list[float]]:
        raise AssertionError("no embeddings stored in these tests: lexical retrieval expected")


@pytest.fixture
def api(sessions_factory, redis_server, audio_dir):  # type: ignore[no-untyped-def]
    seed = run(seed_basics(sessions_factory))
    llm = FakeLlm()
    app = create_app(
        redis_factory=lambda: fakeredis.aioredis.FakeRedis(server=redis_server, decode_responses=True),
        store_factory=lambda: DiskStore(audio_dir),
        sessions_factory=sessions_factory,
        llm_factory=lambda: llm,
        embedder_factory=lambda: FakeEmbedder(),
    )
    with TestClient(app) as client:
        yield client, seed, llm


def login(client: TestClient, role: str) -> dict[str, str]:
    client.cookies.clear()
    email, password = PASSWORDS[role]
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"X-CSRF-Token": response.cookies["csrftoken"]}


async def add_lecture(
    factory,
    seed: Seed,
    *,
    consent: bool,
    segments: list[tuple[int, str, str]],
    status: LectureStatus = LectureStatus.completed,
) -> uuid.UUID:  # type: ignore[no-untyped-def]
    sessions = factory()
    async with sessions() as db:
        lecture = Lecture(
            title="CPU Scheduling Algorithms",
            subject_id=seed.subject_id,
            lecturer_id=seed.lecturer_id,
            device_id=seed.device_id,
            consent_confirmed=consent,
            status=status,
            started_at=datetime.now(UTC),
            duration_ms=60_000,
        )
        db.add(lecture)
        await db.flush()
        for start, text, lang in segments:
            db.add(
                TranscriptSegment(
                    lecture_id=lecture.id,
                    start_ms=start,
                    end_ms=start + 4000,
                    text=text,
                    language=lang,
                    confidence=0.9,
                    source=SegmentSource.live,
                )
            )
        await db.commit()
        lecture_id = lecture.id
    await sessions.kw["bind"].dispose()
    return lecture_id


async def add_artifacts(factory, lecture_id: uuid.UUID) -> None:  # type: ignore[no-untyped-def]
    sessions = factory()
    async with sessions() as db:
        db.add_all(
            [
                LectureArtifact(
                    lecture_id=lecture_id,
                    kind=ArtifactKind.notes,
                    model="m",
                    prompt_version="v",
                    content={
                        "sections": [
                            {
                                "id": "s1",
                                "heading": "Round Robin",
                                "body_markdown": "Each process gets a **quantum**.",
                                "start_ms": 0,
                            }
                        ]
                    },
                ),
                LectureArtifact(
                    lecture_id=lecture_id,
                    kind=ArtifactKind.summary,
                    model="m",
                    prompt_version="v",
                    content={"overview": "Scheduling basics.", "key_points": ["RR", "SJF", "FCFS"]},
                ),
            ]
        )
        await db.commit()
    await sessions.kw["bind"].dispose()


SEGMENTS = [
    (0, "Round Robin uses a time quantum.", "en"),
    (5000, "quantum చాలా చిన్నది అయితే context switches ఎక్కువ అవుతాయి.", "te"),
    (10000, "A very small quantum means many context switches.", "en"),
]


def test_auth_cookies_csrf_and_roles(api) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    assert client.get("/auth/me").json()["code"] == "not_authenticated"
    bad = client.post("/auth/login", json={"email": "priya@college.example", "password": "nope"})
    assert bad.status_code == 401 and bad.json() == {
        "code": "invalid_credentials",
        "message": "Email or password is incorrect.",
    }
    csrf = login(client, "lecturer")
    assert client.get("/auth/me").json()["full_name"] == "Dr. Priya Raghavan"
    body = {
        "subject_id": str(seed.subject_id),
        "title": "Deadlocks",
        "language": "en",
        "device_id": str(seed.device_id),
        "consent_confirmed": True,
    }
    assert client.post("/lectures", json=body).json()["code"] == "csrf_failed"
    created = client.post("/lectures", json=body, headers=csrf)
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "scheduled" and created.json()["consent_confirmed"] is True
    assert (
        client.post("/lectures", json={**body, "consent_confirmed": False}, headers=csrf).status_code == 422
    )
    csrf = login(client, "student")
    assert client.get("/devices").status_code == 403
    assert client.post("/lectures", json=body, headers=csrf).status_code == 403
    client.post("/auth/logout", headers=csrf)
    assert client.get("/auth/me").status_code == 401


def test_visibility_transcript_and_publish_flow(api, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    public = run(add_lecture(sessions_factory, seed, consent=True, segments=SEGMENTS))
    private = run(add_lecture(sessions_factory, seed, consent=False, segments=[]))
    run(add_artifacts(sessions_factory, public))

    login(client, "student")
    ids = [item["id"] for item in client.get("/lectures").json()["items"]]
    assert str(public) in ids and str(private) not in ids
    assert client.get(f"/lectures/{private}").status_code == 404
    page = client.get(f"/lectures/{public}/transcript", params={"limit": 2}).json()
    assert [s["start_ms"] for s in page["items"]] == [0, 5000] and page["next_cursor"]
    rest = client.get(f"/lectures/{public}/transcript", params={"cursor": page["next_cursor"]}).json()
    assert [s["start_ms"] for s in rest["items"]] == [10000] and rest["next_cursor"] is None
    assert client.get(f"/lectures/{public}/notes").json()["code"] == "notes_not_published"

    csrf = login(client, "lecturer")
    notes = client.get(f"/lectures/{public}/notes").json()
    assert notes["published"] is False and notes["sections"][0]["heading"] == "Round Robin"
    stale = client.patch(
        f"/lectures/{public}/notes",
        json={"version": 99, "sections": [{"id": "s1", "heading": "X", "body_markdown": "y"}]},
        headers=csrf,
    )
    assert stale.status_code == 409
    edited = client.patch(
        f"/lectures/{public}/notes",
        json={
            "version": notes["version"],
            "sections": [
                {"id": "s1", "heading": "Round Robin (edited)", "body_markdown": "Quantum."},
                {"id": None, "heading": "New", "body_markdown": "More."},
            ],
        },
        headers=csrf,
    ).json()
    assert (
        edited["version"] == notes["version"] + 1
        and edited["sections"][0]["start_ms"] == 0
        and len(edited["sections"]) == 2
    )
    assert client.post(f"/lectures/{public}/publish", headers=csrf).json()["published"] is True

    login(client, "student")
    assert client.get(f"/lectures/{public}/notes").json()["sections"][0]["heading"] == "Round Robin (edited)"
    assert client.get(f"/lectures/{public}/summary").json()["key_points"] == ["RR", "SJF", "FCFS"]
    item = next(i for i in client.get("/lectures").json()["items"] if i["id"] == str(public))
    assert (
        item["notes_ready"] and item["notes_published"] and sorted(item["languages_detected"]) == ["en", "te"]
    )


def test_ask_cites_only_retrieved_segments(api, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed, llm = api
    lecture = run(add_lecture(sessions_factory, seed, consent=True, segments=SEGMENTS))
    csrf = login(client, "student")
    transcript = client.get(f"/lectures/{lecture}/transcript").json()["items"]
    llm.cited = [transcript[2]["segment_id"]]
    answer = client.post(
        f"/lectures/{lecture}/ask", json={"question": "Why is a small quantum bad?"}, headers=csrf
    ).json()
    assert answer["answer"].startswith("A small quantum")
    assert answer["cited_segment_ids"] == [transcript[2]["segment_id"]]  # invented id dropped
    none = client.post(
        f"/lectures/{lecture}/ask", json={"question": "When is the exam?"}, headers=csrf
    ).json()
    assert none == {"answer": "This is not covered in this lecture.", "cited_segment_ids": []}


def test_search_groups_and_highlights_code_points(api, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    lecture = run(add_lecture(sessions_factory, seed, consent=True, segments=SEGMENTS))
    login(client, "student")
    result = client.get("/search", params={"q": "context switches"}).json()
    assert result["total_hits"] == 2 and result["groups"][0]["lecture"]["id"] == str(lecture)
    for hit in result["groups"][0]["hits"]:
        span = hit["highlights"][0]
        assert hit["text"][span["start"] : span["end"]].lower() == "context switches"
    telugu = client.get("/search", params={"q": "చిన్నది"}).json()
    hit = telugu["groups"][0]["hits"][0]
    assert (
        hit["language"] == "te"
        and hit["text"][hit["highlights"][0]["start"] : hit["highlights"][0]["end"]] == "చిన్నది"
    )
    assert client.get("/search", params={"q": "x"}).json()["code"] == "query_too_short"


def test_export_devices_and_delete(api, sessions_factory) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    lecture = run(add_lecture(sessions_factory, seed, consent=True, segments=SEGMENTS))
    csrf = login(client, "lecturer")
    txt = client.get(f"/lectures/{lecture}/export", params={"format": "txt"})
    assert txt.status_code == 200 and "[0:05] quantum చాలా" in txt.text
    assert 'filename="cpu-scheduling-algorithms.txt"' in txt.headers["content-disposition"]
    md = client.get(f"/lectures/{lecture}/export", params={"format": "md"}).text
    assert md.startswith("# CPU Scheduling Algorithms") and "## Transcript" in md
    assert client.get(f"/lectures/{lecture}/export", params={"format": "pdf"}).status_code in (200, 501)
    devices = client.get("/devices").json()
    assert [d["serial"] for d in devices] == ["24A160C3F1B8"] and devices[0]["online"] is False

    admin_csrf = login(client, "admin")
    registered = client.post(
        "/devices",
        json={
            "name": "Desk mic · Room 105",
            "room": "Block C",
            "serial": "24A160C3AAAA",
            "lecturer_ids": [str(seed.lecturer_id)],
        },
        headers=admin_csrf,
    )
    assert registered.status_code == 201 and len(registered.json()["token"]) >= 24
    assert (
        client.post(
            "/devices", json={"name": "Dup", "room": "x", "serial": "24A160C3AAAA"}, headers=admin_csrf
        ).status_code
        == 409
    )

    csrf = login(client, "lecturer")
    assert client.delete(f"/lectures/{lecture}", headers=csrf).status_code == 204
    assert client.get(f"/lectures/{lecture}").status_code == 404


def test_live_socket_replay_ping_and_render_ack(api, sessions_factory, redis_server) -> None:  # type: ignore[no-untyped-def]
    client, seed, _ = api
    lecture = run(
        add_lecture(sessions_factory, seed, consent=True, segments=[], status=LectureStatus.recording)
    )

    async def publish() -> None:
        redis = fakeredis.aioredis.FakeRedis(server=redis_server, decode_responses=True)
        await publish_live(
            redis, str(lecture), {"type": "lecture.status", "status": "recording", "duration_ms": 0}
        )
        await publish_live(
            redis,
            str(lecture),
            {
                "type": "transcript.final",
                "segment_id": "s1",
                "start_ms": 0,
                "end_ms": 900,
                "text": "Hello",
                "language": "en",
                "confidence": 0.9,
            },
        )

    asyncio.run(publish())
    login(client, "student")
    with client.websocket_connect(f"/ws/lectures/{lecture}/live") as ws:
        ws.send_json({"type": "subscribe", "lecture_id": str(lecture), "last_seq": 1})
        event = ws.receive_json()
        assert event["seq"] == 2 and event["type"] == "transcript.final" and event["server_ts"] > 0
        ws.send_json({"type": "ping", "client_ts": 123})
        assert ws.receive_json() == {
            "type": "pong",
            "client_ts": 123,
            "server_ts": pytest.approx(event["server_ts"], abs=60_000),
        }
        ws.send_json({"type": "render.ack", "seq": 2, "rendered_unix_ms": 1_763_532_000_000})
    client.cookies.clear()
    with client.websocket_connect(f"/ws/lectures/{lecture}/live") as ws, pytest.raises(Exception):  # noqa: B017
        ws.receive_json()  # closed with 4401: not signed in
