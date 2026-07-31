#!/usr/bin/env bash
#
# Deploy to the production server.
#
#   ./deploy.sh                              # host taken from .deploy.env
#   SERVER=user@10.0.0.5 ./deploy.sh         # or passed explicitly
#
# Ships the working tree with rsync and rebuilds the containers. Three things are deliberately
# never touched: the server's `.env`, the database volume, and anything excluded below.
#
# The server address is read from `.deploy.env`, which is git-ignored, rather than written here.
# A deploy script that hardcodes an address publishes the layout of a private network to everyone
# who reads the repository, and that is not information a notes application needs to carry.
# See `.deploy.env.example`.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_DIR="${REMOTE_DIR:-notes_app}"
COMPOSE_FILE="docker-compose.prod.yml"

if [ -z "${SERVER:-}" ] && [ -f "$PROJECT_DIR/.deploy.env" ]; then
  # shellcheck source=/dev/null
  source "$PROJECT_DIR/.deploy.env"
fi

# Two addresses reach the same machine: a VPN one that works from anywhere and a LAN one that is
# faster at home. Whichever answers on port 22 first is the one used.
if [ -z "${SERVER:-}" ]; then
  for candidate in "${SERVER_PRIMARY:-}" "${SERVER_FALLBACK:-}"; do
    [ -z "$candidate" ] && continue
    host="${candidate#*@}"
    if nc -z -w3 "$host" 22 2>/dev/null; then
      SERVER="$candidate"
      break
    fi
  done
fi

if [ -z "${SERVER:-}" ]; then
  echo "❌ No server reachable."
  echo "   Set SERVER=user@host, or fill in .deploy.env (see .deploy.env.example)."
  echo "   If the host is behind a VPN, check that the VPN is connected."
  exit 1
fi

echo "🚀 Deploying notes-app → $SERVER:~/$REMOTE_DIR"

echo "→ [1/4] Uploading code..."
# --delete keeps the server from accumulating files that were renamed or removed locally; stale
# modules survive a rebuild and get imported. The excluded paths are not subject to it, so the
# server's .env and its node_modules are safe.
rsync -az --delete \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.deploy.env' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.vite' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.venv' \
  --exclude '.pytest_cache' \
  --exclude '.ruff_cache' \
  --exclude '.coverage' \
  --exclude 'htmlcov' \
  --exclude 'coverage' \
  --exclude '.claude' \
  --exclude '.DS_Store' \
  "$PROJECT_DIR/" "$SERVER:$REMOTE_DIR/"

echo "→ [2/4] Building images and restarting (1-3 min on a cold cache)..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose -f $COMPOSE_FILE up -d --build"

echo "→ [3/4] Waiting for the API to report healthy..."
# `up -d` returns when containers are started, not when migrations have finished. Reporting
# success before /healthz answers would mean a green deploy and a 502 in the browser.
ssh "$SERVER" "
  for i in \$(seq 1 30); do
    if curl -fsS http://localhost:8091/healthz >/dev/null 2>&1; then
      echo '  API is healthy'; exit 0
    fi
    sleep 2
  done
  echo '  ⚠️  API did not become healthy in 60s — check: docker compose -f $COMPOSE_FILE logs backend'
  exit 1
"

echo "→ [4/4] Status:"
ssh "$SERVER" "cd $REMOTE_DIR && docker compose -f $COMPOSE_FILE ps --format '  {{.Service}}: {{.State}} ({{.Status}})'"

echo ""
echo "✅ Done — https://notes.ssi-dev.com"
