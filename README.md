# cluster-ui

A [Bull Board](https://github.com/taskforcesh/bullmq)-style dashboard for
**Effect v4 clusters** ([`@effect/cluster`](https://github.com/Effect-TS/effect)) —
runners, shards, entities, messages and durable workflows.

Reads the same SQL storage your cluster writes to (`SqlShardStorage` +
`SqlMessageStorage`: the `*_runners`, `*_shards`, `*_messages`, `*_replies`
tables) — no changes to your app needed. The UI is React + Tailwind with
[shadcn](https://ui.shadcn.com)-style components, styled with accents from
[kumo-ui](https://kumo-ui.com). The API server is Effect v4
(`@effect/platform` + `@effect/platform-node`).

## Quick start (demo)

```sh
pnpm install
pnpm seed        # creates ./data/cluster.db with realistic demo data
pnpm build       # typecheck + vite build -> dist/
pnpm start       # serves UI + API on http://localhost:8787
```

## Point it at a real cluster

The server needs read access to the SQLite database used by the cluster's
`SqlShardStorage` / `SqlMessageStorage`.

| Env var               | Default              | Meaning                                   |
| --------------------- | -------------------- | ----------------------------------------- |
| `CLUSTER_UI_DB`       | `./data/cluster.db`  | path to the sqlite file                   |
| `CLUSTER_UI_PREFIX`   | `cluster`            | table prefix used by the storages         |
| `PORT`                | `8787`               | http port                                 |
| `HOST`                | `0.0.0.0`            | bind address                              |
| `CLUSTER_UI_READONLY` | unset                | `1` opens sqlite in read-only mode        |

> Postgres support: the schema is identical across dialects; adding
> `@effect/sql-pg`-backed queries is straightforward follow-up work.

## Development

```sh
pnpm dev:server   # API only, node --watch on :8787 (native TS, no tsx)
pnpm dev:web      # vite dev server (proxies /api to :8787)
```

Docs: [`docs/ROADMAP.md`](docs/ROADMAP.md) (feature roadmap),
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
pnpm e2e     # boots the API router and exercises every endpoint
pnpm smoke   # headless jsdom render test of the built frontend
```

## Notes

- `kumo-ui`'s published JS bundle embeds its own copy of React and crashes when
  mixed with ours, so we reuse only its stylesheet (aliased via
  `kumo-ui/styles.css`) and hand-roll shadcn-flavored components on Tailwind.
- The effect v4 packages are linked from a local checkout of the monorepo
  (`link:../effect/packages/...`). That checkout needs its workspace deps
  installed once (`pnpm install` inside it) because its sources import bare
  specifiers at runtime.
