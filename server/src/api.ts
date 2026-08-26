import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Schedule, Stream } from "effect"
import { convertToModelMessages, stepCountIs, streamText, toUIMessageStream, type LanguageModel, type ToolSet, type UIMessage } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { existsSync, readFileSync } from "node:fs"
import { join, normalize, resolve } from "node:path"
import { ActionError, assertWritable, deleteMessage, interruptMessage, resetActivity, retryMessage } from "./actions.ts"
import { AUTH_COOKIE, verifyToken } from "./auth.ts"
import * as metrics from "./metrics.ts"
import { agentTools, callAgentTool } from "./agent-tools.ts"
import { handleMcpRequest } from "./mcp.ts"
import { config } from "./config.ts"
import { makeRedisRepo } from "./redis-repo.ts"
import { queryRunnerFibers, queryRunnerLogs } from "./singletons.ts"
import { makeRepo, openDb, type MessageQuery, type Repo } from "./queries.ts"
import { queryRunnerState } from "./singletons.ts"
import { actor, alertCluster, createAlert, deleteAlert, listAlerts, listAudit, recordAudit, role, testAlert, updateAlert } from "./ops.ts"

// ------------------------------------------------------------- cluster registry
const repos = new Map<string, Repo>(
  config.clusters.map((c) => [
    c.name,
    c.kind === "redis" ? makeRedisRepo(c.url) : makeRepo(openDb(c), c.prefix)
  ])
)
const defaultRepo = repos.get(config.clusters[0].name)!

/** repo list for the metrics sampler */
export const clusterRepos = (): ReadonlyArray<[string, Repo]> => [...repos.entries()]

/** resolve ?cluster= against the registry; null when unknown */
function repoFor(name: string | undefined): Repo | null {
  if (!name) return defaultRepo
  return repos.get(name) ?? null
}

// ---------------------------------------------------------------- static UI --
// If the built frontend (vite build) exists, serve it from this same process.
const DIST = resolve("dist")
const HAS_DIST = existsSync(join(DIST, "index.html"))

function tryStatic(path: string): HttpServerResponse.HttpServerResponse | null {
  if (!HAS_DIST) return null
  const rel = path === "/" ? "/index.html" : path
  const file = normalize(join(DIST, rel))
  if (!file.startsWith(DIST)) return null
  let content: Buffer | undefined
  let fallback = false
  try {
    if (existsSync(file) && !file.endsWith("/")) content = readFileSync(file)
    else {
      content = readFileSync(join(DIST, "index.html")) // SPA fallback
      fallback = true
    }
  } catch {
    return null
  }
  if (fallback) return HttpServerResponse.raw(content, { contentType: "text/html; charset=utf-8", headers: { "cache-control": "no-store" } })
  const ext = file.split(".").pop() ?? ""
  const types: Record<string, string> = {
    html: "text/html; charset=utf-8",
    js: "text/javascript",
    css: "text/css",
    svg: "image/svg+xml",
    png: "image/png",
    woff2: "font/woff2"
  }
  return HttpServerResponse.raw(content, {
    contentType: types[ext] ?? "application/octet-stream",
    headers: { "cache-control": ext === "html" ? "no-store" : "public, max-age=86400" }
  })
}

function json(data: unknown) {
  return HttpServerResponse.unsafeJson(data, {
    headers: { "cache-control": "no-store" }
  })
}

function notFound(what: string) {
  return HttpServerResponse.unsafeJson({ error: `${what} not found` }, { status: 404 })
}

function intParam(u: string | null | undefined): number | undefined {
  if (u === undefined || u === null || u === "") return undefined
  const n = Number(u)
  return Number.isFinite(n) ? Math.trunc(n) : undefined
}

/** request with merged path params + query params */
/** json() that also accepts promises (redis repo methods are all async) */
const jsonMaybeAsync = (value: unknown) =>
  Effect.map(Effect.tryPromise(() => Promise.resolve(value)), json as (v: unknown) => HttpServerResponse.HttpServerResponse)

