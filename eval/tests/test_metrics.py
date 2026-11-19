"""Tests for eval/metrics.py. Run from the repository root with the backend venv:

backend/.venv/Scripts/python -m pytest eval      (Linux: backend/.venv/bin/python)
"""

from __future__ import annotations

import random
import unicodedata

import pytest

from metrics import (
    LATENCY_INTERVALS,
    Mark,
    backlog_delays,
    completeness,
    error_rates,
    first_covering,
    first_covering_index,
    latency_intervals,
    normalize,
    percentile,
    summarize,
)

# --- normalisation ----------------------------------------------------------------------------


def test_normalize_english_punctuation_case_and_spaces() -> None:
    assert normalize("  Hello,   World! It's  O.K. ") == "hello world it s o k"


def test_normalize_keeps_indic_combining_marks() -> None:
    hindi = "प्रक्रिया"  # pa + virama + ra + ... : the virama and matras must survive
    assert normalize(hindi) == hindi
    telugu = "ప్రక్రియ"
    assert normalize(telugu) == telugu


def test_normalize_removes_danda_and_zero_width_joiners() -> None:
    assert normalize("यह प्रक्रिया है। अगला॥") == "यह प्रक्रिया है अगला"
    assert normalize("क्‍ष") == normalize("क्ष")  # ZWJ changes only the rendering


def test_normalize_nfc_and_indic_digits() -> None:
    decomposed = unicodedata.normalize("NFD", "क़ानून")  # nukta form
    assert normalize(decomposed) == normalize("क़ानून")
    assert normalize("अध्याय ३ और ౪") == "अध्याय 3 और 4"


def test_normalize_fold_nasals_is_opt_in() -> None:
    with_chandrabindu, with_anusvara = "हँसना", "हंसना"
    assert normalize(with_chandrabindu) != normalize(with_anusvara)
    assert normalize(with_chandrabindu, fold_nasals=True) == normalize(with_anusvara, fold_nasals=True)


# --- WER / CER --------------------------------------------------------------------------------


def test_error_rates_counts_and_corpus_weighting() -> None:
    rates = error_rates(["the cat sat", "on the mat today"], ["the cat sit", "on mat today now"])
    # utt 1: 1 substitution; utt 2: 1 deletion + 1 insertion → 3 errors / 7 reference words
    assert (rates.substitutions, rates.deletions, rates.insertions) == (1, 1, 1)
    assert rates.ref_words == 7 and rates.hits == 5
    assert rates.wer == pytest.approx(3 / 7)


def test_error_rates_ignores_formatting_differences() -> None:
    rates = error_rates(["यह प्रक्रिया है।"], ["यह  प्रक्रिया है"])
    assert rates.wer == 0 and rates.cer == 0


def test_error_rates_skips_empty_references_and_checks_lengths() -> None:
    rates = error_rates(["...", "a b"], ["noise", "a b"])
    assert rates.skipped == 1 and rates.wer == 0
    with pytest.raises(ValueError, match="hypotheses"):
        error_rates(["a"], [])
    with pytest.raises(ValueError, match="no non-empty"):
        error_rates(["।"], ["x"])


# --- percentiles ------------------------------------------------------------------------------


def test_percentile_matches_linear_interpolation() -> None:
    values = [10.0, 20.0, 30.0, 40.0]
    assert percentile(values, 0) == 10 and percentile(values, 100) == 40
    assert percentile(values, 50) == 25
    assert percentile(values, 95) == pytest.approx(38.5)
    assert percentile([7.0], 95) == 7
    with pytest.raises(ValueError):
        percentile([], 50)
    with pytest.raises(ValueError):
        percentile([1.0], 101)


def test_summarize() -> None:
    assert summarize([]) is None
    s = summarize([float(v) for v in range(1, 101)])
    assert s is not None and s.n == 100 and s.p50 == pytest.approx(50.5) and s.max == 100


