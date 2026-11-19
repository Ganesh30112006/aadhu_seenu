# Backend: Gateway, API, ASR worker, Notes worker

Four processes share one Python package (Python 3.11+, FastAPI, SQLAlchemy 2, Pydantic v2):

| Process | Command | Role |
|---|---|---|
| Device Gateway | `uvicorn app.gateway.main:app --port 8001` | `wss://…/ws/device`: authenticates devices, stores chunks idempotently, sends selective ACKs, detects gaps, publishes live events |
| API | `uvicorn app.api.main:app --port 8000` | REST (`/auth`, `/lectures`, `/search`, `/devices`, …) and the browser socket `wss://…/ws/lectures/{id}/live` |
| ASR worker | `python -m worker.asr.main` | faster-whisper with VAD: live local agreement, catch-up, backfill of late gaps, finalisation |
| Notes worker | `python -m worker.notes.main` | Bedrock: topics → notes + key terms → summary → questions → embeddings; live key terms while recording |

How they talk to each other:
- **PostgreSQL** is the source of truth.
- **Redis** carries `asr:pending` and `jobs:notes` (jobs), `live:{lecture}` (a replayable Stream per lecture, D5), and `device:{id}` (pub/sub control messages).

The contracts live in `../contracts/`. Run `python -m app.export_openapi` to regenerate `contracts/openapi.json`, which the frontend's types are generated from.

## Setup (development, no Docker)

```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate          # Linux: . .venv/bin/activate
pip install -e ".[dev,eval]"          # add ,asr for faster-whisper and ,pdf for WeasyPrint
cp .env.example .env                  # set DATABASE_URL, REDIS_URL, BEDROCK_LLM_MODEL_ID
alembic upgrade head
python -m tools.seed --admin-email you@college.edu --demo    # prints a device token once
python -m tools.register_device --serial <MAC> --name "Desk mic" --room "Room 204" --lecturer <email>
```

Development needs a PostgreSQL 16 with `pgvector`, and a Redis:
- **Linux:** `apt install postgresql-16 postgresql-16-pgvector redis-server`.
- **Windows:** the PostgreSQL installer plus the pgvector build, and Memurai (or WSL) for Redis.

## Tests

```bash
python -m pytest -q          # 44 tests
ruff check . && ruff format --check . && mypy app worker tools
```

- The tests start an **embedded PostgreSQL 16 + pgvector** (`pgserver`), so no database setup is needed. Set `TEST_DATABASE_URL` to use your own.
- Redis is `fakeredis`.
- `pg_trgm` is optional in tests; search falls back to unindexed `ILIKE` without it.

| Test file | What it proves |
|---|---|
| `test_adpcm.py` | Codec round-trip and **byte-equality with the firmware** (`contracts/test_vectors`) |
| `test_gateway_units.py` | Frame validation, selective-ACK and gap maths, control messages valid against the JSON Schema |
| `test_gateway_flow.py` | Real WebSocket: auth (4401), Untitled lecture, prepared lecture assignment, live-first resend with **no duplicates**, the gap announced and filled, `stop` confirmed |
| `test_simulator_e2e.py` | The device simulator against a real uvicorn gateway with a network outage: every seq stored exactly once, ADPCM backlog |
| `test_local_agreement.py` | The commit policy (agreement, sentence/pause/length segmentation, silence, safety valve), script detection, transliteration |
| `test_asr_worker.py` | Live → gap → backfill → stop: **every word exactly once in timeline order**, partials trimmed, latency marks; recording lectures re-queued on start |
| `test_api.py` | Cookies + CSRF + roles, visibility, keyset pagination, edit/publish workflow, Ask citation filtering, search highlight code points, export, devices, delete, live socket replay/ping/render.ack |
| `test_notes_worker.py` | Validated artifacts with model and prompt version, embeddings, AI outage → `failed` artifacts but a completed lecture, live key terms, JSON extraction with retry, lost jobs re-queued on start |
| `test_register_device.py` | `tools.register_device`: only the token hash is stored, lecturer assignment, refusals |

## Device simulator

This streams a WAV over the exact device protocol, with outages, and is how you test without hardware:

```bash
python -m tools.device_simulator --url ws://127.0.0.1:8001/ws/device \
  --device-id <uuid> --token <token> --wav lecture.wav --outage 30:60 --speed 1
```

## Failure points

- **ASR throughput:** a CPU that can't keep up shows as growing catch-up (`more=True` loops). Choose `ASR_MODEL` from the `eval/` benchmark.
- **Bedrock:** `AccessDenied` or a model that isn't enabled marks the artifacts `failed`, but lectures still complete. Ask returns `503 ai_unavailable`.
- **Redis restart:** the live history is lost, and browsers receive `resync_required` and resubscribe from 0. PostgreSQL keeps everything.
- **PDF export:** needs Pango/HarfBuzz and the Noto fonts on the server (`infra/ec2/setup.sh`). Otherwise it returns `501 export_unavailable`.
