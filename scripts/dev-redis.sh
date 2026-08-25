#!/usr/bin/env bash
# Start a local redis for the demo cluster; no-op if one is already listening.
set -euo pipefail
PORT=6399
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "redis already listening on :$PORT — reusing it (seed anytime with: pnpm seed:redis)"
  exit 0
fi

REDIS_BIN="$(command -v redis-server || true)"
if [ -z "$REDIS_BIN" ]; then
  # not on PATH — we're probably outside the direnv shell; borrow it from nix
  if command -v nix >/dev/null 2>&1; then
    echo "[dev-redis] redis-server not on PATH — using nix shell"
    REDIS_BIN="nix"
    REDIS_ARGS=(develop -c redis-server)
  else
    echo "redis-server not found — enter the nix shell (direnv reload) or install redis" >&2
    exit 1
  fi
fi

if [ "$REDIS_BIN" = "nix" ]; then
  echo "Starting redis on :$PORT (foreground; Ctrl-C stops it)"
  exec nix develop -c redis-server --port "$PORT" --daemonize no
fi
echo "Starting redis on :$PORT (foreground; Ctrl-C stops it)"
exec "$REDIS_BIN" --port "$PORT" --daemonize no