# --- latency pairing --------------------------------------------------------------------------


def _brute_force(starts: dict[int, int], later: list[tuple[int, int]]) -> dict[int, int]:
    out: dict[int, int] = {}
    for seq, t in starts.items():
        candidates = [tb for sb, tb in later if sb >= seq and tb >= t]
        if candidates:
            out[seq] = min(candidates)
    return out


@pytest.mark.parametrize("seed", range(20))
def test_first_covering_matches_brute_force(seed: int) -> None:
    rng = random.Random(seed)
    starts = {s: rng.randint(0, 1000) for s in rng.sample(range(200), rng.randint(0, 60))}
    later = [(rng.randint(0, 220), rng.randint(0, 1200)) for _ in range(rng.randint(0, 60))]
    assert first_covering(starts, later) == _brute_force(starts, later)
    for seq, k in first_covering_index(starts, later).items():
        assert later[k][0] >= seq and later[k][1] >= starts[seq]


def test_latency_intervals_follow_a_chunk_through_every_stage() -> None:
    marks = [
        # chunks 0 and 1 (0.5 s each) captured, received
        Mark("capture", 1_000, seq=0),
        Mark("capture", 1_500, seq=1),
        Mark("gateway_receive", 1_120, seq=0),
        Mark("gateway_receive", 1_610, seq=1),
        # one ASR window ending at chunk 1
        Mark("asr_start", 2_000, seq=1),
        Mark("asr_end", 2_400, seq=1),
        # a partial and a final published in the same millisecond, both covering chunk 1
        Mark("published", 2_450, seq=1, event_seq=7),
        Mark("published", 2_450, seq=1, event_seq=8),
        # two browsers render event 7; event 8 is rendered later
        Mark("rendered", 2_500, event_seq=7),
        Mark("rendered", 2_530, event_seq=7),
        Mark("rendered", 2_900, event_seq=8),
    ]
    got = latency_intervals(marks)
    assert set(got) == set(LATENCY_INTERVALS)
    assert sorted(got["capture→gateway_receive"]) == [110, 120]
    assert sorted(got["gateway_receive→asr_start"]) == [390, 880]
    assert got["asr_start→asr_end"] == [400, 400]  # both chunks are in the one window
    assert got["asr_end→published"] == [50, 50]
    assert sorted(got["published→rendered"]) == [50, 80, 450]
    assert sorted(got["capture→published"]) == [950, 1450]
    # Both chunks first appear in the earliest-indexed publish at 2450 (event 7), rendered at 2500.
    assert sorted(got["capture→rendered"]) == [1000, 1500]


def test_latency_intervals_empty() -> None:
    assert all(v == [] for v in latency_intervals([]).values())


# --- recovery ---------------------------------------------------------------------------------


def test_completeness_reports_missing_and_duplicates() -> None:
    ok = completeness([0, 1, 2, 3], last_seq=3)
    assert ok.complete and ok.expected == 4 and ok.stored == 4
    bad = completeness([0, 2, 2, 3, 5], last_seq=5)
    assert not bad.complete
    assert bad.missing == [1, 4] and bad.duplicated == [2]


def test_backlog_delays() -> None:
    capture = {5: 100, 6: 600, 7: 1100}
    receive = {5: 30_100, 6: 30_200}
    assert backlog_delays(capture, receive, [5, 6, 7]) == [30_000, 29_600]


def test_capture_to_rendered_uses_the_first_rendered_window() -> None:
    """If the first publish covering a chunk never reached a browser, the next rendered one counts."""
    marks = [
        Mark("capture", 1_000, seq=0),
        Mark("published", 2_000, seq=0, event_seq=1),  # e.g. a partial no browser saw
        Mark("published", 3_000, seq=2, event_seq=2),
        Mark("rendered", 3_100, event_seq=2),
    ]
    got = latency_intervals(marks)
    assert got["capture→published"] == [1_000]
    assert got["capture→rendered"] == [2_100]
