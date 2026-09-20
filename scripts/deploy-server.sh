#!/usr/bin/env bash

set -euo pipefail

DEPLOY_HOST="${LUMIMATE_DEPLOY_HOST:-ubuntu@82.156.142.135}"
DEPLOY_DIR="${LUMIMATE_DEPLOY_DIR:-/opt/lumimate-service}"
COMPOSE_FILE="docker-compose.production.yml"

command -v rsync >/dev/null || { echo '缺少 rsync'; exit 1; }
command -v ssh >/dev/null || { echo '缺少 ssh'; exit 1; }

# Server `.env` holds production credentials. Never overwrite it from local.
rsync -az --delete \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '*.tsbuildinfo' \
  ./ "${DEPLOY_HOST}:${DEPLOY_DIR}/"

ssh "${DEPLOY_HOST}" "
  set -e
  cd '${DEPLOY_DIR}'
  docker compose -f '${COMPOSE_FILE}' build api
  docker compose -f '${COMPOSE_FILE}' run --rm api npx prisma migrate deploy
  docker compose -f '${COMPOSE_FILE}' up -d api
  docker compose -f '${COMPOSE_FILE}' ps
"
