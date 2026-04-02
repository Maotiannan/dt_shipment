#!/bin/sh
set -eu

POSTGRES_HOST="${POSTGRES_HOST:-db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-dt_ship_manager}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-dt_shipment}"
BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-21600}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

wait_for_db() {
  until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    sleep 2
  done
}

prune_backups() {
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "${BACKUP_PREFIX}_*.dump" -mtime +"$BACKUP_KEEP_DAYS" -delete
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "${BACKUP_PREFIX}_globals_*.sql" -mtime +"$BACKUP_KEEP_DAYS" -delete
}

run_backup() {
  stamp="$(date '+%Y%m%dT%H%M%S')"
  backup_file="$BACKUP_DIR/${BACKUP_PREFIX}_${stamp}.dump"
  globals_file="$BACKUP_DIR/${BACKUP_PREFIX}_globals_${stamp}.sql"

  mkdir -p "$BACKUP_DIR"
  wait_for_db

  pg_dump \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    -d "$POSTGRES_DB" \
    --format=custom \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --file="$backup_file"

  pg_dumpall \
    -h "$POSTGRES_HOST" \
    -p "$POSTGRES_PORT" \
    -U "$POSTGRES_USER" \
    --globals-only >"$globals_file"

  prune_backups
  echo "backup completed: $backup_file"
}

if [ "${1:-}" = "--once" ]; then
  run_backup
  exit 0
fi

while true; do
  run_backup
  sleep "$BACKUP_INTERVAL_SECONDS"
done
