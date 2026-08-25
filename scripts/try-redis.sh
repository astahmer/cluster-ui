#!/usr/bin/env bash
# One-command local redis UI demo:
#   redis (:6399) -> demo seed -> API server (:8787, sqlite + local-redis clusters)
#   + vite web (:5173). Ctrl-C stops everything.
set -uo pipefail
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT INT TERM

if [ -f .env ]; then set -a; source .env; set +a; fi

# make sure the sqlite cluster has data too
[ -f data/cluster.db ] || { echo "[stack] seeding sqlite demo db…"; pnpm seed >/dev/null 2>&1; }

# 1) redis on :6399 (background; dev-redis.sh is idempotent)
echo "[stack] starting redis on :6399…"
pnpm dev:redis &
REDIS_PID=$!

# wait for readiness
for i in $(seq 1 60); do
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -p 6399 ping 2>/dev/null | grep -q PONG && break
  else
    node -e "
import('ioredis').then(({default: Redis}) => {
  const r = new Redis('redis://127.0.0.1:6399', { lazyConnect: true })
  r.connect().then(() => { r.disconnect(); process.exit(0) }).catch(() => process.exit(1))
})" 2>/dev/null && break
  fi
  sleep 0.25
done

# 2) demo BullMQ data
echo "[stack] seeding demo redis data…"
pnpm seed:redis || echo "[stack] seed failed — continuing anyway"

# 3) clusters: respect .env's CLUSTER_UI_CLUSTERS if the user set one,
#    otherwise include both the sqlite db and the local redis
if [ -z "${CLUSTER_UI_CLUSTERS:-}" ] && [ -z "${CLUSTER_UI_DB:-}" ]; then
  export CLUSTER_UI_CLUSTERS="default=./data/cluster.db,local-redis=redis://127.0.0.1:6399"
fi

# 4) web + api together
echo "[stack] starting web (:5173) + api (:8787) — open http://localhost:5173 and pick 'local-redis' in the switcher"
pnpm dev
