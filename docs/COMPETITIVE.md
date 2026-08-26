# cluster-ui — Competitive landscape & feature gaps

Date: 2026-08-26 · OSS star counts **verified via GitHub API** on this date ("⭐ x, verified").
Non-OSS claims from product knowledge, confidence-tagged `[known]`/`[likely]`/`[uncertain]`.

## 1. Product summaries

- **cluster-ui (this project)** — self-hosted dashboard for an Effect-based TS job/workflow cluster:
  BullMQ-compatible queues (pause/clean/add-job), shard→runner topology, workflows with run detail +
  DAG + retry/cancel, crons, message-level inspect/retry/bulk ops, trace waterfalls, runner
  fibers/logs (Runtime tab), 8d metrics history, multi-cluster w/ cluster switcher, token auth,
  read-only mode, AI chat agent + MCP tools over every operation. SQLite or redis-backed.
- **Bull Board** (felixmosh/bull-board — ⭐ 3.5k, verified) — the standard OSS queue inspector for
  Bull/BullMQ: per-queue job lists by state, retry/clean/promote actions, repeatable-job view,
  format-agnostic adapters (Express/Fastify/Hono…). Queue-only; no workflows/traces/runtime.
- **Taskforce.sh / Bull Pro** — commercial SaaS+on-prem evolution of bull-board by the Bull authors:
  multi-queue dashboards, alerts, longer retention, team features [known]; pricing subscription
  [uncertain]. Closed core.
- **bull-monitor** (s-r-x/bull-monitor — ⭐ 129, verified) — minimal alternative Bull/BullMQ UI;
  queues/jobs/repeatables. Small community.
- **Celery Flower** (mher/flower — ⭐ 7.2k, verified) — Python/Celery real-time monitor: workers,
  task inspect, rate-limit controls, remote control (shutdown/revoke). The "classic" queue monitor.
- **Sidekiq Web** (sidekiq/sidekiq ⭐ 13.5k repo, verified) — Rails-integrated UI for Ruby's Sidekiq:
  queues, retries, scheduled, morgue; dead-retry UX is the industry benchmark. Pro/Sidekiq
  commercial add-ons [known].
- **Provectus Kafka UI** (⭐ 12.3k, verified; last push 2024-07 — effectively unmaintained) —
  brokers/topics/consumers management UI, message browse & produce.
- **Redpanda Console** (redpanda-data/console — ⭐ 4.3k, verified) — polished Kafka console:
  topics, schema registry, consumer-lag monitoring; free OSS core + enterprise tier [known].
- **Temporal UI** (temporalio/ui — ⭐ 429, verified; temporalio/temporal ⭐ 22.5k, verified) —
  workflow execution explorer: event history timeline, input/output payloads, stack traces of
  workflow tasks, schedule management, namespace auth. The deepest *workflow* debugger available.
- **Hatchet** (hatchet-dev/hatchet — ⭐ 7.8k, MIT, verified) — Postgres-backed task orchestration
  engine (queues, DAGs, cron, rate limits) with a built-in dashboard: runs, steps, retries, concurrency
  control, tenant/team model.
- **Trigger.dev** (triggerdotdev/trigger.dev — ⭐ 16.1k, Apache-2.0, verified) — TS workflow platform
  for AI agents: runs timeline, live-log streaming, replay from any step, wait/delay visualization,
  env/config management in UI.
- **Inngest** (inngest/inngest — ⭐ 5.8k, verified) — event-driven durable functions: flow-control
  (throttle/concurrency/rate), step-level function-run timelines, cloud + self-hosted dev server.
- **Windmill** (windmill-labs/windmill — ⭐ 17.7k, verified) — script/flow/workspace platform: visual
  flow editor, schedules, run logs, resource vault, granular RBAC, self-hostable.
- **Restate** (restatedev/restate — ⭐ 4.3k, verified) — durable-execution runtime; web observability
  console for invocations/journal/state [likely].
- **DBOS Transact** (dbos-inc/dbos-transact-ts — ⭐ 1.3k, MIT, verified) — Postgres durable workflows
  TS library; local console for workflow inspection [likely].
- **River** (riverqueue/river — ⭐ 5.6k, MPL-2.0, verified) — Go/Postgres job queue; ships a TUI and
  a web UI (river-ui) with job states/retries [known].
