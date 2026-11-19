"""Speech-to-text adapter. faster-whisper (CTranslate2) with Silero VAD and word timestamps.

The model size/device/compute type come from settings (D11: CPU int8 by default); pick them
from the WER-vs-speed benchmark in eval/, not by assumption.
"""

from __future__ import annotations

from typing import Any, Protocol

import numpy as np

from worker.asr.local_agreement import Word


class Transcriber(Protocol):
    name: str

    def transcribe(
        self, audio: np.ndarray, *, language: str | None, prompt: str | None, beam_size: int
    ) -> list[Word]:
        """Words with times relative to the start of `audio` (16 kHz float32 mono)."""
        ...


class FasterWhisperTranscriber:
    def __init__(self, model: str, device: str, compute_type: str) -> None:
        from faster_whisper import WhisperModel

        self.name = f"faster-whisper/{model}/{device}/{compute_type}"
        self._model: Any = WhisperModel(model, device=device, compute_type=compute_type)

    def transcribe(
        self, audio: np.ndarray, *, language: str | None, prompt: str | None, beam_size: int
    ) -> list[Word]:
        segments, _info = self._model.transcribe(
            audio,
            language=language,
            initial_prompt=prompt,
            beam_size=beam_size,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,
        )
        words: list[Word] = []
        for segment in segments:
            for w in segment.words or []:
                words.append(
                    Word(
                        text=w.word, start=float(w.start), end=float(w.end), probability=float(w.probability)
                    )
                )
        return words
