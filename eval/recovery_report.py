"""Network-recovery report for one lecture: was every chunk stored exactly once, which gaps were
seen, and how long their audio took to arrive.

Procedure (no hardware needed):

    cd backend
    .venv/bin/python -m tools.device_simulator --url ws://127.0.0.1:8001/ws/device \
        --device-id <uuid> --token <token> --wav lecture.wav --outage 30:60 --speed 1
    .venv/bin/python ../eval/recovery_report.py --lecture-id <uuid printed by the simulator/UI>

The exit code is 0 only if seqs 0..last_seq are all present exactly once, and every gap is
filled. With real hardware, pull the Ethernet/Wi-Fi uplink for the outage instead.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from dataclasses import dataclass
from datetime import UTC

from sqlalchemy import select

from app.db.models import AudioChunk, GapState, Lecture, LectureGap
from app.db.session import get_engine, get_sessionmaker
from metrics import backlog_delays, completeness, summarize, utf8_stdio


@dataclass
class Loaded:
    lecture: Lecture
    chunks: list[tuple[int, int, int]]  # seq, capture_unix_ms, received_unix_ms
    gaps: list[LectureGap]


async def load(lecture_id: uuid.UUID) -> Loaded | None:
    async with get_sessionmaker()() as db:
        lecture = await db.get(Lecture, lecture_id)
        if lecture is None:
            return None
        rows = await db.execute(
            select(AudioChunk.seq, AudioChunk.capture_unix_ms, AudioChunk.received_at).where(
                AudioChunk.lecture_id == lecture_id
            )
        )
        chunks = [
            (seq, capture, int(received.replace(tzinfo=received.tzinfo or UTC).timestamp() * 1000))
            for seq, capture, received in rows
        ]
        gaps = list(
            (
                await db.execute(
                    select(LectureGap)
                    .where(LectureGap.lecture_id == lecture_id)
                    .order_by(LectureGap.start_seq)
                )
            ).scalars()
        )
    await get_engine().dispose()
    return Loaded(lecture, chunks, gaps)


def build_report(data: Loaded) -> dict[str, object]:
    seqs = [seq for seq, _, _ in data.chunks]
    last_seq = data.lecture.last_seq if data.lecture.last_seq is not None else max(seqs, default=-1)
    result = completeness(seqs, last_seq)
    capture = {seq: c for seq, c, _ in data.chunks if c > 0}
    receive = {seq: r for seq, _, r in data.chunks}
    gaps: list[dict[str, object]] = []
    for gap in data.gaps:
        end = gap.end_seq if gap.end_seq is not None else last_seq
        delays = summarize(backlog_delays(capture, receive, range(gap.start_seq, end + 1)))
        gaps.append(
            {
                "gap_id": gap.gap_id,
                "seqs": [gap.start_seq, gap.end_seq],
                "audio_s": round((end - gap.start_seq + 1) * 0.5, 1),
                "state": gap.state.value,
                "capture_to_receive": delays.as_dict() if delays else None,
            }
        )
    live = summarize(
        backlog_delays(
            capture,
            receive,
            [s for s in receive if not any(g.start_seq <= s <= (g.end_seq or last_seq) for g in data.gaps)],
        )
    )
    return {
        "lecture_id": str(data.lecture.id),
        "status": data.lecture.status.value,
        "stop_received": data.lecture.stop_received,
        "chunks": result.as_dict(),
        "gaps": gaps,
        "live_capture_to_receive": live.as_dict() if live else None,
        "passed": result.complete and all(g.state == GapState.filled for g in data.gaps),
    }


def main() -> int:
    utf8_stdio()
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--lecture-id", type=uuid.UUID, required=True)
    args = parser.parse_args()
    data = asyncio.run(load(args.lecture_id))
    if data is None:
        print("lecture not found", file=sys.stderr)
        return 2
    report = build_report(data)
    print(json.dumps(report, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