- **Jaeger** (jaegertracing/jaeger — ⭐ 23.1k, verified) / **Grafana Tempo** (⭐ 5.5k, verified) —
  distributed tracing backends; span waterfalls, service graphs, trace search. Jaeger UI is the
  reference waterfall UX.
- **SigNoz** (SigNoz/signoz — ⭐ 31.9k, verified) — OTel-native APM (traces/metrics/logs, dashboards,
  alerts) on ClickHouse.
- **.NET Aspire Dashboard** — local orchestrator dashboard with structured logs, distributed traces
  (OpenTelemetry native), metrics; developer-loop only, not a queue admin [known].

## 2. Feature comparison

Legend: ✅ full · ⚠️ partial · ❌ none · `*` uncertain cell.

| Product | Queue ctrl (pause/clean/add/promote) | Job inspect+retry+bulk | Cron visibility | Workflow/DAG viz | Trace waterfall | Runtime inspect (fibers/logs) | Sharding/topology | Metrics history | Multi-cluster | Auth/RBAC | AI chat / NL ops | MCP/API | Self-host embeddable |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **cluster-ui** | ✅ | ✅ bulk+per-msg | ✅ overdue facet | ✅ DAG + run modal | ✅ in-page | ✅ fibers+logs | ✅ map+legend | ✅ 8d, 7d range | ✅ switcher+URL | ⚠️ token+readonly* | ✅ BYOK chat | ✅ both | ✅ single binary+SPA |
| Bull Board | ✅ | ✅ per-job | ⚠️ repeatables list | ❌ | ❌ | ❌ | ❌ | ❌ counts only | ❌ one instance | ⚠️ DIY middleware | ❌ | ❌ (REST adapters) | ✅ mount anywhere |
| Taskforce.sh | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ⚠️ retention | ✅ | ✅ teams [likely] | ❌ | ⚠️ API [uncertain] | ⚠️ paid on-prem |
| Flower | ⚠️ no add-job | ✅ | ⚠️ scheduled | ❌ | ❌ | ⚠️ worker pool view | ❌ | ⚠️ basic charts | ❌ | ⚠️ basic auth | ❌ | ⚠️ REST API | ✅ |
| Sidekiq Web | ⚠️ quiet/drain | ✅ morgue/retry | ✅ | ❌ | ❌ | ⚠️ processes page | ❌ | ⚠️ history file* | ❌ per-process | ⚠️ via Rack middleware* | ❌ | ❌ | ✅ mounted in app |
| Temporal UI | ❌ read-mostly* | ⚠️ signal/cancel workflow | ✅ schedules | ✅✅ event-history gold standard | ⚠️ via activity spans* | ⚠️ worker/task-queue pages | ⚠️ namespace/queue topology | ⚠️ via Grafana | ✅ namespaces | ✅ SSO/RBAC [known] | ❌ | ✅ gRPC/HTTP API | ✅ |
| Hatchet | ✅ rate/concurrency | ✅ replays | ✅ cron+add-cron | ✅ DAG runs | ⚠️ span-ish step view* | ⚠️ worker page | ❌ | ✅ dashboards | ✅ tenants | ✅ teams/RBAC | ❌ | ✅ API+SDK | ✅ |
| Trigger.dev | n/a managed runs | ✅ replay-from-step | ✅ | ✅ runs graph | ⚠️ live logs | ⚠️ run logs | ❌ | ⚠️ usage charts | ✅ env/projects | ✅ teams [known] | ❌ | ✅ API/SDK | ⚠️ OSS self-host heavier |
| Inngest | ⚠️ flow-control config | ✅ step inspect | ✅ | ✅ function runs | ⚠️ step logs | ❌ | ❌ | ✅ metrics | ✅ apps/envs | ✅ [known] | ⚠️ AI-assist [likely] | ✅ API | ✅ dev server |
| Windmill | ✅ suspend/resume | ✅ run history | ✅ schedules | ✅✅ visual editor | ⚠️ step logs | ⚠️ worker queue view | ⚠️ workers/runtimes page | ✅ | ✅ workspaces/folders | ✅✅ granular RBAC | ❌ | ✅ API+CLI | ✅ |
| SigNoz | ❌ | ❌ | ❌ | ❌ | ✅ | ⚠️ logs | ❌ | ✅✅ | ✅ | ✅ [known] | ⚠️ NL query [likely] | ✅ OTel | ✅ |
| Jaeger/Tempo | ❌ | ❌ | ❌ | ⚠️ DAG service graph | ✅✅ | ❌ | ⚠️ system architecture | ⚠️ via Grafana | ✅ | ⚠️ via Grafana | ❌ | ✅ OTel/Jaeger proto | ✅ |

