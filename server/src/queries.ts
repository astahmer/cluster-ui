import Database from "better-sqlite3"
import { config, decodeSnowflake } from "./config.ts"

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

export function openDb(): Database.Database {
  const db = new Database(config.dbFile, { readonly: config.readonly })
  db.pragma("journal_mode = WAL")
  return db
}

export interface MessageQuery {
  status?: string
  entityType?: string
  q?: string
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
  traceId: string | null
  processed: boolean
  status: MessageStatus
  lastRead: string | null
  deliverAt: number | null
  createdAt: number
  machineId: number
  replyCount: number
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
}

function kindName(kind: number): string {
  return kind === 0 ? "request" : kind === 1 ? "ack" : kind === 2 ? "interrupt" : `kind:${kind}`
}

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
    traceId: row.trace_id ?? null,
    processed: Number(row.processed) === 1,
    status: statusOf({
      processed: Number(row.processed),
      deliverAt: row.deliver_at === null ? null : Number(row.deliver_at),
      lastRead: row.last_read
    }),
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

/** All query helpers take the opened database; they are synchronous & fast. */
export function makeRepo(db: Database.Database) {
  const t = {
    messages: `${config.prefix}_messages`,
    replies: `${config.prefix}_replies`,
    shards: `${config.prefix}_shards`,
    runners: `${config.prefix}_runners`
  }

  // inflight cutoff as a sqlite-comparable UTC string
  const cutoff = () => new Date(Date.now() - INFLIGHT_WINDOW_MS).toISOString().slice(0, 19).replace("T", " ")

  const listMessages = (query: MessageQuery) => {
    const conditions: string[] = []
    const params: unknown[] = []
    if (query.status === "done") conditions.push("m.processed = 1")
    else if (query.status === "pending") conditions.push(`m.processed = 0 AND (m.deliver_at IS NULL OR m.deliver_at <= ?)`)
    else if (query.status === "scheduled") conditions.push(`m.processed = 0 AND m.deliver_at IS NOT NULL AND m.deliver_at > ?`)
    else if (query.status === "inflight")
      conditions.push(`m.processed = 0 AND m.last_read IS NOT NULL AND m.last_read > ?`)
    if (query.entityType) {
      conditions.push("m.entity_type = ?")
      params.push(query.entityType)
    }
    if (query.q) {
      conditions.push("(m.entity_id LIKE ? OR m.tag LIKE ? OR CAST(m.id AS TEXT) LIKE ?)")
      params.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200)
    const page = Math.max(query.page ?? 1, 1)

    // time-dependent params first, then filter params (order matches conditions)
    if (query.status === "pending") params.unshift(Date.now())
    if (query.status === "scheduled") params.unshift(Date.now())
    if (query.status === "inflight") params.unshift(cutoff())

    const total = Number(
      (db.prepare(`SELECT COUNT(*) as total FROM ${t.messages} m ${where}`).get(...params) as any)
        ?.total ?? 0
    )
    const rows = db
      .prepare(
        `SELECT CAST(m.id AS TEXT) as id, m.message_id, m.shard_id, m.entity_type, m.entity_id,
           m.kind, m.tag, m.payload, m.headers, m.trace_id, m.processed, m.last_read, m.deliver_at,
           (SELECT COUNT(*) FROM ${t.replies} r WHERE r.request_id = m.id) as reply_count
         FROM ${t.messages} m ${where}
         ORDER BY m.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize) as ReadonlyArray<RawMessageRow>
    return { rows: rows.map(toMessageView), total, page, pageSize }
  }

  const getMessage = (id: string) => {
    const row = db.prepare(`SELECT CAST(id AS TEXT) as id, message_id, shard_id, entity_type, entity_id,
       kind, tag, payload, headers, trace_id, processed, last_read, deliver_at
     FROM ${t.messages} WHERE CAST(id AS TEXT) = ?`).get(id) as
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
      kind: number
      payload: string
      sequence: number | null
      acked: number
    }>
    return {
      message: toMessageView(row),
      payload: safeJson(row.payload),
      headers: safeJson(row.headers),
      replies: replies.map((r) => ({
        id: r.rid,
        requestId: r.requestId,
        kind:
          Number(r.kind) === 0 ? "withExit" : r.kind === null ? "chunk" : `kind:${r.kind}`,
        payload: safeJson(r.payload),
        sequence: r.sequence,
        acked: Boolean(r.acked)
      }))
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
          SUM(CASE WHEN processed = 0 THEN 1 ELSE 0 END) as unprocessed
        FROM ${t.messages}`
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
    return {
      messages: {
        pending: pending - scheduled - inflight,
        inflight,
        scheduled,
        done: Number(c?.done ?? 0)
      },
      runners: { total: Number(runners?.total ?? 0) },
      shards: { total: Number(shards?.total ?? 0), assigned: Number(shards?.assigned ?? 0) },
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
      return {
        address: r.address,
        host: runner?.address?.host ?? null,
        port: runner?.address?.port ?? null,
        groups: runner?.groups ?? [],
        version: runner?.version ?? null,
        shards: Number(r.shards)
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

  const workflows = () => {
    const rows = db
      .prepare(
        `SELECT SUBSTR(entity_type, 10) as name,
          COUNT(DISTINCT entity_id) as runs,
          SUM(CASE WHEN tag = 'run' AND processed = 1 THEN 1 ELSE 0 END) as completedRuns,
          SUM(CASE WHEN tag = 'run' AND processed = 0 THEN 1 ELSE 0 END) as activeRuns,
          MAX(CAST(id AS TEXT)) as lastId
        FROM ${t.messages} WHERE entity_type LIKE 'Workflow/%'
        GROUP BY entity_type ORDER BY name`
      )
      .all() as any[]
    return rows.map((r) => ({
      name: r.name as string,
      runs: Number(r.runs),
      completedRuns: Number(r.completedRuns ?? 0),
      activeRuns: Number(r.activeRuns ?? 0),
      lastActivityAt: r.lastId ? decodeSnowflake(String(r.lastId)).createdAt : null
    }))
  }

  const workflowRuns = (name: string) => {
    const rows = db
      .prepare(
        `SELECT CAST(m.id AS TEXT) as id, m.entity_id as executionId, m.processed, m.last_read, m.deliver_at,
           (SELECT COUNT(*) FROM ${t.replies} r WHERE r.request_id = m.id) as reply_count
         FROM ${t.messages} m
         WHERE m.entity_type = ? AND m.tag = 'run'
         ORDER BY m.id DESC`
      )
      .all(`Workflow/${name}`) as any[]
    return rows.map((r) => {
      const view = toMessageView({
        ...r,
        kind: 0,
        tag: "run",
        entity_type: `Workflow/${name}`
      } as RawMessageRow)
      return {
        executionId: r.executionId as string,
        runMessageId: String(r.id),
        status: view.status,
        createdAt: view.createdAt,
        activityCount: Number(r.reply_count)
      }
    })
  }

  const workflowRun = (name: string, executionId: string) => {
    const rows = db
      .prepare(
        `SELECT CAST(id AS TEXT) as id, message_id, shard_id, entity_type, entity_id,
           kind, tag, payload, headers, trace_id, processed, last_read, deliver_at
         FROM ${t.messages}
         WHERE entity_type = ? AND entity_id = ?
         ORDER BY id`
      )
      .all(`Workflow/${name}`, executionId) as unknown as RawMessageRow[]
    if (rows.length === 0) return null
    const runRow = rows.find((r) => r.tag === "run")
    const activities = rows
      .filter((r) => r.tag !== "run")
      .map((r) => {
        const { createdAt } = decodeSnowflake(String(r.id))
        return {
          id: String(r.id),
          tag: r.tag,
          kind: kindName(Number(r.kind)),
          status: statusOf({
            processed: Number(r.processed),
            deliverAt: r.deliver_at === null ? null : Number(r.deliver_at),
            lastRead: r.last_read
          }),
          payload: safeJson(r.payload),
          createdAt
        }
      })
    const run = runRow ?
      {
        ...toMessageView({ ...runRow, entity_type: `Workflow/${name}`, entity_id: executionId }),
        payload: safeJson(runRow.payload)
      } :
      null
    return { run, activities }
  }

  return {
    listMessages,
    getMessage,
    overview,
    runners,
    shards,
    entities,
    workflows,
    workflowRuns,
    workflowRun
  }
}

export type Repo = ReturnType<typeof makeRepo>
