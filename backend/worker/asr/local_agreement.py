"""Streaming commit policy for re-decoded windows ("local agreement", brief §4.2).

Every ~1.5 s the ASR worker re-decodes all uncommitted audio. Words that come out identical in
two consecutive runs are committed; the rest stay a partial. Committed words are grouped into
segments that close at sentence punctuation, a pause, or a maximum length. The audio window is
trimmed to the end of the last committed word, so each word is finalised exactly once.

Segment identity: the visible partial has an id; the first segment that closes takes that id
(so the UI replaces the partial in place), later ones get fresh ids. Pure logic, no Whisper here.
"""

from __future__ import annotations

import unicodedata
import uuid
from dataclasses import dataclass, field

SENTENCE_END = (".", "?", "!", "।", "॥")


@dataclass(frozen=True, slots=True)
class Word:
    text: str  # as produced by Whisper, usually with a leading space
    start: float  # seconds from lecture start
    end: float
    probability: float


@dataclass(frozen=True, slots=True)
class Segment:
    segment_id: str
    start_ms: int
    end_ms: int
    text: str
    confidence: float | None


@dataclass(slots=True)
class Update:
    finals: list[Segment] = field(default_factory=list)
    partial: Segment | None = None
    committed_until: float = 0.0


def normalize(text: str) -> str:
    """Case- and punctuation-insensitive form (keeps Indic vowel signs, unlike \\w)."""
    return "".join(
        c for c in text.lower() if not unicodedata.category(c).startswith(("P", "Z")) and not c.isspace()
    )


def join_words(words: list[Word]) -> str:
    return "".join(w.text for w in words).strip()


def _segment(segment_id: str, words: list[Word]) -> Segment:
    return Segment(
        segment_id=segment_id,
        start_ms=round(words[0].start * 1000),
        end_ms=round(words[-1].end * 1000),
        text=join_words(words),
        confidence=round(sum(w.probability for w in words) / len(words), 3),
    )


class LiveCommitter:
    def __init__(
        self,
        id_namespace: uuid.UUID,
        committed_until: float = 0.0,
        *,
        pause_s: float = 0.6,
        max_segment_s: float = 12.0,
        max_window_s: float = 25.0,
    ) -> None:
        self.namespace = id_namespace
        self.committed_until = committed_until
        self.pause_s = pause_s
        self.max_segment_s = max_segment_s
        self.max_window_s = max_window_s
        self.previous: list[Word] = []  # last hypothesis beyond the committed point
        self.pending: list[Word] = []  # committed words not yet closed into a segment
        self.open_id = self._new_id()

    def _new_id(self) -> str:
        # Deterministic per lecture + position: a restarted worker regenerates the same ids.
        return str(uuid.uuid5(self.namespace, f"{self.committed_until:.3f}:{len(self.pending)}"))

    def update(self, hypothesis: list[Word], window_end: float) -> Update:
        words = [w for w in hypothesis if w.end > self.committed_until + 1e-3 and normalize(w.text)]
        agreed = 0
        while (
            agreed < len(words)
            and agreed < len(self.previous)
            and normalize(words[agreed].text) == normalize(self.previous[agreed].text)
        ):
            agreed += 1
        commit = words[:agreed]
        # Safety valve: never let the window grow without bound (e.g. unstable noisy audio).
        if not commit and window_end - self.committed_until > self.max_window_s:
            commit = [w for w in words if w.end <= window_end - 5.0] or words[:1]
        self.previous = words[len(commit) :]
        if commit:
            self.pending.extend(commit)
            self.committed_until = commit[-1].end
        elif not words and not self.pending:
            # Silence (VAD removed everything): move the window forward, keeping 1 s for a word
            # that may be starting right at the edge.
            self.committed_until = max(self.committed_until, window_end - 1.0)
        finals = self._close_segments(final=False)
        return Update(finals=finals, partial=self._partial(), committed_until=self.committed_until)

    def force(self, hypothesis: list[Word], until: float) -> Update:
        """Catch-up mode (worker behind live): commits words ending before `until` without
        waiting for agreement, because the audio is already complete there."""
        words = [w for w in hypothesis if w.end > self.committed_until + 1e-3 and normalize(w.text)]
        commit = [w for w in words if w.end <= until]
        self.previous = []
        if commit:
            self.pending.extend(commit)
        self.committed_until = max(self.committed_until, commit[-1].end if commit else until)
        finals = self._close_segments(final=False)
        return Update(finals=finals, partial=self._partial(), committed_until=self.committed_until)

    def flush(self, until: float | None = None) -> list[Segment]:
        """Commits everything (end of lecture, or audio stops at a gap)."""
        self.pending.extend(self.previous)
        self.previous = []
        if self.pending:
            self.committed_until = max(self.committed_until, self.pending[-1].end)
        if until is not None:
            self.committed_until = max(self.committed_until, until)
        return self._close_segments(final=True)

    def _partial(self) -> Segment | None:
        words = self.pending + self.previous
        if not words:
            return None
        return Segment(
            self.open_id, round(words[0].start * 1000), round(words[-1].end * 1000), join_words(words), None
        )

    def _close_segments(self, *, final: bool) -> list[Segment]:
        finals: list[Segment] = []
        start = 0
        for i, word in enumerate(self.pending):
            next_word = self.pending[i + 1] if i + 1 < len(self.pending) else None
            sentence_end = word.text.rstrip().endswith(SENTENCE_END)
            pause = next_word is not None and next_word.start - word.end >= self.pause_s
            too_long = word.end - self.pending[start].start >= self.max_segment_s
            if sentence_end or pause or too_long:
                finals.append(_segment(self.open_id, self.pending[start : i + 1]))
                start = i + 1
                self.open_id = str(uuid.uuid5(self.namespace, f"{word.end:.3f}:seg"))
        self.pending = self.pending[start:]
        if final and self.pending:
            finals.append(_segment(self.open_id, self.pending))
            self.open_id = str(uuid.uuid5(self.namespace, f"{self.pending[-1].end:.3f}:seg"))
            self.pending = []
        return finals
