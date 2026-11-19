# Build Progress

The build follows the module order of the system brief, with the decisions in `DECISIONS.md` applied throughout.

| # | Module | Status | Verified here |
|---|---|---|---|
| 1 | Hardware validation firmware (`firmware/mic_test`, `firmware/tools`) | done | no (needs ESP-IDF + board) |
| 2 | Contracts (`contracts/`) | done | JSON Schemas checked by backend tests; `openapi.json` exported from FastAPI |
| 3 | Device firmware (`firmware/recorder`, `firmware/lc_core`) | done | `lc_core` host tests written, not compiled (no C compiler here); ADPCM vectors cross-checked from Python |
| 4 | Device gateway + simulator | done | pytest: real WebSocket + embedded PostgreSQL; simulator E2E with an outage |
| 5 | ASR worker | done | pytest with a fake transcriber (faster-whisper itself is not run here) |
| 6 | API + database | done | pytest; Alembic upgrade/downgrade on an embedded database |
| 7 | Notes / Q&A workers | done | pytest with a scripted LLM (Bedrock not called here) |
| 8 | Frontend (`frontend/`) | done | `npm run check` (91 vitest tests), build + bundle budget, 28 Playwright E2E incl. axe |
| 9 | Deployment, no Docker (`infra/`) | done | `bash -n` on the scripts; Caddyfile reviewed by hand (no Caddy binary here; `setup.sh` runs `caddy validate` before reloading) |
| 10 | Evaluation scripts (`eval/`) | done | 38 pytest tests for the metric and report functions; CLIs smoke-tested with `--help` |

## Master-plan additions (2026-11-19/20)

Agreed with the owner on 2026-11-19. Deliberate deviation: no MicroSD; internal flash + PSRAM give about 12.7 min of offline audio.

| Addition | Where | Verified here |
|---|---|---|
| Web Start/Pause/Resume/Stop + physical Pause/Resume button (GPIO7), lecture `paused` flag | gateway, `firmware/recorder`, Live page | pytest (`test_master_plan.py`); firmware not compiled |
| Live device monitoring: mic level, mic status, pending chunks, sync progress | gateway status, Live page, device page | pytest, vitest |
| Manual transcript correction | API + Transcript/Live pages | pytest, vitest |
| Flashcards and revision notes | notes worker, API, Flashcards + Revision tabs | pytest, vitest |
| Settings: profile, password, notifications, server info (admin) | API + Settings page | pytest, vitest |
| Device settings (name, room, gain, voice detection) and lecturer assignment | API + device page (admin) | pytest, vitest |
| Configurable audio retention (`AUDIO_RETENTION_DAYS`, `python -m tools.retention`) | backend tool | pytest |
| Phase 12 documents: report, PPT outline, UML, circuit, user manual, demo script | `docs/project/` | reviewed against the code; results tables left *to be measured* |

## Quality gates (all passing on 2026-11-20)

| Part | Gate | Result |
|---|---|---|
| Backend | `pytest`, `ruff check`, `ruff format --check`, `mypy --strict` | 56 tests; clean |
| Eval | `pytest eval`, ruff, `mypy --strict` | 38 tests; clean |
| Frontend | `npm run check` (tsc ×2, eslint, CSS tokens, Prettier, vitest) | 102 tests; clean |
| Frontend | `npm run build && npm run size` | 184.2 KB initial JS gzip (budget 200 KB), no mock code |
| Frontend | `npm run e2e` (`PW_CHANNEL=chrome` here) | 34 tests (axe sweep now also covers Revision, Flashcards, Settings for every role, and the admin device page) |

## Fixed while adding tests and deployment (2026-11-19)

- **Transcript stopped loading after page 2** when a response was fast. `useFullTranscript` now also depends on the page count.
- **The transcript search box dropped keystrokes** because it was driven by the URL. That would also break Hindi/Telugu input methods. The query now lives in state and is mirrored to `?q=`.
- **The API client captured `fetch` at import time**, so request interceptors could not see its requests. It now resolves `fetch` on each call.
- **`render.ack` was sent only for finals and backfills.** Partials are now acknowledged too, and `eval/` pairs each chunk with the first *rendered* window that covers it.
- **Lost work after a Redis flush or a worker crash:**
  - the ASR worker re-queues `recording` lectures on start;
  - the notes worker re-queues `processing` lectures whose job is missing (`BLPOP` removes the job before it runs).
- **Accessibility, found by axe:**
  - the account button's spoken name didn't match its visible text (WCAG 2.5.3);
  - the scrollable key-terms panel couldn't be focused (WCAG 2.1.1).
- **New tool:** `tools.register_device`, which registers a microphone from the server shell and assigns it to lecturers. (Since 2026-11-20 the device page can assign lecturers too.)
- **Tooling fixes:**
  - husky was pointing at a hooks path that doesn't exist; it now uses `frontend/.husky` (pre-commit runs lint-staged);
  - ESLint now covers config and e2e files;
  - Prettier has been applied to all of `frontend/`.

## Fixed on 2026-11-20

- **Flaky frontend tests under full-suite load:** Testing Library's 1 s wait was too short when all files run in parallel. `asyncUtilTimeout` is now 5 s, the per-test timeout 15 s, and the Library test waits for the lecture count instead of reading it once.
- **Backend tests could not start** because a test PostgreSQL from an earlier run was still holding `%TEMP%\smartclass_test_pg`. Stopping that process and deleting the folder fixes it.

## Not verified here (needs real hardware or services)

- Firmware build and on-device behaviour. The first ESP-IDF build will be the first compile.
- faster-whisper accuracy and speed: run `eval/asr_benchmark.py` on real classroom recordings.
- Amazon Bedrock calls: model access and IAM.
- `infra/ec2/setup.sh` on a real Ubuntu 24.04 instance, and Caddy obtaining a certificate.

## Waiting on the owner

- Restyling the frontend to a plain, simple look. The owner will say when to start.
