import * as React from "react"
import {
  api,
  type Message,
  type MessageDetail,
  type MessageStatus,
  type RunResult
} from "../api.ts"
import { DetailPanel, JsonBlock, StatusBadge, statusTone, useMessageDetail } from "../components/pieces.tsx"
import { Badge, Button, Input, Select, Table, TBody, TD, TH, THead, TR, cn } from "../components/ui.tsx"
import { fmtCountdown, fmtTime, relTime } from "../format.ts"
import { ErrorNote, PageHeader, useEscToClose } from "../shell.tsx"
import { triggerRefresh, useLive } from "../live.ts"

/* ------------------------------------------------------------------ config -- */

let configCache: Awaited<ReturnType<typeof api.config>> | null = null

function useAppConfig() {
  const [config, setConfig] = React.useState(configCache)
  React.useEffect(() => {
    if (configCache) return
    api
      .config()
      .then((c) => {
        configCache = c
        setConfig(c)
      })
      .catch(() => {})
  }, [])
  return config
}

/* ------------------------------------------------------------------ helpers -- */

const TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "inflight", label: "In-flight" },
  { key: "scheduled", label: "Scheduled" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" }
]

function datetimeLocalToMs(v: string): number | undefined {
  if (!v) return undefined
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

function msToDatetimeLocal(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

function copyJson(value: unknown) {
  navigator.clipboard?.writeText(JSON.stringify(value, null, 2)).catch(() => {})
}

function downloadJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export interface MessagesInitialFilters {
  entityType?: string
  entityId?: string
  status?: string
}

/* -------------------------------------------------------------------- page -- */

export function MessagesPage({ initialFilters }: { initialFilters?: MessagesInitialFilters }) {
  const [data, setData] = React.useState<{ rows: Message[]; total: number } | null>(null)

  const [tab, setTab] = React.useState<string>(initialFilters?.status ?? "")
  const [status, setStatus] = React.useState<string>(initialFilters?.status ?? "")
  const [entityType, setEntityType] = React.useState(initialFilters?.entityType ?? "")
  const [entityId, setEntityId] = React.useState(initialFilters?.entityId ?? "")
  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [createdAfter, setCreatedAfter] = React.useState("")
  const [createdBefore, setCreatedBefore] = React.useState("")
  const [pageSize, setPageSize] = React.useState(50)
  const [sort, setSort] = React.useState<"id" | "deliverAt">("id")
  const [page, setPage] = React.useState(1)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  const config = useAppConfig()
  const detail = useMessageDetail(openId)
  useEscToClose(() => setOpenId(null))

  // keep URL-seeded filters in sync when the hash changes underneath us
  React.useEffect(() => {
    setEntityType(initialFilters?.entityType ?? "")
    setEntityId(initialFilters?.entityId ?? "")
    setStatus(initialFilters?.status ?? "")
    setTab(initialFilters?.status ?? "")
    setPage(1)
  }, [initialFilters?.entityType, initialFilters?.entityId, initialFilters?.status])

  React.useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQ(q)
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [q])

  // switching tabs also drives the status query param ("failed" is separate)
  const pickTab = (key: string) => {
    setTab(key)
    setStatus(key === "failed" ? "" : key)
    setSort(key === "scheduled" ? "deliverAt" : "id")
    setPage(1)
  }

  const { loading, error, refresh } = useLive(
    async () =>
      setData(
        await api.messages({
          status: status || undefined,
          failed: tab === "failed" ? true : undefined,
          entityType: entityType || undefined,
          entityId: entityId || undefined,
          q: debouncedQ || undefined,
          createdAfter: datetimeLocalToMs(createdAfter),
          createdBefore: datetimeLocalToMs(createdBefore),
          sort,
          page,
          pageSize
        })
      ),
    [status, tab, entityType, entityId, debouncedQ, createdAfter, createdBefore, sort, page, pageSize]
  )

  const runAction = async (fn: () => Promise<unknown>, what: string) => {
    if (!window.confirm(`Are you sure you want to ${what} this message?`)) return
    try {
      await fn()
      setActionError(null)
      refresh()
      triggerRefresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <PageHeader title="Messages" subtitle={data ? `${data.total.toLocaleString()} matching messages` : undefined} />

      {/* status tabs */}
      <div className="mb-3 flex items-center gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => pickTab(t.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors cursor-pointer",
              tab === t.key ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2 hover:text-text"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="search id / entity / tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
          data-search-input
        />
        <Input
          placeholder="entity type"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value)
            setPage(1)
          }}
          className="w-40"
        />
        <Input
          placeholder="entity id"
          value={entityId}
          onChange={(e) => {
            setEntityId(e.target.value)
            setPage(1)
          }}
          className="w-40"
        />
        <label className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted">
          after
          <Input
            type="datetime-local"
            value={createdAfter}
            onChange={(e) => {
              setCreatedAfter(e.target.value)
              setPage(1)
            }}
            className="w-44"
          />
        </label>
        <label className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted">
          before
          <Input
            type="datetime-local"
            value={createdBefore}
            onChange={(e) => {
              setCreatedBefore(e.target.value)
              setPage(1)
            }}
            className="w-44"
          />
        </label>
        <Select
          value={String(pageSize)}
          onChange={(e) => {
            setPageSize(Number(e.target.value))
            setPage(1)
          }}
          aria-label="page size"
        >
          {[25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </Select>
        {tab === "scheduled" && (
          <Select value={sort} onChange={(e) => setSort(e.target.value as "id" | "deliverAt")} aria-label="sort">
            <option value="deliverAt">by deliver time</option>
            <option value="id">newest first</option>
          </Select>
        )}
      </div>

      <ErrorNote error={error ?? actionError} />

      <div className="rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              <TH>Id</TH>
              <TH>Status</TH>
              <TH>Entity</TH>
              <TH>Tag</TH>
              <TH>Shard</TH>
              <TH>Replies</TH>
              <TH>{tab === "scheduled" ? "Delivers" : "Created"}</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {(loading && !data ? [] : data!.rows).map((m) => (
              <MessageRow
                key={m.id}
                m={m}
                scheduledView={tab === "scheduled"}
                onOpen={() => setOpenId(m.id)}
              />
            ))}
            {!loading && (!data || data.rows.length === 0) && (
              <TR>
                <TD colSpan={8} className="py-10 text-center text-muted">
                  no messages match
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>

      <Pager page={page} total={data?.total ?? 0} pageSize={pageSize} onChange={setPage} />

      <DetailPanel
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={<span className="font-mono text-xs">message {openId && shortId(openId)}</span>}
      >
        {detail === null ? (
          <div className="text-muted">loading…</div>
        ) : (
          <MessageDetailBody d={detail} config={config} onAction={runAction} onChanged={refresh} />
        )}
      </DetailPanel>
    </div>
  )
}

/* --------------------------------------------------------------------- row -- */

function MessageRow({
  m,
  scheduledView,
  onOpen
}: {
  m: Message
  scheduledView: boolean
  onOpen: () => void
}) {
  const config = useAppConfig()
  const traceUrl =
    config?.tracingUrlTemplate && m.traceId ?
      config.tracingUrlTemplate.replace("{traceId}", encodeURIComponent(m.traceId)) :
      null

  return (
    <TR className="cursor-pointer" onClick={onOpen}>
      <TD className="font-mono text-xs text-muted">{shortId(m.id)}</TD>
      <TD>
        <div className="flex items-center gap-1.5">
          {m.failed && (
            <span title="failed execution" className="text-err">
              ✕
            </span>
          )}
          <StatusBadge status={m.status} />
        </div>
      </TD>
      <TD>
        <div className="max-w-72 truncate">
          {m.entityType.startsWith("Workflow/") ? (
            <span className="text-info">{m.entityType}</span>
          ) : (
            m.entityType
          )}
          <span className="text-muted">/{m.entityId}</span>
        </div>
      </TD>
      <TD>{m.tag ? <code className="text-xs">{m.tag}</code> : <span className="text-muted">—</span>}</TD>
      <TD className="tabular-nums text-muted">{m.shardId}</TD>
      <TD className="tabular-nums text-muted">{m.replyCount || "—"}</TD>
      <TD className="whitespace-nowrap text-muted">
        {scheduledView && m.deliverAt !== null ? (
          <span title={fmtTime(m.deliverAt)}>{fmtCountdown(m.deliverAt)}</span>
        ) : (
          relTime(m.createdAt)
        )}
      </TD>
      <TD>
        {traceUrl && (
          <a
            href={traceUrl}
            target="_blank"
            rel="noreferrer"
            title={`trace ${m.traceId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-accent hover:underline"
          >
            ↗ trace
          </a>
        )}
      </TD>
    </TR>
  )
}

/* ------------------------------------------------------------------- detail -- */

function OutcomeBanner({ result }: { result: RunResult }) {
  const failure = result.outcome === "Failure"
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-md border px-3 py-2",
        failure ? "border-err/40 bg-err/10" : "border-ok/40 bg-ok/10"
      )}
    >
      <span className={cn("text-[13px] font-semibold", failure ? "text-err" : "text-ok")}>
        {failure ? "✕ Failed" : "✓ Succeeded"}
      </span>
      {!failure && <Badge tone="ok">success</Badge>}
    </div>
  )
}

function MessageDetailBody({
  d,
  config,
  onAction,
  onChanged
}: {
  d: MessageDetail
  config: Awaited<ReturnType<typeof api.config>> | null
  onAction: (fn: () => Promise<unknown>, what: string) => Promise<void>
  onChanged: () => void
}) {
  const m = d.message
  const [busy, setBusy] = React.useState(false)

  const act = async (fn: () => Promise<unknown>, what: string) => {
    setBusy(true)
    try {
      await onAction(fn, what)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const canRetry = m.status === "done" || (m.status === "scheduled" && !m.failed)
  const canInterrupt = m.status === "pending" || m.status === "inflight" || m.status === "scheduled"
  const traceUrl =
    config?.tracingUrlTemplate && m.traceId ?
      config.tracingUrlTemplate.replace("{traceId}", encodeURIComponent(m.traceId)) :
      null

  return (
    <div className="space-y-4 text-[13px]" data-testid="message-detail">
      {d.result && <OutcomeBanner result={d.result} />}

      <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-2/40 p-3">
        <Field label="Status">
          <div className="flex items-center gap-1.5">
            {m.failed && <span className="text-err">✕</span>}
            <StatusBadge status={m.status} />
          </div>
        </Field>
        <Field label="Kind">{m.kind}</Field>
        <Field label="Created">{fmtTime(m.createdAt)}</Field>
        <Field label="Machine id">{m.machineId}</Field>
        <Field label="Entity">
          {m.entityType}/{m.entityId}
        </Field>
        <Field label="Shard">{m.shardId}</Field>
        <Field label="Last read">{m.lastRead ?? "—"}</Field>
        <Field label="Deliver at">
          {m.deliverAt !== null ? `${fmtTime(m.deliverAt)} (${fmtCountdown(m.deliverAt)})` : "—"}
        </Field>
        {m.traceId && (
          <Field label="Trace" wide>
            {traceUrl ? (
              <a href={traceUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent hover:underline">
                {m.traceId} ↗
              </a>
            ) : (
              <code className="font-mono text-xs">{m.traceId}</code>
            )}
          </Field>
        )}
      </section>

      {(canRetry || canInterrupt) && (
        <section className="flex items-center gap-2">
          {canRetry && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => act(() => api.retryMessage(m.id), "retry")}
            >
              ⟳ retry
            </Button>
          )}
          {canInterrupt && (
            <Button variant="danger" size="sm" disabled={busy} onClick={() => act(() => api.interruptMessage(m.id), "interrupt")}>
              ✕ interrupt
            </Button>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => copyJson(d)}>
              copy json
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadJson(`message-${m.id}.json`, d)}>
              download
            </Button>
          </span>
        </section>
      )}

      <section>
        <SectionTitle>Payload</SectionTitle>
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <JsonBlock value={d.payload} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => copyJson(d.payload)} title="copy payload">
            ⧉
          </Button>
        </div>
      </section>

      {d.result && (
        <section>
          <SectionTitle>Exit</SectionTitle>
          <JsonBlock value={d.result.exit} max={600} />
        </section>
      )}

      <section>
        <SectionTitle>
          Replies ({d.replies.length}){" "}
          {d.replies.some((r) => r.kind === "withExit") && <Badge tone="ok">withExit</Badge>}
        </SectionTitle>
        {d.replies.length === 0 ? (
          <div className="text-muted">no replies yet</div>
        ) : (
          <div className="space-y-2">
            {d.replies.map((r) => (
              <div key={r.id} className="rounded-md border border-border p-2.5">
                <div className="mb-1.5 flex items-center gap-2 text-[12px]">
                  <Badge tone={r.kind === "withExit" ? (isFailureReply(r.payload) ? "err" : "ok") : "neutral"}>
                    {r.kind}
                  </Badge>
                  {r.acked && <Badge tone="accent">acked</Badge>}
                  {r.sequence !== null && <span className="text-muted">seq {r.sequence}</span>}
                  <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-muted">
                    #{shortId(r.id)}
                    <button
                      type="button"
                      title="copy reply"
                      className="cursor-pointer hover:text-text"
                      onClick={() => copyJson(r.payload)}
                    >
                      ⧉
                    </button>
                  </span>
                </div>
                <JsonBlock value={r.payload} max={200} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function isFailureReply(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { _tag?: string })._tag === "WithExit" &&
    ((payload as { exit?: { _tag?: string } }).exit?._tag === "Failure" ||
      (payload as { exit?: { defect?: unknown } }).exit?.defect !== undefined ||
      false)
  )
}

export function Field({
  label,
  children,
  wide
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? "col-span-2 flex flex-col gap-1" : "flex flex-col gap-1"}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="truncate">{children}</span>
    </div>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{children}</h3>
  )
}

function Pager({
  page,
  total,
  pageSize,
  onChange
}: {
  page: number
  total: number
  pageSize: number
  onChange: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[13px] text-muted">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ← prev
      </Button>
      <span className="tabular-nums">
        page {page} / {pages}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        next →
      </Button>
    </div>
  )
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

// re-export for workflow pages
export { statusTone }
export type { MessageStatus }
