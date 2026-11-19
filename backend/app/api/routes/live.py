"""Browser live WebSocket: wss://<host>/ws/lectures/{lecture_id}/live (contracts/PROTOCOL.md §2).

Replays the lecture's Redis Stream from `last_seq`, then forwards new events. Adds `server_ts`
at send time. Handles `ping` (→ `pong`) and `render.ack` (latency stage 6).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from app.api.deps import ApiContext, can_view, session_for_token
from app.db.models import LatencyMark, Lecture, LectureStatus
from app.events import current_live_seq, now_ms, read_live_since

router = APIRouter()
POLL_S = 0.2
SUBSCRIBE_TIMEOUT_S = 10.0


class Subscribe(BaseModel):
    type: str = Field(pattern="^subscribe$")
    lecture_id: str
    last_seq: int = Field(ge=0)


class ClientFrame(BaseModel):
    type: str
    client_ts: float | None = None
    seq: int | None = None
    rendered_unix_ms: int | None = None


client_frame = TypeAdapter(ClientFrame)


@router.websocket("/ws/lectures/{lecture_id}/live")
async def live_socket(ws: WebSocket, lecture_id: uuid.UUID) -> None:
    ctx: ApiContext = ws.app.state.ctx
    await ws.accept()
    async with ctx.sessions() as db:
        web_session = await session_for_token(db, ws.cookies.get(ctx.settings.session_cookie))
        if web_session is None:
            await ws.close(4401)
            return
        lecture = await db.get(Lecture, lecture_id)
        if lecture is None or not can_view(web_session.user, lecture):
            await ws.close(4404)
            return
    try:
        sub = Subscribe.model_validate_json(await asyncio.wait_for(ws.receive_text(), SUBSCRIBE_TIMEOUT_S))
    except (TimeoutError, ValidationError, WebSocketDisconnect):
        with contextlib.suppress(RuntimeError):
            await ws.close(4400)
        return

    key = str(lecture_id)
    send_lock = asyncio.Lock()

    async def send(message: dict[str, Any]) -> None:
        async with send_lock:
            await ws.send_text(json.dumps(message))

    async def receive_loop() -> None:
        while True:
            try:
                frame = client_frame.validate_json(await ws.receive_text())
            except ValidationError:
                continue
            if frame.type == "ping" and frame.client_ts is not None:
                await send({"type": "pong", "client_ts": frame.client_ts, "server_ts": now_ms()})
            elif frame.type == "render.ack" and frame.seq is not None and frame.rendered_unix_ms is not None:
                async with ctx.sessions() as db:
                    db.add(
                        LatencyMark(
                            lecture_id=lecture_id,
                            event_seq=frame.seq,
                            stage="rendered",
                            ts_ms=frame.rendered_unix_ms,
                        )
                    )
                    await db.commit()

    receiver = asyncio.create_task(receive_loop())
    last_seq = sub.last_seq
    try:
        if last_seq > await current_live_seq(ctx.redis, key):
            # The event log was lost (e.g. Redis restart): ask the client to start over.
            await send(
                {
                    "type": "error",
                    "seq": last_seq + 1,
                    "server_ts": now_ms(),
                    "code": "resync_required",
                    "message": "Live history reset.",
                }
            )
            last_seq = 0
        idle_checks = 0
        while not receiver.done():
            events = await read_live_since(ctx.redis, key, last_seq)
            for seq, event, _published in events:
                await send({**event, "seq": seq, "server_ts": now_ms()})
                last_seq = seq
            if events:
                idle_checks = 0
                continue
            idle_checks += 1
            if idle_checks % 25 == 0:  # every ~5 s: has the lecture finished?
                async with ctx.sessions() as db:
                    current = await db.get(Lecture, lecture_id)
                if current is None or current.status in (LectureStatus.completed, LectureStatus.failed):
                    await ws.close(1000)
                    return
            await asyncio.sleep(POLL_S)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        receiver.cancel()
        with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
            await receiver
