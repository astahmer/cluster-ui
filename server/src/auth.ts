import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware"
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest"
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse"
import * as Effect from "effect/Effect"
import { config } from "./config.ts"

export const AUTH_COOKIE = "cluster_ui_token"

/** effect v4 dropped `HttpServerResponse.unsafeJson`; this is the same synchronous shape. */
function unsafeJson(data: unknown, options?: HttpServerResponse.Options): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.raw(JSON.stringify(data), { ...options, contentType: options?.contentType ?? "application/json" })
}

function isExempt(url: string): boolean {
  const path = url.split("?")[0]
  // /healthz, static assets, SPA fallback — everything outside /api/*
  // /mcp is an agent endpoint and must be protected when token auth is enabled.
  if (!path.startsWith("/api/") && path !== "/mcp") return true
  if (path === "/api/auth") return true
  return false
}

/**
 * Token auth middleware (active only when CLUSTER_UI_TOKEN is set).
 * Accepts the `cluster_ui_token` HttpOnly cookie or an
 * `Authorization: Bearer <token>` header.
 */
export const authorization = HttpMiddleware.make((httpApp) =>
  Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    if (!config.authToken || isExempt(request.url)) {
      return yield* httpApp
    }
    const authorized =
      request.cookies[AUTH_COOKIE] === config.authToken ||
      (request.headers.authorization?.startsWith("Bearer ") === true &&
        request.headers.authorization.slice(7) === config.authToken)
    if (!authorized) {
      return unsafeJson({ error: "unauthorized" }, {
        status: 401,
        headers: { "cache-control": "no-store", "www-authenticate": "Bearer" }
      })
    }
    return yield* httpApp
  }))

/** POST /api/auth handler body → response. Returns null when auth is disabled. */
export function verifyToken(token: unknown): { ok: true } | { ok: false; status: number; error: string } {
  if (!config.authToken) return { ok: false, status: 400, error: "auth is not configured" }
  if (typeof token !== "string" || token === "") {
    return { ok: false, status: 401, error: "token required" }
  }
  if (token !== config.authToken) return { ok: false, status: 401, error: "invalid token" }
  return { ok: true }
}
