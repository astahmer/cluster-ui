import * as React from "react"
import {
  api,
  type BulkActionKind,
  type Message,
  type MessageDetail,
  type MessageStatus,
  type RunResult
} from "../api.ts"
import { ArrowClockwise, ArrowCounterClockwise, ArrowUpRight, Copy, FunnelSimple, Trash, XCircle } from "@phosphor-icons/react"
import { useAppConfig } from "../config.ts"
import { downloadCsv, downloadJson } from "../export.ts"
import { DetailPanel, SkeletonTable, StatusBadge, statusTone, rowInteractions, useMessageDetail, Pager } from "../components/pieces.tsx"
import { FilterBar, useFacets, type FacetDef } from "../components/filters/index.tsx"
import { FlowGraph, jobTreeToSpecs } from "../components/flow-graph.tsx"
import { confirmDialog } from "../components/dialogs.tsx"
import { toast } from "../toast.tsx"
import { Badge, Button, Input, Select, Table, TBody, TD, TH, THead, TR, cn } from "../components/ui.tsx"
import { Table as KumoTable } from "../kumo"
import { fmtCountdown, fmtTime, relTime } from "../format.ts"
import { ErrorNote, PageHeader, useEscToClose } from "../shell.tsx"
import { triggerRefresh, useLive, usePauseWhile } from "../live.ts"
import { Banner, CodeBlock, Empty, InputGroup, Tabs, Toolbar } from "../kumo"

/* ------------------------------------------------------------------ config -- */

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


function copyJson(value: unknown) {
  navigator.clipboard?.writeText(JSON.stringify(value, null, 2)).catch(() => {})
}

export interface MessagesInitialFilters {
  entityType?: string
  entityId?: string
  status?: string
  /** "true" opens the Failed tab */
  failed?: string
  q?: string
  createdAfter?: string
  createdBefore?: string
}

/* -------------------------------------------------------------------- page -- */