const req = Effect.all([HttpServerRequest.HttpServerRequest, HttpRouter.params]).pipe(
  Effect.map(([request, params]) => {
    const url = new URL(request.url, "http://localhost")
    const query: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
    })
    return { ...query, ...params }
  })
)

/** request + merged params + parsed JSON body */
/**
 * Vendored @emi/core protocol ChatMessage → ai-sdk UIMessage.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toUIMessages(messages: ReadonlyArray<unknown>): UIMessage[] {
  return messages
    .filter(isRecord)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
      role: m.role as "user" | "assistant",
      parts: (Array.isArray(m.parts) ? m.parts : []).flatMap((rawPart): UIMessage["parts"] => {
        if (!isRecord(rawPart)) return []
        const part = rawPart
        switch (part.type) {
          case "text":
            return [{ type: "text", text: String(part.text ?? "") }]
          case "reasoning":
            return [{ type: "reasoning", text: String(part.text ?? "") }]
          case "tool-invocation": {
            const toolName = String(part.toolName ?? "unknown")
            const state =
              part.state === "output-error" ? "output-error" : part.state === "output-available" ? "output-available" : "input-available"
            return [
              {
                type: `tool-${toolName}`,
                toolCallId: String(part.toolCallId ?? crypto.randomUUID()),
                state,
                input: (part.input ?? {}) as never,
                ...(part.output !== undefined ? { output: part.output as never } : {}),
                ...(typeof part.errorText === "string" ? { errorText: part.errorText } : {})
              } as never
            ]
          }
          default:
            return []
        }
      })
    }))
}

const reqWithBody: Effect.Effect<
  Record<string, any>,
  never,
  HttpServerRequest.HttpServerRequest | HttpRouter.RouteContext
> = Effect.all([HttpServerRequest.HttpServerRequest, HttpRouter.params]).pipe(
  Effect.flatMap(([request, params]) =>
    Effect.map(request.json as Effect.Effect<unknown, never, never>, (body: any) => {
      const url = new URL(request.url, "http://localhost")
      const query: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        query[key] = value
      })
      return { ...query, ...params, body }
    })
  )
)

type RedisActionMap = Partial<
  Record<"retry" | "interrupt" | "reset-activity" | "delete", (id: string) => Promise<{ ok: true }>>
>

/** redis repos carry their own action impls; sqlite goes through actions.ts */
async function dispatchAction(
  repo: Repo,
  redisName: "retry" | "interrupt" | "reset-activity" | "delete",
  sqliteRun: (repo: Repo, id: string) => { ok: true },
  messageId: string
): Promise<{ ok: true }> {
  if (repo.db === null) {
    const redisActions = (repo as unknown as { actions?: RedisActionMap }).actions
    const fn = redisActions?.[redisName]
    if (!fn) throw new ActionError(`${redisName} not supported for this cluster type`, 400)
    try {
      return await fn(messageId)
    } catch (e) {
      throw e instanceof ActionError ? e : new ActionError(String(e))
    }
  }
  return sqliteRun(repo, messageId)
}

function actionHandler(
  run: (repo: Repo, messageId: string) => { ok: true },
  redisName?: "retry" | "interrupt" | "reset-activity" | "delete"
) {
  return Effect.flatMap(reqWithBody, (p) =>
    Effect.tryPromise(async (): Promise<HttpServerResponse.HttpServerResponse> => {
      try {
        assertWritable(config.readonly)
        if (role === "viewer") throw new ActionError("operator role required", 403)
        const repo = repoFor(p.cluster ?? p.body?.cluster)
        if (!repo) return notFound("cluster")
        const messageId = p.body?.messageId
        if (typeof messageId !== "string" || messageId === "") {
          return HttpServerResponse.unsafeJson({ error: "messageId is required" }, { status: 400 })
        }
        await dispatchAction(repo, redisName ?? "retry", run, messageId)
        recordAudit({ actor, role, action: redisName ?? "retry", cluster: p.cluster ?? p.body?.cluster ?? config.clusters[0].name, target: messageId })
        return json({ ok: true })
      } catch (e) {
        if (e instanceof ActionError) {
          return HttpServerResponse.unsafeJson({ error: e.message }, { status: e.status })
        }
        return HttpServerResponse.unsafeJson(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 500 }
        )
      }
    })
  )
}

