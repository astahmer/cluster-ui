import Redis from "ioredis"
import { ActionError, assertWritable } from "./actions.ts"
import { config } from "./config.ts"
import type { MessageQuery } from "./queries.ts"

/**
 * Redis (BullMQ) read model — docs/ROADMAP.md §6.
 *
 * Maps BullMQ job hashes onto the same shapes the sqlite Repo returns so the
 * existing pages render a redis cluster without changes. Pages that have no
 * redis equivalent (shards, workflows, crons, traces, singletons) return
 * harmless empties. Every redis call races a short timeout so a dead redis
 * degrades to clean errors instead of hanging requests.
 */

const TIMEOUT_MS = 1500
const SCAN_WINDOW = 500

type JobState = "wait" | "active" | "completed" | "failed" | "delayed" | "paused"
const STATES: ReadonlyArray<JobState> = ["wait", "active", "completed", "failed", "delayed"]

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`redis timeout after ${ms}ms`)), ms))
  ])
}

interface RawJob {
  queue: string
  jobId: string
  state: JobState
  name: string
  data: unknown
  returnValue: unknown
  failedReason: string | null
  attemptsMade: number
  timestamp: number | null
  processedOn: number | null
  finishedOn: number | null
}

export function makeRedisRepo(url: string): import("./queries.ts").Repo {
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null
  })
  redis.on("error", () => {}) // keep the process alive on connection drops; callers time out

  const ready = async () => {
    if (redis.status === "ready") return
    await withTimeout(redis.connect())
  }

  const scanQueues = async (): Promise<string[]> => {
    await ready()
    const queues = new Set<string>()
    let cursor = "0"
    do {
      const [next, keys] = await withTimeout(redis.scan(cursor, "MATCH", "bull:*:id", "COUNT", 500))
      cursor = next
      for (const key of keys) {
        // bull:<queue>:id
        const parts = key.split(":")
        if (parts.length >= 3 && parts[parts.length - 1] === "id") {
          queues.add(parts.slice(1, -1).join(":"))
        }
      }
    } while (cursor !== "0" && queues.size < 200)
    return [...queues].sort()
  }

  const jobIds = async (queue: string, state: JobState, limit = SCAN_WINDOW): Promise<string[]> => {
    if (state === "completed" || state === "failed" || state === "delayed") {
      // newest-first zsets ordered by score desc
      const ids = await withTimeout(redis.zrange(`bull:${queue}:${state}`, 0, limit - 1))
      return ids.reverse()
    }
    if (state === "active") {
      return withTimeout(redis.lrange(`bull:${queue}:${state}`, 0, limit - 1))
    }
    // wait list + paused marker set fallback → treat as wait
    return withTimeout(redis.lrange(`bull:${queue}:wait`, 0, limit - 1))
  }

  const fetchJob = async (queue: string, jobId: string, state: JobState): Promise<RawJob | null> => {
    const raw = await withTimeout(redis.hgetall(`bull:${queue}:${jobId}`))
    if (!raw || Object.keys(raw).length === 0) return null
    let data: unknown = null
    let returnValue: unknown = null
    try {
      data = JSON.parse(raw.data ?? "null")
    } catch {
      data = raw.data ?? null
    }
    try {
      returnValue = JSON.parse(raw.returnvalue ?? "null")
    } catch {
      returnValue = raw.returnvalue ?? null
    }
    return {
      queue,
      jobId,
      state,
      name: raw.name ?? jobId,
      data,
      returnValue,
      failedReason: raw.failedReason || null,
      attemptsMade: Number(raw.attemptsMade ?? 0),
      timestamp: raw.timestamp ? Number(raw.timestamp) : null,
      processedOn: raw.processedOn ? Number(raw.processedOn) : null,
      finishedOn: raw.finishedOn ? Number(raw.finishedOn) : null
    }
  }

  const collectJobs = async (limit: number): Promise<RawJob[]> => {
    const queues = await scanQueues()
    const jobs: RawJob[] = []
    const perQueue = Math.max(Math.ceil(limit / Math.max(queues.length, 1)), 10)
    for (const q of queues) {
      for (const state of STATES) {
        const ids = await jobIds(q, state, perQueue)
        for (const id of ids) {
          const job = await fetchJob(q, id, state)
          if (job) jobs.push(job)
          if (jobs.length >= limit) return jobs.slice(0, limit)
        }
      }
    }
    return jobs
  }

  const statusOf = (state: JobState): string => {
    switch (state) {
      case "wait":
        return "pending"
      case "active":
        return "inflight"
      case "delayed":
        return "scheduled"
      case "completed":
        return "done"
      case "failed":
        return "done"
      default:
        return "pending"
    }
  }

  const toMessageView = (j: RawJob) => ({
    id: `${j.queue}:${j.jobId}`,
    messageId: j.jobId,
    shardId: "",
    entityType: j.queue,
    entityId: j.jobId,
    kind: j.name,
    tag: j.queue,
    payload: JSON.stringify(j.data),
    headers: null,
    traceId: null,
    processed: j.state === "completed",
    lastRead: j.processedOn ? new Date(j.processedOn).toISOString().slice(0, 19).replace("T", " ") : null,
    deliverAt: null,
    createdAt: j.timestamp ?? 0,
    status: statusOf(j.state),
    failed: j.state === "failed",
    replyCount: 0
  })

  // ---------------------------------------------------------------- repo API

  const listMessages = (query: MessageQuery = {}) => {
    const all = collectJobs(SCAN_WINDOW)
    return all.then((jobs) => {
      let rows = jobs.map(toMessageView)
      if (query.status) rows = rows.filter((r) => r.status === query.status)
      if (query.entityType) rows = rows.filter((r) => r.entityType === query.entityType)
      if (query.entityId) rows = rows.filter((r) => r.entityId === query.entityId)
      if (query.q) {
        const q = query.q.toLowerCase()
        rows = rows.filter(
          (r) =>
            r.entityId.toLowerCase().includes(q) ||
            r.entityType.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q)
        )
      }
      rows.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200)
      const page = Math.max(query.page ?? 1, 1)
      return {
        total: rows.length,
        page,
        pageSize,
        rows: rows.slice((page - 1) * pageSize, page * pageSize)
      }
    })
  }

  const getMessage = (id: string) =>
    collectJobs(SCAN_WINDOW).then((jobs) => {
      const j = jobs.find((x) => `${x.queue}:${x.jobId}` === id)
      if (!j) return null
      return {
        ...toMessageView(j),
        replies: [],
        result:
          j.state === "failed" ?
            { outcome: "failure", error: j.failedReason } :
            j.returnValue !== null && j.returnValue !== undefined ?
            { outcome: "success", value: j.returnValue } :
            null
      }
    })

  const overview = () =>
    collectJobs(SCAN_WINDOW).then((jobs) => {
      const counts = { pending: 0, inflight: 0, scheduled: 0, done: 0, failed: 0 }
      const perQueue = new Map<string, number>()
      for (const j of jobs) {
        counts[statusOf(j.state) as keyof typeof counts]++
        perQueue.set(j.queue, (perQueue.get(j.queue) ?? 0) + 1)
      }
      const topEntities = [...perQueue.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([entityType, total]) => ({ entityType, total, active: 0 }))
      return {
        messages: counts,
        runners: { total: 0 },
        shards: { total: 0, assigned: 0 },
        unassignedShards: 0,
        topEntities,
        topWorkflows: [],
        serverTime: Date.now()
      }
    })

  const entities = () =>
    collectJobs(SCAN_WINDOW).then((jobs) => {
      const byQueue = new Map<string, { count: number; last: number; states: Record<string, number> }>()
      for (const j of jobs) {
        const e = byQueue.get(j.queue) ?? { count: 0, last: 0, states: {} }
        e.count++
        e.last = Math.max(e.last, j.timestamp ?? 0)
        e.states[j.state] = (e.states[j.state] ?? 0) + 1
        byQueue.set(j.queue, e)
      }
      return [...byQueue.entries()].map(([entityType, e]) => ({
        entityType,
        entities: e.count,
        messages: e.count,
        done: e.states.completed ?? 0,
        scheduled: e.states.delayed ?? 0,
        inflight: e.states.active ?? 0,
        pending: e.states.wait ?? 0,
        lastActivityAt: e.last || null
      }))
    })

  const allSync = <T,>(value: T): Promise<T> => Promise.resolve(value)

  const repo = {
    db: null as never,
    prefix: "redis",
    listMessages: (q?: MessageQuery) => listMessages(q ?? {}),
    getMessage,
    overview: () => overview(),
    runners: () => allSync([]),
    shards: () => allSync([]),
    entities: () => entities(),
    entityInstances: (_entityType: string, _opts?: unknown) =>
      allSync({ rows: [], total: 0, page: 1, pageSize: 50 }),
    crons: () => allSync([]),
    workflows: () => allSync([]),
    workflowRuns: (_name: string) => allSync([]),
    workflowRun: (_name: string, _executionId: string) => allSync(null),
    traces: (_limit?: number) => allSync([]),
    trace: (_traceId: string) => allSync([])
  }

  // write actions exposed via the same action-handler path need db/prefix —
  // redis clusters route writes through these instead:
  const actions = {
    async retry(id: string) {
      assertWritable(config.readonly)
      const [queue, jobId] = splitId(id)
      await ready()
      // best-effort: move from failed back to wait
      await withTimeout(
        redis.zrem(`bull:${queue}:failed`, jobId).then(() => redis.lpush(`bull:${queue}:wait`, jobId))
      )
      return { ok: true as const }
    },
    async delete(id: string) {
      assertWritable(config.readonly)
      const [queue, jobId] = splitId(id)
      await ready()
      await withTimeout(
        Promise.all([
          redis.del(`bull:${queue}:${jobId}`),
          redis.zrem(`bull:${queue}:failed`, jobId),
          redis.zrem(`bull:${queue}:completed`, jobId),
          redis.zrem(`bull:${queue}:delayed`, jobId),
          redis.lrem(`bull:${queue}:wait`, 0, jobId),
          redis.lrem(`bull:${queue}:active`, 0, jobId)
        ])
      )
      return { ok: true as const }
    }
  }

  return repo as unknown as import("./queries.ts").Repo & { actions: typeof actions }
}

function splitId(id: string): [string, string] {
  const idx = id.indexOf(":")
  if (idx <= 0 || idx === id.length - 1) throw new ActionError(`invalid redis job id: ${id}`, 400)
  return [id.slice(0, idx), id.slice(idx + 1)]
}
