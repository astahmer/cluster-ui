# cluster-ui — UX Audit #2 (fresh pass, post-batch-4)

Date: 2026-08-26 · Method: full static source re-review (all 14 pages, shell, components, server
surface) **plus** real-browser screenshot pass (`scripts/ux-shots.mjs` → 36 shots, both clusters,
1440px + 390px, panel-open states). All items from the original `docs/UX-REVIEW.md` are verified
fixed in source and excluded here. Zero P0 findings; **7 × P1**, ~25 × P2.

---

## P1 — fix soon

**A1. Dead facets: FilterBar never rendered on EntityInstances & Runtime.**
`EntityInstances.tsx` builds "with failures"/"currently pending" facet defs and computes `facets`,
but no `<FilterBar>` is in the JSX — users can't filter despite shipped machinery. Same in
`Singletons.tsx` ("reporting" facet). Render the bar or delete the defs. Effort S.

**A2. WorkflowRuns still renders FilterBar *above* PageHeader.**
`Workflows.tsx` — the layout-order half of old P1-13 was never applied; every other page puts
FilterBar under the header. Swap the two elements. Effort S.

**A3. Queue "Clean" purge has no confirmation.**
Pause/resume confirms via dialog; Clean (removes up to 500 finished jobs, scope "*" = both states)
fires immediately on click. One misclick on prod is unrecoverable. Route submit through
`confirmDialog({ destructive: true })` summarizing scope + live counts. Effort S.

**A4. Read-only server mode is invisible.**
`/api/config` returns `readonly` and the server gates every write action, but the web `AppConfig`
type doesn't declare it and no surface shows it — in read-only deployments every retry/delete/
pause/clean button renders enabled and fails at click time. Add badge in TopBar + disable writes.
Effort M.

**A5. Switching TopBar cluster silently wipes an in-progress Agent conversation.**
`AgentPage`'s runtime `useMemo` deps include `globalCluster`; a new runtime resets thread state.
The fetch shim already reads `getCluster()` at call time — drop `globalCluster` from deps so only
explicit BYOK edits rebuild. Effort S.

**A6. Command palette unreachable on touch devices.**
Trigger is `hidden sm:flex`, other openers are ⌘K and `/`. On phones there is no affordance at all,
yet the palette is the advertised path for id deep-links (confirmed visually). Icon-only palette
button on mobile. Effort S.

**A7. "Scheduled" renders three different ways across pages.**
Rows use the dashed-outline treatment (P2-18), but Entities' Scheduled *column*, EntityInstances'
count column, and Crons' status tone map `accent → info` — plain blue identical to in-flight badges
beside them. Unify on one scheduled treatment everywhere. Effort S/M.

## P2 — polish

