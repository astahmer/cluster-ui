/* ------------------------------------------------------------------ types -- */

export type MessageStatus = "pending" | "inflight" | "scheduled" | "done"

export interface Overview {
  messages: { pending: number; inflight: number; scheduled: number; done: number; failed: number }
  runners: { total: number }
  shards: { total: number; assigned: number }
  unassignedShards: number
  topEntities: { entityType: string; total: number; active: number }[]
  topWorkflows: { name: string; runs: number }[]
  serverTime: number
}

export interface Runner {
  address: string
  host: string | null
  port: number | null
  groups: string[]
  version: number | null
  shards: number
  stale?: boolean
}

export interface Shard {
  shardId: string
  address: string | null
}

export interface EntityStat {
  entityType: string
  entities: number
  messages: number
  done: number
  scheduled: number
  inflight: number
  pending: number
  lastActivityAt: number | null
}

export interface Message {
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
  failed?: boolean
  lastRead: string | null
  deliverAt: number | null
  createdAt: number
  machineId: number
  replyCount: number
}

export interface MessageList {
  rows: Message[]
  total: number
  page: number
  pageSize: number
}

export interface Reply {
  id: string
  requestId: string
  kind: string
  payload: unknown
  sequence: number | null
  acked: boolean
}

export interface RunResult {
  outcome: "Success" | "Failure"
  exit: unknown
}

export interface MessageDetail {
  message: Message
  payload: unknown
  headers: unknown
  replies: Reply[]
  /** present when any WithExit reply exists */
  result?: RunResult
}

export interface Workflow {
  name: string
  runs: number
  completedRuns: number
  activeRuns: number
  failedRuns?: number
  lastActivityAt: number | null
}

export interface WorkflowRun {
  executionId: string
  runMessageId: string
  status: MessageStatus
  createdAt: number
  activityCount: number
}

export interface WorkflowRunDetail {
  run: (Message & { payload?: unknown }) | null
  activities: {
    id: string
    tag: string | null
    kind: string
    status: MessageStatus
    payload: unknown
    createdAt: number
  }[]
}

export interface EntityInstance {
  entityId: string
  total: number
  pending: number
  inflight: number
  scheduled: number
  done: number
  failed: number
  lastActivityAt: number | null
}

export interface EntityInstanceList {
  rows: EntityInstance[]
  total: number
  page: number
  pageSize: number
}

export interface CronJob {
  name: string
  entityType: string
  lastRunAt: number | null
  nextRunAt: number | null
  lastStatus: MessageStatus | "unknown"
}

export interface MetricPoint {
  t: number
  pending: number
  inflight: number
  scheduled: number
  done: number
  failed: number
  unassignedShards: number
}

export interface AppConfig {
  clusters: string[]
  clusterKinds?: { name: string; kind: "sqlite" | "redis" }[]
  tracingUrlTemplate: string | null
}

export interface JobTreeNode {
  id: string
  label: string
  state?: string
  children?: JobTreeNode[]
}

/* ------------------------------------------------------- token & clusters -- */

const TOKEN_KEY = "cluster_ui_token"
const CLUSTER_KEY = "cluster_ui_cluster"

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function getCluster(): string | null {
  try {
    return localStorage.getItem(CLUSTER_KEY)
  } catch {
    return null
  }
}

const clusterListeners = new Set<(cluster: string | null) => void>()

/** Subscribe to cluster changes (same-tab + cross-tab). Returns an unsubscribe fn. */
export function onClusterChange(fn: (cluster: string | null) => void): () => void {
  clusterListeners.add(fn)
  return () => {
    clusterListeners.delete(fn)
  }
}

export function setCluster(name: string | null) {
  if (name === null) localStorage.removeItem(CLUSTER_KEY)
  else localStorage.setItem(CLUSTER_KEY, name)
  for (const fn of clusterListeners) fn(name)
}

/** fired when any API response comes back 401 — the shell shows a login gate */
export const AUTH_REQUIRED_EVENT = "auth:required"

function withCluster(path: string): string {
  const cluster = getCluster()
  if (!cluster || !path.startsWith("/api/")) return path
  return `${path}${path.includes("?") ? "&" : "?"}cluster=${encodeURIComponent(cluster)}`
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const token = getToken()
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`)

  const res = await fetch(withCluster(path), { ...init, headers })

  if (res.status === 401 && !path.startsWith("/api/auth")) {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT))
    throw new ApiError(401, "unauthorized")
  }
  if (!res.ok) {
    let message = `${res.status} ${path}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* non-json error body */
    }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

/** JSON-RPC call against the stateless MCP endpoint (POST /mcp). */
export async function mcpRpc(
  method: string,
  params?: Record<string, unknown>
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const body = await post<{
    result?: unknown
    error?: { code: number; message: string }
  }>("/mcp", { jsonrpc: "2.0", id: Date.now() % 1_000_000, method, ...(params ? { params } : {}) })
  return body
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  })
}

/* ----------------------------------------------------------------- client -- */

export interface MessagesQuery {
  status?: string
  entityType?: string
  entityId?: string
  q?: string
  page?: number
  pageSize?: number
  failed?: boolean
  createdAfter?: number
  createdBefore?: number
  sort?: "id" | "deliverAt"
}

export interface AuthResponse {
  ok: boolean
}

