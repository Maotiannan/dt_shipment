#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${DT_SHIPMENT_DB_BACKUP_CONTAINER:-dt-shipment-db-backup}"

if ! docker ps --format '{{.Names}}' | grep -Fx "$CONTAINER_NAME" >/dev/null; then
  echo "[ERROR] Backup container is not running: $CONTAINER_NAME" >&2
  exit 1
fi

docker exec "$CONTAINER_NAME" /usr/local/bin/pg-backup-loop.sh --once
