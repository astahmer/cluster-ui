import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { existsSync, readFileSync } from "node:fs"
import { join, normalize, resolve } from "node:path"
import { makeRepo, openDb, type MessageQuery } from "./queries.ts"

const repo = makeRepo(openDb())

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

export const api = HttpRouter.empty.pipe(
  HttpRouter.get("/healthz", HttpServerResponse.text("ok")),

  HttpRouter.get(
    "/api/overview",
    Effect.map(req, () => json(repo.overview()))
  ),

  HttpRouter.get(
    "/api/runners",
    Effect.map(req, () => json(repo.runners()))
  ),

  HttpRouter.get(
    "/api/shards",
    Effect.map(req, () => json(repo.shards()))
  ),

  HttpRouter.get(
    "/api/entities",
    Effect.map(req, () => json(repo.entities()))
  ),

  HttpRouter.get(
    "/api/messages",
    Effect.map(req, (p): HttpServerResponse.HttpServerResponse => {
      const query: MessageQuery = {
        status: p.status,
        entityType: p.entityType,
        q: p.q,
        page: intParam(p.page),
        pageSize: intParam(p.pageSize)
      }
      return json(repo.listMessages(query))
    })
  ),

  HttpRouter.get(
    "/api/messages/:id",
    Effect.map(req, (p) => {
      const result = repo.getMessage(p.id!)
      return result ? json(result) : notFound("message")
    })
  ),

  HttpRouter.get(
    "/api/workflows",
    Effect.map(req, () => json(repo.workflows()))
  ),

  HttpRouter.get(
    "/api/workflows/:name",
    Effect.map(req, (p) => json(repo.workflowRuns(decodeURIComponent(p.name!))))
  ),

  HttpRouter.get(
    "/api/workflows/:name/:executionId",
    Effect.map(req, (p) => {
      const result = repo.workflowRun(decodeURIComponent(p.name!), decodeURIComponent(p.executionId!))
      return result ? json(result) : notFound("workflow run")
    })
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
