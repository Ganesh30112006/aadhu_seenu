"""Device control messages (contracts/PROTOCOL.md §1.3, contracts/schemas/device-control.schema.json)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

DeviceState = Literal[
    "BOOT",
    "WIFI_CONNECTING",
    "SERVER_CONNECTING",
    "READY",
    "RECORDING",
    "RECORDING_OFFLINE",
    "PAUSED",
    "SYNCING",
    "FINALIZING",
    "ERROR",
]


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Hello(_Msg):
    type: Literal["hello"]
    device_id: uuid.UUID
    firmware_version: str = Field(max_length=32)
    token: str = Field(min_length=16, max_length=128)
    protocol_version: Literal[1]


class Start(_Msg):
    type: Literal["start"]
    session_id: uuid.UUID
    lecture_id: uuid.UUID | None
    started_unix_ms: int = Field(ge=0)
    sample_rate: Literal[16000]


class Resume(_Msg):
    type: Literal["resume"]
    session_id: uuid.UUID
    lecture_id: uuid.UUID | None


class Stop(_Msg):
    type: Literal["stop"]
    session_id: uuid.UUID
    last_seq: int = Field(ge=-1)


class Pause(_Msg):
    """Capture paused (`paused: true`) or resumed on the device, by its button or a web command.
    No chunks are produced while paused, so seq stays contiguous and lecture time excludes the pause."""

    type: Literal["pause"]
    session_id: uuid.UUID
    paused: bool


class Status(_Msg):
    type: Literal["status"]
    wifi_rssi: int = Field(ge=-127, le=0)
    psram_buffer_pct: float = Field(ge=0, le=100)
    flash_buffer_pct: float = Field(ge=0, le=100)
    uptime_s: int = Field(ge=0)
    recording: bool
    state: DeviceState
    pending_chunks: int = Field(ge=0)
    # Additions (master plan: live device monitoring). Optional so older firmware stays valid.
    level_dbfs: float | None = Field(default=None, ge=-120, le=0)
    mic_ok: bool | None = None
    paused: bool = False


DeviceMessage = Annotated[Start | Resume | Stop | Pause | Status, Field(discriminator="type")]
device_message_adapter: TypeAdapter[Start | Resume | Stop | Pause | Status] = TypeAdapter(DeviceMessage)
hello_adapter: TypeAdapter[Hello] = TypeAdapter(Hello)


def config_msg(gain: float, vad_enabled: bool, server_unix_ms: int) -> dict[str, object]:
    return {"type": "config", "gain": gain, "vad_enabled": vad_enabled, "server_unix_ms": server_unix_ms}


def ack_msg(session_id: uuid.UUID, seq: int, ranges: list[list[int]]) -> dict[str, object]:
    return {"type": "ack", "session_id": str(session_id), "seq": seq, "ranges": ranges}


def assign_msg(lecture_id: uuid.UUID, title: str) -> dict[str, object]:
    return {"type": "lecture.assign", "lecture_id": str(lecture_id), "title": title[:160]}


def started_msg(lecture_id: uuid.UUID, session_id: uuid.UUID) -> dict[str, object]:
    return {"type": "lecture.started", "lecture_id": str(lecture_id), "session_id": str(session_id)}


def command_msg(action: str, lecture_id: uuid.UUID) -> dict[str, object]:
    """Server → device: the web Live page pressed Start/Pause/Resume/Stop (same effect as the buttons)."""
    return {"type": "command", "action": action, "lecture_id": str(lecture_id)}


def error_msg(code: str, message: str) -> dict[str, object]:
    return {"type": "error", "code": code, "message": message}


CLOSE_AUTH = 4401
CLOSE_PROTOCOL = 4400
CLOSE_REPLACED = 4409
