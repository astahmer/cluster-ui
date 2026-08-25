/**
 * Seeds a demo cluster SQLite database that mirrors the schema created by
 * @effect/cluster's SqlShardStorage + SqlMessageStorage (default "cluster" prefix).
 *
 *   pnpm seed
 */
import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

const DB_FILE = process.env.CLUSTER_UI_DB ?? "./data/cluster.db"
const PREFIX = process.env.CLUSTER_UI_PREFIX ?? "cluster"
const EPOCH = Date.UTC(2025, 0, 1)

mkdirSync(dirname(resolve(DB_FILE)), { recursive: true })

const db = new Database(DB_FILE)
db.pragma("journal_mode = WAL")

db.exec(`
  DROP TABLE IF EXISTS ${PREFIX}_replies;
  DROP TABLE IF EXISTS ${PREFIX}_messages;
  DROP TABLE IF EXISTS ${PREFIX}_shards;
  DROP TABLE IF EXISTS ${PREFIX}_runners;

  CREATE TABLE ${PREFIX}_messages (
    id BIGINT PRIMARY KEY,
    message_id VARCHAR(255),
    shard_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    kind INTEGER NOT NULL,
    tag TEXT,
    payload TEXT,
    headers TEXT,
    trace_id TEXT,
    span_id TEXT,
    sampled BOOLEAN,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    request_id BIGINT NOT NULL,
    reply_id BIGINT,
    last_reply_id BIGINT,
    last_read TEXT,
    deliver_at INTEGER
  );
  CREATE INDEX idx_messages_shard ON ${PREFIX}_messages (shard_id, processed, last_read, deliver_at);
  CREATE INDEX idx_messages_entity ON ${PREFIX}_messages (entity_type, entity_id);
  CREATE INDEX idx_messages_request ON ${PREFIX}_messages (request_id);

  CREATE TABLE ${PREFIX}_replies (
    id INTEGER PRIMARY KEY,
    kind INTEGER,
    request_id BIGINT NOT NULL,
    payload TEXT NOT NULL,
    sequence INTEGER,
    acked BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (request_id, kind),
    UNIQUE (request_id, sequence),
    FOREIGN KEY (request_id) REFERENCES ${PREFIX}_messages (id) ON DELETE CASCADE
  );

  CREATE TABLE ${PREFIX}_runners (
    address TEXT PRIMARY KEY,
    runner TEXT NOT NULL
  );

  CREATE TABLE ${PREFIX}_shards (
    shard_id TEXT PRIMARY KEY,
    address TEXT
  );
`)

// --- snowflake generation (mirrors @effect/cluster Snowflake.make) -------------
let seq = 0
let lastMs = 0
function snowflake(machineId: number): bigint {
  let ms = Date.now()
  if (ms === lastMs) seq = (seq + 1) % 4096
  else {
    lastMs = ms
    seq = Math.floor(Math.random() * 512)
  }
  return BigInt(ms - EPOCH) << 22n | BigInt(machineId % 1024) << 12n | BigInt(seq)
}
// deterministic ids in the past for seeding
function pastSnowflake(atMs: number, machineId: number): bigint {
  return BigInt(atMs - EPOCH) << 22n | BigInt(machineId % 1024) << 12n | BigInt(42)
}

const insertMessage = db.prepare(`
  INSERT INTO ${PREFIX}_messages
    (id, message_id, shard_id, entity_type, entity_id, kind, tag, payload, headers,
     trace_id, span_id, sampled, processed, request_id, reply_id, last_reply_id, last_read, deliver_at)
  VALUES
    (@id, @message_id, @shard_id, @entity_type, @entity_id, @kind, @tag, @payload, @headers,
     @trace_id, @span_id, @sampled, @processed, @request_id, @reply_id, @last_reply_id, @last_read, @deliver_at)
`)
const insertReply = db.prepare(`
  INSERT INTO ${PREFIX}_replies (id, kind, request_id, payload, sequence, acked)
  VALUES (@id, @kind, @request_id, @payload, @sequence, @acked)
`)
const insertRunner = db.prepare(`INSERT INTO ${PREFIX}_runners (address, runner) VALUES (?, ?)`)
const insertShard = db.prepare(`INSERT INTO ${PREFIX}_shards (shard_id, address) VALUES (?, ?)`)

