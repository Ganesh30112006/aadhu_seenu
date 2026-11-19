"""Evaluation metrics: pure functions, no database or model access (tested in eval/tests).

- Text normalisation for WER/CER that is safe for Indic scripts (keeps vowel signs and viramas).
- Corpus WER/CER via jiwer.
- Percentiles (linear interpolation, like numpy's default).
- Latency pairing for the stages in contracts/PROTOCOL.md §3.
- Recovery completeness for one lecture's chunk sequence numbers.
"""

from __future__ import annotations

import io
import math
import re
import sys
import unicodedata
from bisect import bisect_left
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

import jiwer

# ---------------------------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------------------------

_INVISIBLE = dict.fromkeys(map(ord, "​‌‍⁠﻿"))  # ZWSP, ZWNJ, ZWJ, WJ, BOM
_CHANDRABINDU = {
    0x0901: 0x0902,  # Devanagari chandrabindu → anusvara
    0x0C01: 0x0C02,  # Telugu chandrabindu → anusvara
}
_SPACES = re.compile(r"\s+")


def normalize(text: str, *, fold_nasals: bool = False) -> str:
    """Normalises a transcript for scoring.

    - Unicode NFC, so precomposed and decomposed forms compare equal.
    - Zero-width joiners and spaces are removed. They change only rendering, not the word.
    - Punctuation (Unicode category P*) becomes a space. This includes the danda । and double
      danda ॥. Combining marks (Mn/Mc: matras, virama, nukta) are kept, because removing them
      would change Indic words.
    - Every Unicode decimal digit (Devanagari ०-९, Telugu ౦-౯, ...) becomes its ASCII digit.
    - Case-folded, with whitespace collapsed.
    - `fold_nasals=True` maps chandrabindu to anusvara. These are often interchanged in
      transcription and are not a recognition error worth counting.
    """
    text = unicodedata.normalize("NFC", text).translate(_INVISIBLE)
    if fold_nasals:
        text = text.translate(_CHANDRABINDU)
    out: list[str] = []
    for ch in text:
        category = unicodedata.category(ch)
        if category.startswith("P"):
            out.append(" ")
        elif category == "Nd":
            out.append(str(unicodedata.decimal(ch)))
        else:
            out.append(ch)
    return _SPACES.sub(" ", "".join(out).casefold()).strip()


# ---------------------------------------------------------------------------------------------
# WER / CER
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ErrorRates:
    wer: float
    cer: float
    ref_words: int
    substitutions: int
    deletions: int
    insertions: int
    hits: int
    skipped: int  # pairs whose reference was empty after normalisation

    def as_dict(self) -> dict[str, float | int]:
        return {
            "wer": round(self.wer, 4),
            "cer": round(self.cer, 4),
            "ref_words": self.ref_words,
            "substitutions": self.substitutions,
            "deletions": self.deletions,
            "insertions": self.insertions,
            "hits": self.hits,
            "skipped": self.skipped,
        }


def error_rates(
    references: Sequence[str], hypotheses: Sequence[str], *, fold_nasals: bool = False
) -> ErrorRates:
    """Corpus-level WER and CER: total errors over total reference words or characters.

    This is not the mean of per-utterance rates, so long recordings weigh more. Pairs whose
    reference normalises to nothing are skipped and counted in `skipped`.
    """
    if len(references) != len(hypotheses):
        raise ValueError(f"{len(references)} references but {len(hypotheses)} hypotheses")
    refs: list[str] = []
    hyps: list[str] = []
    skipped = 0
    for ref, hyp in zip(references, hypotheses, strict=True):
        r = normalize(ref, fold_nasals=fold_nasals)
        if not r:
            skipped += 1
            continue
        refs.append(r)
        hyps.append(normalize(hyp, fold_nasals=fold_nasals))
    if not refs:
        raise ValueError("no non-empty references to score")
    words = jiwer.process_words(refs, hyps)
    chars = jiwer.process_characters(refs, hyps)
    return ErrorRates(
        wer=float(words.wer),
        cer=float(chars.cer),
        ref_words=int(words.hits + words.substitutions + words.deletions),
        substitutions=int(words.substitutions),
        deletions=int(words.deletions),
        insertions=int(words.insertions),
        hits=int(words.hits),
        skipped=skipped,
    )


