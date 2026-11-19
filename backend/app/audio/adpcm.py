"""IMA-ADPCM codec, bit-identical to firmware/lc_core/src/lc_adpcm.c (contracts/PROTOCOL.md §1.2).

Block layout: int16 predictor (first sample) | uint8 step index | uint8 flags (bit0 = last nibble
is padding) | 4-bit codes, low nibble first.
"""

from __future__ import annotations

import struct
from array import array

STEP_TABLE: tuple[int, ...] = (
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    16,
    17,
    19,
    21,
    23,
    25,
    28,
    31,
    34,
    37,
    41,
    45,
    50,
    55,
    60,
    66,
    73,
    80,
    88,
    97,
    107,
    118,
    130,
    143,
    157,
    173,
    190,
    209,
    230,
    253,
    279,
    307,
    337,
    371,
    408,
    449,
    494,
    544,
    598,
    658,
    724,
    796,
    876,
    963,
    1060,
    1166,
    1282,
    1411,
    1552,
    1707,
    1878,
    2066,
    2272,
    2499,
    2749,
    3024,
    3327,
    3660,
    4026,
    4428,
    4871,
    5358,
    5894,
    6484,
    7132,
    7845,
    8630,
    9493,
    10442,
    11487,
    12635,
    13899,
    15289,
    16818,
    18500,
    20350,
    22385,
    24623,
    27086,
    29794,
    32767,
)
INDEX_TABLE: tuple[int, ...] = (-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8)


class AdpcmError(ValueError):
    """Raised for a malformed ADPCM block."""


def _step_decode(predictor: int, index: int, code: int) -> tuple[int, int]:
    step = STEP_TABLE[index]
    diff = step >> 3
    if code & 4:
        diff += step
    if code & 2:
        diff += step >> 1
    if code & 1:
        diff += step >> 2
    predictor = predictor - diff if code & 8 else predictor + diff
    predictor = max(-32768, min(32767, predictor))
    index = max(0, min(88, index + INDEX_TABLE[code]))
    return predictor, index


def encoded_size(n_samples: int) -> int:
    return 0 if n_samples <= 0 else 4 + n_samples // 2


def _initial_index(pcm: array[int]) -> int:
    if len(pcm) < 2:
        return 0
    magnitude = abs(pcm[1] - pcm[0])
    index = 0
    while index < 88 and STEP_TABLE[index] < magnitude:
        index += 1
    return index


def encode(pcm: array[int]) -> bytes:
    """Encodes signed 16-bit samples (array('h')) into one ADPCM block."""
    n = len(pcm)
    if n == 0:
        return b""
    predictor = pcm[0]
    index = _initial_index(pcm)
    out = bytearray(encoded_size(n))
    struct.pack_into("<hBB", out, 0, predictor, index, (n - 1) % 2)
    for i in range(1, n):
        step = STEP_TABLE[index]
        diff = pcm[i] - predictor
        code = 0
        if diff < 0:
            code = 8
            diff = -diff
        if diff >= step:
            code |= 4
            diff -= step
        if diff >= (step >> 1):
            code |= 2
            diff -= step >> 1
        if diff >= (step >> 2):
            code |= 1
        predictor, index = _step_decode(predictor, index, code)
        nibble = i - 1
        out[4 + nibble // 2] |= code if nibble % 2 == 0 else code << 4
    return bytes(out)


def decode(block: bytes) -> array[int]:
    """Decodes one ADPCM block to signed 16-bit samples."""
    if len(block) < 4:
        raise AdpcmError("ADPCM block shorter than its 4-byte header")
    predictor, index, flags = struct.unpack_from("<hBB", block, 0)
    if index > 88 or flags & 0xFE:
        raise AdpcmError("invalid ADPCM header")
    padding = flags & 1
    if len(block) == 4 and padding:
        raise AdpcmError("padding flag set without code bytes")
    codes = (len(block) - 4) * 2 - padding
    out = array("h", [predictor])
    for c in range(codes):
        byte = block[4 + c // 2]
        code = byte & 0x0F if c % 2 == 0 else byte >> 4
        predictor, index = _step_decode(predictor, index, code)
        out.append(predictor)
    return out
