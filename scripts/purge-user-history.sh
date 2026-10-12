#!/usr/bin/env bash

set -euo pipefail

if [[ "${LUMIMATE_CONFIRM_PURGE_USER_HISTORY:-}" != "YES" ]]; then
  echo 'Refusing to purge. Set LUMIMATE_CONFIRM_PURGE_USER_HISTORY=YES after verifying the production target.' >&2
  exit 1
fi

COMPOSE_FILE="${LUMIMATE_COMPOSE_FILE:-docker-compose.production.yml}"

# Deliberately preserve AiModel, SkillPlugin and SkillPluginVersion. Every other
# record that belongs to a guest user is deleted through the User foreign-key tree.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U lumimate -d lumimate -v ON_ERROR_STOP=1 \
  -c 'TRUNCATE TABLE "User" CASCADE;'

# Only managed user media directories are removed; the mount point itself remains.
for directory in /opt/lumimate-media/images /opt/lumimate-media/videos /opt/lumimate-media/audio /opt/lumimate-media/uploads; do
  if [[ -d "$directory" ]]; then
    find "$directory" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  fi
done

echo 'User history and managed media have been purged. AI model and skill configuration were preserved.'
