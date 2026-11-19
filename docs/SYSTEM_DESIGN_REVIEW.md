# System Design Review: IoT Smart Classroom Lecture Capture

Status: **Awaiting approval** · 2026-11-19

This review covers the full-system brief (device, gateway, ASR, API, workers, frontend, infrastructure, evaluation). Every figure below is either arithmetic from the brief's own parameters or marked "measure". None is a claimed performance number.

---

## 1. Architecture as I understand it

1. **Device (ESP32-S3, ESP-IDF):**
   - The INMP441 is captured over I2S/DMA at 16 kHz and converted to 16-bit mono.
   - Audio is cut into 500 ms chunks, each with a per-lecture `seq` and `sample_offset`, and placed in a PSRAM ring.
   - One WSS connection carries the binary chunk frames up and JSON control messages and cumulative `ack{seq}` back.
   - A chunk is freed only after it has been ACKed. At ≥80% PSRAM, the oldest chunks are compressed to IMA-ADPCM and spilled to a raw flash partition.
   - After a reconnect, the device resends from the first un-ACKed seq.
2. **Gateway (`/ws/device`):**
   - Authenticates the device token hash.
   - Validates frames, stores each payload (disk/S3) plus an `audio_chunks` row (`UNIQUE(lecture_id, seq)`), and ACKs cumulatively.
   - Publishes `audio.new` through Redis.
3. **ASR worker:**
   - faster-whisper with VAD.
   - Live mode re-decodes a rolling window and commits with local agreement (partial → final).
   - Backfill mode batch-transcribes ranges that arrive late.
   - Segments go to PostgreSQL and then out through Redis.
4. **API:**
   - REST plus the browser WebSocket `/ws/lectures/{id}/live`, resumable by `last_seq`.
5. **Notes worker (after Stop):**
   - Clean → split into topics → notes and key terms per topic → summary and questions for the whole lecture.
   - Uses Pydantic-validated JSON, storing the model name and prompt version.
   - Q&A uses pgvector retrieval and cites segments.
6. **Search:** PostgreSQL `simple` full-text search plus `pg_trgm`.
7. **Export:** TXT, MD, and PDF via WeasyPrint with Noto Indic fonts embedded.
8. **Frontend:** as specified in §6 of the brief; already partly built (see §5).
9. **Infrastructure:** Docker Compose, Caddy (TLS), EC2 + S3, structured logs, latency measured at 6 stages.

---

## 2. Capacity arithmetic (from the brief's parameters; verify on hardware)

| Quantity | Value |
|---|---|
| PCM16 mono at 16 kHz | 32,000 B/s (256 kbit/s); one 500 ms chunk = 16,000 B (fits `payload_len` uint16) |
| IMA-ADPCM (4 bits/sample) | about 8,000 B/s; one chunk about 4,000 B plus block header |
| PSRAM ring, if sized at 4 MiB | about 131 s of PCM; spill starts near 105 s (80%) |
| Flash `audiobuf`, about 5 MiB | about 655 s ≈ 10.9 min of ADPCM |
| **Total offline capacity** | **about 12–13 min**, which depends on the final ring and partition sizes |

What this means:
- The 30 s and 2 min outage tests are well inside capacity.
- The **10-minute outage test is close to the limit**, so the ring and partition sizes must be fixed before that test, and the "≥90% flash" OLED warning will fire during it.
- Draining a 10-minute backlog needs uplink throughput well above the 256 kbit/s live rate (**measure** on the classroom Wi-Fi).

---

## 3. Risks and flaws I see (most important first)

**R1. In-order resend freezes the live transcript after every outage.**
- **Problem:**
  - "Resend from the first un-ACKed seq (flash first, then PSRAM)" means new live audio queues behind the whole backlog. After a 2-minute outage, students see nothing new until the backlog drains.
  - Strictly in-order delivery also means the server never actually sees a *gap that is filled later*. So `transcript.backfill` and the "Audio 10:32–10:35 syncing…" UI would never trigger.
- **Proposal:** send live chunks first, with the backlog interleaved using spare bandwidth.
  - This needs **selective ACKs**: `ack{seq, ranges:[[a,b],…]}`, or the cumulative `seq` plus received ranges.
  - With purely cumulative ACKs, live chunks above the hole could not be freed and would pile up in PSRAM.
  - This is a contract change, so it needs your approval.

**R2. Power loss while offline loses everything in PSRAM.**
- **Problem:** spilling only at ≥80% means up to about 105 s of audio exists only in volatile PSRAM. A brownout or unplugged cable loses it, which breaks the "no data loss" goal.
- **Proposal:**
  - While offline, spill continuously (write-behind) instead of waiting for 80%.
  - Give flash records a header (`lecture_id`, `seq`, `sample_offset`, CRC) so that, after a reboot, unfinished sessions can be found and resent.

**R3. Flash writes stall the audio path on the ESP32-S3.**
- **Problem:** during SPI-flash erase and write, the cache is disabled. On the S3 with octal PSRAM, that also blocks PSRAM access.
- **Requirements:**
  - I2S DMA buffers in internal RAM.
  - An IRAM-safe I2S ISR.
  - Enough DMA buffering to cover the worst-case sector-erase stall (**measure**).
  - Erasing pages ahead of time, as the brief already plans.

