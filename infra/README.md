# Deployment (EC2, no Docker)

Everything runs on one Ubuntu 24.04 EC2 instance as system packages and systemd units (decision D12).

```
            Internet (443)                         ESP32 recorders (wss)
                  │                                        │
              ┌───▼────────────────── Caddy ───────────────▼───┐
              │ /            → /var/www/smartclass (frontend)  │
              │ /api/*       → 127.0.0.1:8000 (prefix removed) │
              │ /ws/lectures → 127.0.0.1:8000                  │
              │ /ws/device   → 127.0.0.1:8001                  │
              └───┬───────────────────────────────┬────────────┘
       smartclass-api (2 workers)        smartclass-gateway
                  │                               │
        PostgreSQL 16 + pgvector  ◄──  Redis  ──►  smartclass-asr, smartclass-notes ──► Bedrock
```

| File | Installed as |
|---|---|
| `ec2/setup.sh` | Run once: packages, user, database, venv, frontend build, units, Caddy, firewall |
| `ec2/deploy.sh` | Run per release: backup, sync, deps, migrations, build, rolling restart, health check |
| `env/backend.env.example` | `/etc/smartclass/backend.env` (shared by all four services) |
| `systemd/smartclass-{api,gateway,asr,notes}.service` | `/etc/systemd/system/` |
| `systemd/smartclass-backup.{service,timer}` | Nightly `pg_dump` at 02:30 |
| `backup/pg-backup.sh` | `/usr/local/bin/smartclass-backup` |
| `caddy/Caddyfile` | `/etc/caddy/Caddyfile` (TLS from Let's Encrypt, security headers, CSP) |

## Instance

- **Size:** `c7i.2xlarge` (8 vCPU, 16 GB) or `c7g.2xlarge` (Graviton) handles about 2–3 simultaneous classrooms with Whisper `small` int8 on the CPU. Use the `eval/` latency benchmark to size it for your load (D11).
- **Disk:** 50 GB gp3 or more. Audio takes up to about 115 MB per lecture hour (16 kHz PCM16; ADPCM backlog is a quarter of that), unless `S3_BUCKET` is set.
- **Security group:** inbound 22 (your IP only), 80 and 443. Nothing else: PostgreSQL, Redis and the app ports listen on localhost only.
- **DNS:** an A record for your hostname pointing to the instance's Elastic IP. It must exist before setup so that Caddy can get a certificate.
- **IAM instance role** (no access keys on the server):
  - `bedrock:InvokeModel` on the LLM and embedding models (`ap-south-1`);
  - `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on the audio bucket, if used;
  - `s3:PutObject` on the backup prefix, if used.
- **Bedrock:** enable model access for your LLM and `cohere.embed-multilingual-v3` in the Bedrock console.

## First install

```bash
sudo apt-get update && sudo apt-get install -y git
git clone <repo-url> ~/smartclass && cd ~/smartclass
sudo SITE_ADDRESS=lecture.college.edu bash infra/ec2/setup.sh
sudoedit /etc/smartclass/backend.env        # set BEDROCK_LLM_MODEL_ID, optionally S3_BUCKET
sudo systemctl restart smartclass-api smartclass-gateway smartclass-asr smartclass-notes
```

Create the first administrator:

```bash
cd /opt/smartclass/backend
sudo -u smartclass bash -c 'set -a; . /etc/smartclass/backend.env; set +a; \
  .venv/bin/python -m tools.seed --admin-email you@college.edu'
```

Register each classroom recorder. Its token is printed once and only the hash is stored:

```bash
sudo -u smartclass bash -c 'set -a; . /etc/smartclass/backend.env; set +a; \
  .venv/bin/python -m tools.register_device --serial 24A160C3F1B8 \
  --name "Desk mic · Room 204" --room "Block A, Room 204" --lecturer priya@college.edu'
```

Write the printed `device_id` and `device_token` to the device's NVS, with the server URL `wss://lecture.college.edu/ws/device` (see `firmware/README.md`, D10).

## Updating

```bash
cd ~/smartclass && git pull
sudo bash infra/ec2/deploy.sh
```

The deploy script backs up the database before migrating. It then restarts the workers, the gateway and the API in that order, so that:
- devices reconnect and resend un-ACKed audio (nothing is lost; that is what the flash spill is for);
- browsers reconnect and replay from their last `seq`.

## Operations

| Task | Command |
|---|---|
| Status | `systemctl status 'smartclass-*'` |
| Logs (JSON) | `journalctl -u smartclass-asr -f` |
| Health | `curl -s https://<host>/api/health` → `{"status":"ok","database":true,"redis":true}` |
| Manual backup | `sudo systemctl start smartclass-backup` |
| Restore | `sudo -u postgres pg_restore --clean --if-exists -d smartclass /var/backups/smartclass/<file>.dump` |
| ASR backlog | `redis-cli SCARD asr:pending` (should stay near the number of live classrooms) |

### Backups

The timer writes `/var/backups/smartclass/smartclass-<UTC>.dump` nightly and keeps 14 days. To copy each dump off the instance too, create `/etc/smartclass/backup.env` with:

```
BACKUP_S3_URI=s3://your-backup-bucket/smartclass/
KEEP_DAYS=14
```

Audio is not in the database dump. Either set `S3_BUCKET` so audio lives in S3, with bucket versioning on, or snapshot the EBS volume with Amazon Data Lifecycle Manager.

Redis holds only transient state: job queues and live event history. After a Redis restart, browsers get `resync_required` and reload from PostgreSQL. On start, the ASR worker re-queues every lecture that is still `recording`, and the notes worker re-queues every lecture stuck in `processing`. After a Redis flush, run `sudo systemctl restart smartclass-asr smartclass-notes`.

### GPU (optional)

On a `g5`/`g6` instance, install the NVIDIA driver plus CUDA 12 and cuDNN 9, then set `ASR_DEVICE=cuda` and `ASR_COMPUTE_TYPE=float16` in `backend.env`. Do this only if the `eval/` benchmark shows the CPU can't keep up (D11).

## Troubleshooting

| Symptom | Check |
|---|---|
| Caddy has no certificate | DNS must point to this instance, and ports 80/443 must be open: `journalctl -u caddy` |
| Devices connect then drop with 4401 | The token is wrong, or the device was deactivated: see the gateway logs |
| Notes stay "failed" | `BEDROCK_LLM_MODEL_ID` is empty, model access is not enabled, or the instance role is missing `bedrock:InvokeModel` |
| PDF export returns 501 | The WeasyPrint libraries are missing: re-run `setup.sh`, which installs Pango/HarfBuzz and the Noto fonts |
| Live transcript lags further and further | The ASR CPU is saturated: use a smaller `ASR_MODEL`, a bigger instance, or a GPU |
