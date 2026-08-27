import * as React from "react"
import { CirclesThree } from "@phosphor-icons/react"
import { api, type RunnerReport } from "../api.ts"
import { RunnerRuntimePanel } from "../components/runner-state.tsx"
import { Badge, Table, TBody, TD, TH, THead, TR } from "../components/ui.tsx"
import { ErrorNote, PageHeader, useRoute, useLive } from "../shell.tsx"
import { SkeletonTable, useHashParam } from "../components/pieces.tsx"
import { Empty, Tabs, Tooltip } from "../kumo"
import { FilterBar, presenceFacet, useFacets, type FacetDef } from "../components/filters/index.tsx"
/**
 * Runtime visibility page (display name; route stays /singletons). Runner-
 * resident state (singletons, in-memory entities) is only visible for runners
 * that mount the optional @effect/cluster-ui-reporter package; unreachable
 * reporters show as a muted per-runner error rather than failing the whole view.
 */
export function SingletonsPage() {
  // tab lives in the URL so #/singletons?tab=logs deep-links to fibers/logs
  const [tabParam, setTabParam] = useHashParam("tab")
  const tab = tabParam === "logs" ? "logs" : "state"
  const setTab = (t: string) => setTabParam(t === "state" ? "" : t)
  const [runners, setRunners] = React.useState<RunnerReport[]>([])
  const { loading, error, refresh } = useLive(async () => setRunners((await api.singletons()).runners))
  // cluster param flows through to the runtime fan-out routes too
  const route = useRoute()
  const cluster = route.params.get("cluster") ?? undefined

  const facetDefs: FacetDef<RunnerReport>[] = [
    presenceFacet("reporting", "reporting", (r) => Boolean(r.state))
  ]
  const facets = useFacets(runners, facetDefs)

  if (loading && runners.length === 0) return <SkeletonTable />

  const reporting = runners.filter((r) => r.state)
  const totalSingletons = reporting.reduce((acc, r) => acc + (r.state?.singletons?.length ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="Runtime"
        subtitle="runners, fibers & singleton leases"
      />
      <ErrorNote error={error} onRetry={refresh} />

      <Tabs
        variant="segmented"
        size="sm"
        className="mb-3 w-fit"
        tabs={[
          { value: "state", label: "State" },
          { value: "logs", label: "Logs & fibers" }
        ]}
        value={tab}
        onValueChange={setTab}
      />

      <FilterBar defs={facetDefs} rows={runners} facets={facets} />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-kumo-subtle">
        <Badge tone={reporting.length > 0 ? "ok" : "neutral"}>
          {reporting.length}/{runners.length} runners reporting
        </Badge>
        <Badge tone="accent">{totalSingletons} singletons</Badge>
      </div>
      {runners.length > 0 && reporting.length === 0 && (
        <div className="mb-3 rounded-md border border-kumo-warning/40 bg-kumo-warning-tint px-3 py-2 text-[12px] text-kumo-warning">
          <strong>No runtime reporters are connected.</strong> Runner storage is visible, but in-memory singleton and fiber state is not. Install <code>@effect/cluster-ui-reporter</code> in each runner, then retry.
        </div>
      )}

      <div data-tab="state" hidden={tab !== "state"} className="rounded-lg border border-kumo-line bg-kumo-base">
        <Table>
          <THead>
            <TR>
              <TH>Runner</TH>
              <TH>Reporter</TH>
              <TH>Singletons</TH>
              <TH className="text-right">Entities in memory</TH>
              <TH>Entity types</TH>
            </TR>
          </THead>
          <TBody>
            {facets.filtered.map((r) => (
              <TR key={r.address}>
                <TD className="font-medium">{r.address}</TD>
                <TD>
                  {r.state ? <Badge tone="ok">ok</Badge> : <ReporterMissing reason={r.error} />}
                </TD>
                <TD>
                  {(r.state?.singletons?.length ?? 0) > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {(r.state?.singletons ?? []).map((s) => (
                        <Badge key={s.name} tone="info">
                          {s.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-kumo-subtle">—</span>
                  )}
                </TD>
                <TD className="text-right tabular-nums">
                  {r.state?.entitiesInMemory ?? <span className="text-kumo-subtle">—</span>}
                </TD>
                <TD className="text-kumo-subtle">
                  {(r.state?.registeredEntityTypes?.length ?? 0) > 0
                    ? r.state?.registeredEntityTypes?.join(", ")
                    : "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {runners.length === 0 && (
          <Empty
            icon={<CirclesThree className="h-8 w-8 text-kumo-subtle" />}
            title="No runners registered"
            description="Runner addresses come from shard storage."
          />
        )}
      </div>

      <p className="mt-2 text-[12px] leading-4 text-kumo-subtle">
        Singleton state lives in each runner's memory — mount the optional{" "}
        <code className="rounded bg-kumo-canvas px-1 py-0.5">@effect/cluster-ui-reporter</code>{" "}
        package in your runner app to make it visible here.
      </p>

      <div className="mt-4" data-tab="logs" hidden={tab !== "logs"}>
        <RunnerRuntimePanel cluster={cluster} />
      </div>
    </div>
  )
}

function ReporterMissing({ reason }: { reason?: string }) {
  return (
    <Tooltip
      content={
        <span className="text-xs">
          {reason ? `fetch failed: ${reason} — ` : ""}mount @effect/cluster-ui-reporter on this
          runner to expose GET /internal/cluster-ui/state.
        </span>
      }
    >
      <span className="cursor-help text-[12px] text-kumo-warning">not reporting</span>
    </Tooltip>
  )
}
