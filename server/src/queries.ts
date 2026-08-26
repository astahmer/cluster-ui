import Database from "better-sqlite3"
import { config, decodeSnowflake, SNOWFLAKE_EPOCH, type ClusterProfile } from "./config.ts"

export type MessageStatus = "pending" | "inflight" | "scheduled" | "done"

const INFLIGHT_WINDOW_MS = 5 * 60 * 1000

/** sqlite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC */
function parseSqliteTimestamp(s: string | null): number | null {
  if (!s) return null
  const ms = Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z")
  return Number.isNaN(ms) ? null : ms
}

export function statusOf(row: {
  processed: number
  deliverAt: number | null
  lastRead: string | null
}): MessageStatus {
  if (Number(row.processed) === 1) return "done"
  if (row.deliverAt !== null && row.deliverAt > Date.now()) return "scheduled"
  const read = parseSqliteTimestamp(row.lastRead)
  if (read !== null && Date.now() - read < INFLIGHT_WINDOW_MS) return "inflight"
  return "pending"
}

export function openDb(profile?: ClusterProfile): Database.Database {
  const db = new Database(profile?.dbFile ?? config.dbFile, { readonly: config.readonly })
  db.pragma("journal_mode = WAL")
  return db
}

export interface MessageQuery {
  status?: string
  entityType?: string
  entityId?: string
  q?: string
  /** "true" / "false" — filter on failure exit replies */
  failed?: string | boolean
  /** epoch millis, inclusive */
  createdAfter?: number
  createdBefore?: number
  sort?: "id" | "deliverAt"
  page?: number
  pageSize?: number
}

export interface MessageView {
  id: string
  messageId: string | null
  shardId: string
  entityType: string
  entityId: string
  kind: string
  tag: string | null
  headers: string | null
  traceId: string | null
  processed: boolean
  status: MessageStatus
  failed: boolean
  lastRead: string | null
  deliverAt: number | null
  createdAt: number
  machineId: number
  replyCount: number
}

export interface TraceSummary {
  traceId: string
  count: number
  kinds: string[]
  services: string[]
  firstAt: number
  lastAt: number
}

/** Paged trace listing (UX P1-15): rows + total for the pager. */
export interface TraceList {
  rows: TraceSummary[]
  total: number
}

interface RawMessageRow {
  readonly id: number | bigint
  readonly message_id: string | null
  readonly shard_id: number | string
  readonly entity_type: string
  readonly entity_id: string
  readonly kind: number
  readonly tag: string | null
  readonly payload: string | null
  readonly headers: string | null
  readonly trace_id: string | null
  readonly processed: number
  readonly last_read: string | null
  readonly deliver_at: number | bigint | null
  readonly reply_count?: number
  readonly failed_flag?: number
}

function kindName(kind: number): string {
  return kind === 0 ? "request" : kind === 1 ? "ack" : kind === 2 ? "interrupt" : `kind:${kind}`
}

/** SQL fragment + params detecting a Failure WithExit reply for m.* / the aliased message */
// WithExit reply payloads ARE the exit object: { _tag: "Success", value } /
// { _tag: "Failure", defect } (see SqlMessageStorage.replyToRow)
const FAILED_EXISTS_SQL =
  "EXISTS(SELECT 1 FROM %REPLIES% r WHERE r.request_id = %.ID% AND r.kind = 0 AND json_extract(r.payload,'$._tag') = 'Failure')"

function toMessageView(row: RawMessageRow): MessageView {
  const { createdAt, machineId } = decodeSnowflake(String(row.id))
  return {
    id: String(row.id),
    messageId: row.message_id ?? null,
    shardId: String(row.shard_id),
    entityType: row.entity_type,
    entityId: row.entity_id,
    kind: kindName(Number(row.kind)),
    tag: row.tag ?? null,
    headers: row.headers ?? null,
    traceId: row.trace_id ?? null,
    processed: Number(row.processed) === 1,
    status: statusOf({
      processed: Number(row.processed),
      deliverAt: row.deliver_at === null ? null : Number(row.deliver_at),
      lastRead: row.last_read
    }),
    failed: Number(row.failed_flag ?? 0) === 1,
    lastRead: row.last_read ?? null,
    deliverAt: row.deliver_at === null ? null : Number(row.deliver_at),
    createdAt,
    machineId,
    replyCount: Number(row.reply_count ?? 0)
  }
}

