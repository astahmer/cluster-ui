# cluster-ui

A [Bull Board](https://github.com/taskforcesh/bullmq)-style dashboard for
**Effect v4 clusters** ([`@effect/cluster`](https://github.com/Effect-TS/effect)) —
runners, shards, entities, messages and durable workflows.

Reads the same SQL storage your cluster writes to (`SqlShardStorage` +
`SqlMessageStorage`: the `*_runners`, `*_shards`, `*_messages`, `*_replies`
tables) — no changes to your app needed. The UI is React + Tailwind with
[shadcn](https://ui.shadcn.com)-style components, styled with accents from
[kumo-ui](https://kumo-ui.com). The API server is Effect v4
(`effect/unstable/http` + `@effect/platform-node`).

## Quick start (demo)

```sh
pnpm install
pnpm seed        # creates ./data/cluster.db with realistic demo data
pnpm build       # typecheck + vite build -> dist/
pnpm start       # serves UI + API on http://localhost:8787
```

## Point it at a real cluster

The server needs read access to the storage used by the cluster's
`SqlShardStorage` / `SqlMessageStorage`. SQLite files and PostgreSQL URLs are
supported; PostgreSQL is useful when the cluster runs in the same database as
your application.

| Env var               | Default             | Meaning                                                                                            |
| --------------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| `CLUSTER_UI_DB`       | `./data/cluster.db` | path to the sqlite file                                                                            |
| `CLUSTER_UI_PREFIX`   | `cluster`           | table prefix used by the storages                                                                  |
| `CLUSTER_UI_CLUSTERS` | unset               | comma-separated `name=spec` registry; `spec` may be a SQLite path, `postgres://` URL, or Redis URL |
| `PORT`                | `8787`              | http port                                                                                          |
| `HOST`                | `0.0.0.0`           | bind address                                                                                       |
| `CLUSTER_UI_READONLY` | unset               | `1` enables read-only mode                                                                          |

PostgreSQL support uses the native client adapter and is read-only in the
dashboard: write actions are disabled for these profiles. The adapter tolerates
Effect Cluster database versions that do not have a persisted `cluster_shards`
table and reports shard assignments as empty in that case.

### TL;DR: start cluster-ui from any workspace

Build or install cluster-ui, then run it from the application workspace whose
relative data paths should be used:

```sh
cd ~/dev/my-app
CLUSTER_UI_READONLY=1 cluster-ui ./data/cluster.db
```

The command launches the prebuilt UI and API in one process. The process cwd is
`~/dev/my-app`, while the frontend assets come from the installed cluster-ui
package. The target can also be a PostgreSQL or Redis URL:

```sh
cluster-ui 'postgres://user:password@127.0.0.1:5438/db_dev'
cluster-ui 'redis://127.0.0.1:6379'
```

For advanced multi-cluster setups, omit the argument and set
`CLUSTER_UI_CLUSTERS` as documented above. Do not combine it with a positional
target. Use `CLUSTER_UI_TARGET` when an environment-only single target is more
convenient; it has the same value format as the positional argument.

## Development

```sh
pnpm dev:server   # API only, bundled server watch on :8787
pnpm dev:web      # vite dev server (proxies /api to :8787)
```

Docs: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (production deployment and
operations), [`docs/ROADMAP.md`](docs/ROADMAP.md) (feature roadmap),
[`docs/UX-REVIEW.md`](docs/UX-REVIEW.md) (UX audit #1, all items fixed),
[`docs/UX-AUDIT-2.md`](docs/UX-AUDIT-2.md) (fresh audit #2, 2026-08-26), and
[`docs/COMPETITIVE.md`](docs/COMPETITIVE.md) (competitor landscape + feature gaps).

### Local redis demo

Test the redis (BullMQ) cluster features without any external service:

```sh
pnpm dev:redis    # redis-server on :6399 (foreground)
pnpm seed:redis   # flush + seed ~70 demo jobs across 6 queues + one flow DAG
cp .env.example .env   # enables CLUSTER_UI_CLUSTERS with local-redis
pnpm dev:server   # picks up .env automatically
```

The dashboard then shows a `local-redis` cluster in the switcher with live
queues, states, failures and a parent/child job-flow DAG.

## What you get

- **Overview** — pending / in-flight / scheduled / done message counts, shard
  assignment health, busiest entity types and workflows.
- **Runners** — registered nodes (address, groups, version) with shard load.
- **Shards** — full distribution map plus per-shard assignment table;
  unassigned (rebalancing) shards are highlighted.
- **Entities** — message activity per entity type, including
  `Workflow/<name>` types which deep-link into workflow runs.
- **Workflows** — every durable execution: run status, input payload and an
  activity timeline derived from each activity's stored message + replies.
- **Messages** — searchable/filterable list with detail view showing raw
  payloads, headers and replies.

### Status semantics

Mirrors the cluster's own rules from `SqlMessageStorage`: a message is
**in-flight** for 5 minutes after being read, **scheduled** while
`deliver_at` is in the future, **done** once `processed`, otherwise
**pending**. Message ids are snowflakes, so creation timestamps are decoded
from the id itself.

## Verification

```sh
pnpm e2e          # API contract checks
pnpm smoke        # headless jsdom render test of the built frontend
pnpm e2e:browser   # existing focused Playwright browser sweep
pnpm e2e:bdd       # generate and run all Playwright BDD .feature scenarios
```

`pnpm e2e:bdd` builds an isolated SQLite database and ephemeral Redis instance,
starts the dashboard, runs the feature files under `tests/bdd/features/`, and
writes generated specs to the ignored `tests/bdd/.features-gen/` directory.
Install a Playwright Chromium browser if your machine does not already have
one cached.

## Notes

- `kumo-ui`'s published JS bundle embeds its own copy of React and crashes when
  mixed with ours, so we reuse only its stylesheet (aliased via
  `kumo-ui/styles.css`) and hand-roll shadcn-flavored components on Tailwind.
- The Effect v4 packages (`effect`, `@effect/platform-node`,
  `@effect/platform-node-shared`) are installed from npm's `rc` dist-tag —
  no linked monorepo checkout or `--experimental-transform-types` flag needed.
  Node 24 runs the `.ts` sources directly (native type stripping); `esbuild`
  bundles `server/src/main.ts` into `server/dist/main.cjs` for the packaged CLI.
