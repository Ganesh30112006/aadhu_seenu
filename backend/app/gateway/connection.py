"""One device WebSocket connection (contracts/PROTOCOL.md §1)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from collections.abc import Coroutine
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as aioredis
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.audio.frames import CHUNK_MS, FrameError, parse_frame
from app.audio.storage import AudioStore, chunk_key
from app.config import Settings
from app.db.models import GapState, LectureGap
from app.events import delete_live_event, device_channel, enqueue_asr, now_ms, publish_live
from app.gateway import protocol, service
from app.gateway.seq_tracker import SeqTracker
from app.logs import get_logger

log = get_logger("gateway")

ACK_INTERVAL_S = 0.25
HELLO_TIMEOUT_S = 10.0
STATUS_EVERY_MS = 30_000  # lecture.status duration refresh


def _log_cleanup_failure(task: asyncio.Future[None]) -> None:
    if not task.cancelled() and task.exception() is not None:
        log.error("disconnect_cleanup_failed", error=repr(task.exception()))


@dataclass
class SessionState:
    lecture_id: uuid.UUID
    tracker: SeqTracker
    dirty: bool = False
    last_ack_at: float = 0.0
    last_status_ms: int = 0
    gaps: dict[int, LectureGap] = field(default_factory=dict)  # open gaps by start_seq


class Registry:
    """At most one live connection per device; a newer one replaces the older (close 4409)."""

    def __init__(self) -> None:
        self._by_device: dict[uuid.UUID, DeviceConnection] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    def spawn(self, coro: Coroutine[Any, Any, None]) -> None:
        """Runs cleanup independently of the (possibly cancelled) connection handler."""
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        task.add_done_callback(_log_cleanup_failure)

    async def drain(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    async def claim(self, device_id: uuid.UUID, conn: DeviceConnection) -> None:
        old = self._by_device.get(device_id)
        self._by_device[device_id] = conn
        if old is not None and old is not conn:
            await old.close(protocol.CLOSE_REPLACED)

    def release(self, device_id: uuid.UUID, conn: DeviceConnection) -> None:
        if self._by_device.get(device_id) is conn:
            del self._by_device[device_id]


class DeviceConnection:
    def __init__(
        self,
        ws: WebSocket,
        redis: aioredis.Redis,
        store: AudioStore,
        sessions: async_sessionmaker[AsyncSession],
        settings: Settings,
        registry: Registry,
    ) -> None:
        self.ws = ws
        self.redis = redis
        self.store = store
        self.db = sessions
        self.settings = settings
        self.registry = registry
        self.device_id: uuid.UUID | None = None
        self.sessions: dict[uuid.UUID, SessionState] = {}
        self.current: uuid.UUID | None = None
        self.last_status: dict[str, Any] | None = None
        self.last_chunk_ms: int | None = None  # when the server last stored audio ("last sync")
        self._status_event: dict[str, int] = {}  # lecture → seq of its latest device.status event
        self._send_lock = asyncio.Lock()
        self._closed = False

    # ── plumbing ─────────────────────────────────────────────────────────────
    async def send(self, message: dict[str, Any]) -> None:
        if self._closed:
            return
        async with self._send_lock:
            with contextlib.suppress(RuntimeError, WebSocketDisconnect):
                await self.ws.send_text(json.dumps(message))

    async def close(self, code: int) -> None:
        if self._closed:
            return
        self._closed = True
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await self.ws.close(code)

    # ── lifecycle ────────────────────────────────────────────────────────────
    async def run(self) -> None:
        await self.ws.accept()
        if not await self._handshake():
            return
        assert self.device_id is not None
        tasks = [asyncio.create_task(self._ack_ticker()), asyncio.create_task(self._control_listener())]
        try:
            while not self._closed:
                message = await self.ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    await self._on_frame(message["bytes"])
                elif message.get("text") is not None:
                    await self._on_text(message["text"])
        except WebSocketDisconnect:
            pass
        finally:
            # No awaits here: the handler may already be cancelled. All teardown runs in a tracked
            # background task, so the device is still marked offline and the gap announced.
            self._closed = True
            for task in tasks:
                task.cancel()
            self.registry.release(self.device_id, self)
            self.registry.spawn(self._teardown(tasks))

    async def _teardown(self, tasks: list[asyncio.Task[None]]) -> None:
        await asyncio.gather(*tasks, return_exceptions=True)
        await self._on_disconnect()

    async def _handshake(self) -> bool:
        try:
            raw = await asyncio.wait_for(self.ws.receive_text(), HELLO_TIMEOUT_S)
            hello = protocol.hello_adapter.validate_json(raw)
        except (TimeoutError, ValidationError, WebSocketDisconnect, RuntimeError, KeyError):
            await self.send(protocol.error_msg("protocol_error", "first message must be a valid hello"))
            await self.close(protocol.CLOSE_PROTOCOL)
            return False
        async with self.db() as db:
            device = await service.authenticate(db, hello.device_id, hello.token)
            if device is None:
                log.warning("device_auth_failed", device_id=str(hello.device_id))
                await self.send(protocol.error_msg("auth_failed", "unknown device or wrong token"))
                await self.close(protocol.CLOSE_AUTH)
                return False
            await service.set_device_seen(db, device.id, online=True, firmware=hello.firmware_version)
            assignment = await service.pending_assignment(db, device.id)
        self.device_id = device.id
        await self.registry.claim(device.id, self)
        log.info("device_connected", device_id=str(device.id), firmware=hello.firmware_version)
        gain = device.gain if device.gain is not None else self.settings.device_gain
        vad = device.vad_enabled if device.vad_enabled is not None else self.settings.device_vad_enabled
        await self.send(protocol.config_msg(gain, vad, now_ms()))
        if assignment is not None:
            await self.send(protocol.assign_msg(assignment.id, assignment.title))
        return True

    # ── control messages ─────────────────────────────────────────────────────
    async def _on_text(self, raw: str) -> None:
        try:
            msg = protocol.device_message_adapter.validate_json(raw)
        except ValidationError:
            await self.send(protocol.error_msg("protocol_error", "invalid control message"))
            return
        if isinstance(msg, protocol.Start | protocol.Resume):
            await self._declare(msg)
        elif isinstance(msg, protocol.Stop):
            await self._stop(msg)
        elif isinstance(msg, protocol.Pause):
            await self._pause(msg)
        else:
            await self._status(msg)

    async def _declare(self, msg: protocol.Start | protocol.Resume) -> None:
        assert self.device_id is not None
        started_ms = msg.started_unix_ms if isinstance(msg, protocol.Start) else 0
        async with self.db() as db:
            lecture, newly_started = await service.bind_session(
                db, self.device_id, msg.session_id, msg.lecture_id, started_ms
            )
            if msg.session_id not in self.sessions:
                seqs = await service.stored_seqs(db, lecture.id)
                gaps = await service.open_gaps(db, lecture.id)
                self.sessions[msg.session_id] = SessionState(
                    lecture_id=lecture.id,
                    tracker=SeqTracker.from_seqs(seqs),
                    gaps={g.start_seq: g for g in gaps},
                )
        self.current = msg.session_id
        await self.send(protocol.started_msg(lecture.id, msg.session_id))
        if newly_started:
            log.info("lecture_started", lecture_id=str(lecture.id), session_id=str(msg.session_id))
            await publish_live(
                self.redis,
                str(lecture.id),
                {"type": "lecture.status", "status": "recording", "duration_ms": 0},
            )
        self.sessions[msg.session_id].dirty = True

    async def _stop(self, msg: protocol.Stop) -> None:
        state = self.sessions.get(msg.session_id)
        async with self.db() as db:
            lecture_id = state.lecture_id if state else None
            if lecture_id is None:
                lecture = await service.lecture_for_session(db, msg.session_id)
                if lecture is None:
                    await self.send(protocol.error_msg("unknown_session", "stop for an unknown session"))
                    return
                lecture_id = lecture.id
            await service.mark_stop(db, lecture_id, msg.last_seq)
        tracker = state.tracker if state else SeqTracker()
        # The ack is also the stop confirmation the device waits for (§1.4.7).
        await self.send(protocol.ack_msg(msg.session_id, tracker.cumulative, tracker.ranges()))
        await enqueue_asr(self.redis, str(lecture_id))
        log.info("lecture_stopped", lecture_id=str(lecture_id), last_seq=msg.last_seq)

    async def _pause(self, msg: protocol.Pause) -> None:
        state = self.sessions.get(msg.session_id)
        async with self.db() as db:
            lecture_id = state.lecture_id if state else None
            if lecture_id is None:
                found = await service.lecture_for_session(db, msg.session_id)
                lecture_id = found.id if found else None
            lecture = await service.set_paused(db, lecture_id, msg.paused) if lecture_id else None
        if lecture is None:
            await self.send(protocol.error_msg("unknown_session", "pause for an unknown session"))
            return
        log.info("lecture_paused" if msg.paused else "lecture_unpaused", lecture_id=str(lecture.id))
        duration_ms = (state.tracker.max_seq + 1) * CHUNK_MS if state else lecture.duration_ms
        await publish_live(
            self.redis,
            str(lecture.id),
            {
                "type": "lecture.status",
                "status": "recording",
                "paused": msg.paused,
                "duration_ms": duration_ms,
            },
        )

    async def _status(self, msg: protocol.Status) -> None:
        assert self.device_id is not None
        status = msg.model_dump(exclude={"type"})
        self.last_status = status
        async with self.db() as db:
            await service.set_device_seen(db, self.device_id, online=True, status=status)
            lecture = await service.recording_lecture_for_device(db, self.device_id)
        if lecture is not None:
            await self._publish_device_status(str(lecture.id), online=True)

    async def _publish_device_status(self, lecture_id: str, *, online: bool) -> None:
        status = self.last_status or {}
        # Status arrives every second while recording: keep only the newest one in the replay log.
        previous = self._status_event.get(lecture_id)
        if previous is not None:
            await delete_live_event(self.redis, lecture_id, previous)
        self._status_event[lecture_id] = await publish_live(
            self.redis,
            lecture_id,
            {
                "type": "device.status",
                "device_id": str(self.device_id),
                "online": online,
                "wifi_rssi": status.get("wifi_rssi") if online else None,
                "psram_buffer_pct": status.get("psram_buffer_pct", 0),
                "flash_buffer_pct": status.get("flash_buffer_pct", 0),
                "recording": bool(status.get("recording", False)),
                "last_seen_at": datetime.now(UTC).isoformat(),
                "paused": bool(status.get("paused", False)),
                "level_dbfs": status.get("level_dbfs") if online else None,
                "mic_ok": status.get("mic_ok") if online else None,
                "pending_chunks": int(status.get("pending_chunks", 0)),
                "last_audio_at": (
                    datetime.fromtimestamp(self.last_chunk_ms / 1000, UTC).isoformat()
                    if self.last_chunk_ms is not None
                    else None
                ),
            },
        )

    # ── audio frames ─────────────────────────────────────────────────────────
    async def _on_frame(self, data: bytes) -> None:
        received = now_ms()
        if self.current is None:
            await self.send(protocol.error_msg("protocol_error", "audio frame before start/resume"))
            return
        try:
            frame = parse_frame(data)
        except FrameError as exc:
            await self.send(protocol.error_msg("protocol_error", str(exc)))
            return
        state = self.sessions[self.current]
        lecture_id = str(state.lecture_id)
        key = chunk_key(lecture_id, frame.seq, int(frame.codec))
        if not state.tracker.has(frame.seq):
            await self.store.put(key, frame.payload)  # deterministic key: a retried write is idempotent
            async with self.db() as db:
                inserted = await service.store_chunk(db, state.lecture_id, frame, key, received)
            if inserted:
                self.last_chunk_ms = received
                await self._after_store(state, frame.seq)
        state.dirty = True

    async def _after_store(self, state: SessionState, seq: int) -> None:
        lecture_id = str(state.lecture_id)
        open_ended = next((g for g in state.gaps.values() if g.end_seq is None), None)
        hole = state.tracker.add(seq)
        async with self.db() as db:
            if open_ended is not None and hole is None and seq == open_ended.start_seq:
                # The device resent in order: the announced gap was empty after all.
                await service.set_gap_state(db, open_ended.id, GapState.done, end_seq=seq - 1)
                del state.gaps[open_ended.start_seq]
                start_ms = open_ended.start_seq * CHUNK_MS
                await publish_live(
                    self.redis,
                    lecture_id,
                    {
                        "type": "transcript.backfill",
                        "gap_id": open_ended.gap_id,
                        "segments": [],
                        "gap": {"start_ms": start_ms, "end_ms": start_ms},
                    },
                )
            if hole is not None:
                gap = await service.upsert_gap(db, state.lecture_id, hole[0], hole[1])
                state.gaps[gap.start_seq] = gap
                await publish_live(
                    self.redis,
                    lecture_id,
                    {
                        "type": "transcript.gap",
                        "gap_id": gap.gap_id,
                        "gap": {"start_ms": hole[0] * CHUNK_MS, "end_ms": (hole[1] + 1) * CHUNK_MS},
                    },
                )
            for start, gap in list(state.gaps.items()):
                if gap.end_seq is not None and state.tracker.range_complete(gap.start_seq, gap.end_seq):
                    await service.set_gap_state(db, gap.id, GapState.filled)
                    del state.gaps[start]
                    state.last_ack_at = 0.0  # ack immediately when a gap fills
                    log.info("gap_filled", lecture_id=lecture_id, gap_id=gap.gap_id)
        duration_ms = (state.tracker.max_seq + 1) * CHUNK_MS
        if duration_ms - state.last_status_ms >= STATUS_EVERY_MS:
            state.last_status_ms = duration_ms
            await publish_live(
                self.redis,
                lecture_id,
                {"type": "lecture.status", "status": "recording", "duration_ms": duration_ms},
            )
        await enqueue_asr(self.redis, lecture_id)

    async def _ack_ticker(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            await asyncio.sleep(0.05)
            for session_id, state in self.sessions.items():
                if state.dirty and loop.time() - state.last_ack_at >= ACK_INTERVAL_S:
                    state.dirty = False
                    state.last_ack_at = loop.time()
                    await self.send(
                        protocol.ack_msg(session_id, state.tracker.cumulative, state.tracker.ranges())
                    )

    async def _control_listener(self) -> None:
        assert self.device_id is not None
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(device_channel(str(self.device_id)))
        try:
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message is not None and isinstance(message.get("data"), str):
                    await self.send(json.loads(message["data"]))
        finally:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe()
                await pubsub.aclose()  # type: ignore[no-untyped-call]

    async def _on_disconnect(self) -> None:
        if self.device_id is None:
            return
        log.info("device_disconnected", device_id=str(self.device_id))
        async with self.db() as db:
            await service.set_device_seen(db, self.device_id, online=False)
            lecture = await service.recording_lecture_for_device(db, self.device_id)
            if lecture is None:
                return
            await self._publish_device_status(str(lecture.id), online=False)
            state = next((s for s in self.sessions.values() if s.lecture_id == lecture.id), None)
            if state is None or any(g.end_seq is None for g in state.gaps.values()):
                return
            # Audio keeps being recorded on the device: announce an open-ended gap (D8).
            start = state.tracker.max_seq + 1
            gap = await service.upsert_gap(db, lecture.id, start, None)
        await publish_live(
            self.redis,
            str(lecture.id),
            {
                "type": "transcript.gap",
                "gap_id": gap.gap_id,
                "gap": {"start_ms": start * CHUNK_MS, "end_ms": None},
            },
        )
