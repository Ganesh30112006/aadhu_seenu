"""Audio chunk frame parsing (contracts/PROTOCOL.md §1.1), mirroring firmware lc_frame.c."""

from __future__ import annotations

import struct
from dataclasses import dataclass
from enum import IntEnum

HEADER = struct.Struct("<2sBBIQQH")  # magic, version, codec, seq, sample_offset, capture_unix_ms, payload_len
HEADER_LEN = HEADER.size  # 26
MAGIC = b"LC"
VERSION = 1
SAMPLE_RATE = 16_000
SAMPLES_PER_CHUNK = 8_000
CHUNK_MS = 500
PCM_CHUNK_BYTES = SAMPLES_PER_CHUNK * 2
ADPCM_CHUNK_BYTES = 4 + SAMPLES_PER_CHUNK // 2


class Codec(IntEnum):
    PCM16 = 0
    ADPCM = 1


class FrameError(ValueError):
    """The frame violates the protocol."""


@dataclass(frozen=True, slots=True)
class Frame:
    codec: Codec
    seq: int
    sample_offset: int
    capture_unix_ms: int
    payload: bytes

    @property
    def samples(self) -> int:
        if self.codec is Codec.PCM16:
            return len(self.payload) // 2
        # ADPCM: 1 predictor sample + one 4-bit code per sample, minus a padding nibble.
        return 1 + (len(self.payload) - 4) * 2 - (self.payload[3] & 1)

    @property
    def duration_ms(self) -> int:
        return self.samples * 1000 // SAMPLE_RATE


def max_payload(codec: Codec) -> int:
    return PCM_CHUNK_BYTES if codec is Codec.PCM16 else ADPCM_CHUNK_BYTES


def parse_frame(data: bytes) -> Frame:
    if len(data) < HEADER_LEN:
        raise FrameError("frame shorter than header")
    magic, version, codec_raw, seq, sample_offset, capture_ms, payload_len = HEADER.unpack_from(data)
    if magic != MAGIC:
        raise FrameError("bad magic")
    if version != VERSION:
        raise FrameError(f"unsupported version {version}")
    try:
        codec = Codec(codec_raw)
    except ValueError as exc:
        raise FrameError(f"unknown codec {codec_raw}") from exc
    if payload_len + HEADER_LEN != len(data):
        raise FrameError("payload_len does not match frame length")
    if payload_len == 0 or payload_len > max_payload(codec):
        raise FrameError("impossible payload size")
    if codec is Codec.PCM16 and payload_len % 2:
        raise FrameError("odd PCM payload")
    if codec is Codec.ADPCM and (payload_len < 4 or data[HEADER_LEN + 3] & 0xFE):
        raise FrameError("bad ADPCM block header")
    if sample_offset != seq * SAMPLES_PER_CHUNK:
        raise FrameError("sample_offset must equal seq * 8000")
    return Frame(codec, seq, sample_offset, capture_ms, bytes(data[HEADER_LEN:]))


def build_frame(codec: Codec, seq: int, capture_unix_ms: int, payload: bytes) -> bytes:
    """Encodes a frame (used by the device simulator and tests)."""
    header = HEADER.pack(
        MAGIC, VERSION, int(codec), seq, seq * SAMPLES_PER_CHUNK, capture_unix_ms, len(payload)
    )
    return header + payload
