# Smart Classroom Protocols (v1)

This is the single source of truth for the interfaces between modules. Field names, message types and byte layouts here are binding. Machine-checkable versions are in `contracts/schemas/`. The REST API is defined by FastAPI's generated `contracts/openapi.json` (`python -m app.export_openapi`). Changes to the original brief are listed in `docs/DECISIONS.md`.

---

## 1. Device ↔ Gateway: `wss://<host>/ws/device`

- One WebSocket over TLS per device.
- Binary frames carry audio; text frames carry JSON control messages.
- All integers are **little-endian**.

### 1.1 Audio chunk frame (device → server, binary)

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 2 | `magic` | ASCII `'L' 'C'` (0x4C 0x43) |
| 2 | 1 | `version` | `1` |
| 3 | 1 | `codec` | `0` = PCM16 LE mono, `1` = IMA-ADPCM (see 1.2) |
| 4 | 4 | `seq` | uint32, per session, starts at 0, +1 per chunk, never reused |
| 8 | 8 | `sample_offset` | uint64, samples since recording start; always `seq × 8000` |
| 16 | 8 | `capture_unix_ms` | uint64, SNTP wall clock at capture of the first sample; 0 if not synced |
| 24 | 2 | `payload_len` | uint16, bytes that follow |
| 26 | n | `payload` | ≤ 500 ms of audio at 16 kHz (8000 samples) |

- A PCM16 chunk is 16,000 bytes; an ADPCM chunk is 4,004 bytes.
- Only the final chunk of a session may be shorter.
- The server rejects a frame whose `payload_len` doesn't match the frame length, whose `magic` or `version` is unknown, or whose codec payload size is impossible, and replies with `error{code:"protocol_error"}`.
- Ordering, timing and de-duplication use `(session, seq)` and `sample_offset`, **never arrival time**.

### 1.2 IMA-ADPCM payload (codec 1)

| Bytes | Field |
|---|---|
| 0–1 | int16 initial predictor (the first sample, PCM) |
| 2 | uint8 initial step index (0–88) |
| 3 | flags: bit 0 = 1 if the last nibble is padding (N−1 is odd), other bits 0 |
| 4… | 4-bit codes, **low nibble first**, one per sample, for samples 1…N−1 (the first sample is the predictor) |

- Encoded size is `4 + floor(N/2)`.
- For N = 8000 there are 7999 codes plus one padding nibble = 4000 bytes, with flags = 1.
- Standard IMA step and index tables are used.
- The reference implementations are `firmware/lc_core/adpcm.c` and `backend/app/audio/adpcm.py`. They are cross-checked by the test vectors in `contracts/test_vectors/adpcm_*.bin`.

### 1.3 Control messages (JSON text frames)

Each message has a `type`.

**Device → server**

| `type` | Fields | When |
|---|---|---|
| `hello` | `device_id` (uuid), `firmware_version` (str), `token` (str), `protocol_version` (1) | First frame after connecting. Nothing else is accepted before it. |
| `start` | `session_id` (uuid, device-generated), `lecture_id` (uuid\|null), `started_unix_ms` (int, 0 if unsynced), `sample_rate` (16000) | The Start button was pressed. If the press happened offline, sent on reconnect before the session's frames. |
| `resume` | `session_id`, `lecture_id` (uuid\|null) | Before sending backlog frames of a session that isn't the connection's current one (for example, after a reboot). |
| `stop` | `session_id`, `last_seq` (int, −1 if no chunk) | The Stop button was pressed. Sent once the device has queued every chunk. |
| `pause` | `session_id`, `paused` (bool) | Capture was paused (`true`) or resumed (`false`), by the Pause button or a `command`. No chunks are produced while paused, so `seq` stays contiguous and lecture time excludes the pause. |
| `status` | `wifi_rssi` (int dBm), `psram_buffer_pct` (0–100), `flash_buffer_pct` (0–100), `uptime_s`, `recording` (bool), `state` (device state name), `pending_chunks` (int); optional `level_dbfs` (−120–0), `mic_ok` (bool), `paused` (bool) | Every 1 s while recording (for the live level meter), every 5 s otherwise. A paused device reports `recording: true, paused: true`. |

**Server → device**

| `type` | Fields | Meaning |
|---|---|---|
| `config` | `gain` (linear, 0.5–16), `vad_enabled` (bool), `server_unix_ms` | Reply to a valid `hello`; also means "authenticated". `vad_enabled` turns on the device's "no speech detected, check microphone" warning. |
| `ack` | `session_id`, `seq` (int), `ranges` ([[a,b],…]) | `seq`: every chunk ≤ `seq` is stored (−1 = none). `ranges`: inclusive islands stored above `seq` (at most 16, ascending). The device frees any chunk covered by either. |
| `lecture.assign` | `lecture_id`, `title` | A lecture was prepared for this device in the web app; the OLED shows the title. |
| `lecture.started` | `lecture_id`, `session_id` | The session is bound to a lecture (prepared, or "Untitled – <date time>"). |
| `command` | `action` (`start\|pause\|resume\|stop`), `lecture_id` | Pressed on the web Live page. The device acts as if its own button was pressed (start only when idle, for that lecture; pause/resume/stop only for the current session of that lecture) and reports the result with `start`/`pause`/`stop`. |
| `error` | `code`, `message` | `auth_failed`, `protocol_error`, `unknown_session`, `consent_required`, `internal` |