**R4. Starting a lecture while offline has no `lecture_id`.**
- **Problem:** if Start is pressed with no prepared lecture and no connection, chunks can't be tagged with a server lecture ID.
- **Proposal:** the device generates a UUID `session_id` at Start, and the server maps it to a lecture (including "Untitled – <date time>"). This needs a small change to the `start{}` and frame/header contract.

**R5. Redis pub/sub can't support resume by `last_seq`.**
- **Problem:** pub/sub is fire-and-forget, so a browser that reconnects can't replay what it missed.
- **Proposal:**
  - Use **Redis Streams** per lecture, or the DB, as the replayable event log, with `seq` assigned once at publish time.
  - Trim partials once they are finalized, to bound the log's size.
  - Make ASR processing per lecture single-consumer (local agreement needs strict order).

**R6. Code-mixed audio can stop local agreement from committing.**
- **Problem:** if Whisper's language detection flips between consecutive window runs (en ↔ te), the text never matches twice and nothing is committed.
- **Proposal:**
  - Decode with the lecture's `language_hint` fixed during live mode, and assign segment language after commit.
  - Measure the Telugu and Hindi WER impact in the evaluation.

**R7. Nothing produces live key terms.**
- **Problem:** the notes worker runs only after Stop, but Screen 3 requires a live key-terms panel.
- **Proposal:** either a light periodic LLM pass during recording (for example, every 3 minutes over newly finalized text), emitting `key_terms.update`, or drop the live panel.

**R8. "Browser render" latency has no reporting path.**
- **Problem:** the contract has no endpoint or message for the frontend to report stage 6 (browser render time).
- **Proposal:** the client sends `render.ack{seq, rendered_unix_ms}` over the live WebSocket.
- Device-to-gateway latency also includes SNTP clock skew, so I'll report the skew alongside it.

**R9. Device provisioning and secrets.**
- **Problem:** the brief doesn't say how Wi-Fi credentials, the server URL and the token reach NVS. NVS is also plaintext unless NVS/flash encryption is on.
- **Proposal:**
  - Use the ESP x509 certificate bundle to verify TLS on the device.
  - Caddy needs a real domain for Let's Encrypt.
  - Provisioning needs a decision (see Q6).

**R10. Smaller points:**
- **ASR scaling:** one model instance per worker process, and concurrent classrooms need per-lecture affinity.
- **Embeddings:** the model must handle Telugu and Hindi.
- **PDF export:** the WeasyPrint image must include Pango/HarfBuzz and the Noto fonts.
- **Privacy:** consent is a lecture-level flag the lecturer confirms; the retention period must be configurable (India's DPDP Act 2023).

---

## 4. Contract differences from what I already built for the frontend

| Item | Frontend-only brief (built) | System brief (new) | Plan |
|---|---|---|---|
| `device.status` | `buffer_used_pct` | `psram_buffer_pct`, `flash_buffer_pct` | Adopt the new fields |
| Ask response | `citations[{segment_id,start_ms,end_ms,quote}]` | `{answer, cited_segment_ids}` | Adopt; the frontend resolves times from the transcript |
| Lecture status | includes `paused` | no `paused` | Drop `paused` |
| Prepare lecture | no consent field | `consent_confirmed` | Add a required consent checkbox |
| New endpoints | none | `DELETE /lectures/{id}`, `GET /health` | Add |
| WebSocket extensions I added | `transcript.gap`, `server_ts`, `ping/pong`, `key_terms.update` | not in the contract | **Proposed for adoption** (they resolve R1/R7/R8 and dead-socket detection) |
| AI provider | Amazon Bedrock (your earlier answer) | "LLM API" | Assume Bedrock unless you say otherwise |

---

## 5. Where the work stands

- **Built and tested (frontend):**
  - OpenAPI contract and generated types.
  - Typed REST client.
  - WebSocket manager: state machine, jittered backoff, `last_seq` resume, dedupe, ordering by `start_ms`, backfill merge, heartbeat, latency. 62 unit tests pass.
  - Realistic MSW mocks: a 644-segment EN/TE/HI lecture with an offline gap, plus a live simulator.
  - Design tokens and themes, the design-system components, app shell, auth, Library screen, and transcript components.
- **Not built yet (frontend):**
  - Live, Detail tabs, Study, Search, Devices, Settings, Admin and Home screens.
  - E2E tests, README.
  - The project doesn't type-check right now, because the router references screens that don't exist yet.
- The frontend currently sits at the repository root. Under the monorepo layout it moves to `frontend/`.

---

## 6. Open questions

1. **R1:** Live-first sending with selective ACKs (recommended), or the brief's strict in-order resend?
2. **R2:** Continuous spill to flash while offline, for power-loss safety (recommended)?
3. **R4:** A device-generated `session_id` for lectures started offline?
4. **R7:** Periodic live key-term extraction during recording, or remove the live key-terms panel?
5. **AI models:** Bedrock in `ap-south-1` (Mumbai)? Which LLM and which multilingual embedding model? Or should I benchmark candidates first?
6. **Provisioning:** Wi-Fi, server URL and token loaded by serial console/menuconfig (simplest), or SoftAP/BLE provisioning?
7. **ASR hardware budget:** CPU-only EC2, or can a GPU instance be considered if benchmarks justify it?
8. **Order of work:** the brief says firmware first and frontend 8th, but you earlier asked me to build the whole frontend. Should I (a) finish the frontend now (it runs on mocks) and then start at module 1, or (b) move it to `frontend/` as is and follow the module order strictly?
