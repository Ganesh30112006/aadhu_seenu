"""Which seqs of a session are stored: cumulative ACK, selective ranges and holes (pure logic)."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

MAX_RANGES = 16


@dataclass
class SeqTracker:
    stored: set[int] = field(default_factory=set)
    cumulative: int = -1  # every seq <= cumulative is stored
    max_seq: int = -1

    @classmethod
    def from_seqs(cls, seqs: Iterable[int]) -> SeqTracker:
        tracker = cls()
        for seq in sorted(seqs):
            tracker.add(seq)
        return tracker

    def add(self, seq: int) -> tuple[int, int] | None:
        """Records a stored seq. Returns a newly opened hole (lo, hi) if seq skipped ahead."""
        if seq in self.stored:
            return None
        hole = (self.max_seq + 1, seq - 1) if seq > self.max_seq + 1 else None
        self.stored.add(seq)
        self.max_seq = max(self.max_seq, seq)
        while self.cumulative + 1 in self.stored:
            self.cumulative += 1
        return hole

    def has(self, seq: int) -> bool:
        return seq in self.stored

    def range_complete(self, lo: int, hi: int) -> bool:
        if hi <= self.cumulative:
            return True
        return all(s in self.stored for s in range(lo, hi + 1))

    def ranges(self) -> list[list[int]]:
        """Stored islands above the cumulative point, ascending, at most MAX_RANGES."""
        out: list[list[int]] = []
        seq = self.cumulative + 2
        while seq <= self.max_seq and len(out) < MAX_RANGES:
            if seq in self.stored:
                start = seq
                while seq + 1 in self.stored:
                    seq += 1
                out.append([start, seq])
            seq += 1
        return out

    def holes(self, upto: int | None = None) -> list[tuple[int, int]]:
        """Missing (lo, hi) ranges between 0 and `upto` (default max_seq)."""
        limit = self.max_seq if upto is None else upto
        out: list[tuple[int, int]] = []
        seq = self.cumulative + 1
        while seq <= limit:
            if seq not in self.stored:
                start = seq
                while seq + 1 <= limit and seq + 1 not in self.stored:
                    seq += 1
                out.append((start, seq))
            seq += 1
        return out
