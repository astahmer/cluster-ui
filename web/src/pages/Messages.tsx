import * as React from "react"
import {
  api,
  type Message,
  type MessageDetail,
  type MessageStatus,
  type RunResult
} from "../api.ts"
import { DetailPanel, SkeletonTable, StatusBadge, statusTone, useMessageDetail } from "../components/pieces.tsx"
import { confirmDialog } from "../components/dialogs.tsx"
import { toast } from "../toast.tsx"
import { Badge, Button, Input, Select, Table, TBody, TD, TH, THead, TR, cn } from "../components/ui.tsx"
import { fmtCountdown, fmtTime, relTime } from "../format.ts"
import { ErrorNote, PageHeader, useEscToClose } from "../shell.tsx"
import { triggerRefresh, useLive, usePauseWhile } from "../live.ts"
import { Banner, CodeBlock, Empty, InputGroup, Tabs, Toolbar } from "../kumo"

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
  // stop background polling while the detail panel is open so it doesn't rerender under the cursor
  usePauseWhile(openId !== null)

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
    if (
      !(await confirmDialog({
        title: `Are you sure you want to ${what} this message?`,
        description: "The action writes directly to the cluster's message storage.",
        destructive: true,
        confirmLabel: what.charAt(0).toUpperCase() + what.slice(1)
      }))
    )
      return
    try {
      await fn()
      setActionError(null)
      toast.success(`Message ${what} done`)
      refresh()
      triggerRefresh()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setActionError(msg)
      toast.error(`${what} failed: ${msg}`)
    }
  }

  return (
    <div>
      <PageHeader title="Messages" subtitle={data ? `${data.total.toLocaleString()} matching messages` : undefined} />

      {/* status tabs */}
      <div className="mb-3">
        <Tabs
          variant="segmented"
          size="sm"
          className="w-fit"
          tabs={TABS.map((t) => ({ value: t.key, label: t.label }))}
          value={tab}
          onValueChange={pickTab}
        />
      </div>

      <Toolbar className="mb-3 flex-wrap">
        <InputGroup className="w-56">
          <InputGroup.Input
            placeholder="search id / entity / tag…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-search-input
          />
        </InputGroup>
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
        <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-kumo-subtle">
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
        <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-kumo-subtle">
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
      </Toolbar>

      <ErrorNote error={error ?? actionError} onRetry={refresh} />

      {loading && !data && <SkeletonTable rows={12} cols={6} />}
      {!loading && (
      <div className="rounded-lg border border-kumo-line bg-kumo-base">
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
                <TD colSpan={8} className="py-6">
                  <Empty
                    title="No messages match"
                    description="Adjust the search, status tabs or time range."
                  />
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>
      )}

      <Pager page={page} total={data?.total ?? 0} pageSize={pageSize} onChange={setPage} />

      <DetailPanel
        open={openId !== null}
        onClose={() => setOpenId(null)}
        title={<span className="font-mono text-xs">message {openId && shortId(openId)}</span>}
      >
        {detail === null ? (
          <div className="text-kumo-subtle">loading…</div>
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
      <TD className="font-mono text-xs text-kumo-subtle">{shortId(m.id)}</TD>
      <TD>
        <div className="flex items-center gap-1.5">
          {m.failed && (
            <span title="failed execution" className="text-kumo-danger">
              ✕
            </span>
          )}
          <StatusBadge status={m.status} />
        </div>
      </TD>
      <TD>
        <div className="max-w-72 truncate">
          {m.entityType.startsWith("Workflow/") ? (
            <span className="text-kumo-info">{m.entityType}</span>
          ) : (
            m.entityType
          )}
          <span className="text-kumo-subtle">/{m.entityId}</span>
        </div>
      </TD>
      <TD>{m.tag ? <code className="text-xs">{m.tag}</code> : <span className="text-kumo-subtle">—</span>}</TD>
      <TD className="tabular-nums text-kumo-subtle">{m.shardId}</TD>
      <TD className="tabular-nums text-kumo-subtle">{m.replyCount || "—"}</TD>
      <TD className="whitespace-nowrap text-kumo-subtle">
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
            className="text-kumo-link hover:underline"
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
    <Banner
      variant={failure ? "error" : "default"}
      size="sm"
      title={failure ? "✕ Failed" : "✓ Succeeded"}
      action={<Badge tone={failure ? "err" : "ok"}>{result.outcome}</Badge>}
    />
  )
}

/** JSON viewer built on kumo CodeBlock with a compact truncation mode. */
function PayloadView({ value, max = 400 }: { value: unknown; max?: number }) {
  const [open, setOpen] = React.useState(false)
  if (value === null || value === undefined) return <span className="text-kumo-subtle">—</span>
  const text = JSON.stringify(value, null, 2)
  if (!open && text.length > max) {
    return (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <CodeBlock code={text.slice(0, max) + "\n…"} lang="jsonc" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          more
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="max-h-64 max-w-full overflow-auto [&_pre]:max-h-64">
        <CodeBlock code={text} lang="jsonc" />
      </div>
      {text.length > max && (
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          less
        </Button>
      )}
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

      <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-kumo-line bg-kumo-canvas/50 p-3">
        <Field label="Status">
          <div className="flex items-center gap-1.5">
            {m.failed && <span className="text-kumo-danger">✕</span>}
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
              <a href={traceUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-kumo-link hover:underline">
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
            <PayloadView value={d.payload} />
          </div>
          <Button variant="ghost" size="sm" onClick={() => copyJson(d.payload)} title="copy payload">
            ⧉
          </Button>
        </div>
      </section>

      {d.result && (
        <section>
          <SectionTitle>Exit</SectionTitle>
          <PayloadView value={d.result.exit} max={600} />
        </section>
      )}

      <section>
        <SectionTitle>
          Replies ({d.replies.length}){" "}
          {d.replies.some((r) => r.kind === "withExit") && <Badge tone="ok">withExit</Badge>}
        </SectionTitle>
        {d.replies.length === 0 ? (
          <div className="text-kumo-subtle">no replies yet</div>
        ) : (
          <div className="space-y-2">
            {d.replies.map((r) => (
              <div key={r.id} className="rounded-md border border-kumo-line p-2.5">
                <div className="mb-1.5 flex items-center gap-2 text-[12px]">
                  <Badge tone={r.kind === "withExit" ? (isFailureReply(r.payload) ? "err" : "ok") : "neutral"}>
                    {r.kind}
                  </Badge>
                  {r.acked && <Badge tone="accent">acked</Badge>}
                  {r.sequence !== null && <span className="text-kumo-subtle">seq {r.sequence}</span>}
                  <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-kumo-subtle">
                    #{shortId(r.id)}
                    <button
                      type="button"
                      title="copy reply"
                      className="cursor-pointer hover:text-kumo-default"
                      onClick={() => copyJson(r.payload)}
                    >
                      ⧉
                    </button>
                  </span>
                </div>
                <PayloadView value={r.payload} max={200} />
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
    ((payload as { _tag?: string })._tag === "Failure" ||
      ((payload as { _tag?: string })._tag === "WithExit" &&
        ((payload as { exit?: { _tag?: string } }).exit?._tag === "Failure" ||
          (payload as { exit?: { defect?: unknown } }).exit?.defect !== undefined)) ||
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
      <span className="text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">{label}</span>
      <span className="truncate">{children}</span>
    </div>
  )
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">{children}</h3>
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
    <div className="mt-3 flex items-center justify-end gap-2 text-[13px] text-kumo-subtle">
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
