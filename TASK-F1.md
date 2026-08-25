# F1 — reui-style filters + sort on every table

Reference: https://reui.io/components/filters — literally download their filter
component code (they ship copy-paste React/Tailwind components; fetch the faceted
filter + multi-select source from the site) and ADAPT it to our vendored kumo tokens.
If the download fails, rebuild the same UX by hand: a toolbar row of
"column: value ✕" filter trigger popovers + active-filter chips.

You own ONLY:
- NEW `web/src/components/filters/**`
- `web/src/components/pieces.tsx` (additive helpers)
- pages: Messages.tsx, Entities.tsx, EntityInstances.tsx, Shards.tsx, Crons.tsx,
  Workflows.tsx, Runners.tsx, Singletons.tsx

NOT yours: Traces.tsx, WorkflowRunDetail.tsx, Agent.tsx, shell.tsx, Overview.tsx.

## 1. Primitives (web/src/components/filters/)
- `FilterBar` — renders a row of FilterTrigger popovers + removable chips for active
  filters. Popover = absolutely-positioned div w/ search box (when options > 8) +
  checkbox list (kumo Checkbox), close on outside click/Esc. NO new deps beyond what's
  installed (@phosphor-icons, kumo).
- `type FacetDef<T> = { key: string; label: string; options: (rows: T[]) => Array<{ value: string; label?: string }>; predicate: (row: T, values: string[]) => boolean }`
- `useFacets(rows, defs)` returning { filtered, active: {key: values[]}, toggle(key,value),
  clear(key), clearAll }.

## 2. Apply to every table
Each table page gets a FilterBar between PageHeader and table, wired to its natural
facets, CLIENT-side (server paging on Messages keeps its own server filters untouched —
add facets only over the loaded page there):
- Entities: state facets derived from counts? keep simple: entityType search chip exists;
  add status-presence facet (has failed / has pending / all)
- Runners: groups facet, stale facet
- Shards: assigned/unassigned (replace or wrap existing Select — keep both working,
  select becomes a facet)
- Crons: overdue facet, name-prefix facet
- Workflows list: failed>0 facet; runs page: status facet if data allows
- Singletons: reporting/not-reporting facet
- Messages: add facets over loaded page rows (status/tag prefix) alongside existing
  server filters — do NOT remove server controls
3. Ensure EVERY one of these tables has working column sorting already (U1 added it;
   verify each header sorts and fix where missing).

## 4. Native-element sweep on your pages
Replace any remaining raw `<select>` with kumo Select adapter, raw buttons with Button —
EXCEPT where semantically required (none expected here).

Verify: npx tsc --noEmit --pretty false (owned clean, ignore ../effect/) && npx vite build.
No e2e runs.
