import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Schedule, Stream } from "effect"
import { convertToModelMessages, streamText, toUIMessageStream, type LanguageModel, type ToolSet, type UIMessage } from "ai"
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
import { makeRepo, openDb, type MessageQuery, type Repo } from "./queries.ts"
import { queryRunnerState } from "./singletons.ts"

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
  return Number.isFinite(n) ? n : undefined
}

/** request with merged path params + query params */
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
        const repo = repoFor(p.cluster ?? p.body?.cluster)
        if (!repo) return notFound("cluster")
        const messageId = p.body?.messageId
        if (typeof messageId !== "string" || messageId === "") {
          return HttpServerResponse.unsafeJson({ error: "messageId is required" }, { status: 400 })
        }
        await dispatchAction(repo, redisName ?? "retry", run, messageId)
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
const bulkActionHandler = Effect.map(reqWithBody, (p): HttpServerResponse.HttpServerResponse => {
  try {
    assertWritable(config.readonly)
    const repo = repoFor(p.cluster ?? p.body?.cluster)
    if (!repo) return notFound("cluster")
    const action = p.body?.action
    const run = typeof action === "string" ? BULK_ACTIONS[action as keyof typeof BULK_ACTIONS] : undefined
    if (!run) {
      return HttpServerResponse.unsafeJson(
        { error: "action must be one of retry | interrupt | delete" },
        { status: 400 }
      )
    }
    const ids = p.body?.ids
    if (!Array.isArray(ids) || ids.length === 0) {
      return HttpServerResponse.unsafeJson({ error: "non-empty ids array is required" }, { status: 400 })
    }
    const results = ids.slice(0, 500).map((raw: unknown) => {
      const id = typeof raw === "string" ? raw : String(raw ?? "")
      try {
        run(repo, id)
        return { id, ok: true }
      } catch (e) {
        return {
          id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          status: e instanceof ActionError ? e.status : 500
        }
      }
    })
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

const baseRouter = HttpRouter.empty.pipe(
  HttpRouter.get("/healthz", HttpServerResponse.text("ok")),

  HttpRouter.get(
    "/api/config",
    Effect.succeed(
      json({
        clusters: [...repos.keys()],
        tracingUrlTemplate: config.tracingUrlTemplate,
        readonly: config.readonly
      })
    )
  ),

  HttpRouter.get(
    "/api/clusters",
    Effect.succeed(json([...repos.keys()].map((name) => ({ name }))))
  ),

  HttpRouter.get(
    "/api/overview",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      return repo ? json(repo.overview()) : notFound("cluster")
    })
  ),

  HttpRouter.get(
    "/api/runners",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      return repo ? json(repo.runners()) : notFound("cluster")
    })
  ),

  HttpRouter.get(
    "/api/shards",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      return repo ? json(repo.shards()) : notFound("cluster")
    })
  ),

  HttpRouter.get(
    "/api/entities",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      return repo ? json(repo.entities()) : notFound("cluster")
    })
  ),

  HttpRouter.get(
    "/api/entity-instances",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo || !p.entityType) return notFound(p.entityType ? "cluster" : "entityType")
      return json(
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
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      return repo ? json(repo.crons()) : notFound("cluster")
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
    Effect.map(req, (p): HttpServerResponse.HttpServerResponse => {
      const repo = repoFor(p.cluster)
      if (!repo) return notFound("cluster")
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
      return json(repo.listMessages(query))
    })
  ),

  HttpRouter.get(
    "/api/messages/:id",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return notFound("cluster")
      const result = repo.getMessage(p.id!)
      return result ? json(result) : notFound("message")
    })
  ),

  HttpRouter.get(
    "/api/workflows",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      return repo ? json(repo.workflows()) : notFound("cluster")
    })
  ),

  HttpRouter.get(
    "/api/workflows/:name",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      return repo ? json(repo.workflowRuns(decodeURIComponent(p.name!))) : notFound("cluster")
    })
  ),

  HttpRouter.get(
    "/api/workflows/:name/:executionId",
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      if (!repo) return notFound("cluster")
      const result = repo.workflowRun(decodeURIComponent(p.name!), decodeURIComponent(p.executionId!))
      return result ? json(result) : notFound("workflow run")
    })
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

const agentRouter = HttpRouter.empty.pipe(
  // ------------------------------------------------------------- agent (MCP + chat)
  HttpRouter.post(
    "/mcp",
    Effect.flatMap(reqWithBody, (p) =>
      Effect.tryPromise(() => handleMcpRequest(p.body, repoFor)).pipe(
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
        const repo = repoFor(typeof body.cluster === "string" && body.cluster !== "" ? body.cluster : undefined)
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

        const uiMessages = Array.isArray(body.messages) ? (body.messages as UIMessage[]) : []

        const tools: ToolSet = {}
        for (const t of agentTools) {
          tools[t.name] = {
            description: t.description,
            inputSchema: t.parameters,
            execute: (input: unknown) =>
              callAgentTool(repo, t.name, input).then((r) => (r.ok ? r.result : { error: r.error }))
          }
        }

        const result = streamText({
          model,
          messages: await convertToModelMessages(uiMessages),
          tools
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

export const api = HttpRouter.concat(baseRouter, agentRouter).pipe(
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
    Effect.map(req, (p) => {
      const repo = repoFor(p.cluster)
      return repo ? json(repo.traces(p.limit ? intParam(p.limit) ?? 50 : 50)) : notFound("cluster")
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

  // ------------------------------------------------------- metrics & realtime
  HttpRouter.get(
    "/api/metrics/history",
    Effect.map(req, (p) => {
      const h = metrics.history(p.cluster)
      if (h === null) return notFound("cluster")
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
      const frame = () => {
        let payload: unknown
        try {
          payload = repo.overview()
        } catch (e) {
          payload = { error: String(e) }
        }
        return encoder.encode(`event: overview\ndata: ${JSON.stringify(payload)}\n\n`)
      }
      // initial snapshot immediately, then every 5s; the request scope
      // interrupts the stream when the client disconnects
      const stream = Stream.concat(
        Stream.make(frame()),
        Stream.fromSchedule(Schedule.spaced("5 seconds")).pipe(Stream.map(() => frame()))
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
