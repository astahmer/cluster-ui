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
      const ids = await withTimeout(redis.zrange(`bull:${queue}:${state}`, 0, `${limit - 1}`))
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
        // failed jobs keep their own bucket even though view status is "done"
        if (j.state === "failed") counts.failed++
        else counts[statusOf(j.state) as keyof typeof counts]++
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
    trace: (_traceId: string) => allSync([]),
    queues: () => queues(),
    jobTree: (id: string) => jobTree(id)
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
    },
    async pauseQueue(queue: string) {
      assertWritable(config.readonly)
      await ready()
      await withTimeout(redis.lpush(`bull:${queue}:paused`, "1"))
      return { ok: true as const }
    },
    async resumeQueue(queue: string) {
      assertWritable(config.readonly)
      await ready()
      await withTimeout(redis.lrem(`bull:${queue}:paused`, 0, "1"))
      return { ok: true as const }
    },
    async promote(id: string) {
      assertWritable(config.readonly)
      const [queue, jobId] = splitId(id)
      await ready()
      // BullMQ's promote moves delayed → wait; zrem + lpush is enough for dashboard semantics
      const removed = await withTimeout(redis.zrem(`bull:${queue}:delayed`, jobId))
      if (removed === 0) {
        throw new ActionError(`job ${id} is not delayed`, 400)
      }
      await withTimeout(redis.lpush(`bull:${queue}:wait`, jobId))
      return { ok: true as const }
    },
    async clean(
      queue: string,
      state: "completed" | "failed",
      opts: { olderThanMs?: number; count?: number } = {}
    ) {
      if (queue === "*") {
        const names = await scanQueues()
        let removed = 0
        for (const q of names) {
          const r = await actions.clean(q, state, opts)
          removed += r.removed
        }
        return { removed }
      }
      assertWritable(config.readonly)
      await ready()
      const cap = Math.min(Math.max(opts.count ?? 500, 1), 1000)
      const maxScore = opts.olderThanMs !== undefined ? Date.now() - opts.olderThanMs : "+inf"
      // oldest-first up to cap
      const ids =
        opts.olderThanMs !== undefined ?
          await withTimeout(redis.zrangebyscore(`bull:${queue}:${state}`, "-inf", maxScore, "LIMIT", 0, cap)) :
          (await withTimeout(redis.zrange(`bull:${queue}:${state}`, 0, `${cap - 1}`))).slice(0, cap).reverse()
      let removed = 0
      for (const jobId of ids) {
        await withTimeout(
          Promise.all([
            redis.del(`bull:${queue}:${jobId}`),
            redis.del(`bull:${queue}:${jobId}:children`),
            redis.zrem(`bull:${queue}:${state}`, jobId)
          ])
        )
        removed++
      }
      return { removed }
    },
    async addJob(queue: string, name: string, data: unknown) {
      assertWritable(config.readonly)
      await ready()
      // minimal BullMQ-compatible job: hash + wait list + id marker set
      const jobId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      await withTimeout(
        Promise.all([
          redis.hset(`bull:${queue}:${jobId}`, {
            name,
            data: JSON.stringify(data ?? null),
            timestamp: String(Date.now()),
            attemptsMade: "0",
            delay: "0",
            priority: "0"
          }),
          redis.lpush(`bull:${queue}:wait`, jobId),
          redis.sadd(`bull:${queue}:id`, jobId)
        ])
      )
      return { ok: true as const, id: `${queue}:${jobId}` }
    }
  }

  /** per-queue paused state for the queues listing */
  const queues = () =>
    scanQueues().then(async (names) => {
      const out: Array<{ name: string; paused: boolean }> = []
      for (const name of names) {
        const paused = await withTimeout(redis.llen(`bull:${name}:paused`))
        out.push({ name, paused: paused > 0 })
      }
      return out
    })

  /** parent/child flow tree rooted at the job's root (BullMQ parentKey conventions) */
  const jobTree = async (id: string): Promise<object | null> => {
    await ready()
    const [rootQueue, rootJobId] = splitId(id)

    const fetchRaw = async (queue: string, jobId: string): Promise<Record<string, string> | null> => {
      const raw = await withTimeout(redis.hgetall(`bull:${queue}:${jobId}`))
      return raw && Object.keys(raw).length > 0 ? raw : null
    }

    // walk up to the root via parentKey
    let queue = rootQueue
    let jobId = rootJobId
    for (let depth = 0; depth < 8; depth++) {
      const raw = await fetchRaw(queue, jobId)
      if (!raw) break
      const parentKey = raw.parentKey ?? ""
      if (!parentKey) break
      // parentKey = bull:<parentQueue>:<parentId>
      const parts = parentKey.split(":")
      if (parts.length < 3 || parts[0] !== "bull") break
      queue = parts.slice(1, -1).join(":")
      jobId = parts[parts.length - 1]
    }

    const buildNode = async (q: string, jid: string, depth: number): Promise<object | null> => {
      const raw = await fetchRaw(q, jid)
      if (!raw) return null
      let state: JobState = "wait"
      for (const s of STATES) {
        const member =
          s === "completed" || s === "failed" || s === "delayed" ?
            await withTimeout(redis.zscore(`bull:${q}:${s}`, jid)) :
            null
        if (member !== null) {
          state = s
          break
        }
      }
      const view = toMessageView({
        queue: q,
        jobId: jid,
        state,
        name: raw.name ?? jid,
        data: safeParse(raw.data),
        returnValue: safeParse(raw.returnvalue),
        failedReason: raw.failedReason || null,
        attemptsMade: Number(raw.attemptsMade ?? 0),
        timestamp: raw.timestamp ? Number(raw.timestamp) : null,
        processedOn: raw.processedOn ? Number(raw.processedOn) : null,
        finishedOn: raw.finishedOn ? Number(raw.finishedOn) : null
      })
      const node: Record<string, unknown> = { job: view, children: [] }
      if (depth < 8) {
        const childIds = await withTimeout(redis.smembers(`bull:${q}:${jid}:children`))
        for (const childId of childIds.slice(0, 50)) {
          // child ids are stored as "<queue>:<jobId>" (our seed convention) or bare
          // BullMQ job ids living in the same queue; resolve both
          const sep = childId.indexOf(":")
          const [childQueue, childJob] =
            sep > 0 ? [childId.slice(0, sep), childId.slice(sep + 1)] : [q, childId]
          const child = await buildNode(childQueue, childJob, depth + 1)
          if (child) (node.children as unknown[]).push(child)
        }
      }
      return node
    }

    const tree = await buildNode(queue, jobId, 0)
    return tree
  }

  function safeParse(v: string | undefined): unknown {
    try {
      return JSON.parse(v ?? "null")
    } catch {
      return v ?? null
    }
  }

  return repo as unknown as import("./queries.ts").Repo & RedisRepoExtras
}

/** surface api.ts uses for redis-only routes (queues controls, job tree) */
export interface RedisRepoExtras {
  actions: {
    retry: (id: string) => Promise<{ ok: true }>
    delete: (id: string) => Promise<{ ok: true }>
    pauseQueue: (queue: string) => Promise<{ ok: true }>
    resumeQueue: (queue: string) => Promise<{ ok: true }>
    promote: (id: string) => Promise<{ ok: true }>
    clean: (
      queue: string,
      state: "completed" | "failed",
      opts?: { olderThanMs?: number; count?: number }
    ) => Promise<{ removed: number }>
    addJob: (queue: string, name: string, data: unknown) => Promise<{ ok: true; id: string }>
  }
  queues: () => Promise<Array<{ name: string; paused: boolean }>>
  jobTree: (id: string) => Promise<object | null>
}

function splitId(id: string): [string, string] {
  const idx = id.indexOf(":")
  if (idx <= 0 || idx === id.length - 1) throw new ActionError(`invalid redis job id: ${id}`, 400)
  return [id.slice(0, idx), id.slice(idx + 1)]
}
