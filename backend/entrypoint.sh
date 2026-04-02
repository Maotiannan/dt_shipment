#!/bin/sh
set -eu

if [ -z "${ADMIN_PASSWORD:-}" ] && [ -z "${ADMIN_PASSWORD_HASH:-}" ]; then
  echo "ADMIN_PASSWORD or ADMIN_PASSWORD_HASH must be set" >&2
  exit 1
fi

node dist/scripts/initDb.js
exec node dist/server.js
