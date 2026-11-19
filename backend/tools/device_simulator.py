"""Device simulator: streams a WAV over the exact device protocol (contracts/PROTOCOL.md §1).

Implements the firmware's behaviour: 500 ms chunks with per-session seq, live-first sending,
selective ACKs, chunks un-ACKed for 2 s while offline "spilled" and resent as IMA-ADPCM,
`stop` only once everything is acknowledged, and injected network outages.

  python -m tools.device_simulator --url ws://127.0.0.1:8001/ws/device \
      --device-id <uuid> --token <token> --wav lecture.wav --outage 30:60 --speed 4

WAV must be 16 kHz mono 16-bit (convert with: ffmpeg -i in.mp3 -ac 1 -ar 16000 -sample_fmt s16 out.wav).
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import time
import uuid
import wave
from array import array
from dataclasses import dataclass, field
from pathlib import Path

import websockets

from app.audio import adpcm
from app.audio.frames import SAMPLES_PER_CHUNK, Codec, build_frame

MAX_IN_FLIGHT = 40
SPILL_AFTER_S = 2.0


@dataclass
class Summary:
    session_id: str
    lecture_id: str | None = None
    chunks: int = 0
    frames_sent: int = 0
    resent: int = 0
    adpcm_frames: int = 0
    connections: int = 0
    final_ack: int = -1
    stop_confirmed: bool = False
    acked: set[int] = field(default_factory=set)

    def as_dict(self) -> dict[str, object]:
        return {
            "session_id": self.session_id,
            "lecture_id": self.lecture_id,
            "chunks": self.chunks,
            "frames_sent": self.frames_sent,
            "resent": self.resent,
            "adpcm_frames": self.adpcm_frames,
            "connections": self.connections,
            "final_ack": self.final_ack,
            "all_acked": len(self.acked) == self.chunks,
            "stop_confirmed": self.stop_confirmed,
        }


def load_wav(path: Path) -> array[int]:
    with wave.open(str(path), "rb") as wav:
        if wav.getframerate() != 16000 or wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise SystemExit("WAV must be 16 kHz, mono, 16-bit (see --help for an ffmpeg command)")
        samples = array("h")
        samples.frombytes(wav.readframes(wav.getnframes()))
    return samples


def split_chunks(samples: array[int]) -> list[array[int]]:
    return [samples[i : i + SAMPLES_PER_CHUNK] for i in range(0, len(samples), SAMPLES_PER_CHUNK)]


class Simulator:
    def __init__(
        self,
        url: str,
        device_id: str,
        token: str,
        chunks: list[array[int]],
        *,
        lecture_id: str | None = None,
        outages: list[tuple[float, float]] | None = None,
        speed: float = 1.0,
    ) -> None:
        self.url = url
        self.device_id = device_id
        self.token = token
        self.chunks = chunks
        self.lecture_id = lecture_id
        self.outages = sorted(outages or [])
        self.speed = speed
        self.session_id = str(uuid.uuid4())
        self.summary = Summary(session_id=self.session_id, chunks=len(chunks))
        self.t0 = 0.0
        self.offline_since: dict[int, float] = {}  # seq → time it became "spilled" (ADPCM)
        self.cumulative = -1
        self.ranges: list[list[int]] = []
        self.ever_sent: set[int] = set()
        self.ack_messages = 0
        self.ack_event = asyncio.Event()

    # Audio time elapsed (seconds of lecture captured so far).
    def audio_now(self) -> float:
        return (time.monotonic() - self.t0) * self.speed

    def captured(self) -> int:
        return min(len(self.chunks), int(self.audio_now() / 0.5))

    def in_outage(self, audio_t: float) -> tuple[float, float] | None:
        return next(((s, d) for s, d in self.outages if s <= audio_t < s + d), None)

    def is_acked(self, seq: int) -> bool:
        return seq <= self.cumulative or any(lo <= seq <= hi for lo, hi in self.ranges)

    def frame(self, seq: int) -> bytes:
        pcm = self.chunks[seq]
        capture_ms = int(time.time() * 1000) - int((self.audio_now() - seq * 0.5) * 1000 / self.speed)
        if seq in self.offline_since:  # spilled to "flash" while offline → ADPCM like the firmware
            self.summary.adpcm_frames += 1
            return build_frame(Codec.ADPCM, seq, capture_ms, adpcm.encode(pcm))
        return build_frame(Codec.PCM16, seq, capture_ms, pcm.tobytes())

    async def run(self) -> Summary:
        self.t0 = time.monotonic()
        while True:
            outage = self.in_outage(self.audio_now())
            if outage is not None:
                await self._wait_offline(outage)
                continue
            finished = await self._connection()
            if finished:
                return self.summary

    async def _wait_offline(self, outage: tuple[float, float]) -> None:
        start, duration = outage
        while self.audio_now() < start + duration:
            now = self.audio_now()
            for seq in range(self.captured()):
                if not self.is_acked(seq) and now - seq * 0.5 >= SPILL_AFTER_S:
                    self.offline_since.setdefault(seq, now)
            await asyncio.sleep(0.05 / self.speed)

    async def _connection(self) -> bool:
        try:
            async with websockets.connect(self.url, max_size=2**20) as ws:
                self.summary.connections += 1
                await ws.send(
                    json.dumps(
                        {
                            "type": "hello",
                            "device_id": self.device_id,
                            "firmware_version": "sim-1.0",
                            "token": self.token,
                            "protocol_version": 1,
                        }
                    )
                )
                config = json.loads(await asyncio.wait_for(ws.recv(), 10))
                if config.get("type") != "config":
                    raise SystemExit(f"handshake failed: {config}")
                await ws.send(
                    json.dumps(
                        {
                            "type": "start",
                            "session_id": self.session_id,
                            "lecture_id": self.lecture_id,
                            "started_unix_ms": int(time.time() * 1000),
                            "sample_rate": 16000,
                        }
                    )
                )
                receiver = asyncio.create_task(self._receive(ws))
                try:
                    return await self._send_loop(ws, receiver)
                finally:
                    receiver.cancel()
        except (OSError, websockets.ConnectionClosed):
            await asyncio.sleep(0.5)
            return False

    async def _receive(self, ws: websockets.ClientConnection) -> None:
        async for raw in ws:
            if isinstance(raw, bytes):
                continue
            message = json.loads(raw)
            if message.get("type") == "ack" and message.get("session_id") == self.session_id:
                self.ack_messages += 1
                self.ack_event.set()
                self.cumulative = max(self.cumulative, message["seq"])
                self.ranges = message["ranges"]
                for seq in range(self.summary.chunks):
                    if self.is_acked(seq):
                        self.summary.acked.add(seq)
                self.summary.final_ack = self.cumulative
            elif message.get("type") == "lecture.started":
                self.summary.lecture_id = message["lecture_id"]

    async def _send_loop(self, ws: websockets.ClientConnection, receiver: asyncio.Task[None]) -> bool:
        sent_here: set[int] = set()
        stop_sent_at: float | None = None
        while not receiver.done():
            if self.in_outage(self.audio_now()) is not None:
                await ws.close()
                return False
            captured = self.captured()
            pending = [s for s in range(captured) if not self.is_acked(s) and s not in sent_here]
            in_flight = sum(1 for s in sent_here if not self.is_acked(s))
            if pending and in_flight < MAX_IN_FLIGHT:
                newest = captured - 1
                seq = newest if newest in pending else pending[0]  # live first, then oldest backlog
                await ws.send(self.frame(seq))
                if seq in self.ever_sent:
                    self.summary.resent += 1
                self.ever_sent.add(seq)
                sent_here.add(seq)
                self.summary.frames_sent += 1
                continue
            done_capturing = captured == len(self.chunks)
            if done_capturing and len(self.summary.acked) == len(self.chunks):
                if stop_sent_at is None:
                    acks_before = self.ack_messages
                    await ws.send(
                        json.dumps(
                            {"type": "stop", "session_id": self.session_id, "last_seq": len(self.chunks) - 1}
                        )
                    )
                    stop_sent_at = time.monotonic()
                    # The server answers stop with an ack (§1.4.7); wait up to 5 s for it.
                    self.ack_event.clear()
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(self.ack_event.wait(), 5)
                    self.summary.stop_confirmed = self.ack_messages > acks_before
                    return True
            await asyncio.sleep(0.02)
        return False


def parse_outage(value: str) -> tuple[float, float]:
    start, duration = value.split(":")
    return float(start), float(duration)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--url", required=True)
    parser.add_argument("--device-id", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--lecture-id", default=None, help="Prepared lecture to bind (optional)")
    parser.add_argument(
        "--outage",
        type=parse_outage,
        action="append",
        default=[],
        metavar="START:SECONDS",
        help="Drop the network at START s of audio for SECONDS (repeatable)",
    )
    parser.add_argument("--speed", type=float, default=1.0, help="Audio seconds per wall-clock second")
    args = parser.parse_args()
    chunks = split_chunks(load_wav(args.wav))
    sim = Simulator(
        args.url,
        args.device_id,
        args.token,
        chunks,
        lecture_id=args.lecture_id,
        outages=args.outage,
        speed=args.speed,
    )
    summary = asyncio.run(sim.run())
    print(json.dumps(summary.as_dict(), indent=2))


if __name__ == "__main__":
    main()