**Close codes:**
- `4401`: authentication failed. Don't retry until the configuration changes.
- `4400`: protocol error.
- `4409`: replaced by a newer connection from the same device.
- Anything else: reconnect with backoff.

### 1.4 Delivery rules

1. Every chunk stays on the device (PSRAM, or the flash log) until an `ack` covers it.
2. **Live first:** the newest captured chunk is sent before any backlog. Backlog chunks (oldest first) are interleaved after it while the socket has room.
3. On reconnect: `hello`, then `start` or `resume` for the current session, then frames. Un-ACKed chunks are resent.
4. The server stores chunks with `UNIQUE(lecture_id, seq)`. Duplicates are acknowledged but not stored or processed again.
5. The server ACKs after storing, at most every 250 ms per session and immediately when a gap is filled.
6. A seq hole on the server (receiving seq k while k−1 is missing) becomes a **gap**. When the hole fills, the gap's audio is transcribed in backfill mode.
7. **Stop.** When the Stop button is pressed, the device enters FINALIZING. It sends `stop{last_seq}` only after every chunk it still holds for the session has been ACKed. The session is then complete. Any seq ≤ `last_seq` still missing was dropped on the device: both buffers were full, which the OLED reported while recording. Those seqs become permanent `missing` gaps, never silent holes.
   - The server answers `stop` with an `ack` for that session; the device then forgets the session.
   - If a `stop` is lost, the server finalises a session itself once the device has reported `recording=false` for 10 minutes. It then uses its highest stored seq as `last_seq`. A paused lecture is never finalised this way (only after 24 hours offline).
8. **Buffers full.** If PSRAM and the flash log are both full, the device keeps the oldest audio. New chunks are counted (their `seq` still advances, so timing stays exact) but not stored, and the OLED shows `BUFFER FULL – AUDIO NOT SAVED`.
9. **Reboot recovery.** The session state (id, lecture, next seq, stopped, last seq) is kept in NVS, and un-ACKed chunks are kept in the flash log. After a reboot the device sends `resume`, then the backlog, then `stop` if the session had been stopped.

---

## 2. Browser ↔ API: `wss://<host>/ws/lectures/{lecture_id}/live`

- Authenticated by the session cookie.
- Server events are read from a per-lecture Redis Stream. Every event has a monotonically increasing `seq` (per lecture), `type` and `server_ts` (epoch ms at send time).

**Client → server**

| `type` | Fields |
|---|---|
| `subscribe` | `lecture_id`, `last_seq` (0 = from the beginning) |
| `ping` | `client_ts` |
| `render.ack` | `seq`, `rendered_unix_ms` (latency stage 6, for evaluation) |

**Server → client**

| `type` | Fields |
|---|---|
| `transcript.partial` | `segment_id`, `start_ms`, `end_ms`, `text`, `language` |
| `transcript.final` | `segment_id`, `start_ms`, `end_ms`, `text`, `language`, `confidence`; optional `edited` (a lecturer correction re-sends the final with the same `segment_id`) |
| `transcript.gap` | `gap_id`, `gap{start_ms, end_ms\|null}` |
| `transcript.backfill` | `gap_id`, `segments[]` (final segments), `gap{start_ms, end_ms}` |
| `lecture.status` | `status` (`scheduled\|recording\|processing\|completed\|failed`), `duration_ms`; optional `paused` (bool) |
| `device.status` | `device_id`, `online`, `wifi_rssi`, `psram_buffer_pct`, `flash_buffer_pct`, `recording`, `last_seen_at`; optional `paused`, `level_dbfs`, `mic_ok`, `pending_chunks`, `last_audio_at`. Only the newest `device.status` is kept in the replay log. |
| `key_terms.update` | `terms[]` (`id`, `term`, `definition`, `language`, `first_mentioned_ms`) |
| `notes.ready` | `kinds[]` (`summary`, `notes`, `key_terms`, `questions`, `flashcards`, `revision`) |
| `error` | `code`, `message`; `resync_required` means resubscribe with `last_seq: 0` |
| `pong` | `client_ts`, `server_ts` (no `seq`) |

- `start_ms` and `end_ms` are offsets from the lecture start (`sample_offset / 16`).
- `language` is `en`, `te` or `hi`.

**Close codes:**
- `4401`: not authenticated.
- `4403`: forbidden.
- `4404`: unknown lecture.
- `1000`: the lecture has ended and every event has been sent.

---

## 3. Latency instrumentation (evaluation)

Each stage is recorded in `latency_marks` with the stage name and the unix ms timestamp:

| Stage | Where |
|---|---|
| `capture` | `capture_unix_ms` from the frame |
| `gateway_receive` | gateway, when the frame is read |
| `asr_start` | worker, when decoding of the window containing the chunk starts |
| `asr_end` | worker, when decoding ends |
| `published` | API publisher, when the segment event is added to the stream |
| `rendered` | browser `render.ack` |

`eval/latency_report.py` reports p50 and p95 for each stage-to-stage interval.
