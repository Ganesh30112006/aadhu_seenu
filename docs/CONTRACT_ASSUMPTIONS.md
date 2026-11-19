# Contract assumptions: how each open question was resolved

`FRONTEND_DESIGN.md` §8 listed 23 open questions about the backend contract, each with a default. The backend was then built in the same repository, so most of them became real contract decisions (D1–D14 in `DECISIONS.md`) instead of client-side guesses.

This file records the final answer for each question and where it is implemented. When the contract changes, update this file together with `contracts/`.

**Status key**
- **Contract:** the backend implements the answer, and the frontend relies on it.
- **Default kept:** the original assumption still stands.
- **Changed:** the answer differs from the §8 default.

## Real-time protocol (`contracts/PROTOCOL.md` §2, `frontend/src/api/ws/`)

| # | Question | Resolution | Status |
|---|---|---|---|
| 1 | Gap announced before the backfill | `transcript.gap{gap_id, gap{start_ms, end_ms\|null}}` is published when the gateway sees a seq hole. `transcript.backfill` carries the same `gap_id` and closes it. (D8) | Contract |
| 2 | Server timestamp for latency | Every server event carries `server_ts` (epoch ms). The client sends `ping{client_ts}` and gets `pong{client_ts, server_ts}` for the clock offset. It also sends `render.ack{seq, rendered_unix_ms}` for evaluation. (D7) | Contract |
| 3 | Heartbeat | The client pings every 15 s. With no frame for 35 s, it treats the socket as dead and reconnects (`HEARTBEAT_INTERVAL_MS` / `HEARTBEAT_TIMEOUT_MS`). | Contract |
| 4 | Replay window | Each lecture's events live in a Redis Stream for 24 h (`LIVE_STREAM_TTL_S`). `last_seq: 0` replays all of it, minus partials already superseded by finals (D5). If the client's `last_seq` is ahead of the server (Redis was reset), the server sends `error{code:"resync_required"}` and replays from 0, and the client clears its timeline. The transcript itself always comes from REST, so a late joiner loses nothing. | Contract |
| 5 | Live key terms | `key_terms.update{terms[]}` comes from a light LLM pass every 3 minutes of new final text (D4). There is no polling. | Changed (pushed, not polled) |
| 6 | Close codes | `4401` unauthenticated, `4404` lecture not found **or not visible to this user**, `1000` after the lecture ends and every event is sent. Anything else is retried with backoff. `4403` is never sent: an invisible lecture looks the same as a missing one. | Changed (no 4403) |
| 7 | WebSocket authentication | Same-site deployment: Caddy serves the app, `/api` and `/ws` from one host (`infra/caddy/Caddyfile`), and Vite proxies them in development. The session cookie goes with the handshake. | Default kept |
| 8 | Time base | `start_ms`/`end_ms` are relative to the lecture start. The lecture response includes `started_at`, so wall-clock time can be shown in a tooltip. | Default kept |
| 9 | Language codes | ISO 639-1 (`en`, `hi`, `te`), stored as `language_hint` and per segment, and used directly as the `lang` attribute. | Default kept |

## REST (`contracts/openapi.json`, generated into `frontend/src/api/generated/schema.d.ts`)

| # | Question | Resolution | Status |
|---|---|---|---|
| 10 | CSRF | Double-submit. A readable `csrftoken` cookie is echoed in `X-CSRF-Token` on POST/PATCH/DELETE, and checked against the server-side session (D13). | Contract |
| 11 | Transcript pagination | `GET /lectures/{id}/transcript` returns `{items, next_cursor}` ordered by `start_ms`: 200 per page by default, at most 500. The client fetches every page. | Contract |
| 12 | Search highlight offsets | Code-point offsets. The client converts them to UTF-16 indices. | Contract |
| 13 | Notes shape | `{lecture_id, published, generation_status, updated_at, version, sections[{id, heading, body_markdown}]}`. PATCH sends `version` and gets `409` on conflict. `POST …/notes/regenerate` returns `202`, and completion arrives as `notes.ready{kinds}` on the live socket or is found by polling. | Contract (adds `generation_status`) |
| 14 | Unpublished notes for students | `404` with `code: "notes_not_published"`. Other kinds use `<kind>_not_published`. | Contract |
| 15 | Correct answers visible to students | MCQs include `correct_index` and `explanation`. This is acceptable for self-revision, but **not suitable for graded tests**: anyone can read the answers in devtools. | Default kept (risk accepted) |
| 16 | Ask | Not streamed: `{answer, cited_segment_ids}`. The client looks up each cited segment's `start_ms` in the transcript cache. With AI unavailable it gets `503 ai_unavailable`. The Ask UI handles answers with no citations. | Changed (IDs only) |
| 17 | Export | `GET /lectures/{id}/export?format=pdf\|md\|txt` is synchronous, with `Content-Disposition`. The API sets `Content-Length`. Caddy compresses text responses, which removes `Content-Length` for `md`/`txt`, so those show the indeterminate bar. PDFs are not re-compressed and keep a determinate bar. `501 export_unavailable` is returned if the PDF libraries are missing. | Contract |
| 18 | Admin endpoints | Now present (admin only): `GET/POST /subjects`, `GET/POST /users`, `PATCH /users/{id}`, `POST /devices` (returns the token once) and `PUT /devices/{id}/lecturers`. The frontend has screens for subjects and users, and a Register dialog on the Devices page that shows the token once. **Assigning lecturers to a microphone has no screen yet**; use `python -m tools.register_device --lecturer` or the endpoint. | Changed (endpoints added) |

## Product questions

| # | Question | Resolution | Status |
|---|---|---|---|
| 19 | Status colours | There is **no `paused` status** (adopted from the system brief). The colour table in FRONTEND_DESIGN §7 applies without its `paused` row. | Changed |
| 20 | Who starts recording | The device button. "Prepare lecture" (`POST /lectures`, `consent_confirmed` required) creates a `scheduled` lecture. The next Start on an assigned device binds to it, and a Start with nothing prepared creates an "Untitled" lecture (D3). There is no start/stop endpoint in the web API. | Default kept |
| 21 | Language display preference | Per-user settings: a language label on each segment (`showLanguageLabels`); a transliteration line under Hindi/Telugu segments, taken from `segment.transliteration` (`showTransliteration`); and which languages are shown (`visibleLanguages`). The UI-language picker shows English only, and other languages are marked "coming soon". | Changed (transliteration added) |
| 22 | Lecturer and device | `GET /devices` returns the devices assigned to the lecturer (all devices for admins). The Prepare form pre-selects the device when there is only one. | Default kept |
| 23 | Roles | Exactly one role per user: `lecturer`, `student` or `admin`. | Default kept |

## Additions not in §8

- `device.status` reports `psram_buffer_pct` and `flash_buffer_pct` (D2). The Devices screen shows both.
- `GET /health` returns `{status, database, redis}`. Through Caddy it is at `/api/health`.
- `DELETE /lectures/{id}` is for the owning lecturer or an admin. It removes the audio, transcript and AI material.
