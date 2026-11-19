"""Report builders of the eval CLIs, on in-memory rows (no database)."""

from __future__ import annotations

import uuid

from app.db.models import GapState, Lecture, LectureGap, LectureStatus
from latency_report import report
from metrics import Mark
from recovery_report import Loaded, build_report


def _lecture(last_seq: int | None) -> Lecture:
    return Lecture(
        id=uuid.uuid4(), title="t", status=LectureStatus.completed, last_seq=last_seq, stop_received=True
    )


def test_recovery_report_passes_when_complete_and_gaps_filled() -> None:
    lecture = _lecture(last_seq=5)
    # seqs 2..3 were in an outage: captured on time, received 30 s later
    chunks = [(s, 1_000 + s * 500, 1_000 + s * 500 + (30_000 if s in (2, 3) else 100)) for s in range(6)]
    gap = LectureGap(lecture_id=lecture.id, gap_id="g1", start_seq=2, end_seq=3, state=GapState.filled)
    out = build_report(Loaded(lecture, chunks, [gap]))
    assert out["passed"] is True
    gaps = out["gaps"]
    assert isinstance(gaps, list) and gaps[0]["audio_s"] == 1.0
    assert gaps[0]["capture_to_receive"]["p50_ms"] == 30_000
    live = out["live_capture_to_receive"]
    assert isinstance(live, dict) and live["n"] == 4 and live["max_ms"] == 100


def test_recovery_report_fails_on_missing_chunk_or_open_gap() -> None:
    lecture = _lecture(last_seq=3)
    chunks = [(s, 0, 0) for s in (0, 1, 3)]
    gap = LectureGap(lecture_id=lecture.id, gap_id="g1", start_seq=2, end_seq=None, state=GapState.open)
    out = build_report(Loaded(lecture, chunks, [gap]))
    assert out["passed"] is False
    chunk_info = out["chunks"]
    assert isinstance(chunk_info, dict) and chunk_info["missing"] == [2]


def test_latency_report_pools_lectures() -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    marks = {
        a: [Mark("capture", 0, seq=0), Mark("gateway_receive", 100, seq=0)],
        b: [Mark("capture", 0, seq=0), Mark("gateway_receive", 300, seq=0)],
    }
    out = report(marks)
    pooled = out["pooled"]
    assert isinstance(pooled, dict)
    assert pooled["capture→gateway_receive"]["n"] == 2
    assert pooled["capture→gateway_receive"]["p50_ms"] == 200
    assert pooled["capture→rendered"] is None
