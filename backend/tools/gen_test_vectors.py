"""Generates contracts/test_vectors/adpcm_* used to cross-check the C and Python codecs.

Run from the repository root:  backend/.venv/Scripts/python backend/tools/gen_test_vectors.py
The C host tests (firmware/lc_core/test_host) must produce byte-identical ADPCM.
"""

from __future__ import annotations

import math
from array import array
from pathlib import Path

from app.audio import adpcm

SAMPLES = 8000  # one 500 ms chunk


def deterministic_signal() -> array[int]:
    """Speech-like test signal: harmonics with a syllable envelope plus LCG noise (no RNG state)."""
    state = 12345
    out = array("h")
    for i in range(SAMPLES):
        state = (1103515245 * state + 12345) & 0x7FFFFFFF
        noise = (state >> 16) % 801 - 400
        envelope = 0.5 + 0.5 * math.sin(2 * math.pi * 4.0 * i / 16000)
        voice = sum(
            amp * math.sin(2 * math.pi * freq * i / 16000)
            for freq, amp in ((180, 6000), (360, 3000), (720, 1500), (2400, 600))
        )
        out.append(max(-32768, min(32767, int(envelope * voice) + noise)))
    return out


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    target = root / "contracts" / "test_vectors"
    target.mkdir(parents=True, exist_ok=True)
    pcm = deterministic_signal()
    (target / "adpcm_input.pcm").write_bytes(pcm.tobytes())
    (target / "adpcm_expected.bin").write_bytes(adpcm.encode(pcm))
    print(f"wrote {target} ({len(pcm)} samples)")


if __name__ == "__main__":
    main()
