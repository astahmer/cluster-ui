# cluster-ui — UX/Layout Review

> Status addendum (2026-08-25, v10): the quick-wins batch below plus P0-1..P0-3 landed in
> commit 810690c. Items now **[fixed]**: P0-1, P0-2, P0-3, P1-5, P1-13, P2-1, P2-2, P2-3,
> P2-8, P1-6a (SortableTh as real button), P1-16 (agent chat error surface wired to
> ChatState.error), P2-12 (live.ts uses eventsUrl()), P1-4 (reset-activity button in
> message detail for Workflow/* entities), P1-8 (✕ overload replaced with Phosphor
> Trash/XCircle in Messages).
>
> Batch 3a: **P1-1 [fixed]** — message detail is addressable as `#/messages/<id>` and the
> workflow-run modal as `#/workflows/<name>/<executionId>`; open/close writes the hash
> (Back closes), reload/share rehydrates the panel; covered in browser-e2e. **P1-2 [fixed]**
> — the selected cluster mirrors into the hash as `?cluster=` (shared/bookmarked links
> adopt it on boot), TopBar select is backed by a setCluster pub/sub, and the Agent page's
> second picker now follows the global cluster when unset ("follow topbar cluster").

---

# cluster-ui — UX/Layout Review

Date: 2026-08-25 · Reviewer: reviewer subagent (static source review)
Scope: `web/src/pages/*.tsx`, `web/src/shell.tsx`, `web/src/components/*`, `web/src/kumo` tokens,
`web/src/{api,live,toast,format,freshness}.ts`, `server/src/api.ts` (data surface), `scripts/browser-e2e.mjs`.

**Method note:** this pass is a full *static* review of every page/shell/component source plus the
server route surface, verified against the vendored kumo token file. The planned fresh-screenshot
pass (`nix develop -c pnpm build && node scripts/browser-e2e.mjs` + `modlens`) could not be run in
this session (no shell execution available to this agent); findings are anchored to `file:symbol`
evidence instead. Screenshot confirmation is listed under residual risks.

Severity: **P0** broken/confusing today · **P1** high-value improvement · **P2** polish.
Each item: problem → why it matters → suggested fix → effort (S/M/L).

---

## P0 — broken / confusing

**P0-1. Queues page is unreachable from the sidebar.**
- Problem: `NAV` contains `{ to: "/queues", … }` (`web/src/shell.tsx`, `NAV` array), and the route +
  page exist (`App.tsx` case `"queues"` → `pages/Queues.tsx`), but `NavGroup` renders only
  `NAV.filter(n => NAV_GROUP_CLUSTER.has(n.to))` / `NAV_GROUP_WORK.has(n.to)` — and **neither set
  includes `/queues`**. The sidebar therefore shows 11 items; Queues renders only via ⌘K.
- Why it matters: the one page built specifically for redis/BullMX clusters is invisible exactly
  where redis operators will look for it; it also makes the sidebar's kbd hints lie (see P0-3).
- Fix: add `"/queues"` to `NAV_GROUP_WORK` (or create an "Infra" group with Runners/Shards/Queues).
- Effort: **S**

**P0-2. Entities page renders a duplicated "scheduled" facet pill (duplicate React key).**
- Problem: `facetDefs` in `pages/Entities.tsx` contains
  `presenceFacet("hasScheduled", "scheduled", r => r.scheduled > 0)` **twice** (same `key`).
  `FilterBar` maps defs with `key={def.key}`, so two identical triggers render with duplicate React
  keys (console warning + reconciliation hazard). They mirror the same state, so ticking one moves
  both — looks like a rendering glitch to users.
- Why it matters: a visibly broken control row on one of the highest-traffic tables.
- Fix: delete the second `presenceFacet("hasScheduled", …)` entry.
- Effort: **S**

**P0-3. Number-key navigation promises 1–12 but only 1–9 work.**
- Problem: the global keydown handler navigates on `Number(e.key)` ∈ [1, NAV.length] (`shell.tsx`,
  `Shell` effect) — single keystrokes can never produce 10–12. Yet every palette row shows its index
  as a kbd hint (`hint: String(index+1)`) so Messages/Agent/MCP advertise "10/11/12", and the sidebar
  footer literally says "1–12 switch".
- Why it matters: advertised affordances that silently do nothing erode trust in all shortcuts.
- Fix: either cap hints/shortcut at 1–9 (and drop the footer claim), or implement a proper scheme
  (e.g. `g` then digit, or ⌘+digit).
- Effort: **S**

## P1 — high-value improvements

**P1-1. Message detail and workflow-run detail are not addressable URLs.**
- Problem: open message = `useState(openId)` in `MessagesPage`; workflow run opens
  `WorkflowRunDetailModal` keyed by local state (`pages/Workflows.tsx`). Refresh, tab-drag, or sharing
  the URL loses the selection. Only traces get a real route (`#/traces/:id`).
- Why it matters: dashboards live on deep links (bookmarks, incident threads, agent/MCP outputs
  pointing humans somewhere).
- Fix: encode `#/messages/<id>` and `#/workflows/<name>/<executionId>` (router already splits
  segments; panels stay, just hydrate from the hash).
- Effort: **M**

**P1-2. Cluster selection is invisible in the URL and inconsistent across surfaces.**
- Problem: the TopBar select persists to `localStorage` only (`shell.tsx` `TopBar`); `?cluster=` is
  injected by `withCluster()` at fetch time. Consequences: (a) shared/bookmarked links silently
  resolve against whoever's stored cluster; (b) no persistent "you are looking at cluster X" label
  near page content; (c) the Agent page ships a *second* cluster picker (`ClusterPicker`) defaulting
  to `""` (=default cluster) that does not follow the TopBar choice.
- Why it matters: wrong-cluster reads look like data loss; the dual-picker invites divergent state.
- Fix: mirror the cluster into the hash query (like `useHashParam`), render a muted badge next to
  `PageHeader` when >1 cluster exists, and have the Agent picker default to the global value.
- Effort: **M**

**P1-3. Redis queue operations beyond pause/resume are server-only.**
- Problem: `server/src/api.ts` exposes `promote`, `clean` (completed/failed), and `add-job`
  (redisRouter) and mirrors them as MCP/agent tools, but `pages/Queues.tsx` surfaces only
  pause/resume. Queue depth/waiting/failed counts also aren't shown — the table has just
  name/status/action.
- Why it matters: for a Bull-Board-style dashboard these are table stakes; today users must drop to
  the MCP tester or raw Redis.
- Fix: extend `QueueInfo` display with counts (waiting/active/completed/failed if available) and add
  per-queue "add job" / "clean" dialogs with confirms, mirroring the message-action patterns.
- Effort: **M/L**

**P1-4. `reset-activity` action has no UI.**
- Problem: `api.resetActivity` exists (`web/src/api.ts`) with zero call sites in `web/src`; the
  server route + agent tool exist. Activity retries are only reachable through AI chat.
- Fix: add a "reset activity" action in the message/workflow-run detail alongside retry/interrupt.
- Effort: **S**

**P1-5. First-load blanks: three pages return `null` instead of skeletons.**
- Problem: `SingletonsPage`, `QueuesPage`, `TracesPage` do `if (loading && …) return null`.
  Overview/Messages/Entities/Runners show `SkeletonTable/Cards`. Result: inconsistent blank flashes.
- Fix: reuse `SkeletonTable` everywhere (the component already exists in `components/pieces.tsx`).
- Effort: **S**

**P1-6. Keyboard/screen-reader support on interactive tables and overlays.**
- Evidence:
  - `SortableTh` is a `<TH onClick>` with no `tabIndex`, no key handler (a11y: sort unreachable by
    keyboard despite correct `aria-sort`).
  - Clickable rows (Messages, WorkflowRuns, EntityInstances) are `<TR onClick>` — not focusable, no
    `role="button"`/Enter handling.
  - `DetailPanel`, `WorkflowRunDetailModal`, mobile drawer: plain divs — no `role="dialog"`,
    `aria-modal`, focus trap, initial-focus, or focus restore. Esc works globally (good) but Tab
    roams the background.
- Fix: make `SortableTh` render a real `<button>`; give rows `tabIndex={0}` + keydown; wrap panels in
  a small `useDialogA11y` helper (kumo `Dialog` already exists — the confirm dialog uses it).
- Effort: **M**

**P1-7. Invalid nested interactive control in facet triggers.**
- Problem: `FacetTrigger` renders the "clear" affordance as `<span role="button" …>` **inside** the
  trigger `<button>` (`components/filters/index.tsx`) — invalid DOM/AX nesting; screen readers announce
  a button within a button, click synthesis is browser-dependent.
- Fix: split the pill into two sibling elements (label button + X button) in a flex wrapper.
- Effort: **S**

**P1-8. The ✕ glyph means four different things.**
- Problem: `✕` = "failed execution" marker (Messages status cell), row delete action, interrupt-run
  button, panel close. Distinction is color/hover-title only.
- Why it matters: destructive action shares a glyph with a passive status flag; mis-clicks delete.
- Fix: Phosphor icons — `X` for close, `Trash`/`Prohibit` for destructive, `XCircle` fill for failed.
- Effort: **S**

**P1-9. Contrast failures on informational text.**
- Evidence (kumo tokens, `theme-kumo.css`): light mode `--text-color-kumo-inactive` =
  neutral-300 (~87% L) on white ≈ **<2:1** — used for kbd hints, sidebar footer help, empty-kbd spans;
  `--text-color-kumo-brand` is `#f6821f` in *both* modes and is used as body text
  (`text-kumo-brand/90` for entity codes on Overview "Busiest entities") ≈ **~2.6:1**.
- Why it matters: fails WCAG AA (4.5:1) for the exact texts that carry operational hints.
- Fix: map "inactive-as-text" usages to `subtle` (neutral-500/400 ≈ 4.6:1); reserve brand orange for
  accents/fills, or darken the light-mode brand text token.
- Effort: **S**

**P1-10. Sparklines have no hover inspection despite being built for it.**
- Problem: `Sparkline` keeps `t` "for tooltips/labels" (its own doc comment) but implements neither;
  only the last value is labeled. On Overview you cannot answer "when did pending spike?".
- Fix: pointer-tracking crosshair + value/time bubble (SVG-local, no deps needed).
- Effort: **M**

**P1-11. Command palette is shallow: substring match, noisy subtitles, no domain objects.**
- Problem: matching is `hay.includes(q)` over `keywords + label`; keywords (raw paths like
  `/overview`) are rendered as the item subtitle — visual noise. Nothing searchable except pages,
  theme, pause, and 10+-digit snowflakes. No entities, workflows, queues, clusters, or recent items;
  cluster switching isn't a command.
- Fix: fuzzy subsequence scoring; hide keywords unless they add info; register async item providers
  (entities/workflows via existing list APIs, debounced); add "Switch to cluster …" commands.
- Effort: **M**

**P1-12. Loading/staleness feedback during background refresh is uniform silence.**
- Problem: `useLive` refetches leave the UI untouched until data swaps; the only freshness signal is
  the topbar "updated Ns ago" which is `hidden … sm:inline` (invisible on mobile). Paused state is a
  small badge; per-page there's no way to tell stale from live.
- Fix: subtle opacity pulse or thin progress bar on refetch; surface freshness on mobile (icon-only);
  dim page content slightly while paused.
- Effort: **M**

**P1-13. Workflow runs page: duplicated status filters + layout-order outlier.**
- Problem: status is filterable twice — client facet "status" AND the header `<Select>` writing the
  `status` hash param — with different scopes (facet over loaded rows vs `RUN_STATUSES` whitelist),
  producing chips in two places. Also `FilterBar` renders *above* `PageHeader` here, the only page
  that puts content before the title.
- Fix: drop the facet (keep the URL-backed select) and move FilterBar below the header like every
  other page.
- Effort: **S**

**P1-14. Shards distribution map doesn't scale or segment by runner.**
- Problem: one 10px cell per shard with `repeat(auto-fill, minmax(10px,1fr))` — 1024+ shards produce
  an enormous wall of cells; color encodes only assigned/unassigned, so per-runner skew (the thing
  you scan for) is invisible. Tooltips are title-attr only.
- Fix: color by runner (hash address → categorical hue, legend lists runners), cap cell size/count
  with aggregation, and consider a real tooltip.
- Effort: **M**

**P1-15. Traces list: hard 50-row cap with no pagination/filter/search.**
- Problem: `repo.traces(limit ?? 50)` server-side; the UI gives no paging, no duration/status filter,
  no id search, and no indication the list is truncated.
- Fix: "showing latest 50" caption minimum; ideally offset paging + trace-id search (palette hook
  could deep-link trace ids too).
- Effort: **M**

**P1-16. Agent chat has no visible error surface.**
- Problem: `AgentPageBody` renders `<ErrorNote error={null} />` (hardcoded) and nothing maps
  transport failures (401 bad key, network, provider init errors from `/api/agent/stream`) into the
  transcript. Send is disabled until a key exists (good), but an *invalid* key fails silently after
  send.
- Fix: subscribe to runtime error state and render a Banner/ErrorNote; toast on stream failure.
- Effort: **S/M**

## P2 — polish

**P2-1. Overview stat grid orphan.** 5 StatCards in `grid-cols-2 lg:grid-cols-5`: at md widths the
5th card sits alone on row 2 half-width. Use `sm:grid-cols-3` + last-card `col-span` or 6 slots.

**P2-2. Timeline axis misalignment (~12px).** Tick lane uses `ml-[220px]` but the row label column is
`w-[196px]` + `gap-3` (12px) = 208px (`components/timeline.tsx`). Ticks/bars disagree about t=0.
Set both from one constant.

**P2-3. Relative times without absolute fallback in Messages "Created".** `relTime(m.createdAt)`
with no `title` (Crons and ActivityDot both provide titles). One-liner.

**P2-4. Pager inconsistency.** Messages pager: "page x / y"; EntityInstances: "page {page}" only, and
no page-size control anywhere but Messages. Unify into one `Pager` component (it already exists
privately in `Messages.tsx` — export it).

**P2-5. Absolute-vs-relative time inconsistency.** Workflow runs "Started" uses raw
`toLocaleString()`; messages/crons use relative-with-tooltip. Pick one convention (relative + title).

**P2-6. `fmtTime` drops the year** — traces spanning a year boundary are ambiguous.

**P2-7. Sort direction indicator lies.** Messages' custom "Created/Delivers" header shows ▼ whenever
`sort !== "id"`, regardless of actual direction (only asc is reachable there anyway); no `aria-sort`
on that TH (SortableTh does this correctly — reuse it).

**P2-8. Export buttons export only the current page** (up to pageSize) but are labeled "export
json/csv". Say "export page (n rows)" or add "export all matching" via a server-side CSV route.

**P2-9. Esc listener pile-up.** Drawer close (`SidebarContent`), `useEscToClose` panels, facet
popovers, and palette all listen on window; with drawer + detail panel open, one Esc closes both.
Scope handlers (stopPropagation / single registry with priority).

**P2-10. "/" shortcut is a silent no-op** on pages without `[data-search-input]`. Fall back to
opening the command palette.

**P2-11. Unknown-route dead end.** `default:` renders only `unknown route: …` with no link home.
Add a "← overview" Link.

**P2-12. SSE ignores the selected cluster.** `live.ts` `connect()` hardcodes `new EventSource("/api/events")`
although `eventsUrl()` exists precisely for this — frames always describe the *default* cluster.
Wakeups still refetch correctly, so impact is limited to wasted traffic and a misleading bus-down
heuristic; wire `eventsUrl()` in.

**P2-13. Theme toggle affordances.** Text-glyph "◐" button (inconsistent with Phosphor everywhere
else); no explicit "system" option after first toggle. Also palette offers Light/Dark/Toggle as
three items — collapse to Toggle + System.

**P2-14. Mobile drawer background scrolls and has no focus trap** (overlay div without
`overflow:hidden` on body / inert background).

**P2-15. Sticky-header style drift in Runners table.** Mixes `STICKY_TH` const with hand-written
`className="sticky top-0 z-10 bg-kumo-base"` repeats — use the const (or move stickiness into `TH`)
to avoid one-off drift.

**P2-16. Native checkboxes in Crons "overdue only"** vs kumo `Checkbox` used in facet popovers —
visual inconsistency; also the label is a plain inline control in the header slot rather than a chip.

**P2-17. Palette input lacks combobox wiring.** Items have `role="option"` in a `role="listbox"`, but
the input has no `role="combobox"`, `aria-controls`, or `aria-activedescendant`.

**P2-18. Status tone collision: `pending`=warn (amber) vs `scheduled`=accent (brand-orange family).**
Side by side in tables these read as the same "attention" hue. Differentiate (e.g. scheduled → violet)
or add shape cues.

**P2-19. Messages toolbar density at <1280px.** Five fixed-width inputs + selects wrap into a tall
stack pushing the table down; consider a collapsible "filters" disclosure with active-filter count.

**P2-20. Snowflake deep-link only in palette.** Pasting an id into Messages' own search works, but
pasting a full snowflake into the palette is the advertised path — worth a hint in the messages
search placeholder too ("paste an id").

### IA observations (cross-cutting)
- Grouping works (Cluster / Work) but Work now holds 7 entries; if Queues joins (P0-1), consider a
  third group: **Infra** (Runners, Shards, Queues) / **Work** (Entities, Workflows, Crons) /
  **Observe** (Traces, Singletons, Messages).
- Runner logs/fibers are buried as the second tab of "Singletons" — a page named for a different
  concept. Either rename the page "Runtime" or split Logs out; nothing else in the nav points to the
  `/api/logs` surface.
- Metrics history supports arbitrary `rangeMs` server-side but the UI fixes 1h/6h/24h — cheap win to
  add 7d if retention allows.

## Quick wins (S-effort P0/P1)

1. Add `/queues` to a nav group (P0-1).
2. Delete duplicate `presenceFacet("hasScheduled", …)` in Entities (P0-2).
3. Cap digit shortcuts/hints at 1–9 and fix the sidebar footer copy (P0-3).
4. `title={fmtTime(...)}` on Messages Created cells (P2-3).
5. Fix timeline `ml-[220px]` → 208px constant (P2-2).
6. Skeletons instead of `return null` in Singletons/Queues/Traces (P1-5).
7. `tabIndex={0}` + Enter/Space on `SortableTh` (wrap in `<button>`) (P1-6a).
8. Wire the Agent page error state into `ErrorNote`/Banner (P1-16).
9. Use `eventsUrl()` in `live.ts connect()` (P2-12).
10. Relabel exports to "export page (json/csv)" (P2-8).
11. Move WorkflowRuns FilterBar under PageHeader; remove the duplicate status facet (P1-13).
12. Swap ✕-overload for Phosphor icons in Messages rows/actions (P1-8).
13. Overview stat grid `sm:grid-cols-3` fix (P2-1).
14. Surface `resetActivity` in detail panels (P1-4).
