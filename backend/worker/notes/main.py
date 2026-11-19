"""Notes worker process: `python -m worker.notes.main`.

Two loops: (1) full material generation when a lecture is transcribed (`jobs:notes`), and
(2) live key terms every `live_key_terms_interval_s` for lectures being recorded (D4).
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid

from sqlalchemy import select

from app.ai.client import get_embedder, get_llm
from app.config import get_settings
from app.db.models import Lecture, LectureStatus
from app.db.session import get_sessionmaker
from app.events import NOTES_JOBS, create_redis, enqueue_notes
from app.logs import configure_logging, get_logger
from worker.notes.pipeline import NotesContext, generate_lecture_material, live_key_terms

log = get_logger("notes")


async def jobs_loop(ctx: NotesContext) -> None:
    while True:
        item = await ctx.redis.blpop([NOTES_JOBS], timeout=5)
        if item is None:
            continue
        try:
            job = json.loads(item[1])
            await generate_lecture_material(ctx, uuid.UUID(job["lecture_id"]))
        except Exception:
            log.exception("notes_job_failed", job=item[1])


async def live_terms_loop(ctx: NotesContext) -> None:
    high_water: dict[uuid.UUID, int] = {}
    last_run: dict[uuid.UUID, float] = {}
    while True:
        await asyncio.sleep(15)
        try:
            async with ctx.sessions() as db:
                recording = list(
                    (
                        await db.execute(select(Lecture.id).where(Lecture.status == LectureStatus.recording))
                    ).scalars()
                )
            for lecture_id in recording:
                if time.monotonic() - last_run.get(lecture_id, 0.0) < ctx.settings.live_key_terms_interval_s:
                    continue
                last_run[lecture_id] = time.monotonic()
                high_water[lecture_id] = await live_key_terms(ctx, lecture_id, high_water.get(lecture_id, -1))
        except Exception:
            log.exception("live_terms_failed")


async def requeue_processing_lectures(ctx: NotesContext) -> int:
    """Re-queues lectures left in `processing` whose job is not in the queue.

    BLPOP removes a job before it runs, so a crash mid-job, a crash between the ASR worker's commit
    and its enqueue, or a Redis flush would otherwise leave the lecture `processing` forever.
    Generation is idempotent: artifacts are upserted.
    """
    queued: set[str] = set()
    for raw in await ctx.redis.lrange(NOTES_JOBS, 0, -1):
        try:
            queued.add(str(json.loads(raw)["lecture_id"]))
        except (ValueError, KeyError, TypeError):
            continue
    async with ctx.sessions() as db:
        ids = [
            str(r[0])
            for r in await db.execute(select(Lecture.id).where(Lecture.status == LectureStatus.processing))
        ]
    missing = [i for i in ids if i not in queued]
    for lecture_id in missing:
        await enqueue_notes(ctx.redis, lecture_id)
    return len(missing)


async def main() -> None:
    configure_logging("notes")
    settings = get_settings()
    ctx = NotesContext(get_sessionmaker(), create_redis(), get_llm(), get_embedder(), settings)
    log.info("notes_worker_started", llm=ctx.llm.model_name, embedder=ctx.embedder.model_name)
    log.info("notes_requeued_on_start", lectures=await requeue_processing_lectures(ctx))
    await asyncio.gather(jobs_loop(ctx), live_terms_loop(ctx))


if __name__ == "__main__":
    asyncio.run(main())