const SHARD_COUNT = 256

function shardFor(entityType: string, entityId: string): string {
  // real cluster hashes the address; any stable mapping is fine for a demo
  let h = 0
  const s = `${entityType}/${entityId}`
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0
  return String(h % SHARD_COUNT)
}

function baseMessage(opts: {
  id: bigint
  entityType: string
  entityId: string
  tag: string
  payload: unknown
  processed?: boolean
  lastRead?: string | null
  deliverAt?: number | null
  hoursAgo?: number
}): any {
  const at = Date.now() - (opts.hoursAgo ?? 1) * 3600_000
  return {
    id: String(opts.id),
    message_id: `msg_${opts.id}`,
    shard_id: shardFor(opts.entityType, opts.entityId),
    entity_type: opts.entityType,
    entity_id: opts.entityId,
    kind: 0,
    tag: opts.tag,
    payload: JSON.stringify(opts.payload),
    headers: JSON.stringify({ "x-attempt": "1" }),
    // no trace by default — only spans seeded via addTrace carry trace ids,
    // so the Traces page shows real multi-span cascades instead of noise
    trace_id: null,
    span_id: null,
    sampled: 1,
    processed: opts.processed ? 1 : 0,
    request_id: Number(BigInt(opts.id) & 0xffffffffn),
    reply_id: null,
    last_reply_id: null,
    last_read: opts.lastRead ?? null,
    deliver_at: opts.deliverAt ?? null
  }
}

function utcAt(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ")
}

