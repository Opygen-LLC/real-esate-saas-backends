#!/bin/bash
set -euo pipefail

echo "🔄 Pulling latest backend updates from GitHub..."
OLD_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
git pull origin main
NEW_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# The API and backup images now share one Dockerfile build stage, so pnpm
# install + TypeScript compilation are cached once. In addition, the backup
# runtime is rebuilt only when inputs that can affect it changed, or when the
# backup image does not exist yet. This keeps routine API deployments fast.
BACKUP_NEEDS_BUILD=0
if ! docker compose images -q database-backup 2>/dev/null | grep -q .; then
  BACKUP_NEEDS_BUILD=1
elif [ -n "$OLD_HEAD" ] && [ -n "$NEW_HEAD" ] && [ "$OLD_HEAD" != "$NEW_HEAD" ]; then
  if git diff --name-only "$OLD_HEAD" "$NEW_HEAD" -- \
      Dockerfile package.json pnpm-lock.yaml tsconfig.json \
      src/app/module/backup src/shared/logger.ts src/shared/requestContext.ts \
      docker-compose.yml docker-compose.production.yml \
      | grep -q .; then
    BACKUP_NEEDS_BUILD=1
  fi
fi

# Local/uncommitted changes to backup inputs should also trigger a rebuild.
if git status --porcelain -- \
    Dockerfile package.json pnpm-lock.yaml tsconfig.json \
    src/app/module/backup src/shared/logger.ts src/shared/requestContext.ts \
    docker-compose.yml docker-compose.production.yml \
    | grep -q .; then
  BACKUP_NEEDS_BUILD=1
fi

echo "🏗️ Building API image..."
docker compose build api

if [ "$BACKUP_NEEDS_BUILD" -eq 1 ]; then
  echo "🗄️ Backup runtime changed or is missing; rebuilding database-backup image..."
  docker compose build database-backup
else
  echo "⚡ Reusing existing database-backup image (no backup-runtime inputs changed)."
fi

echo "🚀 Restarting production containers..."
docker compose up -d --no-build

echo "✅ Deployment update complete!"
docker compose ps
