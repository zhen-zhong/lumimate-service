#!/usr/bin/env bash

set -euo pipefail

DEPLOY_HOST="${LUMIMATE_DEPLOY_HOST:-ubuntu@82.156.142.135}"
DEPLOY_DIR="${LUMIMATE_DEPLOY_DIR:-/opt/lumimate-service}"
COMPOSE_FILE="docker-compose.production.yml"

command -v ssh >/dev/null || { echo '缺少 ssh'; exit 1; }

# Source of truth is GitHub. Production only fast-forwards its checked-out main branch.
# Server `.env` is ignored by Git and remains untouched.
ssh "${DEPLOY_HOST}" bash -s -- "${DEPLOY_DIR}" "${COMPOSE_FILE}" <<'REMOTE_SCRIPT'
set -euo pipefail

deploy_dir="$1"
compose_file="$2"

cd "$deploy_dir"

if [[ "$(git branch --show-current)" != 'main' ]]; then
  echo '服务器必须检出 main 分支才能部署'
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo '服务器工作区有未提交改动；拒绝覆盖。请先将服务器恢复为 GitHub main。'
  git status --short
  exit 1
fi

git fetch --prune origin main
git pull --ff-only origin main

docker compose -f "$compose_file" build api
docker compose -f "$compose_file" run --rm api npx prisma migrate deploy
docker compose -f "$compose_file" up -d api
docker compose -f "$compose_file" ps
REMOTE_SCRIPT
