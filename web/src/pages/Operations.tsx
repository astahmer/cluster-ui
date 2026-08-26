import * as React from "react"
import { BookmarkSimple, Bell, ShieldCheck, Trash, PencilSimple, PaperPlaneTilt } from "@phosphor-icons/react"
import { api, type AlertMetric, type AlertOperator, type AlertRule, type AuditEntry } from "../api.ts"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from "../components/ui.tsx"
import { ErrorNote, PageHeader, navigate } from "../shell.tsx"
import { useAppConfig } from "../config.ts"
import { toast } from "../toast.tsx"

type SavedView = { id: string; name: string; url: string; createdAt: number }
const SAVED_KEY = "cluster_ui_saved_views"
const metrics: Array<{ value: AlertMetric; label: string }> = [
  { value: "failed", label: "failed messages" }, { value: "pending", label: "pending messages" },
  { value: "scheduled", label: "scheduled messages" }, { value: "inflight", label: "in-flight messages" },
  { value: "unassignedShards", label: "unassigned shards" }, { value: "runners", label: "runners" }
]

function loadViews(): SavedView[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is SavedView => v && typeof v.id === "string" && typeof v.name === "string" && typeof v.url === "string" && v.url.startsWith("/")).slice(0, 100)
  } catch { return [] }
}
function saveViews(views: SavedView[]) { localStorage.setItem(SAVED_KEY, JSON.stringify(views.slice(0, 100))) }

