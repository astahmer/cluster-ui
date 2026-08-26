import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { isIP } from "node:net"
import { lookup } from "node:dns/promises"
import { Agent } from "undici"
import type { Repo } from "./queries.ts"

export type Role = "viewer" | "operator" | "admin"
export type AlertMetric = "failed" | "pending" | "scheduled" | "inflight" | "unassignedShards" | "runners"
export type AlertOperator = "gt" | "gte" | "eq"

export interface AlertRule {
  id: string
  name: string
  cluster: string
  metric: AlertMetric
  operator: AlertOperator
  threshold: number
  durationMs: number
  webhookUrl: string
  enabled: boolean
  lastTriggeredAt: number | null
}

export interface AuditEntry {
  timestamp: number
  actor: string
  role: Role
  action: string
  cluster: string
  target: string
  success: true
}

interface StateFile { alerts: AlertRule[]; audit: AuditEntry[] }
const stateFile = resolve(process.env.CLUSTER_UI_STATE_FILE ?? "./data/cluster-ui-state.json")
const MAX_ALERTS = 100
const MAX_AUDIT = 1000
const REDACTED_WEBHOOK = "[configured]"
const state: StateFile = { alerts: [], audit: [] }
let loaded = false
const trueSince = new Map<string, number>()
const lastDelivery = new Map<string, number>()
const COOLDOWN_MS = 5 * 60_000

function load() {
  if (loaded) return
  loaded = true
  try {
    if (existsSync(stateFile)) {
      const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as Partial<StateFile>
      if (Array.isArray(parsed.alerts)) state.alerts = parsed.alerts.slice(0, MAX_ALERTS)
      if (Array.isArray(parsed.audit)) state.audit = parsed.audit.slice(-MAX_AUDIT)
    }
  } catch {
    // Corrupt optional state must not prevent the dashboard from starting.
  }
}
function save() {
  try {
    mkdirSync(dirname(stateFile), { recursive: true })
    writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 })
  } catch {
    // Persistence is best-effort; runtime operations remain available.
  }
}

export function validateWebhookUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("webhookUrl must be a URL")
  let url: URL
  try { url = new URL(value) } catch { throw new Error("webhookUrl must be a URL") }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("webhookUrl must use http or https")
  if (url.username || url.password) throw new Error("webhookUrl must not contain credentials")
  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1") {
    throw new Error("webhookUrl host is not allowed")
  }
  if (isPrivateAddress(host)) throw new Error("webhookUrl host is private")
  return url.toString()
}

function isPrivateAddress(value: string): boolean {
  const host = value.replace(/^\[|\]$/g, "").toLowerCase()
  const mappedDotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mappedDotted) return isPrivateAddress(mappedDotted[1])
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16)
    const low = Number.parseInt(mappedHex[2], 16)
    return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  const ip = isIP(host)
  if (ip === 4) {
    const p = host.split(".").map(Number)
    const value = (((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3]) >>> 0
    const first16 = (p[0] * 256 + p[1]) >>> 0
    return p.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ||
      p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || p[0] === 255 ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && (p[1] === 0 || p[1] === 168)) ||
      (p[0] === 198 && (p[1] === 18 || p[1] === 51)) ||
      (p[0] === 203 && p[1] === 0 && p[2] === 113) ||
      first16 === 0xc612 || first16 === 0xc633 || value === 0xffffffff
  }
  if (ip === 6) {
    if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") ||
      /^fe[89ab]/.test(host) || host.startsWith("2001:db8:") || host.startsWith("ff")) return true
    const first = Number.parseInt(host.split(":")[0] || "0", 16)
    return !Number.isFinite(first) || first < 0x2000 || first > 0x3fff
  }
  return false
}

async function assertSafeWebhookDestination(webhookUrl: string): Promise<{ address: string; family: number }> {
  const url = new URL(webhookUrl)
  if (isPrivateAddress(url.hostname)) throw new Error("webhookUrl host is private")
  try {
    const addresses = await lookup(url.hostname, { all: true })
    const safe = addresses.filter((entry) => !isPrivateAddress(entry.address))
    if (safe.length === 0) throw new Error("webhookUrl resolves to a private host")
    return safe[0]
  } catch (error) {
    if (error instanceof Error && error.message.includes("private")) throw error
    throw new Error("webhookUrl host could not be resolved")
  }
}

function normalizeRule(input: unknown, existing?: AlertRule): AlertRule {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : existing?.name ?? ""
  const cluster = typeof body.cluster === "string" ? body.cluster.trim().slice(0, 120) : existing?.cluster ?? ""
  const metric = body.metric ?? existing?.metric
  const operator = body.operator ?? existing?.operator
  const threshold = Number(body.threshold ?? existing?.threshold)
  const durationMs = Number(body.durationMs ?? existing?.durationMs ?? 0)
  if (!name || !cluster) throw new Error("name and cluster are required")
  if (!["failed", "pending", "scheduled", "inflight", "unassignedShards", "runners"].includes(String(metric))) throw new Error("invalid metric")
  if (!["gt", "gte", "eq"].includes(String(operator))) throw new Error("invalid operator")
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1_000_000_000) throw new Error("threshold is out of range")
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 7 * 24 * 60 * 60_000) throw new Error("durationMs is out of range")
  const webhookValue = body.webhookUrl === REDACTED_WEBHOOK ? existing?.webhookUrl : body.webhookUrl ?? existing?.webhookUrl
  return {
    id: existing?.id ?? crypto.randomUUID(), name, cluster,
    metric: metric as AlertMetric, operator: operator as AlertOperator,
    threshold, durationMs: Math.floor(durationMs),
    webhookUrl: validateWebhookUrl(webhookValue),
    enabled: typeof body.enabled === "boolean" ? body.enabled : existing?.enabled ?? true,
    lastTriggeredAt: existing?.lastTriggeredAt ?? null
  }
}

