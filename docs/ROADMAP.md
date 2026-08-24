# cluster-ui roadmap — competitive analysis & planned work

Last updated: 2026-08-25. Sources: product docs of Bull Board, Temporal UI, Asynqmon,
River UI, Sidekiq Web, Flower, Oban Web, Hangfire, Windmill/Trigger.dev/n8n +
features found across @astahmer's GitHub stars (4.9k, filtered for queue/job/task/
worker/cron/dashboard/monitor/workflow/durable/temporal).

## 1. Product comparison

| Product | Manages | Standout features | What it has that we don't |
|---|---|---|---|
| Bull Board (OSS) | Redis queues | per-state job tabs, retry/promote/clean, bulk clean, queue pause/resume, read-only mode | job add form, queue pause, bulk cleanup, job-flow DAG view |
| Temporal UI | durable workflows | event-history timeline, signal/query/update, terminate/cancel/reset/restart, schedule mgmt, history JSON download, batch ops | timeline viz, reset/restart, signals/queries, schedule editing, export |
| Asynqmon (OSS) | Redis tasks | state boards, run/archive/delete/kill/cancel, queue priorities+pause, Prometheus `/metrics`, scheduler entries | metrics endpoint, archived/kill states, queue pause |
| River UI (OSS) | Postgres jobs | clean job boards, cancel/retry/delete, queue paused-state, counts | closest peer — little we lack |
| Sidekiq Web (+cron) | Redis jobs | realtime processed/failed charts over days, queue latency, bulk retry/delete, morgue, live workers view | long-horizon charts, dead-set semantics, worker introspection |
| Flower (OSS) | Celery tasks | live worker panels, broker view, revoke/terminate, rate limits, Prometheus metrics, event stream | worker panels, metrics, rate limiting |
| Oban Web (paid) | Postgres jobs | realtime per-queue/node metric charts, pause/resume/escalate, sorted filtered search, action safety-checks | charts, queue controls, filtering polish |
| Hangfire Dashboard | .NET jobs | succeeded/failed historical graphs, retries, recurring-job editor, server list | historical graphs, recurring editor |
| Windmill / Trigger.dev / n8n | workflow platforms | run timelines w/ per-step durations, log viewers, replay-from-step, schedule calendars | step timelines, logs, replays |
| Uptime-Kuma | monitoring | alert notifications (Slack/Discord/ntfy…), status pages | failure alerting |

Where we're already ahead: multi-cluster registry, zero-instrumentation SQL
attachment, shard distribution map, snowflake age decoding, singleton fan-out
(nobody else models this), live/pause UX.

## 2. Gap decisions

| # | Feature | Decision |
|---|---|---|
| 1 | Bulk actions (multi-select retry/interrupt/delete) | **build now** |
| 2 | Delete/purge failed messages | **build now** |
| 3 | Prometheus `/metrics` endpoint | **build now** |
| 4 | Long-horizon metrics + time range (24h, failure-rate) | **build now** |
| 5 | Workflow run timeline (Gantt/waterfall w/ attempts) | **build now** — see §4 spec |
| 6 | Export/download (JSON/CSV of filtered rows) | **build now** |
| 7 | Command palette (⌘K) | **build now** |
| 8 | Filter chips + deep-linkable filters everywhere | **build now** |
| 9 | Failure alerting (webhook/ntfy/Slack) | deferred — needs server-side watcher; ntfy fits home-infra |
| 10 | OIDC login | deferred — pair with pocket-id; token auth covers today |
| 11 | Worker live panels/logs | deferred — reporter v2 (below) |

## 3. Reporter v2 (deferred)

Extend `@effect/cluster-ui-reporter` beyond `GET /internal/cluster-ui/state`:

```
GET /internal/cluster-ui/logs?entityType=&entityId=&since=   → recent log lines
GET /internal/cluster-ui/fibers                              → live fiber/supervisor state
WS  /internal/cluster-ui/stream                              → push updates
```

Dashboard side: fan-out already exists (`server/src/singletons.ts`); add a Logs
tab per runner and a "live fibers" drill-down. Requires users to mount the newer
reporter; everything degrades to today's behavior otherwise.

## 4. Timelines — Gantt/waterfall (reference screenshots in ~/Desktop/cluster-ui)

Both reference screenshots are span-waterfall views:
- `HQbUZWwX0AAJ3KL.jpeg` — OTel trace waterfall: rows = spans (invoke_agent → chat /
  execute_tool), duration bars on a shared time axis, header with status/duration/tokens.
- `HQclMcmXEAAASnW.jpeg` — phase-grouped Gantt: rows grouped into phases
  (Detection/Triage/Mitigation/Follow-up), each task a labeled bar.

Build two views on shared primitives:
1. **RunTimeline** in WorkflowRunDetail: rows = activities (from run message payloads,
   incl. attempt numbers), bars from created→last-event timestamps, grouped by
   entity/activity type; hover = exact times; failed attempts in danger tone.
2. **Traces page**: group messages by `trace_id`; list recent traces (count, span
   types, total duration, outcome); detail = waterfall ordered by snowflake-derived
   timestamps, colored by message kind/status; keep external trace-url link.

## 5. MCP + agent page (planned)

Goal: "ask what happened / make actions" directly against the cluster.

Design: ship a small MCP server (`cluster-ui-mcp`) exposing read tools backed by the
same repo layer as the API, plus write tools gated by CLUSTER_UI_READONLY:

```
tools: overview | query_messages(filters) | get_message(id) | get_workflow_run(...) |
       list_crons | list_singletons | retry_message(id) | interrupt_message(id) |
       delete_message(id) | reset_activity(id)
resources: cluster-ui://overview, cluster-ui://messages/{query}
prompts: "what happened in the last hour?", "why is X failing?"
```

UI side: an "Agent" page that talks to a model with these tools mounted (BYOK key,
same pattern as dadabase chat), streaming answers with tool-call cards that deep-link
into pages (#/messages?id=…). Server transport: streamable HTTP at `/mcp` so any MCP
client (Claude Desktop, opencode, pi) can attach without the built-in chat.

## 6. Redis integration (side bonus, planned)

Scope: make cluster-ui ALSO usable as a generic Redis queue dashboard, without
entangling it with the Effect-cluster storage path.

Design:
- Connection model: second connection kind `redis` in the cluster registry —
  `CLUSTER_UI_CLUSTERS="name=redis://host:6379"` alongside sqlite paths.
- Read path: scan queues via `KEYS bull:*:id`-style patterns (BullMQ conventions),
  map job hashes → the same Message shape we render today (state boards, payloads,
  attempts, failure reasons).
- Write path: reuse existing action buttons where semantics match (retry = re-enqueue,
  delete = remove), guarded by the same readonly flag.
- Metrics: sampler gains a redis series (queue depths, oldest-job age).
- Explicit non-goals v1: BullMQ Pro flows/parent-child DAG rendering, repeatable-job
  editor; show them read-only if encountered.
- Deps: `ioredis`; lazy-loaded module so non-redis installs don't pay for it.

## 7. Execution order

Wave A (this pass): items 2, 3, 1, 6, 7, 8, plus §4 timelines/traces and item 4.
Next pass candidates: §5 MCP, §6 Redis, then deferred 9/10/11.
