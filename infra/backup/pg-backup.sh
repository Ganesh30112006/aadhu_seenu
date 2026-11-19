#!/usr/bin/env bash
# Nightly PostgreSQL backup (installed as /usr/local/bin/smartclass-backup; run by
# smartclass-backup.timer as the postgres user).
#
# Writes a compressed custom-format dump to /var/backups/smartclass, keeps KEEP_DAYS days locally
# and, when BACKUP_S3_URI is set in /etc/smartclass/backup.env, copies the dump to S3 as well.
#
# Restore:  pg_restore --clean --if-exists -d smartclass /var/backups/smartclass/<file>.dump
set -euo pipefail

DB_NAME="${DB_NAME:-smartclass}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/smartclass}"
KEEP_DAYS="${KEEP_DAYS:-14}"
BACKUP_S3_URI="${BACKUP_S3_URI:-}"   # e.g. s3://my-backups/smartclass/

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="${BACKUP_DIR}/${DB_NAME}-${stamp}.dump"
tmp="${file}.partial"

umask 077
pg_dump --format=custom --compress=6 --no-owner --file="${tmp}" "${DB_NAME}"
pg_restore --list "${tmp}" >/dev/null   # fails if the archive is unreadable
mv "${tmp}" "${file}"
echo "backup written: ${file} ($(du -h "${file}" | cut -f1))"

if [[ -n "${BACKUP_S3_URI}" ]]; then
  aws s3 cp --only-show-errors "${file}" "${BACKUP_S3_URI%/}/$(basename "${file}")"
  echo "backup copied to ${BACKUP_S3_URI}"
fi

find "${BACKUP_DIR}" -name "${DB_NAME}-*.dump" -type f -mtime +"${KEEP_DAYS}" -delete
