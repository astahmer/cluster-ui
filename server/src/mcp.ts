import { ActionError } from "./actions.ts"
import { agentToolsJsonSchema, callAgentTool } from "./agent-tools.ts"
import type { Repo } from "./queries.ts"

/**
 * Minimal stateless MCP streamable-HTTP endpoint (docs/ROADMAP.md §5).
 *
 * One JSON-RPC request per POST, application/json response — valid per the
 * MCP streamable-http transport spec, no SDK dependency. Tools are the shared
 * registry in agent-tools.ts; optional "cluster" argument selects the cluster.
 */

const PROTOCOL_VERSION = "2025-06-18"

interface JsonRpcRequest {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown): { status: number; body: unknown } {
  return { status: 200, body: { jsonrpc: "2.0", id, result } }
}

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string
): { status: number; body: unknown } {
  return { status: 200, body: { jsonrpc: "2.0", id, error: { code, message } } }
}

export async function handleMcpRequest(
  raw: unknown,
  repoFor: (name: string | undefined) => Repo | null
): Promise<{ status: number; body: unknown }> {
  const req = raw as JsonRpcRequest

  // notifications (no id) get an empty 202
  if (req.id === undefined || req.id === null) {
    return { status: 202, body: null }
  }

  switch (req.method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion: (req.params?.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "cluster-ui", version: "1.0.0" }
      })

    case "tools/list":
      return rpcResult(req.id, { tools: agentToolsJsonSchema() })

    case "tools/call": {
      const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
      const name = params.name ?? ""
      const args = params.arguments ?? {}
      const cluster = typeof args.cluster === "string" ? args.cluster : undefined
      const repo = repoFor(cluster)
      if (!repo) return rpcResult(req.id, { content: [{ type: "text", text: `unknown cluster: ${cluster}` }], isError: true })
      const outcome = await callAgentTool(repo, name, args)
      if (!outcome.ok) {
        return rpcResult(req.id, {
          content: [{ type: "text", text: outcome.error }],
          isError: true
        })
      }
      return rpcResult(req.id, {
        content: [{ type: "text", text: JSON.stringify(outcome.result) }],
        isError: false
      })
    }

    default:
      return rpcError(req.id, -32601, `method not found: ${req.method ?? "(none)"}`)
  }
}

// re-export for the api layer's error mapping
export { ActionError }
