import * as React from "react"
import { api, mcpRpc } from "../api.ts"
import { Badge, Button, Input, Select } from "../components/ui.tsx"
import { JsonBlock } from "../components/pieces.tsx"
import { ErrorNote, PageHeader, useLive } from "../shell.tsx"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui.tsx"
import { ClipboardText, CodeBlock, Empty } from "../kumo"

/**
 * MCP page (#/mcp) — connection info, tool explorer and a live tester for the
 * stateless MCP streamable-http endpoint exposed at POST /mcp
 * (docs/ROADMAP.md §5). The same registry backs the Agent page's chat tools.
 */

interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const WRITE_SUFFIX = "(write operation)"

function splitDescription(description: string): { text: string; write: boolean } {
  const text = description.endsWith(WRITE_SUFFIX)
    ? description.slice(0, -WRITE_SUFFIX.length).trim()
    : description
  return { text, write: description.endsWith(WRITE_SUFFIX) }
}

export function McpPage() {
  const [tools, setTools] = React.useState<McpTool[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [initialized, setInitialized] = React.useState(false)

  const refresh = React.useCallback(async () => {
    try {
      await mcpRpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cluster-ui-dashboard", version: "1.0.0" }
      })
      setInitialized(true)
      const res = await mcpRpc("tools/list")
      const raw = (res.result as { tools?: McpTool[] } | undefined)?.tools ?? []
      setTools(raw)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useLive(refresh)

  const endpoint = `${window.location.origin}/mcp`
  const configSnippet = JSON.stringify(
    { mcpServers: { "cluster-ui": { url: endpoint } } },
    null,
    2
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="MCP"
        subtitle="Model Context Protocol — let any MCP client query and act on the cluster"
      />
      <ErrorNote error={error} />

      {/* connection */}
      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="ok">{initialized ? "endpoint live" : "checking…"}</Badge>
            <Badge tone="accent">stateless streamable-http JSON-RPC</Badge>
          </div>
          <ClipboardText
            size="sm"
            text={endpoint}
            tooltip={{ text: "Copy endpoint URL", copiedText: "Copied!", side: "top" }}
          />
          <p className="text-[12px] leading-4 text-kumo-subtle">
            POST initialize / tools/list / tools/call — one JSON-RPC request per call,
            no session state. Write tools respect read-only mode.
          </p>
          <CodeBlock lang="jsonc" code={configSnippet} />
        </CardContent>
      </Card>

      {/* tools explorer + live tester */}
      <ToolsExplorer tools={tools} />
      {tools.length > 0 && <ToolTester tools={tools} />}
    </div>
  )
}

function ToolsExplorer({ tools }: { tools: McpTool[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-kumo-default">
        Tools{" "}
        <span className="text-[11px] font-normal text-kumo-subtle">
          ({tools.length} · shared registry with the Agent chat)
        </span>
      </h2>
      {tools.length === 0 ? (
        <Empty title="No tools loaded" description="The /mcp endpoint returned no tools." />
      ) : (
        tools.map((tool) => <ToolRow key={tool.name} tool={tool} />)
      )}
    </div>
  )
}

function ToolRow({ tool }: { tool: McpTool }) {
  const [open, setOpen] = React.useState(false)
  const { text, write } = splitDescription(tool.description)
  return (
    <Card>
      <CardContent>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center justify-between gap-3 text-left"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2">
              <code className="font-mono text-[13px]">{tool.name}</code>
              <Badge tone={write ? "warn" : "ok"}>{write ? "write" : "read"}</Badge>
            </span>
            <span className="text-[12px] leading-4 text-kumo-subtle">{text}</span>
          </span>
          <span className="shrink-0 text-[11px] text-kumo-subtle">{open ? "hide schema" : "schema"}</span>
        </button>
        {open && (
          <div className="mt-2">
            <JsonBlock value={tool.inputSchema} max={2000} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------- live tester -- */

export function ToolTester({ tools }: { tools: McpTool[] }) {
  const [name, setName] = React.useState(tools[0]?.name ?? "")
  const [argsText, setArgsText] = React.useState("{}")
  const [cluster, setCluster] = React.useState("")
  const [running, setRunning] = React.useState(false)
  // native textarea: no multiline component exists in the vendored kumo subset
  // (upstream ships none); justified exception per repo convention.
  const [result, setResult] = React.useState<
    { isError: boolean; text: string } | null
  >(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!tools.some((t) => t.name === name)) setName(tools[0]?.name ?? "")
  }, [tools, name])

  const execute = async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      let args: Record<string, unknown> = {}
      try {
        args = argsText.trim() === "" ? {} : (JSON.parse(argsText) as Record<string, unknown>)
      } catch {
        throw new Error("arguments must be valid JSON")
      }
      if (cluster.trim() !== "") args.cluster = cluster.trim()
      const res = await mcpRpc("tools/call", { name, arguments: args })
      if (res.error) throw new Error(res.error.message)
      const call = (res.result ?? {}) as {
        isError?: boolean
        content?: Array<{ type: string; text?: string }>
      }
      const text = call.content?.find((c) => c.type === "text")?.text ?? ""
      setResult({
        isError: call.isError === true,
        text: prettyMaybeJson(text)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live tester</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[220px_140px_100px]">
          <Select aria-label="tool" value={name} onChange={(e) => setName(e.target.value)}>
            {tools.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </Select>
          <Input
            placeholder="cluster (optional)"
            aria-label="cluster argument"
            value={cluster}
            onChange={(e) => setCluster(e.target.value)}
          />
          <Button variant="default" onClick={execute} disabled={running || !name}>
            {running ? "Running…" : "Execute"}
          </Button>
        </div>
        <textarea
          rows={4}
          aria-label="tool arguments JSON"
          placeholder='{"pageSize": 5}'
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          className="w-full resize-y rounded-md border border-kumo-line bg-kumo-base px-3 py-2 font-mono text-[12px] outline-none focus:border-kumo-brand"
        />
        <ErrorNote error={error} />
        {result && (
          <div>
            <Badge tone={result.isError ? "err" : "ok"}>
              {result.isError ? "isError" : "ok"}
            </Badge>
            <div className="mt-1.5">
              <CodeBlock lang="jsonc" code={result.text} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function prettyMaybeJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
