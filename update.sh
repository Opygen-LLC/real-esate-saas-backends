#!/bin/bash
set -e

echo "🔄 Pulling latest backend updates from GitHub..."
git pull origin main

echo "🧹 Cleaning up dangling build cache & unused images..."
docker builder prune -f || true
docker image prune -f || true

echo "🏗️ Rebuilding & restarting Docker production containers..."
docker compose up -d --build


echo "✅ Deployment update complete!"
docker compose ps