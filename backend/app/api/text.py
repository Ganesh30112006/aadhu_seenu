"""Text helpers shared by search and Ask."""

from __future__ import annotations

import re


def escape_like(value: str) -> str:
    """Escapes LIKE/ILIKE wildcards (use with escape='\\')."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def find_matches(text: str, query: str) -> list[tuple[int, int]]:
    """Case-insensitive occurrences of `query` (whitespace-flexible) as code-point offsets
    [start, end). Python str indices are code points, as the contract requires."""
    parts = [re.escape(p) for p in query.strip().split()]
    if not parts:
        return []
    pattern = re.compile(r"\s+".join(parts), re.IGNORECASE)
    return [(m.start(), m.end()) for m in pattern.finditer(text) if m.end() > m.start()]
