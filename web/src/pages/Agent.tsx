import * as React from "react"
import { PaperPlaneRight, StopCircle, Sparkle } from "@phosphor-icons/react"
import {
  ChatProvider,
  useChatActions,
  useChatRuntime,
  useChatSelector,
} from "../agent/react-hooks.ts"
import { createChatRuntime } from "../agent/runtime/create-chat-runtime.ts"
import type { MessagePart, ToolInvocationMessagePart } from "../agent/protocol/parts.ts"
import type { ChatMessage } from "../agent/protocol/messages.ts"
import { Badge, Button, Input, Select } from "../components/ui.tsx"
import { api, getCluster, setCluster } from "../api.ts"
import { ErrorNote, PageHeader, useCluster } from "../shell.tsx"
import { useAppConfig } from "../config.ts"
import { confirmDialog } from "../components/dialogs.tsx"
import { toast } from "../toast.tsx"
import { Card, CardContent } from "../components/ui.tsx"
import { Empty } from "../kumo"
import { JsonBlock } from "../components/pieces.tsx"

/**
 * Agent page — chat with a model that has live cluster tools mounted
 * (docs/ROADMAP.md §5), running on the vendored @emi/core chat runtime
 * (temporary threads only — nothing persisted, per decision).
 *
 * BYOK: provider/key/model live in localStorage and are injected into each
 * request body by the transport fetch shim; the server never persists them.
 */

interface AgentConfig {
  provider: "openai" | "anthropic"
  apiKey: string
  model: string
  cluster: string
}

const CONFIG_KEY = "cluster_ui_agent"

const DEFAULTS: AgentConfig = {
  provider: "openai",
  apiKey: "",
  model: "",
  cluster: ""
}

function loadConfig(): AgentConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return DEFAULTS
}

const MODEL_PLACEHOLDERS = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-haiku-4-5"
}

const kvStorage = (key: string) => ({
  get: (_k: string) => localStorage.getItem(key),
  set: (_k: string, value: string) => localStorage.setItem(key, value),
  remove: (_k: string) => localStorage.removeItem(key)
})

/** transport fetch shim: retarget every runtime request at our agent stream */
function makeAgentFetch(config: AgentConfig): typeof globalThis.fetch {
  return async (_input, init) => {
    const parsed = init?.body ? JSON.parse(String(init.body)) : {}
    // an unset agent picker follows the global TopBar cluster (UX review P1-2)
    const cluster = config.cluster || getCluster() || ""
    const merged = {
      ...parsed,
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model || MODEL_PLACEHOLDERS[config.provider],
      ...(cluster ? { cluster } : {})
    }
    return fetch("/api/agent/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(merged)
    })
  }
}

/** persistence stays out of scope for now (temporary threads only) */
const noopPersistence = {
  listConversations: async () => [],
  loadConversation: async () => {
    throw new Error("persistence disabled")
  },
  reviseConversationMessage: async () => {},
  updateConversation: async () => {
    throw new Error("persistence disabled")
  },
  deleteConversation: async () => {},
  cloneConversation: async () => {
    throw new Error("persistence disabled")
  },
  compactConversation: async () => {
    throw new Error("persistence disabled")
  }
} as never

