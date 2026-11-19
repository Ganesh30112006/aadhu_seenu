"""Redis plumbing shared by every process.

Live events (D5): one Redis Stream per lecture, `live:{lecture_id}`. Each entry's stream ID is
`{seq}-0`, so a browser resumes with XRANGE from `{last_seq+1}-0`. Seq comes from INCR; if two
publishers race, the loser's XADD is rejected (ID not greater than the top) and it retries with a
new seq, so order is preserved and at worst a seq number is skipped (clients tolerate gaps).

Jobs: lectures with new audio go into the `asr:pending` set and the worker is woken through the
`asr:wake` list; notes jobs use the `jobs:notes` list. Device control messages (lecture.assign)
use pub/sub on `device:{id}` (the gateway re-sends assignments on every connect anyway).
"""

from __future__ import annotations

import json
import time
from typing import Any

import redis.asyncio as aioredis
from redis.exceptions import ResponseError

from app.config import get_settings

ASR_PENDING = "asr:pending"
ASR_WAKE = "asr:wake"
NOTES_JOBS = "jobs:notes"


def live_stream(lecture_id: str) -> str:
    return f"live:{lecture_id}"


def live_counter(lecture_id: str) -> str:
    return f"live:{lecture_id}:seq"


def device_channel(device_id: str) -> str:
    return f"device:{device_id}"


def create_redis() -> aioredis.Redis:
    return aioredis.from_url(get_settings().redis_url, decode_responses=True)


def now_ms() -> int:
    return int(time.time() * 1000)


async def publish_live(redis: aioredis.Redis, lecture_id: str, event: dict[str, Any]) -> int:
    """Appends an event (without seq/server_ts) to the lecture's stream. Returns its seq."""
    stream = live_stream(lecture_id)
    for _ in range(5):
        seq = int(await redis.incr(live_counter(lecture_id)))
        try:
            await redis.xadd(stream, {"e": json.dumps(event), "p": str(now_ms())}, id=f"{seq}-0")
        except ResponseError:
            continue  # another publisher took a higher seq first; take a fresh one
        return seq
    raise RuntimeError(f"could not publish live event for {lecture_id}")


async def delete_live_event(redis: aioredis.Redis, lecture_id: str, seq: int) -> None:
    """Trims a superseded partial from the replay log (D5)."""
    await redis.xdel(live_stream(lecture_id), f"{seq}-0")


async def read_live_since(
    redis: aioredis.Redis, lecture_id: str, last_seq: int, count: int = 500
) -> list[tuple[int, dict[str, Any], int]]:
    """Events with seq > last_seq, in order: (seq, event, published_ms)."""
    entries = await redis.xrange(live_stream(lecture_id), min=f"{last_seq + 1}-0", max="+", count=count)
    out: list[tuple[int, dict[str, Any], int]] = []
    for entry_id, fields in entries or []:
        if fields is None:
            continue
        seq = int(str(entry_id).split("-")[0])
        out.append((seq, json.loads(str(fields["e"])), int(str(fields.get("p", "0")))))
    return out


async def current_live_seq(redis: aioredis.Redis, lecture_id: str) -> int:
    value = await redis.get(live_counter(lecture_id))
    return int(value) if value is not None else 0


async def expire_live(redis: aioredis.Redis, lecture_id: str) -> None:
    ttl = get_settings().live_stream_ttl_s
    await redis.expire(live_stream(lecture_id), ttl)
    await redis.expire(live_counter(lecture_id), ttl)


async def enqueue_asr(redis: aioredis.Redis, lecture_id: str) -> None:
    await redis.sadd(ASR_PENDING, lecture_id)
    await redis.lpush(ASR_WAKE, "1")
    await redis.ltrim(ASR_WAKE, 0, 99)


async def enqueue_notes(redis: aioredis.Redis, lecture_id: str, kind: str = "full") -> None:
    await redis.lpush(NOTES_JOBS, json.dumps({"lecture_id": lecture_id, "kind": kind}))


async def send_device_control(redis: aioredis.Redis, device_id: str, message: dict[str, Any]) -> None:
    await redis.publish(device_channel(device_id), json.dumps(message))
