import * as React from "react"
import { api, type Message } from "../api.ts"
import { DetailPanel, JsonBlock, StatusBadge, statusTone, useMessageDetail } from "../components/pieces.tsx"
import { Badge, Button, Input, Select, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { fmtTime, relTime } from "../format.ts"
import { ErrorNote, PageHeader, usePolling } from "../shell.tsx"

export function MessagesPage() {
  const [data, setData] = React.useState<{ rows: Message[]; total: number } | null>(null)
  const [status, setStatus] = React.useState<string>("")
  const [entityType, setEntityType] = React.useState<string>("")
  const [q, setQ] = React.useState("")
  const [debouncedQ, setDebouncedQ] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const pageSize = 50

  React.useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQ(q)
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [q])

  const { loading, error } = usePolling(
    async () =>
      setData(
        await api.messages({
          status: status || undefined,
          entityType: entityType || undefined,
          q: debouncedQ || undefined,
          page,
          pageSize
        })
      ),
    [status, entityType, debouncedQ, page]
  )

  const detail = useMessageDetail(openId)

  return (
    <div>
      <PageHeader
        title="Messages"
        subtitle={
          data ? `${data.total.toLocaleString()} matching messages` : undefined
        }
      >
        <Input
          placeholder="search id / entity / tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-60"
        />
        <Input
          placeholder="entity type"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value)
            setPage(1)
          }}
          className="w-44"
        />
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
        >
          <option value="">any status</option>
          <option value="pending">pending</option>
          <option value="inflight">in-flight</option>
          <option value="scheduled">scheduled</option>
          <option value="done">done</option>
        </Select>
      </PageHeader>
      <ErrorNote error={error} />
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
              <TH>Created</TH>
            </TR>
          </THead>
          <TBody>
            {(loading && !data ? [] : data!.rows).map((m) => (
              <TR key={m.id} className="cursor-pointer" onClick={() => setOpenId(m.id)}>
                <TD className="font-mono text-xs text-muted">{shortId(m.id)}</TD>
                <TD>
                  <StatusBadge status={m.status} />
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
                <TD className="whitespace-nowrap text-muted">{relTime(m.createdAt)}</TD>
              </TR>
            ))}
            {!loading && (!data || data.rows.length === 0) && (
              <TR>
                <TD colSpan={7} className="py-10 text-center text-muted">
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
          <MessageDetailBody d={detail} />
        )}
      </DetailPanel>
    </div>
  )
}

function MessageDetailBody({ d }: { d: NonNullable<ReturnType<typeof useMessageDetail>> }) {
  const m = d.message
  return (
    <div className="space-y-4 text-[13px]">
      <section className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-2/40 p-3">
        <Field label="Status">
          <StatusBadge status={m.status} />
        </Field>
        <Field label="Kind">{m.kind}</Field>
        <Field label="Created">{fmtTime(m.createdAt)}</Field>
        <Field label="Machine id">{m.machineId}</Field>
        <Field label="Entity">
          {m.entityType}/{m.entityId}
        </Field>
        <Field label="Shard">{m.shardId}</Field>
        <Field label="Last read">{m.lastRead ?? "—"}</Field>
        <Field label="Deliver at">{m.deliverAt !== null ? fmtTime(m.deliverAt) : "—"}</Field>
        {m.traceId && (
          <Field label="Trace" wide>
            <code className="font-mono text-xs">{m.traceId}</code>
          </Field>
        )}
      </section>

      <section>
        <SectionTitle>Payload</SectionTitle>
        <JsonBlock value={d.payload} />
      </section>

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
                  <Badge tone={r.kind === "withExit" ? "ok" : "neutral"}>{r.kind}</Badge>
                  {r.acked && <Badge tone="accent">acked</Badge>}
                  {r.sequence !== null && <span className="text-muted">seq {r.sequence}</span>}
                  <span className="font-mono text-[11px] text-muted">#{shortId(r.id)}</span>
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