**Layout/visual**
- Overview stat grid still orphans below `sm` (5 cards in 2 cols); make 5th span or `grid-cols-1`.
- `ShardBar` divides by zero when total=0 → `NaN%` width (Runners' LoadBar guards correctly).
- Busiest-entities `<code class="truncate">` can't truncate without a `min-w-0` flex wrapper; same
  for unbounded workflow names on Workflows cards.
- Timeline axis ticks: edge labels clip (t=0 tick's left half cut by overflow container) AND when
  the run modal is narrow the tick labels collide into an unreadable run-on (confirmed in
  screenshots) — thin to ~5 ticks and clamp first/last.
- `RUNNER_PALETTE` hues untested in light mode; three adjacent warm hues hard to distinguish at
  10px cells regardless of mode.
- `SortableTh` duplicates sticky classes instead of sharing `STICKY_TH` — drift can recur.

**Responsive**
- Sub-32px tap targets in repeated chrome: Pager prev/next (~22px tall), FilterChip remove ✕,
  Messages row delete. Bump via `sm:` overrides to keep desktop density.
- Wide tables are horizontal-crawl only on phones; a card/list layout for Messages <sm is the
  eventual fix (L, note only).

**Flows / state**
- SSE stream never reconnects after a cluster switch: `connect()` evaluates `eventsUrl()` once;
  wakeup cadence + bus-down signal reflect the wrong cluster until reload.
- Stale derived labels: palette's pause/resume label memoized on `[clusterNames]`; theme icon reads
  DOM during render and only corrects on next unrelated rerender. Derive both from hooks.
- MCP page re-runs the JSON-RPC initialize/tools-list handshake on every ~5s SSE wakeup. Fetch once
  + manual refresh; drop `useLive` there.
- Runner logs "incremental since" logic is wired to nothing: `lastSeenRef` exists but
  `api.runnerLogs` sends no `since`, so each poll refetches the full buffer (server supports it).
- Messages deep-link writer emits both `/messages/<id>` **and** a dead `msg=` query param; nothing
  reads it. `msToDatetimeLocal` helper is uncalled. Drop both.

**Information design**
- Sparkline hover bubble shows time without date — with 7d ranges "14:32" is ambiguous across seven
  days. Day-aware formatting when range > 24h.
- Message detail "Last read" renders a raw machine timestamp while neighbors use fmtTime/relTime.
- Overview "Cluster time" card shows "0s ago" forever (it IS server now); show clock skew when
  |Δ|>2s instead, fold explainer into footer (confirmed visually).
- Busiest-entities has no empty state (blank card on fresh clusters).
- Runners states staleness twice ("stale" badge + "no shards" status) with different words.
- Sidebar footer says "reads the cluster's SQL storage" while a redis cluster is selected
  (confirmed visually) — say "storage".
- Traces duration column = first→last creation window but reads as critical-path duration; needs a
  tooltip/label.
- Workflow runs fail-rate % appears on some cards and vanishes on others (`totalFailed > 0 &&
  failedRuns > 0` ternary) — inconsistent row grammar in a failing cluster.
- Shards distribution map ignores the header Select AND facets — filtering to "unassigned" still
  paints every assigned cell; also unbounded cell count at 1024+ shards. Map should respect active
  filters (or caption why not) + aggregate/cap.

**Consistency**
- Icon vocabulary split: Phosphor in tables, unicode glyphs in detail bodies (`⟳ retry`, `↺ reset`,
  `✕ cancel run` — destructive ✕ again!, `⧉ copy`, `▾/▸`). Sweep detail surfaces to Phosphor.
- Traces search input is hand-styled raw `<input>` (others use Input/InputGroup) and lacks
  `data-search-input`, so `/` doesn't focus it.
- CleanDialog uses an unstyled native `<select>` though shared `Select` is imported next to it.
- Export exists only on Messages; generalize `useExport(rows, filename)` for Entities/Crons/Traces/runs.
- `aria-sort` sits on the inner button, not the TH (ARIA defines it for columnheaders).
- Queues: server-side `promote` has no UI (delayed jobs can't be promoted from the dashboard);
  Add-job default payload `"{\n \n}"` should just be `{}`.
- Runtime page: tab named "Runtime" inside page "Runtime"; rename tab "Logs & fibers". Tab state not
  URL-addressable. `RunnerRuntimePanel` returns null first load (P1-5 pattern regression).

## Quick wins (ranked)

1. Render FilterBar on EntityInstances + Runtime (A1)
2. Confirm-dialog on queue Clean (A3)
3. Move WorkflowRuns FilterBar under header (A2)
4. Mobile palette button (A6)
5. Exclude globalCluster from Agent runtime deps (A5)
6. Unify scheduled badge across count columns (A7)
7. ShardBar zero-guard + busiest-entities min-w-0 + empty state
8. Surface config.readonly (badge + disabled writes) (A4)
9. Shards map respects filters + caption/cap
10. Pass `since` through runnerLogs; stop MCP 5s loop
11. Derive theme icon + pause label from reactive hooks
12. Day-aware sparkline hover labels; fmtTime Last-read
13. Unicode glyph sweep → Phosphor in detail bodies
14. Drop dead `msg` param + helper; aria-sort onto TH
15. Sidebar footer copy: "reads the cluster's storage"

## Residual risks / notes

- i18n readiness: ~300+ hardcoded English strings, mixed casing conventions; extraction layer would
  be L effort (note only).
- Z-order verified statically (sticky z-10 < popover z-30 < panel/drawer z-40 < kumo Dialog portal);
  confirmDialog-over-side-panel stacking worth one runtime check.
- Wide-table mobile strategy is scroll-only by design for now.
