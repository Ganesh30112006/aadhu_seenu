#!/usr/bin/env bash
# One-time server setup for Ubuntu 24.04 LTS on EC2 (no Docker, decision D12).
#
# Usage (as root, from a checkout of this repository):
#   sudo SITE_ADDRESS=lecture.college.edu bash infra/ec2/setup.sh
#
# Installs PostgreSQL 16 + pgvector, Redis, Caddy, Python venv, WeasyPrint system libraries,
# Noto fonts and Node.js 22; creates the `smartclass` service user, directories, database and
# role; installs systemd units, the Caddyfile and the nightly backup timer. Safe to re-run.
set -euo pipefail

SITE_ADDRESS="${SITE_ADDRESS:?set SITE_ADDRESS to the public hostname, e.g. lecture.college.edu}"
APP_USER=smartclass
APP_DIR=/opt/smartclass
ETC_DIR=/etc/smartclass
DATA_DIR=/var/lib/smartclass
WEB_DIR=/var/www/smartclass
BACKUP_DIR=/var/backups/smartclass
DB_NAME=smartclass
DB_USER=smartclass
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi
. /etc/os-release
if [[ "${ID}" != "ubuntu" || "${VERSION_ID}" != "24.04" ]]; then
  echo "Warning: tested on Ubuntu 24.04, found ${PRETTY_NAME}." >&2
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> System packages"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git rsync jq unzip \
  python3 python3-venv python3-dev build-essential \
  postgresql-16 postgresql-contrib-16 postgresql-16-pgvector \
  redis-server \
  libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libharfbuzz-subset0 libffi8 \
  fonts-noto-core fonts-noto-ui-core \
  debian-keyring debian-archive-keyring apt-transport-https

echo "==> Caddy (official apt repository)"
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Node.js 22 (NodeSource apt repository, for building the frontend)"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/nodesource.gpg
  echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

echo "==> AWS CLI v2 (backups to S3; optional)"
if ! command -v aws >/dev/null; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "${tmp}/awscliv2.zip"
  unzip -q "${tmp}/awscliv2.zip" -d "${tmp}"
  "${tmp}/aws/install"
  rm -rf "${tmp}"
fi

echo "==> Service user and directories"
id -u "${APP_USER}" >/dev/null 2>&1 || useradd --system --home "${DATA_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0750 "${DATA_DIR}" "${DATA_DIR}/audio" "${DATA_DIR}/models"
install -d -o root -g "${APP_USER}" -m 0750 "${ETC_DIR}"
install -d -o root -g root -m 0755 "${WEB_DIR}"
install -d -o postgres -g postgres -m 0750 "${BACKUP_DIR}"

echo "==> Application code in ${APP_DIR}"
if [[ "${REPO_DIR}" != "${APP_DIR}" ]]; then
  rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude '.venv' --exclude '__pycache__' \
    --exclude 'frontend/dist' --exclude 'backend/data' --exclude 'backend/.env' \
    "${REPO_DIR}/" "${APP_DIR}/"
fi
chown -R root:"${APP_USER}" "${APP_DIR}"
chmod -R g+rX,o-rwx "${APP_DIR}"

echo "==> PostgreSQL role and database"
systemctl enable --now postgresql
if [[ ! -f "${ETC_DIR}/db-password" ]]; then
  umask 077
  openssl rand -hex 24 > "${ETC_DIR}/db-password"
  chown root:root "${ETC_DIR}/db-password"
fi
DB_PASSWORD="$(cat "${ETC_DIR}/db-password")"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
# Extensions need superuser; the initial migration's CREATE EXTENSION IF NOT EXISTS is then a no-op.
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${DB_NAME}" \
  -c "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"

echo "==> Redis (localhost only, no persistence needed beyond defaults)"
sed -i 's/^#\?\s*bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
sed -i 's/^#\?\s*supervised .*/supervised systemd/' /etc/redis/redis.conf
systemctl enable redis-server
systemctl restart redis-server

echo "==> Environment file ${ETC_DIR}/backend.env"
if [[ ! -f "${ETC_DIR}/backend.env" ]]; then
  sed -e "s#__DB_PASSWORD__#${DB_PASSWORD}#" -e "s#__SITE_ADDRESS__#${SITE_ADDRESS}#" \
    "${APP_DIR}/infra/env/backend.env.example" > "${ETC_DIR}/backend.env"
  chown root:"${APP_USER}" "${ETC_DIR}/backend.env"
  chmod 0640 "${ETC_DIR}/backend.env"
  echo "    Created. Edit it now: set BEDROCK_LLM_MODEL_ID (and S3_BUCKET if used)."
else
  echo "    Exists; left unchanged."
fi

echo "==> Python virtual environment and migrations"
python3 -m venv "${APP_DIR}/backend/.venv"
"${APP_DIR}/backend/.venv/bin/pip" install --quiet --upgrade pip
"${APP_DIR}/backend/.venv/bin/pip" install --quiet -e "${APP_DIR}/backend[asr,pdf]"
chown -R root:"${APP_USER}" "${APP_DIR}/backend/.venv"
(
  cd "${APP_DIR}/backend"
  set -a; . "${ETC_DIR}/backend.env"; set +a
  sudo -E -u "${APP_USER}" "${APP_DIR}/backend/.venv/bin/alembic" upgrade head
)

echo "==> Frontend build"
(
  cd "${APP_DIR}/frontend"
  HUSKY=0 npm ci --no-audit --no-fund
  npm run build
  rsync -a --delete dist/ "${WEB_DIR}/"
)

echo "==> systemd units"
install -m 0644 "${APP_DIR}"/infra/systemd/*.service "${APP_DIR}"/infra/systemd/*.timer /etc/systemd/system/
install -m 0755 "${APP_DIR}/infra/backup/pg-backup.sh" /usr/local/bin/smartclass-backup
systemctl daemon-reload
systemctl enable --now smartclass-api smartclass-gateway smartclass-asr smartclass-notes
systemctl enable --now smartclass-backup.timer

echo "==> Caddy"
sed "s#__SITE_ADDRESS__#${SITE_ADDRESS}#g" "${APP_DIR}/infra/caddy/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall (ufw): SSH, HTTP, HTTPS only"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

cat <<EOF

Done. Next steps:
  1. Edit ${ETC_DIR}/backend.env (BEDROCK_LLM_MODEL_ID, S3_BUCKET), then:
       sudo systemctl restart smartclass-api smartclass-gateway smartclass-asr smartclass-notes
  2. Create the first admin:
       cd ${APP_DIR}/backend && sudo -u ${APP_USER} bash -c \\
         'set -a; . ${ETC_DIR}/backend.env; set +a; .venv/bin/python -m tools.seed --admin-email you@college.edu'
  3. Register each recorder (prints its device_id and token once):
       .venv/bin/python -m tools.register_device --serial <MAC> --name "..." --room "..." --lecturer <email>
     (run it the same way as step 2; see infra/README.md)
  4. Check: curl -fsS https://${SITE_ADDRESS}/api/health
EOF