export function AgentPage() {
  const [config, setConfig] = React.useState<AgentConfig>(loadConfig)
  // an unset agent picker follows the global TopBar cluster (UX review P1-2)
  const globalCluster = useCluster()
  const saveConfig = (patch: Partial<AgentConfig>) => {
    setConfig((c) => {
      const next = { ...c, ...patch }
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  // rebuild when BYOK config changes so the transport shim reads fresh values
  const runtime = React.useMemo(
    () =>
      createChatRuntime({
        transport: {
          baseUrl: "/api/agent",
          fetch: makeAgentFetch(config),
          streamInactivityTimeoutMilliseconds: 5 * 60 * 1000
        },
        persistence: noopPersistence,
        storage: {
          settings: kvStorage("cluster_ui_agent_settings"),
          drafts: kvStorage("cluster_ui_agent_draft")
        },
        browser: {
          online: typeof navigator === "undefined" ? true : navigator.onLine,
          subscribeOnline: (listener) => {
            const handler = () => listener(navigator.onLine)
            window.addEventListener("online", handler)
            window.addEventListener("offline", handler)
            return () => {
              window.removeEventListener("online", handler)
              window.removeEventListener("offline", handler)
            }
          }
        },
        identity: {
          createId: () => crypto.randomUUID(),
          now: () => new Date().toISOString()
        },
        model: { model: config.model || MODEL_PLACEHOLDERS[config.provider] }
      }),
    // NOTE: globalCluster deliberately NOT a dep — the fetch shim reads
    // getCluster() per request, so an ambient cluster switch must not rebuild
    // the runtime (that would wipe the conversation). (UX audit #2 A5)
    [config.provider, config.apiKey, config.model, config.cluster]
  )

  return (
    <ChatProvider runtime={runtime}>
      <AgentPageBody config={config} saveConfig={saveConfig} />
    </ChatProvider>
  )
}

function ClusterPicker({ cluster, onPick }: { cluster: string; onPick: (c: string) => void }) {
  const [clusters, setClusters] = React.useState<string[]>([])
  React.useEffect(() => {
    api
      .config()
      .then((cfg) => setClusters((cfg as { clusters?: string[] }).clusters ?? []))
      .catch(() => {})
  }, [])
  if (clusters.length <= 1) return null
  return (
    <Select aria-label="cluster" value={cluster} onChange={(e) => onPick(e.target.value)}>
      <option value="">follow topbar cluster</option>
      {clusters.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  )
}

function AgentPageBody({
  config,
  saveConfig
}: {
  config: AgentConfig
  saveConfig: (patch: Partial<AgentConfig>) => void
}) {
  const actions = useChatActions()
  const globalCluster = useCluster()
  const messages = useChatSelector((s) => s.activeThread.messages)
  const draft = useChatSelector((s) => s.composer.text)
  const isStreaming = useChatSelector((s) => s.activeThread.isStreaming)
  // transport/provider failures (bad key, network, stream errors) surface here
  const chatError = useChatSelector((s) => s.error)
  const appConfig = useAppConfig()
  const canWrite = appConfig !== null && appConfig.readonly !== true && appConfig.role !== "viewer"

  const send = () => {
    if (!config.apiKey.trim()) return
    actions.sendMessage({ text: draft })
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
            aria-label="API key"
            placeholder="API key (stored locally)"
            value={config.apiKey}
            onChange={(e) => saveConfig({ apiKey: e.target.value })}
          />
          <Input
            aria-label="model name"
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
              config.cluster || globalCluster || "the default cluster"
            }; write actions respect read-only mode.`}
          />
        )}
        {messages.map((m: ChatMessage) => (
          <MessageBubble
            key={m.id}
            message={m}
            canWrite={canWrite}
            cluster={config.cluster || globalCluster || undefined}
          />
        ))}
        {isStreaming && (
          <div className="text-[12px] text-kumo-subtle" data-testid="agent-streaming">
            thinking…
          </div>
        )}
      </div>

      <ErrorNote error={chatError ?? null} />

      {/* composer */}
      <div className="mt-3 flex shrink-0 items-end gap-2">
        <textarea
          rows={2}
          aria-label="agent message"
          className="w-full resize-y rounded-md border border-kumo-line bg-kumo-base px-3 py-2 text-[13px] outline-none focus:border-kumo-brand"
          placeholder={config.apiKey ? "ask anything about the cluster…" : "set an API key above first"}
          value={draft}
          onChange={(e) => actions.setDraft({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        {isStreaming ? (
          <Button variant="secondary" onClick={() => actions.stop()} aria-label="stop generation">
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

type AgentUIMessage = ChatMessage

function MessageBubble({ message, canWrite, cluster }: { message: AgentUIMessage; canWrite: boolean; cluster?: string }) {
  const isUser = message.role === "user"
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-full rounded-lg px-3 py-2 text-[13px] leading-5 ${
          isUser ? "bg-kumo-brand/15 text-kumo-default" : "border border-kumo-line bg-kumo-base"
        }`}
      >
        {message.parts.map((part: MessagePart, i: number) => (
          <MessagePartView key={i} part={part} canWrite={canWrite} cluster={cluster} />
        ))}
      </div>
    </div>
  )
}

function MessagePartView({ part, canWrite, cluster }: { part: MessagePart; canWrite: boolean; cluster?: string }) {
  if (part.type === "text") {
    return <p className="whitespace-pre-wrap">{part.text}</p>
  }
  if (part.type === "tool-invocation") {
    return <ToolCard part={part} canWrite={canWrite} cluster={cluster} />
  }
  return null
}

function ToolCard({ part, canWrite, cluster }: { part: ToolInvocationMessagePart; canWrite: boolean; cluster?: string }) {
  const [open, setOpen] = React.useState(false)
  const isError = part.state === "output-error"
  const tone = isError ? "err" : part.state === "output-available" ? "ok" : "info"
  const stateLabel =
    part.state === "input-available" ? "running" : part.state === "output-error" ? "failed" : "done"
  return (
    <div className="my-1.5 rounded-md border border-kumo-line bg-kumo-canvas/60 p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 text-left font-mono text-[12px]"
      >
        <Badge tone={tone as "ok" | "err" | "info"}>{stateLabel}</Badge>
        <span>{part.toolName}()</span>
        <span className="ml-auto text-[10px] text-kumo-subtle">{open ? "hide" : "details"}</span>
      </button>
      {isError && part.errorText && <div className="mt-1 text-[12px] text-kumo-danger">{part.errorText}</div>}
      {!isError && part.state === "output-available" && <ToolWidget toolName={part.toolName} output={part.output} canWrite={canWrite} cluster={cluster} />}
      {open && (
        <div className="mt-2 space-y-2">
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle">input</div>
            <JsonBlock value={part.input ?? null} max={200} />
          </div>
          <div>
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-kumo-subtle">output</div>
            <JsonBlock value={part.output ?? part.errorText ?? null} max={400} />
          </div>
        </div>
      )}
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Safe typed summaries for common read tools; model output is never treated as markup or code. */
function ToolWidget({ toolName, output, canWrite, cluster }: { toolName: string; output: unknown; canWrite: boolean; cluster?: string }) {
  if (toolName === "overview" && isRecord(output)) {
    const messages = isRecord(output.messages) ? output.messages : null
    if (!messages) return <UnexpectedWidget />
    const entries = Object.entries(messages)
    return (
      <div className="mt-2 rounded border border-kumo-brand/30 bg-kumo-tint/40 p-2 text-[12px]" data-testid="agent-widget-overview">
        <div className="flex items-center justify-between gap-2 font-medium">
          <span>Cluster overview</span>
          <a
            className="text-kumo-link hover:underline"
            href="#/overview"
            onClick={() => cluster && setCluster(cluster)}
          >
            open overview
          </a>
        </div>
        {entries.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-kumo-subtle">
            {entries.map(([key, value]) => <span key={key}>{key}: {typeof value === "number" ? value : "—"}</span>)}
          </div>
        )}
      </div>
    )
  }
  if ((toolName === "query_messages" || toolName === "list_traces") && isRecord(output)) {
    if (!Array.isArray(output.rows)) return <UnexpectedWidget />
    const rows = output.rows
    const total = typeof output.total === "number" ? output.total : rows.length
    const route = toolName === "query_messages" ? "#/messages" : "#/traces"
    const failedId: string | undefined = toolName === "query_messages" ? (rows.find((row): row is Record<string, unknown> => isRecord(row) && row.failed === true && typeof row.id === "string")?.id as string | undefined) : undefined
    const retry = async () => {
      if (!canWrite || !failedId) return
      if (!(await confirmDialog({ title: "Retry this failed message?", description: "The message will be re-delivered to its entity.", destructive: true, confirmLabel: "Retry" }))) return
      try {
        await api.retryMessage(failedId, cluster)
        toast.success("Message retry queued")
      } catch (error) {
        toast.error(`Retry failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return (
      <div className="mt-2 rounded border border-kumo-line bg-kumo-recessed p-2 text-[12px]" data-testid={`agent-widget-${toolName}`}>
        <div className="flex items-center justify-between gap-2 font-medium">
          <span>{toolName === "query_messages" ? "Messages" : "Traces"} · {total} total</span>
          <a
            className="text-kumo-link hover:underline"
            href={route}
            onClick={() => cluster && setCluster(cluster)}
          >
            open page
          </a>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-kumo-subtle">
          <span>showing {Math.min(rows.length, 5)} result{rows.length === 1 ? "" : "s"}</span>
          {failedId && canWrite && <Button variant="secondary" size="sm" onClick={() => void retry()}>retry failed</Button>}
        </div>
      </div>
    )
  }
  if (toolName === "list_workflows" || toolName === "list_crons" || toolName === "list_singletons") {
    const rows = Array.isArray(output) ? output : isRecord(output) && Array.isArray(output.runners) ? output.runners : null
    if (rows) {
      const route = toolName === "list_workflows" ? "#/workflows" : toolName === "list_crons" ? "#/crons" : "#/singletons"
      return <div className="mt-2 rounded border border-kumo-line bg-kumo-recessed p-2 text-[12px]" data-testid="agent-widget-list"><div className="flex items-center justify-between gap-2 font-medium"><span>{rows.length} result{rows.length === 1 ? "" : "s"}</span><a className="text-kumo-link hover:underline" href={route} onClick={() => cluster && setCluster(cluster)}>open page</a></div></div>
    }
    return <UnexpectedWidget />
  }
  return null
}

function UnexpectedWidget() {
  return <div className="mt-2 rounded border border-kumo-warning/40 bg-kumo-warning/10 p-2 text-[12px] text-kumo-subtle">Tool returned an unexpected shape; open details to inspect the raw response.</div>
}