const BULK_ACTIONS = {
  retry: (repo: Repo, id: string) => retryMessage(repo.db, repo.prefix, id),
  interrupt: (repo: Repo, id: string) => interruptMessage(repo.db, repo.prefix, id),
  delete: (repo: Repo, id: string) => deleteMessage(repo.db, repo.prefix, id)
} as const

/** Per-id results; individual failures never fail the whole batch. */
const bulkActionHandler = Effect.flatMap(reqWithBody, (p) =>
  Effect.tryPromise(async (): Promise<HttpServerResponse.HttpServerResponse> => {
    try {
      assertWritable(config.readonly)
      if (role === "viewer") throw new ActionError("operator role required", 403)
      const repo = repoFor(p.cluster ?? p.body?.cluster)
      if (!repo) return notFound("cluster")
      const action = p.body?.action as "retry" | "interrupt" | "delete" | undefined
      if (action !== "retry" && action !== "interrupt" && action !== "delete") {
        return HttpServerResponse.unsafeJson(
          { error: "action must be one of retry | interrupt | delete" },
          { status: 400 }
        )
      }
      const ids = p.body?.ids
      if (!Array.isArray(ids) || ids.length === 0) {
        return HttpServerResponse.unsafeJson({ error: "non-empty ids array is required" }, { status: 400 })
      }
      const results: Array<{ id: string; ok: boolean; error?: string; status?: number }> = []
      for (const raw of ids.slice(0, 500)) {
        const id = typeof raw === "string" ? raw : String(raw ?? "")
        try {
          await dispatchAction(repo, action, BULK_ACTIONS[action], id)
          results.push({ id, ok: true })
        } catch (e) {
          results.push({
            id,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            status: e instanceof ActionError ? e.status : 500
          })
        }
      }
      if (results.some((result) => result.ok)) {
        recordAudit({
          actor,
          role,
          action: `bulk:${action}`,
          cluster: p.cluster ?? p.body?.cluster ?? config.clusters[0].name,
          target: results.filter((result) => result.ok).map((result) => result.id).slice(0, 10).join(",") + (results.filter((result) => result.ok).length > 10 ? "…" : "")
        })
      }
      return json({ results })
    } catch (e) {
      if (e instanceof ActionError) {
        return HttpServerResponse.unsafeJson({ error: e.message }, { status: e.status })
      }
      return HttpServerResponse.unsafeJson(
        { error: e instanceof Error ? e.message : String(e) },
        { status: 500 }
      )
    }
  })
)

const opsRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/api/alerts", Effect.sync(() => json(listAlerts()))),
  HttpRouter.post("/api/alerts", Effect.flatMap(reqWithBody, (p) => Effect.sync(() => {
    try {
      assertWritable(config.readonly)
      if (role === "viewer") throw new ActionError("operator role required", 403)
      const rule = createAlert(p.body)
      recordAudit({ actor, role, action: "alert-create", cluster: rule.cluster, target: rule.id })
      return json(rule)
    } catch (e) {
      return HttpServerResponse.unsafeJson({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof ActionError ? e.status : 400 })
    }
  }))),
  HttpRouter.patch("/api/alerts/:id", Effect.flatMap(reqWithBody, (p) => Effect.sync(() => {
    try {
      assertWritable(config.readonly)
      if (role === "viewer") throw new ActionError("operator role required", 403)
      const rule = updateAlert(decodeURIComponent(p.id!), p.body)
      if (!rule) return notFound("alert")
      recordAudit({ actor, role, action: "alert-update", cluster: rule.cluster, target: rule.id })
      return json(rule)
    } catch (e) {
      return HttpServerResponse.unsafeJson({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof ActionError ? e.status : 400 })
    }
  }))),
  HttpRouter.del("/api/alerts/:id", Effect.flatMap(req, (p) => Effect.sync(() => {
    try {
      assertWritable(config.readonly)
      if (role === "viewer") throw new ActionError("operator role required", 403)
      const id = decodeURIComponent(p.id!)
      const ok = deleteAlert(id)
      if (ok) recordAudit({ actor, role, action: "alert-delete", cluster: alertCluster(id), target: id })
      return json({ ok })
    } catch (e) {
      return HttpServerResponse.unsafeJson({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof ActionError ? e.status : 400 })
    }
  }))),
  HttpRouter.post("/api/alerts/:id/test", Effect.flatMap(req, (p) => Effect.tryPromise(async () => {
    try {
      assertWritable(config.readonly)
      if (role === "viewer") throw new ActionError("operator role required", 403)
      const id = decodeURIComponent(p.id!)
      const result = await testAlert(id)
      recordAudit({ actor, role, action: "alert-test", cluster: alertCluster(id), target: id })
      return json(result)
    } catch (e) {
      return HttpServerResponse.unsafeJson({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof ActionError ? e.status : 400 })
    }
  }))),
  HttpRouter.get("/api/audit", Effect.flatMap(req, (p) => Effect.succeed(json(listAudit(intParam(p.limit))))))
)

const baseRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/healthz", HttpServerResponse.text("ok")),

  HttpRouter.get(
    "/api/config",
    Effect.succeed(
      json({
        clusters: [...repos.keys()],
        clusterKinds: config.clusters.map((c) => ({ name: c.name, kind: c.kind })),
        tracingUrlTemplate: config.tracingUrlTemplate,
        readonly: config.readonly,
        role
      })
    )
  ),

  HttpRouter.get(
    "/api/clusters",
    Effect.succeed(json([...repos.keys()].map((name) => ({ name }))))
  ),

  HttpRouter.get(
    "/api/overview",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return jsonMaybeAsync(repo.overview())
    })
  ),

  HttpRouter.get(
    "/api/runners",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return jsonMaybeAsync(repo.runners())
    })
  ),

  HttpRouter.get(
    "/api/shards",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return jsonMaybeAsync(repo.shards())
    })
  ),

  HttpRouter.get(
    "/api/entities",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return jsonMaybeAsync(repo.entities())
    })
  ),

  HttpRouter.get(
    "/api/entity-instances",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo || !p.entityType) return Effect.succeed(notFound(p.entityType ? "cluster" : "entityType"))
      return jsonMaybeAsync(
        repo.entityInstances(decodeURIComponent(p.entityType), {
          q: p.q,
          page: intParam(p.page),
          pageSize: intParam(p.pageSize)
        })
      )
    })
  ),

  HttpRouter.get(
    "/api/crons",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return jsonMaybeAsync(repo.crons())
    })
  ),

  HttpRouter.get(
    "/api/singletons",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return Effect.map(Effect.tryPromise(() => queryRunnerState(repo)), json)
    })
  ),

  HttpRouter.get(
    "/api/messages",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      const failedParam = p.failed
      const query: MessageQuery = {
        status: p.status,
        entityType: p.entityType,
        entityId: p.entityId,
        q: p.q,
        failed:
          failedParam === undefined ?
            undefined :
            failedParam === "true" ?
              true :
              failedParam === "false" ?
                false :
                undefined,
        createdAfter: intParam(p.createdAfter),
        createdBefore: intParam(p.createdBefore),
        sort: p.sort === "deliverAt" ? "deliverAt" : undefined,
        page: intParam(p.page),
        pageSize: intParam(p.pageSize)
      }
      if (repo.db === null) {
        return jsonMaybeAsync((repo as unknown as { listMessages(q: MessageQuery): Promise<unknown> }).listMessages(query))
      }
      return Effect.succeed(json(repo.listMessages(query)))
    })
  ),

  HttpRouter.get(
    "/api/messages/:id",
    Effect.flatMap(req, (p) =>
      Effect.tryPromise(async (): Promise<HttpServerResponse.HttpServerResponse> => {
        const repo = repoFor(p.cluster)
        if (!repo) return notFound("cluster")
        const result = await Promise.resolve(repo.getMessage(p.id!))
        return result ? json(result) : notFound("message")
      })
    )
  ),

  HttpRouter.get(
    "/api/workflows",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return jsonMaybeAsync(repo.workflows())
    })
  ),

  HttpRouter.get(
    "/api/workflows/:name",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return jsonMaybeAsync(repo.workflowRuns(decodeURIComponent(p.name!)))
    })
  ),

  HttpRouter.get(
    "/api/workflows/:name/:executionId",
    Effect.flatMap(req, (p) =>
      Effect.tryPromise(async (): Promise<HttpServerResponse.HttpServerResponse> => {
        const repo = repoFor(p.cluster)
        if (!repo) return notFound("cluster")
        const result = await Promise.resolve(
          repo.workflowRun(decodeURIComponent(p.name!), decodeURIComponent(p.executionId!))
        )
        return result ? json(result) : notFound("workflow run")
      })
    )
  ),

  // ------------------------------------------------------------------ actions
  HttpRouter.post("/api/actions/retry", actionHandler((repo, id) => retryMessage(repo.db, repo.prefix, id), "retry")),
  HttpRouter.post(
    "/api/actions/interrupt",
    actionHandler((repo, id) => interruptMessage(repo.db, repo.prefix, id), "interrupt")
  ),
  HttpRouter.post(
    "/api/actions/reset-activity",
    actionHandler((repo, id) => resetActivity(repo.db, repo.prefix, id), "reset-activity")
  ),
  HttpRouter.post(
    "/api/actions/delete",
    actionHandler((repo, id) => deleteMessage(repo.db, repo.prefix, id), "delete")
  ),
  HttpRouter.post("/api/actions/bulk", bulkActionHandler)
)