export function MessagesPage({
  initialFilters,
  messageId
}: {
  initialFilters?: MessagesInitialFilters
  /** deep link #/messages/<id> — the detail panel hydrates from this */
  messageId?: string
}) {
  const [data, setData] = React.useState<{ rows: Message[]; total: number } | null>(null)

  const initialTab = initialFilters?.failed === "true" ? "failed" : (initialFilters?.status ?? "")
  const [tab, setTab] = React.useState<string>(initialTab)
  const [status, setStatus] = React.useState<string>(initialTab === "failed" ? "" : initialTab)
  const [entityType, setEntityType] = React.useState(initialFilters?.entityType ?? "")
  const [entityId, setEntityId] = React.useState(initialFilters?.entityId ?? "")
  const [q, setQ] = React.useState(initialFilters?.q ?? "")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  // P2-19 collapsible filters
  const [showFilters, setShowFilters] = React.useState(false)
  const [createdAfter, setCreatedAfter] = React.useState(initialFilters?.createdAfter ?? "")
  const [createdBefore, setCreatedBefore] = React.useState(initialFilters?.createdBefore ?? "")

  // P2-19: number of collapsed filters currently active (drives the badge)
  const activeFilterCount = [entityType, entityId, createdAfter, createdBefore].filter((v) => v !== "").length
  const [pageSize, setPageSize] = React.useState(50)
  const [sort, setSort] = React.useState<"id" | "deliverAt">("id")
  const [page, setPage] = React.useState(1)
  const [openId, setOpenIdState] = React.useState<string | null>(messageId ?? null)
  const [actionError, setActionError] = React.useState<string | null>(null)

  // open/close writes the hash so panels are addressable URLs (UX review P1-1);
  // back/forward + external hash edits stay in sync via the messageId prop.
  const setOpenId = React.useCallback((id: string | null) => {
    setOpenIdState(id)
    const raw = window.location.hash.slice(1) || "/messages"
    const qIdx = raw.indexOf("?")
    const params = new URLSearchParams(qIdx === -1 ? "" : raw.slice(qIdx + 1))
    const qs = params.toString()
    window.location.hash = `/messages${id !== null ? `/${encodeURIComponent(id)}` : ""}${qs ? `?${qs}` : ""}`
  }, [])
  React.useEffect(() => {
    setOpenIdState(messageId ?? null)
  }, [messageId])
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = React.useState(false)

  const config = useAppConfig()
  const readonly = config?.readonly === true || config?.role === "viewer"
  const detailState = useMessageDetail(openId)
  useEscToClose(() => setOpenId(null))
  // stop background polling while the detail panel is open so it doesn't rerender under the cursor
  usePauseWhile(openId !== null)

  // keep URL-seeded filters in sync when the hash changes underneath us
  React.useEffect(() => {
    setEntityType(initialFilters?.entityType ?? "")
    setEntityId(initialFilters?.entityId ?? "")
    const nextStatus = initialFilters?.failed === "true" ? "" : (initialFilters?.status ?? "")
    setStatus(nextStatus)
    setTab(initialFilters?.failed === "true" ? "failed" : nextStatus)
    setQ(initialFilters?.q ?? "")
    setCreatedAfter(initialFilters?.createdAfter ?? "")
    setCreatedBefore(initialFilters?.createdBefore ?? "")
    setPage(1)
  }, [
    initialFilters?.entityType,
    initialFilters?.entityId,
    initialFilters?.status,
    initialFilters?.failed,
    initialFilters?.q,
    initialFilters?.createdAfter,
    initialFilters?.createdBefore
  ])

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

  // any filter/tab/page change invalidates the current selection
  React.useEffect(() => {
    setSelected(new Set())
  }, [status, tab, entityType, entityId, debouncedQ, createdAfter, createdBefore, sort, page, pageSize])

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

  // client-side facets over the loaded page rows — server filters above stay authoritative
  const pageRows = data?.rows ?? []
  const facetDefs: FacetDef<Message>[] = [
    {
      key: "entityType",
      label: "entity type",
      options: (all) => [...new Set(all.map((r) => r.entityType))].sort().map((v) => ({ value: v })),
      predicate: (r, v) => v.includes(r.entityType)
    },
    {
      key: "tag",
      label: "tag",
      options: (all) =>
        [...new Set(all.map((r) => r.tag).filter((t): t is string => Boolean(t)))].sort().map((v) => ({ value: v })),
      predicate: (r, v) => (r.tag ? v.includes(r.tag) : false)
    }
  ]
  const facets = useFacets(pageRows, facetDefs)

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

  const rows = data?.rows ?? []
  const visibleIds = rows.map((r) => r.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))
  }

  const runBulk = async (action: BulkActionKind) => {
    const ids = [...selected]
    if (ids.length === 0 || bulkBusy) return
    const label = action === "delete" ? "Delete" : "Retry"
    if (
      !(await confirmDialog({
        title: `${label} ${ids.length} message${ids.length === 1 ? "" : "s"}?`,
        description:
          action === "delete" ?
            "Deletes the message rows and their replies from the cluster storage. This cannot be undone." :
            "The actions write directly to the cluster's message storage.",
        destructive: true,
        confirmLabel: `${label} ${ids.length}`
      }))
    )
      return
    setBulkBusy(true)
    try {
      const { results } = await api.bulkActions(action, ids)
      const okCount = results.filter((r) => r.ok).length
      setActionError(null)
      if (okCount === results.length) toast.success(`${label}: ${okCount}/${results.length} done`)
      else toast.error(`${label}: ${okCount}/${results.length} done — first failure: ${results.find((r) => !r.ok)?.error}`)
      refresh()
      triggerRefresh()
      setSelected(new Set())
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setActionError(msg)
      toast.error(`${label.toLowerCase()} failed: ${msg}`)
    } finally {
      setBulkBusy(false)
    }
  }

  const exportRows = () =>
    rows.map((m) => ({
      id: m.id,
      status: m.status,
      failed: m.failed,
      entityType: m.entityType,
      entityId: m.entityId,
      tag: m.tag ?? "",
      shardId: m.shardId,
      replyCount: m.replyCount,
      createdAt: m.createdAt,
      ...(m.deliverAt !== null ? { deliverAt: m.deliverAt } : {}),
      ...(m.traceId ? { traceId: m.traceId } : {})
    }))

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
            aria-label="search messages"
            placeholder="search id / entity / tag — paste an id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-search-input
          />
        </InputGroup>
        {/* P2-19: secondary filters collapse behind a disclosure with an
            active-filter count so the toolbar doesn't stack tall on narrow screens */}
        <Button
          variant={activeFilterCount > 0 ? "secondary" : "ghost"}
          size="sm"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
        >
          <FunnelSimple className="h-3.5 w-3.5" /> filters
          {activeFilterCount > 0 && (
            <span className="rounded bg-kumo-brand/20 px-1 tabular-nums">{activeFilterCount}</span>
          )}
        </Button>
        {showFilters && (
          <>
            <Input
              aria-label="filter by entity type"
              placeholder="entity type"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value)
                setPage(1)
              }}
              className="w-40"
            />
            <Input
              aria-label="filter by entity id"
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
          </>
        )}
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

        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={rows.length === 0} onClick={() => downloadJson(exportRows(), "messages.json")}>
            export page (json)
          </Button>
          <Button variant="ghost" size="sm" disabled={rows.length === 0} onClick={() => downloadCsv(exportRows(), "messages.csv")}>
            export page (csv)
          </Button>
        </span>
      </Toolbar>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-kumo-line bg-kumo-canvas/50 px-3 py-2 text-[13px]">
          <span className="font-medium tabular-nums">{selected.size} selected</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={bulkBusy || readonly}
            title={readonly ? "read-only mode" : undefined}
            onClick={() => runBulk("retry")}
          >
            <ArrowClockwise className="h-3.5 w-3.5" /> retry selected
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={bulkBusy || readonly}
            title={readonly ? "read-only mode" : undefined}
            onClick={() => runBulk("delete")}
          >
            <Trash className="h-3.5 w-3.5" /> delete selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            clear
          </Button>
        </div>
      )}

      <ErrorNote error={error ?? actionError} onRetry={refresh} />

      <FilterBar defs={facetDefs} rows={pageRows} facets={facets} />

      {loading && !data && <SkeletonTable rows={12} cols={6} />}
      {!loading && (
      <div className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <KumoTable.CheckHead
                aria-label="select all visible messages"
                checked={allVisibleSelected}
                indeterminate={!allVisibleSelected && selected.size > 0}
                onCheckedChange={toggleAllVisible}
              />
              <TH>Id</TH>
              <TH>Status</TH>
              <TH>Entity</TH>
              <TH>Tag</TH>
              <TH>Shard</TH>
              <TH>Replies</TH>
              <TH aria-sort={sort === "id" ? "descending" : "ascending"}>
                <button
                  type="button"
                  title="toggle server-side sort"
                  className="cursor-pointer"
                  onClick={() => {
                    setSort((prev) => (prev === "id" ? "deliverAt" : "id"))
                    setPage(1)
                  }}
                >
                  {tab === "scheduled" ? "Delivers" : "Created"}{" "}
                  {/* honest direction: id = newest first (desc); deliverAt = soonest first (asc) */}
                  <span className="text-kumo-subtle" aria-hidden>
                    {sort === "id" ? "\u2193" : "\u2191"}
                  </span>
                </button>
              </TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {(loading && !data ? [] : facets.filtered).map((m) => (
              <MessageRow
                key={m.id}
                m={m}
                scheduledView={tab === "scheduled"}
                selected={selected.has(m.id)}
                onToggle={() => toggleRow(m.id)}
                onOpen={() => setOpenId(m.id)}
                onDelete={() => runAction(() => api.deleteMessage(m.id), "delete")}
              />
            ))}
            {!loading && (!data || data.rows.length === 0) && (
              <TR>
                <TD colSpan={9} className="py-6">
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
        {detailState.error ? (
          <div className="space-y-2 text-kumo-danger">
            <div>{detailState.error}</div>
            <Button size="sm" variant="secondary" onClick={detailState.retry}>Retry</Button>
          </div>
        ) : detailState.detail === null ? (
          <div className="text-kumo-subtle">loading…</div>
        ) : (
          <MessageDetailBody d={detailState.detail} config={config} onAction={runAction} onChanged={refresh} />
        )}
      </DetailPanel>
    </div>
  )
}

/* --------------------------------------------------------------------- row -- */

function MessageRow({
  m,
  scheduledView,
  selected,
  onToggle,
  onOpen,
  onDelete
}: {
  m: Message
  scheduledView: boolean
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  onDelete: () => Promise<void>
}) {
  const config = useAppConfig()
  const traceUrl =
    config?.tracingUrlTemplate && m.traceId ?
      config.tracingUrlTemplate.replace("{traceId}", encodeURIComponent(m.traceId)) :
      null

  return (
    <TR
      className="cursor-pointer"
      data-selected={selected || undefined}
      {...rowInteractions(onOpen)}
    >
      <KumoTable.CheckCell
        aria-label={selected ? "deselect message" : "select message"}
        checked={selected}
        onCheckedChange={() => onToggle()}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      />
      <TD className="font-mono text-xs text-kumo-subtle">{shortId(m.id)}</TD>
      <TD>
        <div className="flex items-center gap-1.5">
          {m.failed && (
            <span title="failed execution" className="text-kumo-danger">
              <XCircle weight="fill" className="h-3.5 w-3.5" />
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
          <span title={fmtTime(m.createdAt)}>{relTime(m.createdAt)}</span>
        )}
      </TD>
      <TD>
        <div className="flex items-center gap-2">
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
          <button
            type="button"
            title={config?.readonly ? "read-only mode" : "delete message"}
            aria-label={`delete message ${m.id}`}
            disabled={config?.readonly === true || config?.role === "viewer"}
            className="cursor-pointer rounded p-1.5 text-kumo-subtle hover:bg-kumo-danger-tint hover:text-kumo-danger disabled:cursor-not-allowed disabled:opacity-40"
            onClick={(e) => {
              e.stopPropagation()
              if (config?.readonly) return
              onDelete()
            }}
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        </div>
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
      title={failure ? "Failed" : "Succeeded"}
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
  const readonly = config?.readonly === true || config?.role === "viewer"
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
  // reset-activity re-arms a workflow activity (processed=0, last_read=NULL)
  const canResetActivity = m.entityType.startsWith("Workflow/")
  const traceUrl =
    config?.tracingUrlTemplate && m.traceId ?
      config.tracingUrlTemplate.replace("{traceId}", encodeURIComponent(m.traceId)) :
      null

  const clusterKind =
    config?.clusterKinds?.find((c) => {
      try {
        const stored = localStorage.getItem("cluster_ui_cluster")
        return stored ? c.name === stored : c.name === config.clusters[0]
      } catch {
        return false
      }
    })?.kind ?? "sqlite"

  return (
    <div className="space-y-4 text-[13px]" data-testid="message-detail">
      {d.result && <OutcomeBanner result={d.result} />}

      {clusterKind === "redis" && <JobFlowSection messageId={m.id} />}

      <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-kumo-line bg-kumo-canvas/50 p-3">
        <Field label="Status">
          <div className="flex items-center gap-1.5">
            {m.failed && (
              <span className="text-kumo-danger">
                <XCircle weight="fill" className="h-3.5 w-3.5" />
              </span>
            )}
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
        <Field label="Last read">{fmtLastRead(m.lastRead)}</Field>
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

      {(canRetry || canInterrupt || canResetActivity) && (
        <section className="flex items-center gap-2">
          {canRetry && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || readonly}
              title={readonly ? "read-only mode" : undefined}
              onClick={() => act(() => api.retryMessage(m.id), "retry")}
            >
              <ArrowClockwise className="h-3.5 w-3.5" /> retry
            </Button>
          )}
          {canInterrupt && (
            <Button
              variant="danger"
              size="sm"
              disabled={busy || readonly}
              title={readonly ? "read-only mode" : undefined}
              onClick={() => act(() => api.interruptMessage(m.id), "interrupt")}
            >
              <XCircle className="h-3.5 w-3.5" /> interrupt
            </Button>
          )}
          {canResetActivity && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || readonly}
              title={readonly ? "read-only mode" : "clear processed/last_read so the engine re-runs this activity"}
              onClick={() => act(() => api.resetActivity(m.id), "reset activity")}
            >
              <ArrowCounterClockwise className="h-3.5 w-3.5" /> reset activity
            </Button>
          )}
          {clusterKind === "redis" && m.status === "scheduled" && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || readonly}
              title={readonly ? "read-only mode" : "make this delayed job pending immediately (redis clusters)"}
              onClick={() => act(() => api.promoteJob(m.id), "promote")}
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> promote now
            </Button>
          )}
          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => copyJson(d)}>
              copy json
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadJson(d, `message-${m.id}.json`)}>
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
            <Copy className="h-3.5 w-3.5" />
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
                      className="cursor-pointer p-1 hover:text-kumo-default"
                      onClick={() => copyJson(r.payload)}
                    >
                      <Copy className="h-3.5 w-3.5" />
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

/** "Last read" arrives as a raw machine string — render it with the same
 * fmtTime convention as neighboring fields when parseable (audit #2). */
function fmtLastRead(raw: string | null): string {
  if (raw === null || raw === "") return "—"
  const n = Number(raw)
  const ms = Number.isFinite(n) && raw.trim() !== "" ? n : new Date(raw).getTime()
  return Number.isFinite(ms) && ms > 0 ? fmtTime(ms) : raw
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

// re-export for workflow pages
export { statusTone }
export type { MessageStatus }

/* ------------------------------------------------------------------ flow --- */

function JobFlowSection({ messageId }: { messageId: string }) {
  const [tree, setTree] = React.useState<import("../api.ts").JobTreeNode | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let alive = true
    api
      .jobTree(messageId)
      .then((t) => alive && setTree(t))
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [messageId])

  if (error) return null
  if (!tree) return null
  return (
    <section>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-kumo-subtle">
        Job flow — parent/child relations
      </div>
      <FlowGraph specs={[jobTreeToSpecs(tree)]} height={260} />
    </section>
  )
}