export function OperationsPage() {
  const config = useAppConfig()
  const writable = config !== null && config.readonly !== true && config.role !== "viewer"
  const [views, setViews] = React.useState<SavedView[]>(loadViews)
  const [viewName, setViewName] = React.useState("")
  const [alerts, setAlerts] = React.useState<AlertRule[]>([])
  const [audit, setAudit] = React.useState<AuditEntry[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<AlertRule | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      const [nextAlerts, nextAudit] = await Promise.all([api.alerts(), api.audit(100)])
      setAlerts(nextAlerts); setAudit(nextAudit); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setRefreshing(false); setLoaded(true) }
  }, [])
  React.useEffect(() => { void refresh() }, [refresh])

  const addView = () => {
    const name = viewName.trim().slice(0, 80)
    const url = window.location.hash.slice(1) || "/overview"
    if (!name) return
    const next = [{ id: crypto.randomUUID(), name, url: url.slice(0, 2048), createdAt: Date.now() }, ...views.filter((v) => v.url !== url)]
    setViews(next); saveViews(next); setViewName(""); toast.success("View saved")
  }
  const removeView = (id: string) => { const next = views.filter((v) => v.id !== id); setViews(next); saveViews(next) }

  return <div className="space-y-5">
    <PageHeader title="Operations" subtitle="saved views, alerts, and the write audit trail">
      <Badge tone={config?.role === "viewer" ? "neutral" : config?.role === "admin" ? "ok" : "info"}>{config?.role ?? "loading role…"}</Badge>
      {config?.readonly && <Badge tone="warn">read-only</Badge>}
      <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "refreshing…" : "refresh"}</Button>
    </PageHeader>
    <ErrorNote error={error} onRetry={() => void refresh()} />

    <Card>
      <CardHeader><CardTitle><span className="flex items-center gap-2"><BookmarkSimple className="h-4 w-4" /> Saved views</span></CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-[12px] text-kumo-subtle">Save the current page and filters as a private browser bookmark. Views never contain credentials.</p>
        <div className="mb-4 flex max-w-xl gap-2"><Input aria-label="saved view name" placeholder="e.g. failed checkout messages" value={viewName} onChange={(e) => setViewName(e.target.value.slice(0, 80))} onKeyDown={(e) => e.key === "Enter" && addView()} /><Button variant="secondary" size="sm" disabled={!viewName.trim()} onClick={addView}>save current</Button></div>
        {views.length === 0 ? <p className="rounded border border-dashed border-kumo-line p-4 text-[12px] text-kumo-subtle">No saved views yet. Navigate to a filtered page, name it above, and save it.</p> : <ul className="divide-y divide-kumo-line rounded border border-kumo-line">{views.map((view) => <li key={view.id} className="flex items-center gap-2 px-3 py-2"><button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => navigate(view.url)}><span className="block truncate text-[13px] font-medium">{view.name}</span><span className="block truncate font-mono text-[11px] text-kumo-subtle">{view.url}</span></button><Button variant="ghost" size="sm" onClick={() => removeView(view.id)} aria-label={`delete saved view ${view.name}`}><Trash className="h-3.5 w-3.5" /></Button></li>)}</ul>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle><span className="flex items-center gap-2"><Bell className="h-4 w-4" /> Threshold alerts</span></CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-[12px] text-kumo-subtle">Rules poll cluster counters every 15 seconds and POST a minimal event to the webhook after the threshold remains true for the duration. Webhook URLs are validated server-side.</p>
        {writable && <AlertForm clusters={config?.clusters ?? []} editing={editing} onSaved={() => { setEditing(null); void refresh() }} onCancel={() => setEditing(null)} />}
        {!writable && <p className="mb-3 rounded border border-kumo-line bg-kumo-recessed p-3 text-[12px] text-kumo-subtle">{config?.readonly ? "Read-only mode disables alert mutations." : "Viewer role can inspect alerts but cannot change them."}</p>}
        {alerts.length === 0 ? <p className="rounded border border-dashed border-kumo-line p-4 text-[12px] text-kumo-subtle">{!loaded ? "Loading alert rules…" : "No alert rules configured."}</p> : <div className="space-y-2">{alerts.map((rule) => <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded border border-kumo-line px-3 py-2"><span className="min-w-44 flex-1"><strong className="text-[13px]">{rule.name}</strong><span className="ml-2 text-[11px] text-kumo-subtle">{rule.cluster} · {rule.metric} {rule.operator} {rule.threshold} · {Math.round(rule.durationMs / 1000)}s</span></span><Badge tone={rule.enabled ? "ok" : "neutral"}>{rule.enabled ? "enabled" : "disabled"}</Badge>{rule.lastTriggeredAt && <span className="text-[11px] text-kumo-subtle">last {new Date(rule.lastTriggeredAt).toLocaleString()}</span>}<Button variant="ghost" size="sm" disabled={!writable} onClick={() => setEditing(rule)}><PencilSimple className="h-3.5 w-3.5" /> edit</Button><Button variant="ghost" size="sm" disabled={!writable} onClick={() => void api.testAlert(rule.id).then(() => toast.success("Test webhook sent")).catch((e) => toast.error(String(e)))}><PaperPlaneTilt className="h-3.5 w-3.5" /> test</Button><Button variant="ghost" size="sm" disabled={!writable} onClick={() => void api.deleteAlert(rule.id).then(() => void refresh()).catch((e) => toast.error(String(e)))}><Trash className="h-3.5 w-3.5" /></Button></div>)}</div>}
      </CardContent>
    </Card>

      <Card>
      <CardHeader><CardTitle><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Recent audit</span></CardTitle></CardHeader>
      <CardContent>{audit.length === 0 ? <p className="text-[12px] text-kumo-subtle">{!loaded ? "Loading audit entries…" : "No successful writes recorded yet."}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-[12px]"><thead><tr className="border-b border-kumo-line text-kumo-subtle"><th className="px-2 py-1.5">When</th><th className="px-2 py-1.5">Actor</th><th className="px-2 py-1.5">Action</th><th className="px-2 py-1.5">Cluster</th><th className="px-2 py-1.5">Target</th></tr></thead><tbody>{audit.map((entry, i) => <tr key={`${entry.timestamp}-${i}`} className="border-b border-kumo-line/50"><td className="px-2 py-1.5 text-kumo-subtle">{new Date(entry.timestamp).toLocaleString()}</td><td className="px-2 py-1.5">{entry.actor} <span className="text-kumo-subtle">({entry.role})</span></td><td className="px-2 py-1.5 font-mono">{entry.action}</td><td className="px-2 py-1.5">{entry.cluster}</td><td className="max-w-48 truncate px-2 py-1.5 font-mono">{entry.target}</td></tr>)}</tbody></table></div>}</CardContent>
    </Card>
  </div>
}

function AlertForm({ clusters, editing, onSaved, onCancel }: { clusters: string[]; editing: AlertRule | null; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = React.useState(""); const [cluster, setCluster] = React.useState(clusters[0] ?? ""); const [metric, setMetric] = React.useState<AlertMetric>("failed"); const [operator, setOperator] = React.useState<AlertOperator>("gte"); const [threshold, setThreshold] = React.useState("1"); const [duration, setDuration] = React.useState("0"); const [webhook, setWebhook] = React.useState(""); const [enabled, setEnabled] = React.useState(true); const [busy, setBusy] = React.useState(false); const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => { if (editing) { setName(editing.name); setCluster(editing.cluster); setMetric(editing.metric); setOperator(editing.operator); setThreshold(String(editing.threshold)); setDuration(String(editing.durationMs / 1000)); setWebhook(editing.webhookUrl); setEnabled(editing.enabled) } else { setName(""); setCluster(clusters[0] ?? ""); setMetric("failed"); setOperator("gte"); setThreshold("1"); setDuration("0"); setWebhook(""); setEnabled(true) } }, [editing, clusters])
  const submit = async () => { setBusy(true); setError(null); try { const body = { name, cluster, metric, operator, threshold: Number(threshold), durationMs: Number(duration) * 1000, webhookUrl: webhook, enabled }; if (editing) await api.updateAlert(editing.id, body); else await api.createAlert(body); toast.success(editing ? "Alert updated" : "Alert created"); onSaved() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  return <div className="mb-4 rounded border border-kumo-line bg-kumo-recessed p-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Input aria-label="alert name" placeholder="alert name" value={name} onChange={(e) => setName(e.target.value)} /><Select aria-label="alert cluster" value={cluster} onChange={(e) => setCluster(e.target.value)}>{clusters.map((c) => <option key={c}>{c}</option>)}</Select><Select aria-label="alert metric" value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric)}>{metrics.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select><div className="flex gap-1"><Select aria-label="alert operator" value={operator} onChange={(e) => setOperator(e.target.value as AlertOperator)}><option value="gte">≥</option><option value="gt">&gt;</option><option value="eq">=</option></Select><Input aria-label="alert threshold" type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div><Input aria-label="alert duration seconds" type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="duration seconds" /><Input aria-label="alert webhook URL" type="url" placeholder="https://hooks.example/…" value={webhook} onChange={(e) => setWebhook(e.target.value)} /><label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> enabled</label></div>{error && <p className="mt-2 text-[12px] text-kumo-danger">{error}</p>}<div className="mt-3 flex gap-2"><Button variant="secondary" size="sm" disabled={busy || !name || !webhook || !cluster} onClick={() => void submit()}>{busy ? "saving…" : editing ? "update alert" : "create alert"}</Button>{editing && <Button variant="ghost" size="sm" onClick={onCancel}>cancel</Button>}</div></div>
}
