"""Audio retention (master plan §25; India's DPDP Act 2023): deletes recorded classroom audio
`AUDIO_RETENTION_DAYS` after a lecture ended. Transcripts, notes and the lecture record are kept;
the lecture is marked `audio_purged_at` so the UI can say the recording is gone.

    python -m tools.retention              # apply the configured policy (0 days = keep forever)
    python -m tools.retention --dry-run    # list what would be deleted
    python -m tools.retention --days 30    # override the setting for this run

Run daily by the smartclass-retention.timer systemd unit (infra/).
"""

from __future__ import annotations

import argparse
import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audio.storage import AudioStore, get_audio_store
from app.config import get_settings
from app.db.models import AudioChunk, AuditLog, Lecture, LectureStatus
from app.db.session import get_engine, get_sessionmaker

FINISHED = (LectureStatus.completed, LectureStatus.failed)


async def expired_lectures(db: AsyncSession, days: int, now: datetime) -> list[Lecture]:
    """Finished lectures that ended more than `days` ago and still have audio."""
    cutoff = now - timedelta(days=days)
    rows = await db.execute(
        select(Lecture).where(
            Lecture.status.in_(FINISHED),
            Lecture.audio_purged_at.is_(None),
            Lecture.ended_at.is_not(None),
            Lecture.ended_at < cutoff,
        )
    )
    return list(rows.scalars())


async def purge(
    db: AsyncSession, store: AudioStore, days: int, *, dry_run: bool = False, now: datetime | None = None
) -> list[uuid.UUID]:
    """Deletes the audio of expired lectures; returns their ids. `days <= 0` does nothing."""
    if days <= 0:
        return []
    now = now or datetime.now(UTC)
    lectures = await expired_lectures(db, days, now)
    if dry_run:
        return [lecture.id for lecture in lectures]
    for lecture in lectures:
        # Files first: if deleting them fails, the rows (and the purge) are retried next run.
        await store.delete_prefix(f"audio/{lecture.id}")
        await db.execute(delete(AudioChunk).where(AudioChunk.lecture_id == lecture.id))
        lecture.audio_purged_at = now
        db.add(AuditLog(actor_id=None, action="audio.purge", target=str(lecture.id)))
        await db.commit()
    return [lecture.id for lecture in lectures]


async def main(args: argparse.Namespace) -> None:
    days = args.days if args.days is not None else get_settings().audio_retention_days
    if days <= 0:
        print("Audio retention is off (AUDIO_RETENTION_DAYS=0): nothing to do.")
        return
    async with get_sessionmaker()() as db:
        ids = await purge(db, get_audio_store(), days, dry_run=args.dry_run)
    await get_engine().dispose()
    verb = "Would delete" if args.dry_run else "Deleted"
    print(f"{verb} the audio of {len(ids)} lecture(s) that ended more than {days} days ago.")
    for lecture_id in ids:
        print(f"  {lecture_id}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--days", type=int, default=None, help="override AUDIO_RETENTION_DAYS")
    parser.add_argument("--dry-run", action="store_true")
    asyncio.run(main(parser.parse_args()))
