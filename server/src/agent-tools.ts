import { z } from "zod"
import { ActionError, assertWritable, deleteMessage, interruptMessage, resetActivity, retryMessage } from "./actions.ts"
import { config } from "./config.ts"
import type { Repo } from "./queries.ts"
import { queryRunnerState } from "./singletons.ts"

/**
 * Shared agent tool registry (docs/ROADMAP.md §5).
 *
 * The same tools back both the machine endpoint (POST /mcp) and the chat
 * agent route (POST /api/agent/stream). Read tools reuse the repo layer;
 * write tools mirror the dashboard's own actions and respect read-only mode.
 */

export interface AgentTool {
  readonly name: string
  readonly description: string
  readonly parameters: z.ZodType
  /** false = mutates cluster storage; rejected in read-only mode */
  readonly readOnly: boolean
  execute(repo: Repo, args: unknown): Promise<unknown>
}

function zodToSchema(parameters: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(parameters as never, { target: "draft-7" }) as Record<string, unknown>
}

const IdSchema = z.string().min(1).describe("message id (text form)")

export const agentTools: ReadonlyArray<AgentTool> = [
  {
    name: "overview",
    description:
      "Cluster overview counters: pending/inflight/scheduled/done/failed messages, runners, shards, unassigned shards, busiest entity types.",
    parameters: z.object({}),
    readOnly: true,
    execute: async (repo) => repo.overview()
  },
  {
    name: "query_messages",
    description:
      "Search messages. Filters: status (pending|inflight|scheduled|done), q (matches id/entity/tag), entityType, entityId, page, pageSize (default 20).",
    parameters: z.object({
      status: z.string().optional(),
      q: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      failed: z.boolean().optional(),
      page: z.number().int().positive().optional(),
      pageSize: z.number().int().positive().max(200).optional()
    }),
    readOnly: true,
    execute: async (repo, args) => repo.listMessages(args as never)
  },
  {
    name: "get_message",
    description: "Full message detail by id: payload, headers, replies, failure result if any.",
    parameters: z.object({ id: IdSchema }),
    readOnly: true,
    execute: async (repo, args) => {
      const { id } = args as { id: string }
      const detail = repo.getMessage(id)
      if (!detail) throw new ActionError(`message ${id} not found`, 404)
      return detail
    }
  },
  {
    name: "list_workflows",
    description: "All workflows with run counts and failed-run counts.",
    parameters: z.object({}),
    readOnly: true,
    execute: async (repo) => repo.workflows()
  },
  {
    name: "get_workflow_run",
    description: "One workflow run by workflow name + execution id, incl. activity payloads and outcome.",
    parameters: z.object({ name: z.string(), executionId: z.string() }),
    readOnly: true,
    execute: async (repo, args) => {
      const { name, executionId } = args as { name: string; executionId: string }
      const run = repo.workflowRun(name, executionId)
      if (!run) throw new ActionError("workflow run not found", 404)
      return run
    }
  },
  {
    name: "list_crons",
    description: "Scheduled ClusterCron jobs with next delivery times.",
    parameters: z.object({}),
    readOnly: true,
    execute: async (repo) => repo.crons()
  },
  {
    name: "list_traces",
    description: "Recent trace ids with span counts and kinds (newest first).",
    parameters: z.object({ limit: z.number().int().positive().max(200).optional() }),
    readOnly: true,
    execute: async (repo, args) => repo.traces({ limit: (args as { limit?: number }).limit ?? 25 })
  },
  {
    name: "list_singletons",
    description:
      "Per-runner singleton entities and in-memory entity counts via the optional reporter; unreachable reporters appear as error entries.",
    parameters: z.object({}),
    readOnly: true,
    execute: async (repo) => queryRunnerState(repo)
  },
  {
    name: "retry_message",
    description: "Redeliver a message: clears processed state and drops its exit reply so the entity re-executes.",
    parameters: z.object({ id: IdSchema }),
    readOnly: false,
    execute: async (repo, args) => runWrite(repo, "retry", (args as { id: string }).id)
  },
  {
    name: "interrupt_message",
    description: "Cancel work on an entity by writing an Interrupt envelope message.",
    parameters: z.object({ id: IdSchema }),
    readOnly: false,
    execute: async (repo, args) => runWrite(repo, "interrupt", (args as { id: string }).id)
  },
  {
    name: "reset_activity",
    description: "Reset an activity attempt so it re-runs.",
    parameters: z.object({ id: IdSchema }),
    readOnly: false,
    execute: async (repo, args) => runWrite(repo, "reset-activity", (args as { id: string }).id)
  },
  {
    name: "delete_message",
    description: "Permanently delete a message and its replies from storage.",
    parameters: z.object({ id: IdSchema }),
    readOnly: false,
    execute: async (repo, args) => runWrite(repo, "delete", (args as { id: string }).id)
  }
]

type WriteAction = "retry" | "interrupt" | "reset-activity" | "delete"

/** redis-backed repos expose their own action implementations; sqlite uses actions.ts */
async function runWrite(repo: Repo, action: WriteAction, messageId: string): Promise<{ ok: true }> {
  const redisActions = (
    repo as unknown as {
      actions?: Partial<Record<WriteAction, (id: string) => Promise<{ ok: true }>>>
    }
  ).actions
  assertWritable(config.readonly)
  if (redisActions && (action === "retry" || action === "delete")) {
    const fn = redisActions[action]
    if (!fn) throw new ActionError(`${action} not supported for this cluster`, 400)
    try {
      return await fn(messageId)
    } catch (e) {
      throw e instanceof ActionError ? e : new ActionError(String(e))
    }
  }
  switch (action) {
    case "retry":
      return retryMessage(repo.db, repo.prefix, messageId)
    case "interrupt":
      return interruptMessage(repo.db, repo.prefix, messageId)
    case "reset-activity":
      return resetActivity(repo.db, repo.prefix, messageId)
    case "delete":
      return deleteMessage(repo.db, repo.prefix, messageId)
  }
}

export function findAgentTool(name: string): AgentTool | undefined {
  return agentTools.find((t) => t.name === name)
}

/** JSON-schema view for MCP tools/list */
export function agentToolsJsonSchema(): Array<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
}> {
  return agentTools.map((t) => ({
    name: t.name,
    description: t.description + (t.readOnly ? "" : " (write operation)"),
    inputSchema: zodToSchema(t.parameters)
  }))
}

export async function callAgentTool(
  repo: Repo,
  name: string,
  args: unknown
): Promise<{ ok: true; result: unknown } | { ok: false; error: string; status?: number }> {
  const tool = findAgentTool(name)
  if (!tool) return { ok: false, error: `unknown tool: ${name}` }
  try {
    const parsed = tool.parameters.safeParse(args ?? {})
    if (!parsed.success) {
      return { ok: false, error: `invalid arguments: ${parsed.error.message}` }
    }
    const result = await tool.execute(repo, parsed.data)
    return { ok: true, result }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      status: e instanceof ActionError ? e.status : undefined
    }
  }
}
