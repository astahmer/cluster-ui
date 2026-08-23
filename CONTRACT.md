# cluster-ui v2 — implementation contract

All agents MUST follow this contract exactly. Integration is verified afterwards;
deviations break the build.

## Ground rules

- Repo root: `/Users/astahmer/dev/cluster-ui`. Do NOT touch files outside it
  (especially NOT ~/dev/effect).
- Server: TypeScript run by tsx, Effect v4 from linked monorepo. Import effect
  packages like `"effect"`, `"@effect/platform"`, subpaths like
  `"@effect/platform-node/NodeHttpServer"`.
- **Effect v4 gotchas (already battle-tested in this repo):**
  - Serve layers pipe-style: `router.pipe(HttpServer.serve(), Layer.provide(serverLive))`.
    NEVER `HttpServer.serve(router)`.
  - `HttpRouter.params` = PATH params ONLY. Query params come from
    `HttpServerRequest.HttpServerRequest` → `new URL(req.url, "http://x").searchParams`
    (see existing `req` helper in server/src/api.ts — reuse it).
  - Handlers must return plain `HttpServerResponse` values (use `unsafeJson`),
    NOT `HttpServerResponse.json(...)` (returns an Effect) unless wrapped.
  - SQLite ONLY. Always `CAST(id AS TEXT)` when selecting bigint ids.
  - Reply kinds in `_replies.kind`: `0 = WithExit`, `NULL = Chunk`.
  - Message kinds: 0=request, 1=AckChunk, 2=Interrupt.
  - Status rules: done = processed=1; scheduled = deliver_at > now; inflight =
    last_read within 5 min (sqlite CURRENT_TIMESTAMP strings, UTC,
    "YYYY-MM-DD HH:MM:SS"); else pending.
- Web: React 19 + Tailwind v4 + hand-rolled shadcn-style components in
  `web/src/components/ui.tsx` (+ `pieces.tsx`). NO new chart libraries — charts
  are inline SVG sparklines. kumo-ui is CSS-only (never import its JS).
- Imports inside this repo use explicit `.ts`/`.tsx` extensions.
- After changes: server must pass `pnpm typecheck` (errors under ../effect are
  pre-existing upstream noise, ignore those) and web must pass `npx vite build`.

## New/changed REST API

All JSON responses `{ cache-control: no-store }`. Unless stated otherwise every
endpoint accepts `?cluster=<name>` and honors it (multi-cluster).

### Existing (extended)

- `GET /api/overview` → adds `messages.failed: number` and
  `unassignedShards: number` (= total - assigned).
- `GET /api/messages` → query params extended:
  - existing: `status` (pending|inflight|scheduled|done), `entityType`, `q`,
    `page`, `pageSize`
  - new: `entityId` (exact), `failed` ("true"/"false"), `createdAfter`,
    `createdBefore` (epoch millis), `sort` ("id" default | "deliverAt")
  - each row gains `failed: boolean` (true iff a WithExit reply exists whose
    `payload.exit._tag === "Failure"`; compute with
    `json_extract(r.payload,'$.exit._tag')='Failure'` EXISTS subquery — sqlite ok)
- `GET /api/messages/:id` → unchanged shape; detail view also derives
  `result`: if any WithExit reply, `{ outcome: "Success" | "Failure", value }`
  (parsed from reply payload `{ _tag, value|defect|cause }` — expose raw exit
  object as `exit`).
- `GET /api/runners` → each row gains `stale: boolean` (= shards === 0).
- `GET /api/workflows` → rows gain `failedRuns: number` (runs whose run-message
  has a Failure WithExit reply).

### New

- `GET /api/config` →
  `{ clusters: string[], tracingUrlTemplate: string | null }`
  where tracingUrlTemplate comes from env `CLUSTER_UI_TRACE_URL` containing the
  literal `{traceId}` (e.g. `http://jaeger.local/trace/{traceId}`), null if unset.
- `GET /api/clusters` → `[{ name: string }]` (active cluster list).
- `GET /api/entity-instances?entityType=X&q=&page=&pageSize=` →
  `{ rows: [{ entityId, total, pending, inflight, scheduled, done, failed, lastActivityAt }], total, page, pageSize }`
- `GET /api/crons` →
  `[{ name, entityType, lastRunAt: number|null, nextRunAt: number|null, lastStatus }]`
  derived from messages where `entity_type LIKE 'ClusterCron/%'`;
  entityId is "" for cron entities; lastRunAt = MAX(created_at decoded);
  nextRunAt = MIN(deliver_at) over unprocessed rows; lastStatus from newest row.
- `GET /api/metrics/history` →
  `[{ t: number, pending, inflight, scheduled, done, failed, unassignedShards }]`
  oldest-first ring buffer (target: ~10s resolution, ≥60min retained).
- `POST /api/actions/retry` body `{ messageId, cluster? }` → retries a message:
  `UPDATE {p}_messages SET processed=0, last_read=NULL WHERE id=?` AND delete
  WithExit replies for it (`DELETE FROM {p}_replies WHERE request_id=? AND kind=0`)
  so the entity re-executes. Returns `{ ok: true }` or 400 with `{ error }`.
- `POST /api/actions/interrupt` body `{ messageId }` → inserts an Interrupt
  envelope row (kind=2) referencing the target request: copy shard_id,
  entity_type, entity_id from target; `message_id=NULL`, `tag=NULL`,
  `payload=NULL`, `headers=NULL`, `request_id=<target numeric id>`,
  `processed=1`, fresh snowflake id (epoch Date.UTC(2025,0,1),
  `(ms-epoch)<<22n | machine<<12n | seq`). Returns `{ ok: true }`.