const seed = db.transaction(() => {
  // ---- runners -------------------------------------------------------------
  const runners = [
    { host: "10.0.4.11", port: 8080, groups: ["api"], version: 2 },
    { host: "10.0.4.12", port: 8080, groups: ["api"], version: 2 },
    // localhost runner — run `pnpm demo-runner` to see live reporter state in the UI
    { host: "127.0.0.1", port: 9199, groups: ["worker"], version: 1 },
    // registered but owns no shards — shows up as STALE in the UI
    { host: "10.0.4.14", port: 8080, groups: ["worker"], version: 1 }
  ]
  runners.forEach((r) => {
    const address = `${r.host}:${r.port}`
    insertRunner.run(
      address,
      JSON.stringify({ _id: "Runner", address: { _id: "RunnerAddress", host: r.host, port: r.port }, groups: r.groups, version: r.version })
    )
  })
  const addresses = runners.slice(0, 3).map((r) => `${r.host}:${r.port}`)

  // ---- shards ---------------------------------------------------------------
  for (let i = 0; i < SHARD_COUNT; i++) {
    // leave ~8% unassigned to visualize rebalancing
    const assigned = i % 13 !== 5
    insertShard.run(String(i), assigned ? addresses[i % addresses.length] : null)
  }

  // ---- plain entities -------------------------------------------------------
  const counters = Array.from({ length: 24 }, (_, i) => `counter-${i + 1}`)
  const sessions = Array.from({ length: 40 }, (_, i) => `sess_${String(i + 1).padStart(4, "0")}`)
  const carts = Array.from({ length: 12 }, (_, i) => `cart-${100 + i}`)

  let mid = 1
  const addDone = (entityType: string, entityId: string, tag: string, payload: unknown, hoursAgo: number, result: unknown) => {
    const id = pastSnowflake(Date.now() - hoursAgo * 3600_000, 7 * mid)
    const msg = baseMessage({ id, entityType, entityId, tag, payload, processed: true, hoursAgo })
    insertMessage.run(msg)
    insertReply.run({
      id: mid * 10,
      kind: 0, // WithExit
      request_id: String(msg.id),
      payload: JSON.stringify({ _tag: "Success", value: result }),
      sequence: null,
      acked: 1
    })
    mid++
  }
  const addPending = (entityType: string, entityId: string, tag: string, payload: unknown, hoursAgo: number) => {
    insertMessage.run(
      baseMessage({ id: pastSnowflake(Date.now() - hoursAgo * 3600_000, 3 * mid), entityType, entityId, tag, payload, hoursAgo })
    )
    mid++
  }
  const addScheduled = (entityType: string, entityId: string, tag: string, payload: unknown, hoursAgo: number, inMinutes: number) => {
    insertMessage.run(
      baseMessage({
        id: pastSnowflake(Date.now() - hoursAgo * 3600_000, 5 * mid),
        entityType,
        entityId,
        tag,
        payload,
        deliverAt: Date.now() + inMinutes * 60_000,
        hoursAgo
      })
    )
    mid++
  }
  const addInflight = (entityType: string, entityId: string, tag: string, payload: unknown, hoursAgo: number) => {
    insertMessage.run(
      baseMessage({
        id: pastSnowflake(Date.now() - hoursAgo * 3600_000, 9 * mid),
        entityType,
        entityId,
        tag,
        payload,
        lastRead: utcAt(Date.now() - 30_000)
      })
    )
    mid++
  }

  counters.forEach((c, i) => {
    addDone("Counter", c, "Increment", { amount: i + 1 }, i + 2, i + 1)
    if (i % 4 === 0) addPending("Counter", c, "Increment", { amount: 10 }, 0.2)
    if (i % 6 === 0) addInflight("Counter", c, "Decrement", { amount: 1 }, 0.1)
    if (i % 8 === 0) addScheduled("Counter", c, "Increment", { amount: 100 }, 0.5, (i % 3) * 15 + 5)
  })
  sessions.forEach((s, i) => {
    addDone("Session", s, "Touch", { lastSeen: Date.now() - i * 60_000 }, (i % 20) + 1, null)
    if (i % 5 === 0) addPending("Session", s, "Expire", {}, 0.05)
  })
  carts.forEach((c, i) => {
    addDone("Cart", c, "AddItem", { sku: `SKU-${i}`, qty: 1 }, i + 1, null)
    addDone("Cart", c, "Checkout", {}, i + 0.5, { orderId: `ord_${i}` })
  })

  // ---- failed messages ------------------------------------------------------
  const addFailed = (entityType: string, entityId: string, tag: string, payload: unknown, hoursAgo: number, defect: unknown) => {
    const id = pastSnowflake(Date.now() - hoursAgo * 3600_000, 15 * mid)
    const msg = baseMessage({ id, entityType, entityId, tag, payload, processed: true, hoursAgo })
    insertMessage.run(msg)
    insertReply.run({
      id: Date.now() % 1_000_000_000 + mid * 1000 + 900,
      kind: 0,
      request_id: String(msg.id),
      payload: JSON.stringify({ _tag: "Failure", defect }),
      sequence: null,
      acked: 1
    })
    mid++
  }
  addFailed(
    "Payment",
    "card_5555",
    "ChargeCard",
    { amountCents: 4999, currency: "EUR" },
    3,
    { _tag: "Fail", error: { reason: "card_declined", issuerMessage: "Insufficient funds" } }
  )
  addFailed(
    "Payment",
    "card_5555",
    "Refund",
    { orderId: "ord_42" },
    2.5,
    { _tag: "Die", defect: "HttpStatusCodeError: upstream 503 after 3 attempts" }
  )
  addFailed(
    "Session",
    "sess_0037",
    "Expire",
    {},
    1.2,
    { _tag: "Fail", error: { reason: "redis_unavailable" } }
  )

  // ---- workflows --------------------------------------------------------------
  // Workflow runs appear as entities of type "Workflow/<name>" where the
  // entity id is the executionId; tag "run" is the workflow itself and each
  // durable activity is stored as its own message.
  const workflows: Record<string, { executions: number[]; activities: [string, unknown][] }> = {
    OnboardingWorkflow: {
      executions: [1, 2, 3, 4, 5, 6],
      activities: [
        ["sendWelcomeEmail", { template: "welcome-v2" }],
        ["createWorkspace", { plan: "pro" }],
        ["scheduleFollowUp", { delayHours: 48 }]
      ]
    },
    SyncContactsWorkflow: {
      executions: [1, 2, 3],
      activities: [
        ["fetchRemoteDelta", {}],
        ["applyDiff", {}]
      ]
    },
    NightlyReportWorkflow: {
      executions: [1, 2],
      activities: [
        ["aggregateMetrics", { day: "yesterday" }],
        ["renderPdf", {}],
        ["emailReport", { to: "ops@example.com" }]
      ]
    }
  }

  for (const [name, def] of Object.entries(workflows)) {
    def.executions.forEach((n, idx) => {
      const entityType = `Workflow/${name}`
      const executionId = `${name.toLowerCase().replace(/workflow$/, "")}-exec-${n}`
      const startedHoursAgo = (idx + 1) * 6
      const finished = idx % 3 !== 2 // every 3rd still running

      // the run message
      const runId = pastSnowflake(Date.now() - startedHoursAgo * 3600_000, 11 * mid)
      insertMessage.run(
        baseMessage({
          id: runId,
          entityType,
          entityId: executionId,
          tag: "run",
          payload: { input: { userId: `user-${n}` } },
          processed: finished,
          hoursAgo: startedHoursAgo
        })
      )
      if (finished) {
        insertReply.run({
          id: Date.now() % 1_000_000_000 + mid * 1000 + 500,
          kind: 0,
          request_id: String(runId),
          payload: JSON.stringify({ _tag: "Success", value: { done: true } }),
          sequence: null,
          acked: 1
        })
      }
      mid++

      // activities
      def.activities.forEach(([activity, payload], aIdx) => {
        const isActive = !finished && aIdx === def.activities.length - 1
        const isScheduled = !finished && aIdx === def.activities.length - 1 && idx === 5
        const activityMsg = baseMessage({
          id: pastSnowflake(
            Date.now() - (startedHoursAgo - aIdx * 0.25) * 3600_000,
            13 * mid
          ),
          entityType,
          entityId: executionId,
          tag: `activity:${activity}`,
          payload,
          processed: finished ? true : false,
          hoursAgo: startedHoursAgo - aIdx * 0.25,
          lastRead: isActive && !isScheduled ? utcAt(Date.now() - 90_000) : null,
          deliverAt: isScheduled ? Date.now() + 30 * 60_000 : null
        })
        insertMessage.run(activityMsg)
        if (finished || (!isActive && !isScheduled)) {
          insertReply.run({
            id: Date.now() % 1_000_000_000 + mid * 1000 + aIdx + 501,
            kind: 0,
            request_id: String(activityMsg.id),
            payload: JSON.stringify({ _tag: "Success", value: null }),
            sequence: null,
            acked: 1
          })
        }
      })
    })
  }
  // ---- a failed workflow run -------------------------------------------------
  {
    const entityType = "Workflow/PaymentWorkflow"
    const executionId = "payment-exec-1"
    const runId = pastSnowflake(Date.now() - 4 * 3600_000, 17 * mid)
    insertMessage.run(
      baseMessage({
        id: runId,
        entityType,
        entityId: executionId,
        tag: "run",
        payload: { input: { orderId: "ord_42" } },
        processed: true,
        hoursAgo: 4
      })
    )
    insertReply.run({
      id: Date.now() % 1_000_000_000 + mid * 1000 + 950,
      kind: 0,
      request_id: String(runId),
      payload: JSON.stringify({ _tag: "Failure", defect: { _tag: "Fail", error: { step: "chargeCard", reason: "card_declined" } } }),
      sequence: null,
      acked: 1
    })
    mid++

    // its failing activity (attempt 2 visible in the payload, like the engine writes it)
    const activityMsg = baseMessage({
      id: pastSnowflake(Date.now() - 3.8 * 3600_000, 19 * mid),
      entityType,
      entityId: executionId,
      tag: "activity",
      payload: { name: "chargeCard", attempt: 2 },
      processed: true,
      hoursAgo: 3.8
    })
    insertMessage.run(activityMsg)
    insertReply.run({
      id: Date.now() % 1_000_000_000 + mid * 1000 + 951,
      kind: 0,
      request_id: String(activityMsg.id),
      payload: JSON.stringify({ _tag: "Failure", defect: { _tag: "Fail", error: { reason: "card_declined", issuerMessage: "Do not honor" } } }),
      sequence: null,
      acked: 1
    })
    mid++
  }

  // ---- cron jobs (@effect/cluster ClusterCron entities) ----------------------
  // entityId is "" (the engine's PrimaryKey for the cron entity); each scheduled
  // fire is a message whose deliver_at carries the next fire time.
  const crons: Array<{ name: string; pastRuns: number; intervalMinutes: number }> = [
    { name: "NightlyCleanup", pastRuns: 5, intervalMinutes: 24 * 60 },
    { name: "HourlySync", pastRuns: 12, intervalMinutes: 60 }
  ]
  for (const job of crons) {
    const entityType = `ClusterCron/${job.name}`
    for (let i = 0; i < job.pastRuns; i++) {
      insertMessage.run(
        baseMessage({
          id: pastSnowflake(Date.now() - (i + 1) * job.intervalMinutes * 60_000, 21 * mid),
          entityType,
          entityId: "",
          tag: "run",
          payload: { dateTime: new Date(Date.now() - (i + 1) * job.intervalMinutes * 60_000).toISOString() },
          processed: true,
          hoursAgo: ((i + 1) * job.intervalMinutes) / 60
        })
      )
      mid++
    }
    // next scheduled fire
    insertMessage.run(
      baseMessage({
        id: pastSnowflake(Date.now(), 23 * mid),
        entityType,
        entityId: "",
        tag: "run",
        payload: { dateTime: new Date(Date.now() + job.intervalMinutes * 60_000).toISOString() },
        deliverAt: Date.now() + job.intervalMinutes * 60_000,
        hoursAgo: 0.01
      })
    )
        mid++
  }

  // ---- distributed traces -----------------------------------------------------
  // Multi-span traces: messages sharing a trace_id whose ids are created ms
  // apart, so the Traces waterfall renders a real cascade. Each span's true
  // duration rides in its headers JSON (`spanDurationMs`) — the UI reads it
  // back to draw overlapping bars (otel-style) instead of deriving ends from
  // successor starts.
  let traceCounter = 0
  const addTrace = (
    spans: Array<{
      service: string // entity_type
      entity: string // entity_id
      op: string // tag
      atMs: number // offset from trace start
      durMs: number
      fail?: unknown // Failure defect → failed span
    }>,
    hoursAgo: number
  ) => {
    const traceId = ((++traceCounter).toString(16).padStart(4, "0") + "9f2c").slice(0, 8).repeat(4)
    const t0 = Date.now() - hoursAgo * 3600_000
    spans.forEach((s, i) => {
      const msg: any = baseMessage({
        id: pastSnowflake(t0 + s.atMs, (31 + i) % 1024),
        entityType: s.service,
        entityId: s.entity,
        tag: s.op,
        payload: { op: s.op },
        processed: true,
        hoursAgo
      })
      msg.trace_id = traceId
      msg.headers = JSON.stringify({ "x-attempt": "1", spanDurationMs: s.durMs })
      insertMessage.run(msg)
      if (s.fail !== undefined) {
        insertReply.run({
          id: 5_000_000 + traceCounter * 100 + i,
          kind: 0,
          request_id: String(msg.id),
          payload: JSON.stringify({ _tag: "Failure", defect: s.fail }),
          sequence: null,
          acked: 1
        })
        mid++
      }
    })
  }

  const CARD_DECLINED = { _tag: "Fail", error: { reason: "card_declined", issuerMessage: "Do not honor" } }

  addTrace(
    [
      { service: "ApiGateway", entity: "gw-1", op: "POST /v1/checkout", atMs: 0, durMs: 850 },
      { service: "CartService", entity: "cart-104", op: "loadCart", atMs: 20, durMs: 110 },
      { service: "PricingService", entity: "pricing-7", op: "quoteTotals", atMs: 35, durMs: 125 },
      { service: "PaymentService", entity: "pay-2201", op: "riskCheck", atMs: 190, durMs: 70 },
      { service: "PaymentService", entity: "pay-2201", op: "authorize", atMs: 180, durMs: 520 },
      { service: "Ledger", entity: "led-9", op: "appendEntry", atMs: 640, durMs: 60 },
      { service: "EmailService", entity: "mail-3", op: "sendReceipt", atMs: 660, durMs: 140 }
    ],
    0.5
  )
  addTrace(
    [
      { service: "ApiGateway", entity: "gw-1", op: "POST /v1/checkout", atMs: 0, durMs: 430 },
      { service: "CartService", entity: "cart-107", op: "loadCart", atMs: 15, durMs: 90 },
      { service: "PaymentService", entity: "pay-3310", op: "authorize", atMs: 120, durMs: 280, fail: CARD_DECLINED }
    ],
    1.5
  )
  addTrace(
    [
      { service: "AuthService", entity: "auth-1", op: "verifyPassword", atMs: 0, durMs: 140 },
      { service: "SessionService", entity: "sess_ab12", op: "create", atMs: 150, durMs: 55 }
    ],
    0.8
  )
  addTrace(
    [
      { service: "SearchService", entity: "srch-2", op: "query", atMs: 0, durMs: 340 },
      { service: "IndexService", entity: "idx-a", op: "fetchShard", atMs: 25, durMs: 275 },
      { service: "IndexService", entity: "idx-b", op: "fetchShard", atMs: 25, durMs: 255 },
      { service: "Ranker", entity: "rank-1", op: "rerank", atMs: 310, durMs: 25 }
    ],
    2.2
  )
  addTrace(
    [
      { service: "WebhookDispatcher", entity: "hook-77", op: "deliver", atMs: 0, durMs: 1500 },
      { service: "WebhookDispatcher", entity: "hook-77", op: "resolveEndpoint", atMs: 0, durMs: 80 }
    ],
    3.1
  )
  addTrace(
    [
      { service: "ImageService", entity: "img-42", op: "upload", atMs: 0, durMs: 620 },
      { service: "ImageService", entity: "img-42", op: "thumbnail", atMs: 300, durMs: 290 },
      { service: "CdnPurge", entity: "cdn-5", op: "purgeUrls", atMs: 600, durMs: 45 }
    ],
    4.4
  )
  addTrace(
    [
      { service: "ApiGateway", entity: "gw-2", op: "GET /v1/orders/ord_42", atMs: 0, durMs: 95 },
      { service: "OrderService", entity: "ord_42", op: "get", atMs: 10, durMs: 70 }
    ],
    5.6
  )
})

seed()

const counts = {
  messages: (db.prepare(`SELECT COUNT(*) as n FROM ${PREFIX}_messages`).get() as any)?.n,
  replies: (db.prepare(`SELECT COUNT(*) as n FROM ${PREFIX}_replies`).get() as any)?.n,
  runners: (db.prepare(`SELECT COUNT(*) as n FROM ${PREFIX}_runners`).get() as any)?.n,
  shards: (db.prepare(`SELECT COUNT(*) as n FROM ${PREFIX}_shards`).get() as any)?.n
}
console.log(`Seeded ${DB_FILE}`, counts)
db.close()
