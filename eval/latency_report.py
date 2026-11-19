"""Latency report: p50/p95 per pipeline stage, from `latency_marks` (contracts/PROTOCOL.md §3).

    cd backend
    .venv/bin/python ../eval/latency_report.py --lecture-id <uuid> [--lecture-id <uuid> ...]
    .venv/bin/python ../eval/latency_report.py --last 5 --json ../eval/results/latency.json

Reads DATABASE_URL from the environment or backend/.env, like the services. For browser
stages, keep a browser on the live page during the lecture: it sends `render.ack`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from pathlib import Path

from sqlalchemy import select

from app.db.models import LatencyMark, Lecture
from app.db.session import get_engine, get_sessionmaker
from metrics import LATENCY_INTERVALS, Mark, latency_intervals, summarize, utf8_stdio


async def load(lecture_ids: list[uuid.UUID], last: int | None) -> dict[uuid.UUID, list[Mark]]:
    async with get_sessionmaker()() as db:
        if last is not None:
            rows = await db.execute(
                select(Lecture.id)
                .where(Lecture.started_at.is_not(None))
                .order_by(Lecture.started_at.desc())
                .limit(last)
            )
            lecture_ids = [r[0] for r in rows]
        out: dict[uuid.UUID, list[Mark]] = {}
        for lecture_id in lecture_ids:
            result = await db.execute(
                select(LatencyMark.stage, LatencyMark.ts_ms, LatencyMark.seq, LatencyMark.event_seq).where(
                    LatencyMark.lecture_id == lecture_id
                )
            )
            out[lecture_id] = [Mark(stage, ts, seq, event_seq) for stage, ts, seq, event_seq in result]
    await get_engine().dispose()
    return out


def report(marks_by_lecture: dict[uuid.UUID, list[Mark]]) -> dict[str, object]:
    pooled: dict[str, list[float]] = {name: [] for name in LATENCY_INTERVALS}
    per_lecture: dict[str, object] = {}
    for lecture_id, marks in marks_by_lecture.items():
        intervals = latency_intervals(marks)
        per_lecture[str(lecture_id)] = {
            name: (s.as_dict() if (s := summarize(values)) else None) for name, values in intervals.items()
        }
        for name, values in intervals.items():
            pooled[name].extend(values)
    return {
        "lectures": per_lecture,
        "pooled": {name: (s.as_dict() if (s := summarize(v)) else None) for name, v in pooled.items()},
    }


def print_table(pooled: dict[str, dict[str, float | int] | None]) -> None:
    print(f"{'interval':28} {'n':>7} {'p50 ms':>9} {'p95 ms':>9} {'max ms':>9}")
    for name in LATENCY_INTERVALS:
        s = pooled.get(name)
        if s is None:
            print(f"{name:28} {'—':>7}")
        else:
            print(f"{name:28} {s['n']:>7} {s['p50_ms']:>9} {s['p95_ms']:>9} {s['max_ms']:>9}")


def main() -> int:
    utf8_stdio()
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--lecture-id", type=uuid.UUID, action="append")
    group.add_argument("--last", type=int, help="the N most recently started lectures")
    parser.add_argument("--json", type=Path, help="also write the full report here")
    args = parser.parse_args()

    marks = asyncio.run(load(args.lecture_id or [], args.last))
    if not any(marks.values()):
        print("no latency marks found for the selected lectures", file=sys.stderr)
        return 1
    result = report(marks)
    pooled = result["pooled"]
    assert isinstance(pooled, dict)
    print(f"{len(marks)} lecture(s)")
    print_table(pooled)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"written: {args.json}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
