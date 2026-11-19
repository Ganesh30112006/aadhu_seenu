"""Per-segment language (D6: decided after commit, from the script of the committed text) and
Latin transliteration of Telugu/Hindi for the frontend's optional romanised line."""

from __future__ import annotations

from typing import Literal

Language = Literal["en", "te", "hi"]

TELUGU = (0x0C00, 0x0C7F)
DEVANAGARI = (0x0900, 0x097F)


def _word_script(word: str) -> str | None:
    for ch in word:
        code = ord(ch)
        if TELUGU[0] <= code <= TELUGU[1]:
            return "te"
        if DEVANAGARI[0] <= code <= DEVANAGARI[1]:
            return "hi"
    return "en" if any(ch.isascii() and ch.isalpha() for ch in word) else None


def script_language(text: str, fallback: Language = "en") -> Language:
    """Language of a committed segment from the script of its words.

    Code-mixed lectures put English technical terms inside Telugu/Hindi sentences
    ("Priority scheduling में starvation की problem आती है।"), so a line counts as Telugu/Hindi as
    soon as at least a quarter of its words are in that script; otherwise English.
    """
    counts = {"te": 0, "hi": 0, "en": 0}
    for word in text.split():
        script = _word_script(word)
        if script is not None:
            counts[script] += 1
    total = sum(counts.values())
    if total == 0:
        return fallback
    indic: Language = "te" if counts["te"] >= counts["hi"] else "hi"
    return indic if counts[indic] * 4 >= total and counts[indic] > 0 else "en"


def transliterate(text: str, language: Language) -> str | None:
    """ISO 15919 romanisation for te/hi; None for English or if the library is unavailable."""
    if language == "en":
        return None
    try:
        from indic_transliteration import sanscript
    except ImportError:
        return None
    source = sanscript.TELUGU if language == "te" else sanscript.DEVANAGARI
    return str(sanscript.transliterate(text, source, sanscript.ISO))
