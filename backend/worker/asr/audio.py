"""Loads stored chunks as float32 audio (PCM16 or IMA-ADPCM, contracts §1.2)."""

from __future__ import annotations

import uuid
from array import array

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audio import adpcm
from app.audio.frames import SAMPLES_PER_CHUNK, Codec
from app.audio.storage import AudioStore
from app.db.models import AudioChunk


def decode_payload(codec: int, payload: bytes) -> np.ndarray:
    if codec == Codec.PCM16:
        pcm = np.frombuffer(payload, dtype="<i2")
    else:
        pcm = np.asarray(adpcm.decode(payload), dtype=np.int16)
    out = np.zeros(SAMPLES_PER_CHUNK, dtype=np.float32)  # a short final chunk is zero-padded
    n = min(len(pcm), SAMPLES_PER_CHUNK)
    out[:n] = pcm[:n].astype(np.float32) / 32768.0
    return out


async def load_chunks(
    db: AsyncSession, store: AudioStore, lecture_id: uuid.UUID, first_seq: int, last_seq: int
) -> np.ndarray | None:
    """Audio for seqs first..last (inclusive), or None if any chunk is missing."""
    rows = (
        await db.execute(
            select(AudioChunk.seq, AudioChunk.codec, AudioChunk.storage_key)
            .where(
                AudioChunk.lecture_id == lecture_id, AudioChunk.seq >= first_seq, AudioChunk.seq <= last_seq
            )
            .order_by(AudioChunk.seq)
        )
    ).all()
    if len(rows) != last_seq - first_seq + 1:
        return None
    parts = [decode_payload(codec, await store.get(key)) for _, codec, key in rows]
    return np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)


def pcm16(samples: np.ndarray) -> array[int]:
    """float32 → array('h') (tests and the simulator)."""
    clipped = np.clip(samples * 32768.0, -32768, 32767).astype(np.int16)
    return array("h", clipped.tobytes())