`*` = best-effort knowledge, verify before relying on it.

**Where cluster-ui is already ahead of its class:** the combination of (a) write-enabled queue
controls + message bulk ops, (b) true runtime inspection (runner fibers + live logs), (c) shard
topology map, (d) first-party AI chat + MCP over all mutations, (e) one embeddable artifact with
SQLite storage. No surveyed product has more than two of those five.

## 3. Gap analysis — what they have that we don't (ranked value ÷ effort)

1. **Per-queue job browser** (Bull Board/Sidekiq core UX). We show aggregate counts but can't list
   individual delayed/completed jobs of a queue, inspect one, or promote it. Server already speaks
   Bull key-space (`promote`, `clean`) — add `/api/queues/:name/jobs?state=` + job drawer reusing
   message-detail patterns. **Highest value ÷ effort.**
2. **Replay-from-step / attempt diffing** (Trigger.dev). Our workflow runs show attempts; add
   side-by-side attempt payload diff + "retry from activity N" (server has resetActivity already).
3. **Event-history timeline for workflow runs** (Temporal UI gold standard): vertical ledger of every
   transition (scheduled → started → activity N done → retrying…) with payload expanders. Our data
   model already stores activities; render them as a timeline beside the DAG.
4. **Saved views / saved queries** (logchef, SigNoz): persist named filter sets ("failed cart
   messages last hour") in localStorage/server; palette + sidebar access.
5. **Alerting / notification rules** (SigNoz, Taskforce): threshold rules (failed>0 for 5m, queue
   depth>X) → webhook/shoutrrr-style sink. Medium effort, big ops value.
6. **Live-tail push for traces/runs** (livetrace pattern from user's stars): SSE channel that appends
   finished spans to an open waterfall instead of poll-refresh.
7. **Time-brush linking**: drag a window on Overview charts → filters Messages/Traces to that window
   (logchef pattern).
8. **RBAC-lite / teams**: token roles beyond readonly (operator vs admin), audit log of who ran what
   (Temporal/Windmill have full RBAC — don't copy; just roles + audit trail).
9. **Consumer-lag style health scores** (Kafka consoles): per-queue "health" derived from
   waiting-age + failed-rate trend, surfaced as chips in nav/overview.
10. **Generative-UI widgets in chat** (mcp-ui / openui standards from stars): assistant answers
    render as mini-cards (queue sparkline + retry button) instead of JSON.

**What NOT to copy**
- **Full RBAC/teams/multi-tenancy** (Windmill/Temporal): cluster-ui is a single-operator ops tool;
  roles-lite covers the real need without the identity surface area.
- **Visual workflow editor** (Windmill/Trigger): definitions belong to code (@effect/cluster); a
  second editor would fork truth.
- **Managed-cloud control plane** (Trigger/Inngest): against the project's one-binary self-host ethos.
- **OTel-everything ingestion** (SigNoz): our tracing is purpose-built around snowflake/message
  semantics; generic APM scope creep would dilute it.
- **Plugin marketplaces** (Grafana-style): maintenance trap at this size.

## 4. From your own stars (600 repos scanned)

Closest product-space neighbors are agent-session dashboards (opensync, openchamber, paseo, herdr),
not job dashboards. Most borrowable ideas found there:

- **livetrace** (Effect span → React push) — see gap #6.
- **dozzle** — follow-mode log tail with scroll-disengage + "jump to bottom" pill for the Runtime tab.
- **dockhand** — status-chip taxonomy (dot+word, never color alone) and toast-with-undo instead of
  confirm modals for reversible bulk ops.
- **assistant-ui / mcp-ui / openui** — typed message-parts + served widget resources for the chat
  panel (gap #10).
- **logchef** — time-brush linking + saved queries (gaps #4/#7).
- **apple/embedding-atlas** — cross-filter exploration pattern if an entity explorer ever lands.
- Effect-ecosystem repos (effect-mq, effect-encore, effect-machine) suggest native vocabulary:
  present runners as actors with mailbox depths, and render intended-vs-actual statecharts when a
  workflow declares one.

## Sources
GitHub REST API v3 (repos + search endpoints), queried 2026-08-26 · starred dump
`api.github.com/users/astahmer/starred` (600 entries) · non-OSS details from product knowledge,
confidence-marked inline.