/** handler for redis-only operations; sqlite clusters get a clean 400 */
function redisOnlyHandler(
  run: (repo: import("./queries.ts").Repo & RedisRepoExtras, body: Record<string, any>) => Promise<unknown>
) {
  return Effect.flatMap(reqWithBody, (p) =>
    Effect.tryPromise(async (): Promise<HttpServerResponse.HttpServerResponse> => {
      try {
        assertWritable(config.readonly)
        if (role === "viewer") throw new ActionError("operator role required", 403)
        const repo = repoFor(p.cluster ?? p.body?.cluster)
        if (!repo) return notFound("cluster")
        if (repo.db === null) {
          const result = await run(repo as never, p.body ?? {})
          recordAudit({ actor, role, action: "redis-operation", cluster: p.cluster ?? p.body?.cluster ?? config.clusters[0].name, target: typeof p.body?.queue === "string" ? p.body.queue : typeof p.body?.id === "string" ? p.body.id : "redis" })
          return json(result)
        }
        return HttpServerResponse.unsafeJson(
          { error: "not supported for this cluster type" },
          { status: 400 }
        )
      } catch (e) {
        if (e instanceof ActionError) {
          return HttpServerResponse.unsafeJson({ error: e.message }, { status: e.status })
        }
        return HttpServerResponse.unsafeJson(
          { error: e instanceof Error ? e.message : String(e) },
          { status: 500 }
        )
      }
    })
  )
}

type RedisRepoExtras = import("./redis-repo.ts").RedisRepoExtras

function requireString(body: Record<string, any>, field: string): void {
  if (typeof body[field] !== "string" || body[field] === "") {
    throw new ActionError(`${field} is required`, 400)
  }
}

function numOrUndefined(v: unknown): number | undefined {
  const n = Number(v)
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : undefined
}