export function listAlerts(): AlertRule[] {
  load()
  return state.alerts.map((x) => ({ ...x, webhookUrl: REDACTED_WEBHOOK }))
}
export function createAlert(input: unknown): AlertRule { load(); if (state.alerts.length >= MAX_ALERTS) throw new Error("alert limit reached"); const rule = normalizeRule(input); state.alerts.push(rule); save(); return rule }
export function updateAlert(id: string, input: unknown): AlertRule | null { load(); const i = state.alerts.findIndex((x) => x.id === id); if (i < 0) return null; const rule = normalizeRule(input, state.alerts[i]); state.alerts[i] = rule; save(); return rule }
export function alertCluster(id: string): string { load(); return state.alerts.find((x) => x.id === id)?.cluster ?? "*" }
export function deleteAlert(id: string): boolean { load(); const i = state.alerts.findIndex((x) => x.id === id); if (i < 0) return false; state.alerts.splice(i, 1); save(); trueSince.delete(id); lastDelivery.delete(id); return true }

export function recordAudit(entry: Omit<AuditEntry, "timestamp" | "success">) { load(); state.audit.push({ ...entry, timestamp: Date.now(), success: true }); if (state.audit.length > MAX_AUDIT) state.audit.splice(0, state.audit.length - MAX_AUDIT); save() }
export function listAudit(limit = 100): AuditEntry[] { load(); return state.audit.slice(-Math.min(Math.max(Math.floor(limit) || 100, 1), 200)).reverse() }

function metricValue(overview: any, metric: AlertMetric): number {
  return metric === "unassignedShards" ? Number(overview.unassignedShards ?? 0) : metric === "runners" ? Number(overview.runners?.total ?? 0) : Number(overview.messages?.[metric] ?? 0)
}
function matches(value: number, op: AlertOperator, threshold: number): boolean { return op === "gt" ? value > threshold : op === "gte" ? value >= threshold : value === threshold }

async function deliver(rule: AlertRule, value: number, test = false) {
  const destination = await assertSafeWebhookDestination(rule.webhookUrl)
  // Pin the already-validated DNS result for this request. This prevents a
  // hostname from being re-resolved to a private address between validation
  // and connection establishment (DNS rebinding).
  const dispatcher = new Agent({
    connect: {
      lookup: ((
        _hostname: string,
        _options: unknown,
        callback: (error: Error | null, address?: string, family?: number) => void
      ) => callback(null, destination.address, destination.family)) as never
    }
  })
  try {
    const response = await fetch(rule.webhookUrl, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/json", "user-agent": "cluster-ui-alerts" },
      body: JSON.stringify({ type: test ? "cluster-ui.alert.test" : "cluster-ui.alert", ruleId: rule.id, ruleName: rule.name, cluster: rule.cluster, metric: rule.metric, operator: rule.operator, threshold: rule.threshold, value, triggeredAt: Date.now() }),
      signal: AbortSignal.timeout(5000),
      dispatcher
    } as RequestInit & { dispatcher: Agent })
    if (!response.ok) throw new Error(`webhook returned ${response.status}`)
  } finally {
    await dispatcher.close()
  }
}

export async function testAlert(id: string): Promise<{ ok: true }> { load(); const rule = state.alerts.find((x) => x.id === id); if (!rule) throw new Error("alert not found"); const value = 0; await deliver(rule, value, true); return { ok: true } }

export function startAlertMonitor(getRepos: () => ReadonlyArray<[string, Repo]>) {
  const tick = async () => {
    load()
    for (const rule of state.alerts) {
      if (!rule.enabled) { trueSince.delete(rule.id); continue }
      const repo = getRepos().find(([name]) => name === rule.cluster)?.[1]
      if (!repo) continue
      try {
        const overview = await Promise.resolve(repo.overview())
        const value = metricValue(overview, rule.metric)
        const now = Date.now()
        if (!matches(value, rule.operator, rule.threshold)) { trueSince.delete(rule.id); continue }
        const started = trueSince.get(rule.id) ?? now
        trueSince.set(rule.id, started)
        const deliveredAt = lastDelivery.get(rule.id) ?? rule.lastTriggeredAt ?? 0
        lastDelivery.set(rule.id, deliveredAt)
        if (now - started < rule.durationMs || now - deliveredAt < COOLDOWN_MS) continue
        try {
          await deliver(rule, value)
          lastDelivery.set(rule.id, now)
          rule.lastTriggeredAt = now
          save()
        } catch {
          // Webhook outages must not kill monitoring.
        }
      } catch {
        // A broken cluster must not affect other rules.
      }
    }
  }
  void tick()
  const timer = setInterval(() => { void tick() }, 15_000)
  timer.unref?.()
}

export function roleFromEnv(authEnabled: boolean): Role {
  const raw = process.env.CLUSTER_UI_ROLE
  return raw === "viewer" || raw === "operator" || raw === "admin" ? raw : authEnabled ? "operator" : "admin"
}
export const role: Role = roleFromEnv(Boolean(process.env.CLUSTER_UI_TOKEN))
export const actor = process.env.CLUSTER_UI_ACTOR?.trim().slice(0, 120) || role
export function requireOperator() { if (role === "viewer") throw new Error("operator role required") }
export function statePath() { return stateFile }