# ---------------------------------------------------------------------------------------------
# Percentiles and latency
# ---------------------------------------------------------------------------------------------


def percentile(values: Sequence[float], p: float) -> float:
    """The p-th percentile (0–100) with linear interpolation between closest ranks."""
    if not values:
        raise ValueError("percentile of an empty sequence")
    if not 0 <= p <= 100:
        raise ValueError("p must be within 0..100")
    ordered = sorted(values)
    rank = (len(ordered) - 1) * p / 100
    lo, hi = math.floor(rank), math.ceil(rank)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (rank - lo)


@dataclass(frozen=True)
class Summary:
    n: int
    p50: float
    p95: float
    max: float

    def as_dict(self) -> dict[str, float | int]:
        return {"n": self.n, "p50_ms": round(self.p50, 1), "p95_ms": round(self.p95, 1), "max_ms": self.max}


def summarize(values: Sequence[float]) -> Summary | None:
    if not values:
        return None
    return Summary(len(values), percentile(values, 50), percentile(values, 95), max(values))


@dataclass(frozen=True)
class Mark:
    """One `latency_marks` row."""

    stage: str
    ts_ms: int
    seq: int | None = None  # audio chunk seq
    event_seq: int | None = None  # live event seq


def _first_by_seq(marks: Iterable[Mark], stage: str) -> dict[int, int]:
    """seq → earliest timestamp of `stage` for that exact seq."""
    out: dict[int, int] = {}
    for m in marks:
        if m.stage == stage and m.seq is not None and (m.seq not in out or m.ts_ms < out[m.seq]):
            out[m.seq] = m.ts_ms
    return out


def first_covering_index(starts: Mapping[int, int], later: Sequence[tuple[int, int]]) -> dict[int, int]:
    """For each chunk `seq → t`, the index in `later` of the earliest `(seq_b, t_b)` with
    `seq_b >= seq` and `t_b >= t`. In other words: the first time a later stage handled a window
    that ended at or after this chunk. Chunks with no such event are left out.

    This uses an offline sweep over time with a Fenwick tree (suffix minimum over seq), so it is
    O((n + m) log m). A 2-hour lecture has about 14,400 chunks.
    """
    if not starts or not later:
        return {}
    seqs = sorted({s for s, _ in later})
    size = len(seqs)
    none = (math.inf, -1)
    # Fenwick over reversed rank, so a prefix minimum is a suffix minimum over seq.
    tree: list[tuple[float, int]] = [none] * (size + 1)

    def update(rank: int, value: tuple[float, int]) -> None:
        i = size - rank
        while i <= size:
            tree[i] = min(tree[i], value)
            i += i & -i

    def query(rank: int) -> tuple[float, int]:  # min over ranks >= rank
        i, best = size - rank, none
        while i > 0:
            best = min(best, tree[i])
            i -= i & -i
        return best

    order = sorted(range(len(later)), key=lambda k: later[k][1], reverse=True)
    queries = sorted(starts.items(), key=lambda q: q[1], reverse=True)
    out: dict[int, int] = {}
    j = 0
    for seq, t in queries:
        while j < len(order) and later[order[j]][1] >= t:
            k = order[j]
            update(bisect_left(seqs, later[k][0]), (float(later[k][1]), k))
            j += 1
        rank = bisect_left(seqs, seq)
        if rank < size:
            best = query(rank)
            if best[1] >= 0:
                out[seq] = best[1]
    return out


def first_covering(starts: Mapping[int, int], later: Sequence[tuple[int, int]]) -> dict[int, int]:
    """Like first_covering_index, but returns `seq → t_b`."""
    return {seq: later[k][1] for seq, k in first_covering_index(starts, later).items()}


LATENCY_INTERVALS = (
    "capture→gateway_receive",
    "gateway_receive→asr_start",
    "asr_start→asr_end",
    "asr_end→published",
    "published→rendered",
    "capture→published",
    "capture→rendered",
)