const redisRouter = HttpRouter.empty.pipe(
  // ------------------------------------------------------- redis queue controls
  HttpRouter.post(
    "/api/actions/pause-queue",
    redisOnlyHandler(async (repo, body) => {
      requireString(body, "queue")
      return repo.actions.pauseQueue(body.queue)
    })
  ),
  HttpRouter.post(
    "/api/actions/resume-queue",
    redisOnlyHandler(async (repo, body) => {
      requireString(body, "queue")
      return repo.actions.resumeQueue(body.queue)
    })
  ),
  HttpRouter.post(
    "/api/actions/promote",
    redisOnlyHandler(async (repo, body) => {
      requireString(body, "id")
      return repo.actions.promote(body.id)
    })
  ),
  HttpRouter.post(
    "/api/actions/clean",
    redisOnlyHandler(async (repo, body) => {
      const state = body.state === "failed" ? "failed" : body.state === "*" ? "*" : "completed"
      if (state === "*") {
        const limit = numOrUndefined(body.count)
        const options = { olderThanMs: numOrUndefined(body.olderThanMs), count: limit }
        const done = await repo.actions.clean(String(body.queue ?? "*"), "completed", options)
        const remaining = limit === undefined ? undefined : Math.max(0, limit - done.removed)
        const failed = remaining === 0 ? { removed: 0 } : await repo.actions.clean(String(body.queue ?? "*"), "failed", {
          olderThanMs: options.olderThanMs,
          count: remaining
        })
        return { removed: done.removed + failed.removed }
      }
      return repo.actions.clean(String(body.queue ?? "*"), state, {
        olderThanMs: numOrUndefined(body.olderThanMs),
        count: numOrUndefined(body.count)
      })
    })
  ),
  HttpRouter.post(
    "/api/actions/add-job",
    redisOnlyHandler(async (repo, body) => {
      requireString(body, "queue")
      if (typeof body.data === "undefined") throw new ActionError("data is required", 400)
      return repo.actions.addJob(body.queue, typeof body.name === "string" && body.name !== "" ? body.name : "manual", body.data)
    })
  ),
  HttpRouter.get(
    "/api/queues",
    Effect.flatMap(req, (params) =>
      Effect.flatMap(
        Effect.sync(() => repoFor(params.cluster)),
        (repo) => {
          if (!repo) return Effect.succeed(notFound("cluster"))
          if (repo.db !== null) return Effect.succeed(json([]))
          return Effect.tryPromise(async () => json(await (repo as never as RedisRepoExtras).queues()))
        }
      )
    )
  ),
  HttpRouter.get(
    "/api/queues/:name/jobs",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      if (repo.db !== null || !(repo as unknown as RedisRepoExtras).queueJobs) {
        return Effect.succeed(
          HttpServerResponse.unsafeJson({ error: "queue jobs are only supported for redis clusters" }, { status: 400 })
        )
      }
      const state = p.state
      if (state !== "wait" && state !== "active" && state !== "delayed" && state !== "completed" && state !== "failed") {
        return Effect.succeed(HttpServerResponse.unsafeJson({ error: "state must be wait | active | delayed | completed | failed" }, { status: 400 }))
      }
      const limit = intParam(p.limit)
      const offset = intParam(p.offset)
      return Effect.tryPromise(async () => json(await (repo as unknown as RedisRepoExtras).queueJobs(decodeURIComponent(p.name!), state, limit, offset)))
    })
  ),
  HttpRouter.get(
    "/api/queue-jobs/:id",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      if (repo.db !== null || !(repo as unknown as RedisRepoExtras).jobDetail) {
        return Effect.succeed(
          HttpServerResponse.unsafeJson({ error: "queue jobs are only supported for redis clusters" }, { status: 400 })
        )
      }
      return Effect.tryPromise(async () => {
        const job = await (repo as unknown as RedisRepoExtras).jobDetail(decodeURIComponent(p.id!))
        return job ? json(job) : notFound("job")
      })
    })
  ),
  HttpRouter.get(
    "/api/job-tree/:id",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      if (repo.db !== null || !(repo as unknown as RedisRepoExtras).jobTree) {
        return Effect.succeed(
          HttpServerResponse.unsafeJson({ error: "not supported for this cluster type" }, { status: 400 })
        )
      }
      return Effect.tryPromise(async () => {
        const tree = await (repo as unknown as RedisRepoExtras).jobTree(decodeURIComponent(p.id!))
        return tree ? json(tree) : notFound("job")
      })
    })
  )
)

