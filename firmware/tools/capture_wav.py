"""Captures the WAV emitted by firmware/mic_test over the USB serial console.

Usage:  pip install pyserial
        python firmware/tools/capture_wav.py --port COM5 --out mic.wav
Prints LEVEL/DIAG lines as they arrive and verifies the CRC32 before writing the file.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import sys
from pathlib import Path

import serial  # pyserial


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", required=True, help="Serial port, e.g. COM5 or /dev/ttyACM0")
    parser.add_argument("--out", type=Path, default=Path("mic.wav"))
    parser.add_argument("--baud", type=int, default=115200, help="Ignored by USB-Serial-JTAG")
    args = parser.parse_args()

    with serial.Serial(args.port, args.baud, timeout=30) as port:
        expected_len = expected_crc = None
        chunks: list[bytes] = []
        while True:
            raw = port.readline()
            if not raw:
                print("timeout waiting for the device", file=sys.stderr)
                return 1
            line = raw.decode("ascii", errors="replace").strip()
            if line.startswith("WAV BEGIN"):
                _, _, length, crc = line.split()
                expected_len, expected_crc = int(length), int(crc, 16)
                chunks = []
            elif line == "WAV END":
                data = b"".join(chunks)
                if len(data) != expected_len or binascii.crc32(data) != expected_crc:
                    print(f"corrupt transfer: {len(data)} bytes (expected {expected_len})", file=sys.stderr)
                    return 2
                args.out.write_bytes(data)
                print(f"saved {args.out} ({len(data)} bytes)")
                return 0
            elif expected_len is not None:
                chunks.append(base64.b64decode(line))
            else:
                print(line)


if __name__ == "__main__":
    raise SystemExit(main())