function safeJson(s: string | null): unknown {
  if (s === null) return null
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/**
 * Extracts the execution outcome from WithExit replies of a message.
 * Exit payloads are `{ _tag: "Success", value }` or `{ _tag: "Failure", defect }`.
 */
export function extractResult(
  replies: ReadonlyArray<{ kind: string; payload: unknown }>
): { outcome: "Success" | "Failure"; value: unknown; exit: Record<string, unknown> } | null {
  const withExit = replies.find((r) => r.kind === "withExit")
  if (!withExit || typeof withExit.payload !== "object" || withExit.payload === null) return null
  const exit = withExit.payload as Record<string, unknown>
  const outcome = exit._tag === "Failure" ? "Failure" : exit._tag === "Success" ? "Success" : null
  if (outcome === null) return null
  return {
    outcome,
    value: outcome === "Success" ? exit.value : (exit.defect ?? exit.cause ?? exit.error ?? null),
    exit
  }
}

/** All query helpers take the opened database; they are synchronous & fast. */
export function makeRepo(db: Database.Database, prefix: string = config.prefix) {
  const t = {
    messages: `${prefix}_messages`,
    replies: `${prefix}_replies`,
    shards: `${prefix}_shards`,
    runners: `${prefix}_runners`
  }

  // inflight cutoff as a sqlite-comparable UTC string
  const cutoff = () => new Date(Date.now() - INFLIGHT_WINDOW_MS).toISOString().slice(0, 19).replace("T", " ")

  const failedExistsFor = (idExpr: string) =>
    FAILED_EXISTS_SQL.replace("%REPLIES%", t.replies).replace("%.ID%", `m.${idExpr}`)

  const listMessages = (query: MessageQuery) => {
    // [sql, ...params] pairs kept together so placeholder order is always correct
    const conds: Array<[string, ...unknown[]]> = []
    if (query.status === "done") conds.push(["m.processed = 1"])
    else if (query.status === "pending") conds.push(["m.processed = 0 AND (m.deliver_at IS NULL OR m.deliver_at <= ?)", Date.now()])
    else if (query.status === "scheduled") conds.push(["m.processed = 0 AND m.deliver_at IS NOT NULL AND m.deliver_at > ?", Date.now()])
    else if (query.status === "inflight") conds.push(["m.processed = 0 AND m.last_read IS NOT NULL AND m.last_read > ?", cutoff()])
    if (query.entityType) conds.push(["m.entity_type = ?", query.entityType])
    if (query.entityId) conds.push(["m.entity_id = ?", query.entityId])
    if (query.q)
      conds.push([
        "(m.entity_id LIKE ? OR m.tag LIKE ? OR CAST(m.id AS TEXT) LIKE ?)",
        `%${query.q}%`,
        `%${query.q}%`,
        `%${query.q}%`
      ])
    if (query.failed === true || query.failed === "true") conds.push([failedExistsFor("id")])
    if (query.failed === false || query.failed === "false") conds.push([`NOT ${failedExistsFor("id")}`])
    if (query.createdAfter !== undefined) conds.push(["m.id >= ?", snowflakeFloor(query.createdAfter)])
    if (query.createdBefore !== undefined) conds.push(["m.id <= ?", snowflakeCeil(query.createdBefore)])

    const where = conds.length > 0 ? `WHERE ${conds.map(([c]) => c).join(" AND ")}` : ""
    const params = conds.flatMap(([, ...vals]) => vals)
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200)
    const page = Math.max(query.page ?? 1, 1)
    const order = query.sort === "deliverAt" ? "ORDER BY (m.deliver_at IS NULL), m.deliver_at ASC, m.id DESC" : "ORDER BY m.id DESC"

    const total = Number(
      (db.prepare(`SELECT COUNT(*) as total FROM ${t.messages} m ${where}`).get(...params) as any)
        ?.total ?? 0
    )
    const rows = db
      .prepare(
        `SELECT CAST(m.id AS TEXT) as id, m.message_id, m.shard_id, m.entity_type, m.entity_id,
           m.kind, m.tag, m.payload, m.headers, m.trace_id, m.processed, m.last_read, m.deliver_at,
           (${failedExistsFor("id")}) as failed_flag,
           (SELECT COUNT(*) FROM ${t.replies} r WHERE r.request_id = m.id) as reply_count
         FROM ${t.messages} m ${where}
         ${order} LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize) as ReadonlyArray<RawMessageRow>
    return { rows: rows.map(toMessageView), total, page, pageSize }
  }

  const getMessage = (id: string) => {
    const row = db.prepare(`SELECT CAST(id AS TEXT) as id, message_id, shard_id, entity_type, entity_id,
       kind, tag, payload, headers, trace_id, processed, last_read, deliver_at,
       (${failedExistsFor("id")}) as failed_flag
     FROM ${t.messages} m WHERE CAST(m.id AS TEXT) = ?`).get(id) as
      | RawMessageRow
      | undefined
    if (!row) return null
    const replies = db
      .prepare(
        `SELECT CAST(id AS TEXT) as rid, CAST(request_id AS TEXT) as requestId, kind, payload, sequence, acked
         FROM ${t.replies} WHERE CAST(request_id AS TEXT) = ? ORDER BY sequence`
      )
      .all(id) as ReadonlyArray<{
      rid: string
      requestId: string
      kind: number | null
      payload: string
      sequence: number | null
      acked: number
    }>
    const mappedReplies = replies.map((r) => ({
      id: r.rid,
      requestId: r.requestId,
      kind:
        Number(r.kind) === 0 ? "withExit" : r.kind === null ? "chunk" : `kind:${r.kind}`,
      payload: safeJson(r.payload),
      sequence: r.sequence,
      acked: Boolean(r.acked)
    }))
    return {
      message: toMessageView(row),
      payload: safeJson(row.payload),
      headers: safeJson(row.headers),
      result: extractResult(mappedReplies),
      replies: mappedReplies
    }
  }

  const overview = () => {
    const now = Date.now()
    const c = db
      .prepare(
        `SELECT
          SUM(CASE WHEN processed = 1 THEN 1 ELSE 0 END) as done,
          SUM(CASE WHEN processed = 0 AND deliver_at IS NOT NULL AND deliver_at > ? THEN 1 ELSE 0 END) as scheduled,
          SUM(CASE WHEN processed = 0 AND last_read IS NOT NULL AND last_read > ? THEN 1 ELSE 0 END) as inflight,
          SUM(CASE WHEN processed = 0 THEN 1 ELSE 0 END) as unprocessed,
          SUM(CASE WHEN ${failedExistsFor("id")} THEN 1 ELSE 0 END) as failed
        FROM ${t.messages} m`
      )
      .get(now, cutoff()) as any
    const shards = db.prepare(`SELECT COUNT(*) as total, COUNT(address) as assigned FROM ${t.shards}`).get() as any
    const runners = db.prepare(`SELECT COUNT(*) as total FROM ${t.runners}`).get() as any
    const topEntities = db
      .prepare(
        `SELECT entity_type as entityType, COUNT(*) as total,
           SUM(CASE WHEN processed = 0 THEN 1 ELSE 0 END) as active
         FROM ${t.messages} GROUP BY entity_type ORDER BY total DESC LIMIT 8`
      )
      .all()
    const topWorkflows = db
      .prepare(
        `SELECT SUBSTR(entity_type, 10) as name, COUNT(DISTINCT entity_id) as runs
         FROM ${t.messages} WHERE entity_type LIKE 'Workflow/%'
         GROUP BY entity_type ORDER BY runs DESC LIMIT 8`
      )
      .all()
    const pending = Number(c?.unprocessed ?? 0)
    const scheduled = Number(c?.scheduled ?? 0)
    const inflight = Number(c?.inflight ?? 0)
    const shardTotal = Number(shards?.total ?? 0)
    const assigned = Number(shards?.assigned ?? 0)
    return {
      messages: {
        pending: pending - scheduled - inflight,
        inflight,
        scheduled,
        done: Number(c?.done ?? 0),
        failed: Number(c?.failed ?? 0)
      },
      runners: { total: Number(runners?.total ?? 0) },
      shards: { total: shardTotal, assigned },
      unassignedShards: shardTotal - assigned,
      topEntities: topEntities.map((e: any) => ({
        entityType: e.entityType,
        total: Number(e.total),
        active: Number(e.active)
      })),
      topWorkflows: topWorkflows.map((w: any) => ({ name: w.name, runs: Number(w.runs) })),
      serverTime: now
    }
  }

  const runners = () => {
    const rows = db
      .prepare(
        `SELECT r.address, r.runner,
           (SELECT COUNT(*) FROM ${t.shards} s WHERE s.address = r.address) as shards
         FROM ${t.runners} r ORDER BY r.address`
      )
      .all() as ReadonlyArray<{ address: string; runner: string; shards: number }>
    return rows.map((r) => {
      let runner: any = null
      try {
        runner = JSON.parse(r.runner)
      } catch {}
      const shards = Number(r.shards)
      return {
        address: r.address,
        host: runner?.address?.host ?? null,
        port: runner?.address?.port ?? null,
        groups: runner?.groups ?? [],
        version: runner?.version ?? null,
        shards,
        stale: shards === 0
      }
    })
  }

  const shards = () => {
    const rows = db
      .prepare(`SELECT CAST(shard_id AS TEXT) as shardId, address FROM ${t.shards} ORDER BY CAST(shard_id AS INTEGER)`)
      .all() as ReadonlyArray<{ shardId: string; address: string | null }>
    return rows.map((r) => ({ shardId: r.shardId, address: r.address ?? null }))
  }

  const entities = () => {
    const rows = db
      .prepare(
        `SELECT entity_type as entityType,
          COUNT(DISTINCT entity_id) as entities,
          COUNT(*) as messages,
          SUM(CASE WHEN processed = 1 THEN 1 ELSE 0 END) as done,
          SUM(CASE WHEN processed = 0 AND deliver_at IS NOT NULL AND deliver_at > ? THEN 1 ELSE 0 END) as scheduled,
          SUM(CASE WHEN processed = 0 AND last_read IS NOT NULL AND last_read > ? THEN 1 ELSE 0 END) as inflight,
          MAX(CAST(id AS TEXT)) as lastId
        FROM ${t.messages} GROUP BY entity_type ORDER BY messages DESC`
      )
      .all(Date.now(), cutoff()) as any[]
    return rows.map((r) => ({
      entityType: r.entityType as string,
      entities: Number(r.entities),
      messages: Number(r.messages),
      done: Number(r.done ?? 0),
      scheduled: Number(r.scheduled ?? 0),
      inflight: Number(r.inflight ?? 0),
      pending:
        Number(r.messages) - Number(r.done ?? 0) - Number(r.scheduled ?? 0) - Number(r.inflight ?? 0),
      lastActivityAt: r.lastId ? decodeSnowflake(String(r.lastId)).createdAt : null
    }))
  }

  /** per-entity-id breakdown within one entity type */
  const entityInstances = (
    entityType: string,
    opts: { q?: string; page?: number; pageSize?: number } = {}
  ) => {
    const conds: Array<[string, ...unknown[]]> = [["m.entity_type = ?", entityType]]
    if (opts.q) conds.push(["m.entity_id LIKE ?", `%${opts.q}%`])
    const where = `WHERE ${conds.map(([c]) => c).join(" AND ")}`
    const params = conds.flatMap(([, ...vals]) => vals)
    const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200)
    const page = Math.max(opts.page ?? 1, 1)

    const inner = `
      SELECT m.entity_id as entityId,
        COUNT(*) as total,
        SUM(CASE WHEN m.processed = 1 THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN m.processed = 0 AND m.deliver_at IS NOT NULL AND m.deliver_at > ${Date.now()} THEN 1 ELSE 0 END) as scheduled,
        SUM(CASE WHEN m.processed = 0 AND m.last_read IS NOT NULL AND m.last_read > '${cutoff()}' THEN 1 ELSE 0 END) as inflight,
        SUM(CASE WHEN ${FAILED_EXISTS_SQL.replace("%REPLIES%", t.replies).replace("%.ID%", "m.id")} THEN 1 ELSE 0 END) as failed,
        MAX(CAST(m.id AS TEXT)) as lastId
      FROM ${t.messages} m ${where}
      GROUP BY m.entity_id`

    const total = Number(
      (db.prepare(`SELECT COUNT(*) as total FROM (${inner})`).get(...params) as any)?.total ?? 0
    )
    const rows = db
      .prepare(`SELECT * FROM (${inner}) ORDER BY lastId DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as any[]
    return {
      rows: rows.map((r) => {
        const done = Number(r.done ?? 0)
        const scheduledN = Number(r.scheduled ?? 0)
        const inflightN = Number(r.inflight ?? 0)
        return {
          entityId: String(r.entityId),
          total: Number(r.total),
          pending: Number(r.total) - done - scheduledN - inflightN,
          inflight: inflightN,
          scheduled: scheduledN,
          done,
          failed: Number(r.failed ?? 0),
          lastActivityAt: r.lastId ? decodeSnowflake(String(r.lastId)).createdAt : null
        }
      }),
      total,
      page,
      pageSize
    }
  }

  /** cron jobs persisted by @effect/cluster's ClusterCron (entities "ClusterCron/<name>") */
  const crons = () => {
    const now = Date.now()
    const rows = db
      .prepare(
        `SELECT SUBSTR(entity_type, 13) as name, entity_type as entityType,
           CAST(id AS TEXT) as id, processed, deliver_at
         FROM ${t.messages} WHERE entity_type LIKE 'ClusterCron/%'
         ORDER BY id ASC`
      )
      .all() as any[]
    const byJob = new Map<string, any>()
    for (const r of rows) {
      let job = byJob.get(r.entityType)
      if (!job) {
        job = {
          name: r.name,
          entityType: r.entityType,
          lastRunAt: null,
          nextRunAt: null,
          newestId: null as string | null,
          lastProcessed: 0
        }
        byJob.set(r.entityType, job)
      }
      job.newestId = String(r.id)
      job.lastProcessed = Number(r.processed)
      if (Number(r.processed) === 1) {
        const at = decodeSnowflake(String(r.id)).createdAt
        job.lastRunAt = Math.max(job.lastRunAt ?? 0, at)
      }
      if (Number(r.processed) === 0 && r.deliver_at !== null && r.deliver_at !== undefined) {
        const at = Number(r.deliver_at)
        job.nextRunAt = job.nextRunAt === null ? at : Math.min(job.nextRunAt, at)
      }
    }
    return [...byJob.values()].map((j) => ({
      name: j.name as string,
      entityType: j.entityType as string,
      lastRunAt: j.lastRunAt as number | null,
      nextRunAt: j.nextRunAt as number | null,
      // status of the most recent fire (done vs pending); failure detail lives on the message
      lastStatus:
        j.newestId !== null ?
          statusOf({ processed: j.lastProcessed, deliverAt: null, lastRead: null }) :
          ("pending" satisfies MessageStatus),
      overdue: j.nextRunAt !== null && j.nextRunAt < now
    }))
  }

  const workflows = () => {
    const rows = db
      .prepare(
        `SELECT SUBSTR(entity_type, 10) as name,
          COUNT(DISTINCT entity_id) as runs,
          SUM(CASE WHEN m.tag = 'run' AND m.processed = 1 THEN 1 ELSE 0 END) as completedRuns,
          SUM(CASE WHEN m.tag = 'run' AND m.processed = 0 THEN 1 ELSE 0 END) as activeRuns,
          SUM(CASE WHEN m.tag = 'run' AND ${failedExistsFor("id")} THEN 1 ELSE 0 END) as failedRuns,
          MAX(CAST(m.id AS TEXT)) as lastId
        FROM ${t.messages} m WHERE m.entity_type LIKE 'Workflow/%'
        GROUP BY m.entity_type ORDER BY name`
      )
      .all() as any[]
    return rows.map((r) => ({
      name: r.name as string,
      runs: Number(r.runs),
      completedRuns: Number(r.completedRuns ?? 0),
      activeRuns: Number(r.activeRuns ?? 0),
      failedRuns: Number(r.failedRuns ?? 0),
      lastActivityAt: r.lastId ? decodeSnowflake(String(r.lastId)).createdAt : null
    }))
  }

  const workflowRuns = (name: string) => {
    const rows = db
      .prepare(
        `SELECT CAST(m.id AS TEXT) as id, m.entity_id as entity_id, m.entity_type as entity_type,
           m.message_id, m.shard_id,
           m.kind, m.tag, m.payload, m.headers, m.trace_id, m.processed, m.last_read, m.deliver_at,
           (${failedExistsFor("id")}) as failed_flag,
           (SELECT COUNT(*) FROM ${t.replies} r WHERE r.request_id = m.id) as reply_count
         FROM ${t.messages} m
         WHERE m.entity_type = ? AND m.tag = 'run'
         ORDER BY m.id DESC`
      )
      .all(`Workflow/${name}`) as unknown as RawMessageRow[]
    return rows.map((r) => {
      const view = toMessageView({
        ...r,
        kind: 0,
        tag: "run",
        entity_type: `Workflow/${name}`
      })
      return {
        executionId: String(view.entityId),
        runMessageId: String(r.id),
        status: view.status,
        failed: view.failed,
        createdAt: view.createdAt,
        activityCount: Number(r.reply_count ?? 0)
      }
    })
  }

  const workflowRun = (name: string, executionId: string) => {
    const rows = db
      .prepare(
        `SELECT CAST(id AS TEXT) as id, message_id, shard_id, entity_type, entity_id,
           kind, tag, payload, headers, trace_id, processed, last_read, deliver_at,
           (${failedExistsFor("id")}) as failed_flag
         FROM ${t.messages} m
         WHERE m.entity_type = ? AND m.entity_id = ?
         ORDER BY m.id`
      )
      .all(`Workflow/${name}`, executionId) as unknown as RawMessageRow[]
    if (rows.length === 0) return null
    const runRow = rows.find((r) => r.tag === "run")
    const activities = rows
      .filter((r) => r.tag !== "run")
      .map((r) => {
        const { createdAt } = decodeSnowflake(String(r.id))
        const payload = safeJson(r.payload)
        // ActivityRpc payloads carry { name, attempt } for durable activities
        let attempt: number | undefined
        let activityName: string | undefined
        if (payload && typeof payload === "object" && "attempt" in (payload as any)) {
          attempt = Number((payload as any).attempt)
          activityName = (payload as any).name
        }
        return {
          id: String(r.id),
          tag: r.tag,
          kind: kindName(Number(r.kind)),
          status: statusOf({
            processed: Number(r.processed),
            deliverAt: r.deliver_at === null ? null : Number(r.deliver_at),
            lastRead: r.last_read
          }),
          failed: Number(r.failed_flag ?? 0) === 1,
          activityName,
          attempt,
          payload,
          createdAt
        }
      })
    const eventHistory = rows.map((r) => {
      const { createdAt } = decodeSnowflake(String(r.id))
      const payload = safeJson(r.payload)
      const isRun = r.tag === "run"
      const activity = activities.find((a) => a.id === String(r.id))
      return {
        id: String(r.id),
        timestamp: createdAt,
        event: isRun ? "run-created" : activity?.failed ? "activity-failed" : `activity-${activity?.status ?? "pending"}`,
        activityName: activity?.activityName,
        attempt: activity?.attempt,
        payload
      }
    })
    const run = runRow ?
      (() => {
        const view = toMessageView({ ...runRow, entity_type: `Workflow/${name}`, entity_id: executionId })
        const runReplies = db
          .prepare(`SELECT kind, payload FROM ${t.replies} WHERE CAST(request_id AS TEXT) = ?`)
          .all(runRow.id) as ReadonlyArray<{ kind: number | null; payload: string }>
        const mapped = runReplies.map((r) => ({
          kind: Number(r.kind) === 0 ? "withExit" : r.kind === null ? "chunk" : `kind:${r.kind}`,
          payload: safeJson(r.payload)
        }))
        return {
          ...view,
          payload: safeJson(runRow.payload),
          result: extractResult(mapped)
        }
      })() :
      null
    return { run, activities, eventHistory }
  }

  /** Recent traces: non-null trace_ids grouped, newest first. Optional id-substring search + offset paging (UX P1-15). */
  const traces = (opts: { limit?: number; offset?: number; q?: string; createdAfter?: number; createdBefore?: number } = {}): TraceList => {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
    const offset = Math.max(opts.offset ?? 0, 0)
    const q = opts.q?.trim() ?? ""
    const createdAfter = opts.createdAfter
    const createdBefore = opts.createdBefore
    // escape LIKE wildcards in the user-supplied substring
    const pattern = q === "" ? null : `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const clauses = ["m.trace_id IS NOT NULL AND m.trace_id != ''"]
    const searchParams: Array<string | number> = []
    if (pattern !== null) {
      clauses.push("m.trace_id LIKE ? ESCAPE '\\'")
      searchParams.push(pattern)
    }
    if (createdAfter !== undefined && Number.isFinite(createdAfter)) {
      clauses.push("m.id >= ?")
      searchParams.push(snowflakeFloor(createdAfter))
    }
    if (createdBefore !== undefined && Number.isFinite(createdBefore)) {
      clauses.push("m.id <= ?")
      searchParams.push(snowflakeCeil(createdBefore))
    }
    const where = `WHERE ${clauses.join(" AND ")}`

    const totalRow = db
      .prepare(`SELECT COUNT(DISTINCT m.trace_id) as total FROM ${t.messages} m ${where}`)
      .get(...searchParams) as { total: number | bigint } | undefined

    const rows = db
      .prepare(
        `SELECT m.trace_id as traceId, COUNT(*) as count,
           MIN(m.id) as firstId, MAX(m.id) as lastId,
           GROUP_CONCAT(DISTINCT m.kind) as kinds,
           GROUP_CONCAT(DISTINCT m.entity_type) as services
         FROM ${t.messages} m
         ${where}
         GROUP BY m.trace_id
         ORDER BY MAX(m.id) DESC
         LIMIT ? OFFSET ?`
      )
      .all(...searchParams, limit, offset) as ReadonlyArray<{
      traceId: string
      count: number | bigint
      firstId: number | bigint
      lastId: number | bigint
      kinds: string | null
      services: string | null
    }>
    return {
      rows: rows.map((r) => ({
        traceId: r.traceId,
        count: Number(r.count),
        kinds:
          r.kinds === null ? [] :
          String(r.kinds)
            .split(",")
            .filter((k) => k !== "")
            .map((k) => kindName(Number(k))),
        services:
          r.services === null ? [] :
          String(r.services)
            .split(",")
            .filter((s) => s !== ""),
        firstAt: decodeSnowflake(String(r.firstId)).createdAt,
        lastAt: decodeSnowflake(String(r.lastId)).createdAt
      })),
      total: Number(totalRow?.total ?? 0)
    }
  }

  /** All messages sharing a trace id, oldest first (same view shape as listMessages). */
  const trace = (traceId: string) => {
    const rows = db
      .prepare(
        `SELECT CAST(m.id AS TEXT) as id, m.message_id, m.shard_id, m.entity_type, m.entity_id,
           m.kind, m.tag, m.payload, m.headers, m.trace_id, m.processed, m.last_read, m.deliver_at,
           (${failedExistsFor("id")}) as failed_flag,
           (SELECT COUNT(*) FROM ${t.replies} r WHERE CAST(r.request_id AS TEXT) = m.id) as reply_count
         FROM ${t.messages} m WHERE m.trace_id = ? ORDER BY m.id ASC`
      )
      .all(traceId) as unknown as RawMessageRow[]
    return rows.map(toMessageView)
  }

  return {
    db,
    prefix,
    listMessages,
    getMessage,
    overview,
    runners,
    shards,
    entities,
    entityInstances,
    crons,
    workflows,
    workflowRuns,
    workflowRun,
    traces,
    trace
  }
}

export type Repo = ReturnType<typeof makeRepo>

/** largest snowflake that could have been created at or before the given epoch ms */
function snowflakeCeil(atMs: number): string {
  return String(((BigInt(Math.max(atMs, SNOWFLAKE_FLOOR_MS)) - BigInt(SNOWFLAKE_EPOCH)) << 22n) | ((1n << 22n) - 1n))
}

/** smallest snowflake that could have been created at or after the given epoch ms */
function snowflakeFloor(atMs: number): string {
  return String((BigInt(Math.max(atMs, SNOWFLAKE_FLOOR_MS)) - BigInt(SNOWFLAKE_EPOCH)) << 22n)
}

const SNOWFLAKE_FLOOR_MS = Date.UTC(2025, 0, 2) // ids before this are not time-decodable reliably
