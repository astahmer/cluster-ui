#!/usr/bin/env bash
# Start a local redis for the demo cluster; no-op if one is already listening.
set -euo pipefail
PORT=6399
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "redis already listening on :$PORT — reusing it (seed anytime with: pnpm seed:redis)"
  exit 0
fi
if ! command -v redis-server >/dev/null 2>&1; then
  echo "redis-server not found — enter the nix shell (direnv reload) or install redis" >&2
  exit 1
fi
exec redis-server --port "$PORT" --daemonize no