const agentRouter = HttpRouter.empty.pipe(
  // ------------------------------------------------------------- agent (MCP + chat)
  HttpRouter.post(
    "/mcp",
    Effect.flatMap(reqWithBody, (p) =>
      Effect.tryPromise(() => handleMcpRequest(p.body, repoFor, config.clusters[0].name)).pipe(
        Effect.map((outcome) =>
          HttpServerResponse.unsafeJson(outcome.body, {
            status: outcome.status,
            contentType: "application/json"
          })
        )
      )
    )
  ),

  HttpRouter.post(
    "/api/agent/stream",
    Effect.flatMap(reqWithBody, (p) =>
      Effect.tryPromise(async () => {
        const body = p.body ?? {}
        const apiKey = typeof body.apiKey === "string" ? body.apiKey : ""
        const provider = body.provider === "anthropic" ? "anthropic" : "openai"
        const modelId = typeof body.model === "string" && body.model.trim() !== "" ? body.model.trim() : null
        if (!apiKey) {
          return HttpServerResponse.unsafeJson({ error: "missing apiKey in request body" }, { status: 401 })
        }
        if (!modelId) {
          return HttpServerResponse.unsafeJson({ error: "missing model in request body" }, { status: 400 })
        }
        const selectedCluster = typeof body.cluster === "string" && body.cluster !== "" ? body.cluster : config.clusters[0].name
        const repo = repoFor(selectedCluster)
        if (!repo) return notFound("cluster")

        let model: LanguageModel
        try {
          model =
            provider === "anthropic" ?
              createAnthropic({ apiKey })(modelId) :
              createOpenAI({ apiKey })(modelId)
        } catch (e) {
          return HttpServerResponse.unsafeJson(
            { error: `provider init failed: ${e instanceof Error ? e.message : String(e)}` },
            { status: 400 }
          )
        }

        const uiMessages = toUIMessages(Array.isArray(body.messages) ? body.messages : [])

        const tools: ToolSet = {}
        for (const t of agentTools) {
          tools[t.name] = {
            description: t.description,
            inputSchema: t.parameters,
            execute: (input: unknown) =>
              callAgentTool(repo, t.name, input, selectedCluster).then((r) => (r.ok ? r.result : { error: r.error }))
          }
        }

        const result = streamText({
          model,
          messages: await convertToModelMessages(uiMessages),
          tools,
          stopWhen: stepCountIs(5)
        })
        return HttpServerResponse.raw(toUIMessageStream(result), {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache"
          }
        })
      })
    )
  )
)

