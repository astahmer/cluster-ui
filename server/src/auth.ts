import { HttpMiddleware, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"
import { config } from "./config.ts"

export const AUTH_COOKIE = "cluster_ui_token"

function isExempt(url: string): boolean {
  const path = url.split("?")[0]
  // /healthz, static assets, SPA fallback — everything outside /api/*
  if (!path.startsWith("/api/")) return true
  if (path === "/api/auth") return true
  return false
}

/**
 * Token auth middleware (active only when CLUSTER_UI_TOKEN is set).
 * Accepts the `cluster_ui_token` HttpOnly cookie or an
 * `Authorization: Bearer <token>` header.
 */
export const authorization: HttpMiddleware.HttpMiddleware = (httpApp) =>
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
      return HttpServerResponse.unsafeJson({ error: "unauthorized" }, {
        status: 401,
        headers: { "cache-control": "no-store", "www-authenticate": "Bearer" }
      })
    }
    return yield* httpApp
  })

/** POST /api/auth handler body → response. Returns null when auth is disabled. */
export function verifyToken(token: unknown): { ok: true } | { ok: false; status: number; error: string } {
  if (!config.authToken) return { ok: false, status: 400, error: "auth is not configured" }
  if (typeof token !== "string" || token === "") {
    return { ok: false, status: 401, error: "token required" }
  }
  if (token !== config.authToken) return { ok: false, status: 401, error: "invalid token" }
  return { ok: true }
}
