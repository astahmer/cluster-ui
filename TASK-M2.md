# M2 — MCP page (#/mcp)

You own ONLY: NEW `web/src/pages/Mcp.tsx` and an additive edit to `web/src/api.ts`.
The parent wires nav entry + App route + palette — do NOT touch shell.tsx or App.tsx.
Route contract: "#/mcp" renders `export function McpPage()`.

Page content (kumo components/tokens only):
1. **Connection card**: shows the MCP endpoint URL (window.location.origin + "/mcp"),
   transport note ("stateless streamable-http JSON-RPC — POST initialize/tools/list/
   tools/call"), and a copy button (kumo ClipboardText exists — check its API).
   Include a ready-to-paste config snippet block (Code/CodeBlock component exists):
   ```json
   { "mcpServers": { "cluster-ui": { "url": "<origin>/mcp" } } }
   ```
2. **Tools explorer**: POST /api/mcp-style call to "/mcp" with { jsonrpc:"2.0", id:1,
   method:"tools/list" } — render each tool as a Card row: name (mono), description,
   readOnly/write badge (parse "(write operation)" suffix off description into a Badge,
   description shown without the suffix), input schema pretty-printed collapsible.
3. **Live tester**: pick a tool (Select), fill arguments as JSON in a textarea (native ok —
   no kumo textarea exists; justify via comment), "Execute" Button → POST tools/call →
   render result content[0].text (pretty JSON) or isError styling. Optional cluster arg
   input. Errors shown inline.
4. api.ts additive: `mcpRpc(method, params)` helper posting to "/mcp".

Verify: npx tsc --noEmit --pretty false (owned clean) && npx vite build. No e2e.
