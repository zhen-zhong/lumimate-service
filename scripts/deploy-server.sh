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
# The image tag remains `lumimate-api:latest`; force recreation so a rebuilt
# image always replaces an already-running API container.
docker compose -f "$compose_file" up -d --force-recreate api
docker compose -f "$compose_file" ps
docker compose -f "$compose_file" exec -T api npx prisma migrate status

# A running container can still contain stale code or an application that has
# not finished booting. Health verifies dependencies; the protected route check
# verifies that the deployed API actually registered the current chat routes.
for attempt in $(seq 1 30); do
  health="$(docker compose -f "$compose_file" exec -T api wget -qO- http://127.0.0.1:3000/v1/health 2>/dev/null || true)"
  route_headers="$(docker compose -f "$compose_file" exec -T api sh -lc 'wget -qSO- -O /dev/null http://127.0.0.1:3000/v1/chats/deploy-smoke/presence 2>&1' || true)"
  if [[ "$health" == *'"ok":true'* ]] && grep -Eq 'HTTP/[0-9.]+ 401' <<<"$route_headers"; then
    echo '部署自检通过：health 与 presence 路由正常。'
    exit 0
  fi
  sleep 1
done

echo '部署自检失败：API 未就绪或 presence 路由未注册。' >&2
docker compose -f "$compose_file" logs --tail=200 api >&2
exit 1
REMOTE_SCRIPT