export type BulkActionKind = "retry" | "interrupt" | "delete"

/** One entry per submitted id; failed ids carry an error message. */
export interface BulkActionResult {
  id: string
  ok: boolean
  error?: string
}

export interface ReporterSingletonInfo {
  name: string
  address?: string | null
  startedAt?: number | string | null
}

export interface QueueInfo {
  name: string
  paused: boolean
}

export interface TraceSummary {
  traceId: string
  count: number
  kinds: string[]
  services: string[]
  firstAt: number
  lastAt: number
}

export interface RunnerReport {
  address: string
  state?: {
    singletons?: ReporterSingletonInfo[]
    entitiesInMemory?: number
    registeredEntityTypes?: string[]
  }
  error?: string
}

export interface ReporterLogLine {
  t: number
  level?: string | null
  text: string
}

export interface RunnerLogsReport {
  address: string
  lines?: ReporterLogLine[]
  error?: string
}

export interface ReporterFiber {
  id: string
  name?: string | null
  status: string
  startedAt?: number | string | null
  children?: number | null
}

export interface RunnerFibersReport {
  address: string
  fibers?: ReporterFiber[]
  error?: string
}

export const api = {
  runnerLogs: (cluster?: string) =>
    get<{ runners: RunnerLogsReport[] }>(
      "/api/logs" + (cluster ? `?cluster=${encodeURIComponent(cluster)}` : "")
    ),
  runnerFibers: (cluster?: string) =>
    get<{ runners: RunnerFibersReport[] }>(
      "/api/fibers" + (cluster ? `?cluster=${encodeURIComponent(cluster)}` : "")
    ),
  overview: () => get<Overview>("/api/overview"),
  runners: () => get<Runner[]>("/api/runners"),
  shards: () => get<Shard[]>("/api/shards"),
  entities: () => get<EntityStat[]>("/api/entities"),
  entityInstances: (q: {
    entityType: string
    q?: string
    page?: number
    pageSize?: number
  }) =>
    get<EntityInstanceList>(
      `/api/entity-instances?${new URLSearchParams(
        Object.entries(q)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)])
      )}`
    ),
  crons: () => get<CronJob[]>("/api/crons"),
  traces: () => get<TraceSummary[]>("/api/traces"),
  queues: (q?: { cluster?: string }) =>
    get<QueueInfo[]>("/api/queues" + (q?.cluster ? `?cluster=${encodeURIComponent(q.cluster)}` : "")),
  pauseQueue: (queue: string, cluster?: string) =>
    post<{ ok: true }>("/api/actions/pause-queue", { queue, ...(cluster ? { cluster } : {}) }),
  resumeQueue: (queue: string, cluster?: string) =>
    post<{ ok: true }>("/api/actions/resume-queue", { queue, ...(cluster ? { cluster } : {}) }),
  jobTree: (id: string) => get<JobTreeNode>(`/api/job-tree/${encodeURIComponent(id)}`),
  trace: (traceId: string) =>
    get<{ traceId: string; rows: Message[] }>(`/api/traces/${encodeURIComponent(traceId)}`),
  singletons: () => get<{ runners: RunnerReport[] }>("/api/singletons"),
  metricsHistory: (opts?: { rangeMs?: number }) =>
    get<MetricPoint[]>(
      "/api/metrics/history" + (opts?.rangeMs ? `?rangeMs=${opts.rangeMs}` : "")
    ),
  config: () => get<AppConfig>("/api/config"),
  clusters: () => get<{ name: string }[]>("/api/clusters"),

  messages: (q: MessagesQuery) =>
    get<MessageList>(
      "/api/messages?" +
        Object.entries(q)
          .filter(([, v]) => v !== undefined && v !== "" && v !== false)
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join("&")
    ),
  message: (id: string) => get<MessageDetail>(`/api/messages/${id}`),

  workflows: () => get<Workflow[]>("/api/workflows"),
  workflowRuns: (name: string) => get<WorkflowRun[]>(`/api/workflows/${encodeURIComponent(name)}`),
  workflowRun: (name: string, executionId: string) =>
    get<WorkflowRunDetail>(
      `/api/workflows/${encodeURIComponent(name)}/${encodeURIComponent(executionId)}`
    ),

  retryMessage: (messageId: string) => post<{ ok: true }>("/api/actions/retry", { messageId }),
  interruptMessage: (messageId: string) => post<{ ok: true }>("/api/actions/interrupt", { messageId }),
  resetActivity: (messageId: string) =>
    post<{ ok: true }>("/api/actions/reset-activity", { messageId }),
  deleteMessage: (messageId: string) => post<{ ok: true }>("/api/actions/delete", { messageId }),

  /** Apply an action to many messages at once; per-id results, batch never hard-fails. */
  bulkActions: (action: BulkActionKind, ids: ReadonlyArray<string>) =>
    post<BulkActionResult[]>("/api/actions/bulk", { ids: [...ids], action }),

  login: (token: string) => post<AuthResponse>("/api/auth", { token })
}

/**
 * SSE endpoint URL for EventSource. EventSource cannot send Authorization
 * headers — cookie auth works; when only header-token auth is configured the
 * stream will fail and `live.ts` transparently falls back to polling.
 */
export function eventsUrl(): string {
  return withCluster("/api/events")
}
