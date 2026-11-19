"""ASR worker process: `python -m worker.asr.main`.

Lectures with new audio are listed in the Redis set `asr:pending`. A per-lecture lock keeps
processing of one lecture on one worker (local agreement needs strict order) while several
workers can serve different classrooms.
"""

from __future__ import annotations

import asyncio
import os
import socket
import uuid

from sqlalchemy import select

from app.audio.storage import get_audio_store
from app.config import get_settings
from app.db.models import Lecture, LectureStatus
from app.db.session import get_sessionmaker
from app.events import ASR_PENDING, ASR_WAKE, create_redis
from app.logs import configure_logging, get_logger
from worker.asr.processor import AsrContext, process_lecture
from worker.asr.transcriber import FasterWhisperTranscriber

log = get_logger("asr")
LOCK_TTL_S = 300


async def run_once(ctx: AsrContext, worker_id: str) -> int:
    """Processes every pending lecture once; returns how many were processed."""
    processed = 0
    for raw in list(await ctx.redis.smembers(ASR_PENDING)):
        lecture = raw if isinstance(raw, str) else raw.decode()
        lock = f"asr:lock:{lecture}"
        if not await ctx.redis.set(lock, worker_id, nx=True, ex=LOCK_TTL_S):
            continue
        try:
            await ctx.redis.srem(ASR_PENDING, lecture)  # new chunks during processing re-add it
            if await process_lecture(ctx, uuid.UUID(lecture)):
                await ctx.redis.sadd(ASR_PENDING, lecture)
            processed += 1
        except Exception:
            log.exception("lecture_processing_failed", lecture_id=lecture)
            await ctx.redis.sadd(ASR_PENDING, lecture)
            await asyncio.sleep(1)
        finally:
            if await ctx.redis.get(lock) == worker_id:
                await ctx.redis.delete(lock)
    return processed


async def requeue_recording_lectures(ctx: AsrContext) -> int:
    """Re-queues every lecture still recording, so work survives a Redis restart or flush.

    `asr:pending` lives only in Redis; PostgreSQL is the source of truth. Re-queueing is harmless:
    `process_lecture` returns at once when there is no new audio.
    """
    async with ctx.sessions() as db:
        ids = [
            str(r[0])
            for r in await db.execute(select(Lecture.id).where(Lecture.status == LectureStatus.recording))
        ]
    if ids:
        await ctx.redis.sadd(ASR_PENDING, *ids)
    return len(ids)


async def main() -> None:
    configure_logging("asr")
    settings = get_settings()
    transcriber = FasterWhisperTranscriber(settings.asr_model, settings.asr_device, settings.asr_compute_type)
    ctx = AsrContext(get_sessionmaker(), create_redis(), get_audio_store(), transcriber, settings)
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    log.info("asr_worker_started", model=transcriber.name, worker=worker_id)
    log.info("asr_requeued_on_start", lectures=await requeue_recording_lectures(ctx))
    while True:
        await ctx.redis.blpop([ASR_WAKE], timeout=2)
        await run_once(ctx, worker_id)


if __name__ == "__main__":
    asyncio.run(main())
