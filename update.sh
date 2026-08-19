#!/bin/bash
set -e

echo "🔄 Pulling latest backend updates from GitHub..."
git pull origin main

echo "🏗️ Rebuilding & restarting Docker production containers..."
docker compose up -d --build

echo "✅ Deployment update complete!"
docker compose ps