import * as React from "react"
import { PaperPlaneRight, StopCircle, Sparkle } from "@phosphor-icons/react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"
import { Badge, Button, Input, Select } from "../components/ui.tsx"
import { ErrorNote, PageHeader } from "../shell.tsx"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui.tsx"
import { Empty } from "../kumo"
import { JsonBlock } from "../components/pieces.tsx"

/**
 * Agent page — chat with a model that has live cluster tools mounted
 * (docs/ROADMAP.md §5). BYOK: the key stays in localStorage and is sent per
 * request in the body; the server never persists it. The same tools are also
 * exposed machine-to-machine at POST /mcp.
 */

interface AgentConfig {
  provider: "openai" | "anthropic"
  apiKey: string
  model: string
  cluster: string
}

const CONFIG_KEY = "cluster_ui_agent"

function loadConfig(): AgentConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return DEFAULTS
}

const DEFAULTS: AgentConfig = {
  provider: "openai",
  apiKey: "",
  model: "",
  cluster: ""
}

const MODEL_PLACEHOLDERS = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5"
}

/** deep-link chips for known tools so answers jump straight into the pages */
function deepLinkFor(toolName: string, input: unknown): { label: string; href: string } | null {
  const inp = (input ?? {}) as Record<string, unknown>
  switch (toolName) {
    case "query_messages":
    case "get_message":
      return { label: "open in Messages", href: `#/messages?q=${encodeURIComponent(String(inp.id ?? inp.q ?? ""))}` }
    case "get_workflow_run":
      return {
        label: "open run",
        href: `#/workflows/${encodeURIComponent(String(inp.name ?? ""))}/${encodeURIComponent(String(inp.executionId ?? ""))}`
      }
    case "list_crons":
      return { label: "open Crons", href: "#/crons" }
    case "list_singletons":
      return { label: "open Singletons", href: "#/singletons" }
    case "list_traces":
      return { label: "open Traces", href: "#/traces" }
    default:
      return null
  }
}