def latency_intervals(marks: Sequence[Mark]) -> dict[str, list[float]]:
    """Per-chunk durations (ms) for each interval in LATENCY_INTERVALS.

    - Per-chunk stages (`capture`, `gateway_receive`) pair on the exact seq.
    - Window stages (`asr_start`, `asr_end`, `published`) are marked with the window's last seq.
      A chunk counts from the first window at or after it, in both seq and time.
    - `rendered` pairs with `published` by `event_seq`. With several browsers, each render is a
      sample for published→rendered. For capture→rendered, each event counts from its earliest
      render, and a chunk counts from the first rendered window covering it. The client acks
      partials too, so this is when the chunk's words first appeared.

    `capture` comes from the device clock (SNTP) and `rendered` from the browser clock. Intervals
    that cross clocks include their offset; the browser reports its offset through ping/pong.
    """
    capture = _first_by_seq(marks, "capture")
    receive = _first_by_seq(marks, "gateway_receive")

    def window(stage: str) -> list[tuple[int, int]]:
        return [(m.seq, m.ts_ms) for m in marks if m.stage == stage and m.seq is not None]

    asr_start = first_covering(receive, window("asr_start"))
    asr_end = first_covering(asr_start, window("asr_end"))
    published_marks = [m for m in marks if m.stage == "published" and m.seq is not None]
    published_windows = [(m.seq, m.ts_ms) for m in published_marks if m.seq is not None]
    published = first_covering(asr_end, published_windows)

    renders: dict[int, list[int]] = {}
    for m in marks:
        if m.stage == "rendered" and m.event_seq is not None:
            renders.setdefault(m.event_seq, []).append(m.ts_ms)

    out: dict[str, list[float]] = {name: [] for name in LATENCY_INTERVALS}
    for seq, t in receive.items():
        if seq in capture:
            out["capture→gateway_receive"].append(t - capture[seq])
        if seq in asr_start:
            out["gateway_receive→asr_start"].append(asr_start[seq] - t)
    for seq, t in asr_start.items():
        if seq in asr_end:
            out["asr_start→asr_end"].append(asr_end[seq] - t)
    for seq, t in asr_end.items():
        if seq in published:
            out["asr_end→published"].append(published[seq] - t)
    for m in published_marks:
        if m.event_seq is not None:
            out["published→rendered"].extend(r - m.ts_ms for r in renders.get(m.event_seq, []))
    # End to end: capture → the first publish covering the chunk, and capture → the first render
    # of any event covering it (the moment its words were first on a screen).
    for seq, t_pub in first_covering(capture, published_windows).items():
        out["capture→published"].append(t_pub - capture[seq])
    rendered_windows = [
        (m.seq, min(renders[m.event_seq]))
        for m in published_marks
        if m.seq is not None and m.event_seq is not None and m.event_seq in renders
    ]
    for seq, t_render in first_covering(capture, rendered_windows).items():
        out["capture→rendered"].append(t_render - capture[seq])
    return out


# ---------------------------------------------------------------------------------------------
# Network recovery
# ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Completeness:
    expected: int
    stored: int
    missing: list[int]
    duplicated: list[int]

    @property
    def complete(self) -> bool:
        return not self.missing and not self.duplicated

    def as_dict(self) -> dict[str, object]:
        return {
            "expected": self.expected,
            "stored": self.stored,
            "missing": self.missing,
            "duplicated": self.duplicated,
            "complete": self.complete,
        }


def completeness(stored_seqs: Iterable[int], last_seq: int) -> Completeness:
    """Checks that seqs 0..last_seq were each stored exactly once."""
    counts = Counter(stored_seqs)
    expected = last_seq + 1
    return Completeness(
        expected=expected,
        stored=sum(counts.values()),
        missing=[s for s in range(expected) if counts[s] == 0],
        duplicated=sorted(s for s, c in counts.items() if c > 1),
    )


def backlog_delays(
    capture: Mapping[int, int], receive: Mapping[int, int], seqs: Iterable[int]
) -> list[float]:
    """capture→gateway_receive (ms) for the given seqs, e.g. the chunks inside an outage gap."""
    return [float(receive[s] - capture[s]) for s in seqs if s in capture and s in receive]


# ---------------------------------------------------------------------------------------------
# CLI helper
# ---------------------------------------------------------------------------------------------


def utf8_stdio() -> None:
    """Reports print Indic text and arrows; Windows consoles default to a legacy code page."""
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