- `POST /api/actions/reset-activity` body `{ messageId }` → identical to retry
  (same SQL) but ALSO deletes Chunk replies (`kind IS NULL`). Used for workflow
  activity attempts.
- ALL `/api/actions/*` must return HTTP 403 `{ error: "read-only mode" }` when
  `CLUSTER_UI_READONLY=1`.
- Auth (only active when env `CLUSTER_UI_TOKEN` is set):
  - `POST /api/auth` body `{ token }` → sets HttpOnly cookie `cluster_ui_token`,
    returns `{ ok: true }` or 401.
  - Every other `/api/*` route requires either that cookie or
    `Authorization: Bearer <token>` header → else 401 `{ error: "unauthorized" }`.
  - `/healthz`, static assets, and `/` are always exempt.
- `GET /api/events` → SSE stream (`content-type: text/event-stream`), emits
  `event: overview\ndata: <overview JSON>\n\n` every ~5s, plus an initial event
  immediately. Must not leak connections: close cleanly on abort (use
  `HttpServerRequest` + `HttpServerResponse.stream` over a Stream that ends when
  the request scope closes).

## Web contract

- `web/src/api.ts` is rewritten to cover the whole surface above, including
  auth (fetch wrapper reads token from `localStorage.cluster_ui_token`, adds
  `Authorization` header; on 401 dispatches a global `auth:required` CustomEvent)
  and cluster selection (remembers selected cluster in localStorage).
- `web/src/shell.tsx`: top bar in addition to sidebar with (a) cluster switcher
  `<Select>` shown when >1 cluster, (b) LIVE/PAUSED pill toggling the shared
  refresh bus, (c) light/dark toggle (swap CSS variables on `documentElement` —
  define a `[data-theme="light"]` block in styles.css), (d) keyboard shortcuts:
  `1..6` switch sections, `/` focuses the page search input if present
  (mark it with `data-search-input`), `Esc` closes detail panels.
  Polling moves to a tiny pub/sub in shell (or `web/src/live.ts`): SSE via
  EventSource on `/api/events` drives overview refreshes; pages without SSE
  coverage keep interval polling; PAUSED stops both.
- Pages:
  - **Messages**: status tabs (all/pending/inflight/scheduled/done/failed),
    entityId filter box, created-after/before datetime-local inputs, page-size
    select, sort-by-deliverAt option for scheduled. Rows: failure icon for
    failed, countdown cell for scheduled ("in 4m"), trace-link icon when
    tracingUrlTemplate configured. Detail panel: result banner
    (Success green / Failure red with exit payload), Retry button (when not
    pending/inflight), Interrupt button (when pending/inflight/scheduled),
    copy-json + download-json buttons. Confirm destructive actions via
    `window.confirm`.
  - **Entities**: type rows link to `#/entities/<encoded type>`; new page lists
    instances (entityId, counts, last activity) linking to
    `#/messages?entityType=..&entityId=..` (App must pre-seed MessagesPage
    filters from query-string-style hash params).
  - **Workflows**: list cards gain failedRuns badge; runs table gains status +
    failed tinting; WorkflowRunDetail gains outcome banner (from run result) and
    Retry-run / Cancel buttons calling actions endpoints.
  - **Overview**: four status cards + new Failed card; sparkline strip (SVG
    polyline, ~120px tall) fed by /api/metrics/history for pending, inflight,
    failed, unassignedShards; red banner when unassignedShards > 0.
  - **Runners**: `STALE` badge (tone warn) when stale, plus legend hint.
  - **Crons** (`#/crons`, new nav entry): table name / last run (relTime) /
    next run countdown / lastStatus badge.
- `seed.ts` additions: ≥2 failed messages (WithExit Failure replies), 2 cron
  jobs (`ClusterCron/NightlyCleanup`, `ClusterCron/HourlySync`) with past
  processed runs + future deliver_at rows, one stale runner (no shards).

## File ownership (do not touch others' files)

- **S1 server-data**: `server/src/queries.ts`, `server/src/actions.ts` (new),
  `server/src/seed.ts`, and the NON-auth/SSE/metrics routes in
  `server/src/api.ts` + `server/src/config.ts` (clusters list, trace template).
- **W1 web-foundation**: `web/src/api.ts`, `web/src/shell.tsx`, `web/src/App.tsx`,
  `web/src/styles.css`, `web/src/format.ts`.
- **S2 server-infra** (after S1): `server/src/metrics.ts` (new),
  `server/src/auth.ts` (new), then wires SSE/auth/metrics routes into
  `server/src/api.ts`, env parsing into `server/src/config.ts`, background
  sampler fiber in `server/src/main.ts`.
- **W2 pages-data** (after W1): `web/src/pages/Messages.tsx`,
  `web/src/pages/Entities.tsx`, `web/src/pages/EntityInstances.tsx` (new),
  `web/src/pages/Crons.tsx` (new).
- **W3 pages-dash** (after W1): `Overview.tsx`, `Runners.tsx`, `Workflows.tsx`,
  `WorkflowRunDetail.tsx`, `web/src/components/sparkline.tsx` (new).

Integration (typecheck/build/e2e/smoke fixes) happens centrally afterwards.
