import json
import uuid
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from app.audio.frames import Codec, FrameError, build_frame, parse_frame
from app.gateway import protocol
from app.gateway.seq_tracker import SeqTracker

SCHEMAS = Path(__file__).resolve().parents[2] / "contracts" / "schemas"


def test_frame_roundtrip_and_validation() -> None:
    payload = bytes(16000)
    frame = parse_frame(build_frame(Codec.PCM16, 7, 1_700_000_000_123, payload))
    assert (frame.seq, frame.sample_offset, frame.capture_unix_ms) == (7, 56_000, 1_700_000_000_123)
    assert frame.samples == 8000 and frame.duration_ms == 500
    data = bytearray(build_frame(Codec.PCM16, 1, 0, bytes(10)))
    with pytest.raises(FrameError):
        parse_frame(bytes(data[:-1]))  # length mismatch
    data[0] = ord("X")
    with pytest.raises(FrameError):
        parse_frame(bytes(data))
    with pytest.raises(FrameError):
        parse_frame(build_frame(Codec.PCM16, 1, 0, bytes(16002)))  # larger than a chunk
    bad_offset = bytearray(build_frame(Codec.PCM16, 1, 0, bytes(10)))
    bad_offset[8] = 1
    with pytest.raises(FrameError):
        parse_frame(bytes(bad_offset))


def test_adpcm_frame_sample_count() -> None:
    block = bytes([0, 0, 0, 1]) + bytes(4000)  # 7999 codes + padding
    assert parse_frame(build_frame(Codec.ADPCM, 0, 0, block)).samples == 8000


def test_seq_tracker_cumulative_ranges_and_holes() -> None:
    t = SeqTracker()
    assert t.add(0) is None and t.add(1) is None
    assert t.cumulative == 1
    assert t.add(5) == (2, 4)  # live-first after an outage: hole opens
    assert t.add(6) is None
    assert t.ranges() == [[5, 6]]
    assert t.holes() == [(2, 4)]
    t.add(2)
    t.add(4)
    assert t.ranges() == [[4, 6]] and t.cumulative == 2
    assert not t.range_complete(2, 4)
    t.add(3)
    assert t.cumulative == 6 and t.ranges() == [] and t.range_complete(2, 4)
    assert t.add(3) is None  # duplicate


def test_seq_tracker_limits_ranges_to_sixteen() -> None:
    t = SeqTracker.from_seqs(range(0, 100, 2))
    assert len(t.ranges()) == 16
    assert t.ranges()[0] == [2, 2]


def test_control_messages_match_contract_schema() -> None:
    schema = json.loads((SCHEMAS / "device-control.schema.json").read_text())
    sid = str(uuid.uuid4())
    samples = [
        {"type": "start", "session_id": sid, "lecture_id": None, "started_unix_ms": 0, "sample_rate": 16000},
        {"type": "resume", "session_id": sid, "lecture_id": str(uuid.uuid4())},
        {"type": "stop", "session_id": sid, "last_seq": 41},
        {
            "type": "status",
            "wifi_rssi": -61,
            "psram_buffer_pct": 3.5,
            "flash_buffer_pct": 0,
            "uptime_s": 120,
            "recording": True,
            "state": "RECORDING",
            "pending_chunks": 1,
        },
    ]
    for sample in samples:
        jsonschema.validate(sample, schema)
        protocol.device_message_adapter.validate_python(sample)
    for outbound in (
        protocol.config_msg(4.0, True, 1),
        protocol.ack_msg(uuid.uuid4(), 5, [[7, 9]]),
        protocol.assign_msg(uuid.uuid4(), "Deadlocks"),
        protocol.started_msg(uuid.uuid4(), uuid.uuid4()),
        protocol.error_msg("auth_failed", "bad token"),
    ):
        jsonschema.validate(outbound, schema)
    with pytest.raises(ValidationError):
        protocol.device_message_adapter.validate_python({"type": "stop", "session_id": sid, "last_seq": -2})
    with pytest.raises(ValidationError):
        protocol.device_message_adapter.validate_python({"type": "reboot"})
