# R3 — Test redis locally: demo seeder + flake + env wiring

Goal: `pnpm dev:redis` gives you a local redis on :6399 seeded with realistic BullMQ
data so the redis cluster features (queues, states, flows/DAG, actions) are fully
testable without any external service.

You own ONLY: NEW `scripts/demo-redis.mjs`, edits to `flake.nix`, NEW `.env.example`,
package.json script additions ("dev:redis", "seed:redis"), README.md short section.

1. flake.nix devShell packages: add `pkgs.redis`.
2. scripts/demo-redis.mjs (plain node, ioredis is already a dep):
   - connect redis://127.0.0.1:6399 (fail with a helpful message if down: "run pnpm dev:redis")
   - FLUSHDB, then seed ~6 queues (emails, payments, images, reports, notifications, webhooks)
     with jobs across states: wait (~20 total), active (3), completed (30+ spread over the
     last 48h timestamps), failed (8 with failedReason + stacktrace fields), delayed (5).
     Job hashes need BullMQ fields: name, data (JSON payload), timestamp, processedOn,
     finishedOn, attemptsMade, failedReason, returnvalue, parentKey where applicable.
     Maintain the bookkeeping structures EXACTLY like our redis-repo reads them:
       bull:<q>:wait (list), :active (list), :completed/:failed/:delayed (zsets score=timestamp),
       bull:<q>:id (set of ids), bull:<q>:paused marker only for one queue.
   - seed ONE parent/child flow: parent job in emails with 3 children in images via
     parentKey field on children + <parentKey>:children set on parent — so the DAG view
     has something real to show.
   - idempotent-ish: always flushes first. Print a summary at the end.
3. package.json scripts: "dev:redis": "redis-server --port 6399 --daemonize no" (foreground);
   "seed:redis": "node scripts/demo-redis.mjs".
4. .env.example: document CLUSTER_UI_CLUSTERS including the redis entry, e.g.
   ```
   # CLUSTER_UI_CLUSTERS=default=./data/cluster.db,local-redis=redis://127.0.0.1:6399
   ```
   Note in README (short "Local redis demo" section): run dev:redis, then start the server
   with CLUSTER_UI_CLUSTERS set (copy .env.example to .env — dev:server already loads
   --env-file-if-exists=.env).
5. Verify seeding works ONLY if a redis binary is available locally (`command -v redis-server`);
   otherwise just typecheck. npx tsc --noEmit --pretty false must stay clean (your files are .mjs
   so nothing to check — just don't break others').
