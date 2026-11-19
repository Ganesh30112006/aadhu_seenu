# Architecture Decisions

On 2026-11-19 the owner instructed: "don't ask me, complete full architecture" and "I don't want Docker". The recommended option for every open question in `SYSTEM_DESIGN_REVIEW.md` was therefore adopted. Each change to the original brief is recorded here and reflected in `contracts/`.

| # | Decision | Contract impact |
|---|---|---|
| D1 | **Live-first sending with selective ACKs.** The device sends new live chunks first and interleaves the backlog using spare bandwidth. The server ACKs with `ack{seq, ranges}`: `seq` is the cumulative "everything ≤ seq stored" and `ranges` lists stored islands above it. Chunks are freed when covered by either. | `ack` gains an optional `ranges` field; the cumulative `seq` keeps its original meaning. |
| D2 | **Continuous spill while offline.** Any chunk still un-ACKed 2 s after capture while the server is unreachable is ADPCM-encoded and written to the flash log, so power loss loses at most about 2 s. The 80% PSRAM threshold remains as a second trigger. Flash records carry a header (session, seq, offsets, CRC) so unfinished sessions are recovered after a reboot. | None (device internal); `flash_buffer_pct` is reported in `status`. |
| D3 | **Device-generated `session_id`** (UUID v4) at Start. A lecture can start offline; the server maps the session to a lecture idempotently, using `UNIQUE(lectures.session_id)`. Frames belong to the session last declared by `start` or `resume` on that connection. | `start{lecture_id\|null, session_id, started_unix_ms}`; new `resume{session_id, lecture_id\|null}` for backlog from an earlier connection; `stop{session_id, last_seq}`. |
| D4 | **Live key terms** come from a periodic light LLM pass (every 3 min of new final text) during recording. | Browser event `key_terms.update{terms[]}`. |
| D5 | **Replayable live events.** Each lecture has a Redis Stream; `seq` is assigned once by the API publisher, and PostgreSQL stays the source of truth. Partials are trimmed once finalised. | `seq` semantics unchanged. |
| D6 | **Fixed decode language during live ASR** (the lecture's `language_hint`). Per-segment language is detected after commit, so language flips can't stall local agreement. | None. |
| D7 | **Browser render latency** is reported with `render.ack{seq, rendered_unix_ms}` on the live WebSocket. Every server event carries `server_ts`, and `ping`/`pong` provide liveness and clock-offset estimation. | Additions to the browser protocol. |
| D8 | **Gap announcement**: `transcript.gap{gap_id, gap{start_ms,end_ms\|null}}` is published when the gateway sees a seq hole, and `transcript.backfill` carries the same `gap_id`. | Additions to the browser protocol. |
| D9 | **AI provider: Amazon Bedrock** in `ap-south-1`. The LLM defaults to Claude via the Bedrock Converse API; embeddings default to `cohere.embed-multilingual-v3` (supports Hindi and Telugu). Both are configurable, to be benchmarked in `eval/`. The browser never calls Bedrock. | None. |
| D10 | **Provisioning**: Wi-Fi credentials, server URL and device token are written to NVS from a CSV with `nvs_partition_gen.py`, or set via `idf.py menuconfig` for development. | None. |
| D11 | **ASR runs on CPU by default** (faster-whisper int8). CUDA is a configuration switch that is justified only by `eval/` benchmarks. | None. |
| D12 | **No Docker.** EC2 runs Ubuntu 24.04 with PostgreSQL 16 + pgvector, Redis and Caddy as system packages; the API, gateway, ASR worker and notes worker run as systemd units. Local development uses native installs (Redis via Memurai or WSL on Windows). | `infra/` holds a setup script and systemd units instead of Compose. |
| D13 | **Server-side sessions** (`sessions` table, token hash, CSRF token) back the httpOnly cookie, so sessions can be revoked. | Schema adds `sessions` (justified addition). |
| D14 | Monorepo layout as in the brief: `firmware/ backend/ frontend/ contracts/ infra/ eval/ docs/`. | None. |

Adopted from the system brief over the earlier frontend-only brief:
- `device.status` reports `psram_buffer_pct` and `flash_buffer_pct`.
- Ask returns `{answer, cited_segment_ids}`.
- There is no `paused` status.
- Prepare requires `consent_confirmed`.
- `DELETE /lectures/{id}` and `GET /health` are added.