export function AgentPage() {
  const [config, setConfig] = React.useState<AgentConfig>(loadConfig)
  const saveConfig = (patch: Partial<AgentConfig>) => {
    setConfig((c) => {
      const next = { ...c, ...patch }
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  // transport re-created when config changes so body resolver reads fresh values
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agent/stream",
        body: () => ({
          provider: config.provider,
          apiKey: config.apiKey,
          model: config.model,
          cluster: config.cluster || undefined
        })
      }),
    [config.provider, config.apiKey, config.model, config.cluster]
  )

  const { messages, sendMessage, status, error, stop } = useChat({
    transport,
    onFinish: () => {},
    onError: () => {}
  })
  void error

  const [draft, setDraft] = React.useState("")
  const streaming = status === "streaming" || status === "submitted"

  const send = () => {
    const text = draft.trim()
    if (!text || streaming) return
    if (!config.apiKey.trim()) return
    setDraft("")
    void sendMessage({ text })
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <PageHeader title="Agent" subtitle="ask what happened · make actions — same tools as POST /mcp" />

      {/* connection settings */}
      <Card className="mb-3 shrink-0">
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-[110px_1fr_1fr_130px]">
          <Select
            aria-label="provider"
            value={config.provider}
            onChange={(e) => saveConfig({ provider: e.target.value as AgentConfig["provider"] })}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </Select>
          <Input
            type="password"
            placeholder="API key (stored locally)"
            value={config.apiKey}
            onChange={(e) => saveConfig({ apiKey: e.target.value })}
          />
          <Input
            placeholder={MODEL_PLACEHOLDERS[config.provider]}
            value={config.model}
            onChange={(e) => saveConfig({ model: e.target.value })}
          />
          <ClusterPicker cluster={config.cluster} onPick={(cluster) => saveConfig({ cluster })} />
        </CardContent>
      </Card>

      {/* transcript */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-kumo-line bg-kumo-base p-3">
        {messages.length === 0 && (
          <Empty
            icon={<Sparkle className="h-8 w-8 text-kumo-subtle" />}
            title="Ask about your cluster"
            description={`Try "what failed in the last hour?" or "retry message <id>". Tools run against ${
              config.cluster || "the default cluster"
            }; write actions respect read-only mode.`}
          />
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {streaming && (
          <div className="text-[12px] text-kumo-inactive" data-testid="agent-streaming">
            thinking…
          </div>
        )}
      </div>

      <ErrorNote error={error ? String(error.message ?? error) : null} />

      {/* composer */}
      <div className="mt-3 flex shrink-0 items-end gap-2">
        <textarea
          rows={2}
          aria-label="agent message"
          className="w-full resize-y rounded-md border border-kumo-line bg-kumo-base px-3 py-2 text-[13px] outline-none focus:border-kumo-brand"
          placeholder={config.apiKey ? "ask anything about the cluster…" : "set an API key above first"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        {streaming ? (
          <Button variant="secondary" onClick={() => stop()} aria-label="stop generation">
            <StopCircle className="h-4 w-4" /> Stop
          </Button>
        ) : (
          <Button variant="default" onClick={send} disabled={!draft.trim() || !config.apiKey.trim()}>
            <PaperPlaneRight className="h-4 w-4" /> Send
          </Button>
        )}
      </div>
    </div>
  )
}

function ClusterPicker({ cluster, onPick }: { cluster: string; onPick: (c: string) => void }) {
  const [clusters, setClusters] = React.useState<string[]>([])
  React.useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg: { clusters: string[] }) => setClusters(cfg.clusters ?? []))
      .catch(() => {})
  }, [])
  if (clusters.length <= 1) return null
  return (
    <Select aria-label="cluster" value={cluster} onChange={(e) => onPick(e.target.value)}>
      <option value="">default cluster</option>
      {clusters.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  )
}

type AgentUIMessage = UIMessage

function MessageBubble({ message }: { message: AgentUIMessage }) {
  const isUser = message.role === "user"
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-full rounded-lg px-3 py-2 text-[13px] leading-5 ${
          isUser ? "bg-kumo-brand/15 text-kumo-default" : "border border-kumo-line bg-kumo-base"
        }`}
      >
        {message.parts.map((part, i) => (
          <MessagePart key={i} part={part} />
        ))}
      </div>
    </div>
  )
}

function MessagePart({ part }: { part: AgentUIMessage["parts"][number] }) {
  if (part.type === "text") {
    return <p className="whitespace-pre-wrap">{part.text}</p>
  }
  if (part.type.startsWith("tool-")) {
    const p = part as unknown as ToolUIPartLike
    return <ToolCard name={p.type.slice(5)} state={p.state} input={p.input} output={p.output} errorText={p.errorText} />
  }
  // step markers / files / reasoning — render nothing for now
  return null
}

interface ToolUIPartLike {
  type: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

function ToolCard({
  name,
  state,
  input,
  output,
  errorText
}: {
  name: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}) {
  const [open, setOpen] = React.useState(false)
  const link = deepLinkFor(name, input)
  const isError = state === "output-error" || Boolean(errorText)
  const tone = isError ? "err" : state === "output-available" ? "ok" : "info"
  const stateLabel =
    state === "input-streaming" || state === "input-available" ?
      "running" :
      state === "output-error" ?
      "failed" :
      "done"
  return (
    <div className="my-1.5 rounded-md border border-kumo-line bg-kumo-canvas/60 p-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex cursor-pointer items-center gap-2 font-mono text-[12px]"
        >
          <Badge tone={tone as "ok" | "err" | "info"}>{stateLabel}</Badge>
          <span>{name}()</span>
        </button>
        <div className="flex items-center gap-2">
          {link && (
            <a href={link.href} className="text-[11px] text-kumo-link hover:underline">
              {link.label} →
            </a>
          )}
        </div>
      </div>
      {isError && errorText && <div className="mt-1 text-[12px] text-kumo-danger">{errorText}</div>}
      {open && (
        <div className="mt-2 space-y-2">
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle">input</div>
            <JsonBlock value={input ?? null} max={200} />
          </div>
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle">output</div>
            <JsonBlock value={output ?? errorText ?? null} max={400} />
          </div>
        </div>
      )}
    </div>
  )
}
