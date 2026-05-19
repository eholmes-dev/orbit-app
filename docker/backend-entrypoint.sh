#!/bin/sh
# Backend container entrypoint. Two jobs:
#   1. Apply any pending Prisma migrations (uses `migrate deploy`, the
#      production migrator — no schema-drift detection, no shadow DB).
#   2. Start the Node server.
#
# Prisma's `migrate deploy` is safe to run concurrently across containers —
# it uses an advisory lock so only one replica actually runs the SQL.

set -e

# Azure deploy path: Container Apps can pass Postgres parts as secrets but
# can't embed a Key Vault secret into a composed string env var. So if
# PG_PASSWORD + PG_HOST are set, we compose DATABASE_URL ourselves here.
# Docker Compose deploys set DATABASE_URL directly and this branch is a
# no-op.
if [ -n "$PG_PASSWORD" ] && [ -n "$PG_HOST" ]; then
  export DATABASE_URL="postgresql://${PG_USER:-orbit}:${PG_PASSWORD}@${PG_HOST}:5432/${PG_DATABASE:-orbit}?sslmode=require"
  echo "[orbit] composed DATABASE_URL from PG_* env (Azure deploy path)"
fi

echo "[orbit] applying database migrations..."
node scripts/prisma-shim.cjs migrate deploy

echo "[orbit] starting backend server on port ${BACKEND_PORT:-4000}..."
exec node dist/index.js
