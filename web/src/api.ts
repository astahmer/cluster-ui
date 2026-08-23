export interface Overview {
  messages: { pending: number; inflight: number; scheduled: number; done: number }
  runners: { total: number }
  shards: { total: number; assigned: number }
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

export type MessageStatus = "pending" | "inflight" | "scheduled" | "done"

export interface Message {
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

export interface MessageDetail {
  message: Message
  payload: unknown
  headers: unknown
  replies: Reply[]
}

export interface Workflow {
  name: string
  runs: number
  completedRuns: number
  activeRuns: number
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json() as Promise<T>
}

export const api = {
  overview: () => get<Overview>("/api/overview"),
  runners: () => get<Runner[]>("/api/runners"),
  shards: () => get<Shard[]>("/api/shards"),
  entities: () => get<EntityStat[]>("/api/entities"),
  messages: (q: Record<string, string | number | undefined>) =>
    get<MessageList>(
      "/api/messages?" +
        Object.entries(q)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join("&")
    ),
  message: (id: string) => get<MessageDetail>(`/api/messages/${id}`),
  workflows: () => get<Workflow[]>("/api/workflows"),
  workflowRuns: (name: string) => get<WorkflowRun[]>(`/api/workflows/${encodeURIComponent(name)}`),
  workflowRun: (name: string, executionId: string) =>
    get<WorkflowRunDetail>(`/api/workflows/${encodeURIComponent(name)}/${encodeURIComponent(executionId)}`)
}
