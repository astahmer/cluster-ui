#!/usr/bin/env bash
# Run API server (:8787) and vite web (:5173) together; Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT INT TERM
if [ -f .env ]; then set -a; source .env; set +a; fi
pnpm dev:web &
WEB=$!
sleep 1
pnpm dev:server &
SRV=$!
wait "$SRV" "$WEB" 2>/dev/null || true
