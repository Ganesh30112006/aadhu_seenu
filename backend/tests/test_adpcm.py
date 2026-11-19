import math
import sys
from array import array
from pathlib import Path

import pytest

from app.audio import adpcm

VECTORS = Path(__file__).resolve().parents[2] / "contracts" / "test_vectors"


def _sine(n: int) -> array:
    return array(
        "h",
        (
            int(
                8000 * math.sin(2 * math.pi * 440 * i / 16000)
                + 3000 * math.sin(2 * math.pi * 1250 * i / 16000)
            )
            for i in range(n)
        ),
    )


def _snr_db(a: array, b: array) -> float:
    signal = sum(x * x for x in a)
    noise = sum((x - y) ** 2 for x, y in zip(a, b, strict=True))
    return 120.0 if noise == 0 else 10 * math.log10(signal / noise)


def test_full_chunk_roundtrip() -> None:
    pcm = _sine(8000)
    block = adpcm.encode(pcm)
    assert len(block) == 4004
    assert block[3] == 1  # 7999 codes → padding nibble
    decoded = adpcm.decode(block)
    assert len(decoded) == 8000
    assert decoded[0] == pcm[0]
    assert _snr_db(pcm, decoded) > 15


@pytest.mark.parametrize("n", [1, 2, 7, 8, 1999])
def test_short_blocks_decode_to_exact_length(n: int) -> None:
    pcm = _sine(n)
    assert len(adpcm.decode(adpcm.encode(pcm))) == n


def test_malformed_blocks_raise() -> None:
    with pytest.raises(adpcm.AdpcmError):
        adpcm.decode(b"\x00\x00")
    with pytest.raises(adpcm.AdpcmError):
        adpcm.decode(bytes([0, 0, 99, 0, 0]))
    with pytest.raises(adpcm.AdpcmError):
        adpcm.decode(bytes([0, 0, 0, 1]))


def test_shared_vectors_match() -> None:
    pcm = array("h")
    pcm.frombytes((VECTORS / "adpcm_input.pcm").read_bytes())
    if sys.byteorder != "little":
        pcm.byteswap()
    assert adpcm.encode(pcm) == (VECTORS / "adpcm_expected.bin").read_bytes()
