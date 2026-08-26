import * as React from "react"
import { CaretDown, CaretRight } from "@phosphor-icons/react"
import { api, type RunnerFibersReport, type RunnerLogsReport, type ReporterLogLine } from "../api.ts"
import { Badge } from "./ui.tsx"
import { useLive } from "../shell.tsx"
import { SkeletonTable } from "./pieces.tsx"

/**
 * Runtime panel for the Runtime (singletons) page — per reporting-runner fiber snapshots
 * and recent log lines (Reporter v2 providers). Runners whose reporter is
 * unreachable show the same muted state as the State tab.
 */

export function RunnerRuntimePanel({
  cluster
}: {
  /** optional cluster name passed through to the fan-out routes */
  cluster?: string
}) {
  const lastSeenRef = React.useRef<number | undefined>(undefined)
  const [logs, setLogs] = React.useState<RunnerLogsReport[]>([])
  const [fibers, setFibers] = React.useState<RunnerFibersReport[]>([])

  const { loading, error, refresh } = useLive(async () => {
    const sinceMs = lastSeenRef.current
    const [l, f] = await Promise.all([
      // incremental tail: after the first poll, ask the server only for newer
      // lines (server /api/logs supports ?since=); dedup on merge for safety
      api.runnerLogs(cluster, sinceMs !== undefined ? { since: sinceMs } : undefined),
      api.runnerFibers(cluster)
    ])
    setLogs((prev) => {
      if (sinceMs === undefined) return l.runners
      const byAddress = new Map(prev.map((r) => [r.address, r]))
      return l.runners.map((r) => {
        const before = byAddress.get(r.address)
        if (!before) return r
        const seen = new Set((before.lines ?? []).map((line) => `${line.t}\u0000${line.text}`))
        const fresh = (r.lines ?? []).filter((line) => !seen.has(`${line.t}\u0000${line.text}`))
        return { ...r, lines: [...(before.lines ?? []), ...fresh] as ReporterLogLine[] }
      })
    })
    setFibers(f.runners)
    // remember newest timestamp so the next poll asks only for newer lines
    const allT = l.runners.flatMap((r) => (r.lines ?? []).map((line) => line.t))
    if (allT.length > 0) lastSeenRef.current = Math.max(...allT) + 1
  }, [cluster])

  const addresses = [...new Set([...logs.map((r) => r.address), ...fibers.map((r) => r.address)])]
  const logsByAddress = new Map(logs.map((r) => [r.address, r]))
  const fibersByAddress = new Map(fibers.map((r) => [r.address, r]))

  if (loading && addresses.length === 0) return <SkeletonTable rows={3} cols={2} />

  return (
    <div className="space-y-3">
      <ErrorRow error={error} onRetry={refresh} />
      {addresses.length === 0 ? (
        <div className="rounded-lg border border-kumo-line bg-kumo-base px-4 py-8 text-center text-[13px] text-kumo-subtle">
          No runners registered.
        </div>
      ) : (
        addresses.map((address) => (
          <RunnerCard key={address} address={address} logs={logsByAddress.get(address)} fibers={fibersByAddress.get(address)} />
        ))
      )}
    </div>
  )
}

function ErrorRow({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null
  return (
    <div className="flex items-center justify-between rounded-md border border-kumo-danger/30 bg-kumo-danger-tint px-3 py-2 text-[13px] text-kumo-danger">
      <span>{error}</span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 cursor-pointer rounded-md border border-kumo-danger/40 px-2 py-0.5 text-[12px] font-medium hover:bg-kumo-danger-tint"
      >
        Retry
      </button>
    </div>
  )
}

function RunnerCard({
  address,
  logs,
  fibers
}: {
  address: string
  logs?: RunnerLogsReport
  fibers?: RunnerFibersReport
}) {
  const [open, setOpen] = React.useState(true)
  const reachable = !logs?.error && !fibers?.error && (logs?.lines !== undefined || fibers?.fibers !== undefined)

  return (
    <div className="rounded-lg border border-kumo-line bg-kumo-base">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="font-mono text-[12px] font-medium">{address}</span>
        <span className="flex items-center gap-2">
          <Badge tone={reachable ? "ok" : "neutral"}>
            {reachable ? `${(logs?.lines ?? []).length} lines · ${(fibers?.fibers ?? []).length} fibers` : "reporter not reachable"}
          </Badge>
          {open ? <CaretDown className="h-3 w-3" /> : <CaretRight className="h-3 w-3" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-kumo-line p-3">
          {!reachable ? (
            <p className="text-[12px] text-kumo-subtle">
              Mount @effect/cluster-ui-reporter with the optional{" "}
              <code className="rounded bg-kumo-canvas px-1">logs</code> /{" "}
              <code className="rounded bg-kumo-canvas px-1">fibers</code> providers to enable this panel.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* fibers */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle">
                  Fibers
                </div>
                {(fibers?.fibers?.length ?? 0) === 0 ? (
                  <p className="text-[12px] text-kumo-subtle">no fiber snapshot</p>
                ) : (
                  <table className="w-full text-left text-[12px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-kumo-subtle">
                        <th className="pb-1 font-semibold">Id</th>
                        <th className="pb-1 font-semibold">Name</th>
                        <th className="pb-1 font-semibold">Status</th>
                        <th className="pb-1 text-right font-semibold">Children</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(fibers?.fibers ?? []).map((f) => (
                        <tr key={f.id} className="border-t border-kumo-line/60">
                          <td className="py-1 pr-2 font-mono">{f.id}</td>
                          <td className="py-1 pr-2 text-kumo-subtle">{f.name ?? "—"}</td>
                          <td className="py-1 pr-2">
                            <Badge tone={f.status === "running" || f.status === "suspended" ? "ok" : "warn"}>
                              {f.status}
                            </Badge>
                          </td>
                          <td className="py-1 text-right tabular-nums text-kumo-subtle">
                            {f.children ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* log tail */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle">
                  Recent logs
                </div>
                {(logs?.lines?.length ?? 0) === 0 ? (
                  <p className="text-[12px] text-kumo-subtle">no log lines reported</p>
                ) : (
                  <pre className="max-h-64 overflow-auto rounded-md border border-kumo-line bg-kumo-base p-2 font-mono text-[11px] leading-4 text-kumo-default">
                    {(logs?.lines ?? []).map((line, i) => (
                      <div key={`${line.t}-${i}`} className="whitespace-pre-wrap">
                        <span className="text-kumo-subtle">
                          {new Date(line.t).toLocaleTimeString()}{" "}
                          {line.level ? `[${line.level}] ` : ""}
                        </span>
                        {line.text}
                      </div>
                    ))}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