export const api = HttpRouter.concat(HttpRouter.concat(HttpRouter.concat(baseRouter, opsRouter), redisRouter), agentRouter).pipe(
  // Prometheus scrape endpoint — outside /api/* so the auth middleware's
  // static exemption covers it (same treatment as /healthz)
  HttpRouter.get(
    "/metrics",
    Effect.succeed(
      HttpServerResponse.text(metrics.prometheus(), {
        contentType: "text/plain; version=0.0.4; charset=utf-8"
      })
    )
  ),

  HttpRouter.get(
    "/api/traces",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return jsonMaybeAsync(
        repo.traces({
          limit: p.limit ? intParam(p.limit) ?? 50 : 50,
          offset: intParam(p.offset) ?? 0,
          q: typeof p.q === "string" && p.q !== "" ? p.q : undefined,
          createdAfter: intParam(p.createdAfter),
          createdBefore: intParam(p.createdBefore)
        })
      )
    })
  ),

  HttpRouter.get(
    "/api/traces/:traceId/events",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo || !p.traceId) return Effect.succeed(notFound(p.traceId ? "cluster" : "traceId"))
      const traceId = decodeURIComponent(p.traceId)
      const encoder = new TextEncoder()
      const frame = () => Effect.tryPromise(async () => {
        try {
          const rows = await Promise.resolve(repo.trace(traceId))
          return encoder.encode(`event: trace\ndata: ${JSON.stringify({ traceId, rows, sentAt: Date.now() })}\n\n`)
        } catch (error) {
          return encoder.encode(`event: trace-error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`)
        }
      })
      const stream = Stream.concat(
        Stream.fromEffect(frame()),
        Stream.fromSchedule(Schedule.spaced("2 seconds")).pipe(Stream.mapEffect(() => frame()))
      )
      return Effect.succeed(HttpServerResponse.stream(stream, {
        contentType: "text/event-stream",
        headers: { "cache-control": "no-store", "x-accel-buffering": "no" }
      }))
    })
  ),

  HttpRouter.get(
    "/api/traces/:traceId",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo || !p.traceId) return notFound(p.traceId ? "cluster" : "traceId")
      const rows = repo.trace(decodeURIComponent(p.traceId))
      return rows.length === 0 ? notFound("trace") : json({ traceId: decodeURIComponent(p.traceId), rows })
    })
  ),

  HttpRouter.get(
    "/api/logs",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      const since = p.since !== undefined ? Number(p.since) : undefined
      return Effect.map(
        Effect.tryPromise(() => queryRunnerLogs(repo, Number.isFinite(since) ? since : undefined)),
        json
      )
    })
  ),

  HttpRouter.get(
    "/api/fibers",
    Effect.flatMap(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return Effect.succeed(notFound("cluster"))
      return Effect.map(Effect.tryPromise(() => queryRunnerFibers(repo)), json)
    })
  ),

  // ------------------------------------------------------- metrics & realtime
  HttpRouter.get(
    "/api/metrics/history",
    Effect.map(req, (p) => {
      // known cluster without samples yet -> empty series (fresh boots), else 404
      if (p.cluster !== undefined && !repos.has(p.cluster)) return notFound("cluster")
      const h = metrics.history(p.cluster === undefined ? p.cluster : p.cluster) ?? []
      const rangeMs = Number(p.rangeMs)
      if (p.rangeMs !== undefined && Number.isFinite(rangeMs) && rangeMs > 0) {
        const cutoff = Date.now() - rangeMs
        return json(h.filter((s) => s.t >= cutoff))
      }
      return json(h)
    })
  ),

  HttpRouter.get(
    "/api/events",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster) ?? defaultRepo
      const encoder = new TextEncoder()
      const frame = () => Effect.tryPromise(async () => {
        try {
          const payload = await Promise.resolve(repo.overview())
          return encoder.encode(`event: overview\ndata: ${JSON.stringify(payload)}\n\n`)
        } catch (e) {
          return encoder.encode(`event: overview-error\ndata: ${JSON.stringify({ error: String(e) })}\n\n`)
        }
      })
      // initial snapshot immediately, then every 5s; the request scope
      // interrupts the stream when the client disconnects
      const stream = Stream.concat(
        Stream.fromEffect(frame()),
        Stream.fromSchedule(Schedule.spaced("5 seconds")).pipe(Stream.mapEffect(() => frame()))
      )
      return HttpServerResponse.stream(stream, {
        contentType: "text/event-stream",
        headers: { "cache-control": "no-store", "x-accel-buffering": "no" }
      })
    })
  ),

  HttpRouter.post(
    "/api/auth",
    Effect.map(HttpServerRequest.HttpServerRequest, (req) =>
      Effect.map(
        req.json,
        (body: any) => {
          const verdict = verifyToken(body?.token)
          if (!verdict.ok) {
            return HttpServerResponse.unsafeJson({ error: verdict.error }, {
              status: verdict.status,
              headers: { "cache-control": "no-store" }
            })
          }
          return HttpServerResponse.unsafeJson({ ok: true }, {
            headers: {
              "cache-control": "no-store",
              "set-cookie": `${AUTH_COOKIE}=${encodeURIComponent(verdict.ok ? body.token : "")}; Path=/; HttpOnly; SameSite=Lax`
            }
          })
        }
      )
    ).pipe(Effect.flatten)
  ),

  HttpRouter.get(
    "/assets/*",
    Effect.map(HttpServerRequest.HttpServerRequest, (req) => {
      if (!HAS_DIST) return HttpServerResponse.empty({ status: 404 })
      const res = tryStatic(req.url.split("?")[0])
      return res ?? HttpServerResponse.empty({ status: 404 })
    })
  ),

  HttpRouter.get(
    "*",
    Effect.map(HttpServerRequest.HttpServerRequest, (req) => {
      const res = tryStatic(req.url.split("?")[0])
      return res ??
        HttpServerResponse.text("cluster-ui API is running — build the frontend with `vite build`")
    })
  )
)
