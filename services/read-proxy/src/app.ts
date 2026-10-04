// dashboard-ui Read_Proxy — thin hand-written HTTP router (NO web framework).
//
// This module is the serving-side request router. It is deliberately built on the
// Node 22 BUILT-IN `http` types plus `node:url` only — there is NO Express /
// Fastify / Koa / any web framework anywhere on this path (spec Req 3.1). It is
// bound to the fixed `ENDPOINTS` allowlist from allowlist.ts and wires together the
// four standalone policy modules:
//
//   rateLimit.ts  — per-IP + global admission (429 on rejection)
//   cache.ts      — short-TTL response cache keyed on path + full query string
//   allowlist.ts  — buildQueryForPath: path/param validation BEFORE any DB round-trip
//   security.ts   — the CSP + security headers set on every response
//
// and the single Supabase-touching transport (supabaseReadClient.ts).
//
// The handler is produced by a dependency-injecting factory, `createHandler(deps)`,
// so it can be exercised by unit / integration tests WITHOUT binding a port or
// reaching a real network: a stub SupabaseReadClient (or a stub `fetch` passed to a
// real one), an in-memory cache store, a rate limiter, and an injectable `now`
// clock are all supplied by the caller. main.ts constructs the production wiring.
//
// GET-ONLY (spec Req 3.4): only `GET` is routed. Every other method returns `405`
// with an `Allow: GET` header. SELECT-only is enforced structurally by the read
// client (it has no write verb); this router never issues anything but a GET read.
//
// _Requirements: 3.1 (serving via proxy), 3.4 (GET/SELECT-only), 5.5 (fixed
//  allowlist; reject else before DB), 5.6 (security headers on every response)_

import type * as http from "node:http";

import { buildQueryForPath, ENDPOINTS, type EndpointSpec } from "./allowlist.js";
import { ResponseCacheStore, type CacheRequest } from "./cache.js";
import { RateLimiterStore } from "./rateLimit.js";
import { securityHeaders } from "./security.js";
import { SupabaseReadError, type SupabaseReadClient } from "./supabaseReadClient.js";

/** A single unknown row as returned by the SELECT-only client. */
export type Row = Record<string, unknown>;

/**
 * The JSON body of a successful read: the bounded rows plus a `lastUpdated`
 * timestamp (ISO 8601) the SPA surfaces as "last updated". `lastUpdated` is the
 * instant the proxy served the response (from the injected clock), NOT a row
 * value — it reflects freshness of the served payload (design sequence diagram
 * `200 {rows, lastUpdated}`).
 */
export interface ReadResponseBody {
  readonly rows: readonly Row[];
  readonly lastUpdated: string;
}

/**
 * Injected dependencies for the request handler. Every collaborator is supplied
 * so the handler is testable without a port or a live network:
 *
 * - `readClient` — the SELECT-only Supabase transport (a stub, or a real client
 *   constructed with a stub `fetch`, is accepted).
 * - `cache`      — the response cache store (path + query keyed).
 * - `rateLimiter`— the per-IP + global admission store.
 * - `now`        — the clock (ms epoch) used for the `lastUpdated` timestamp;
 *   defaults to `Date.now`. The cache / limiter hold their own injected clocks.
 */
export interface HandlerDeps {
  readonly readClient: Pick<SupabaseReadClient, "select">;
  readonly cache: ResponseCacheStore<ReadResponseBody>;
  readonly rateLimiter: RateLimiterStore;
  readonly now?: () => number;
}

/** The request handler signature produced by {@link createHandler}. */
export type RequestHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void | Promise<void>;

/** Fast O(1) path lookup over the fixed allowlist. */
const ENDPOINTS_BY_PATH: ReadonlyMap<string, EndpointSpec> = new Map(
  ENDPOINTS.map((e) => [e.path, e] as const),
);

/**
 * Resolve the client IP for per-IP rate limiting. Behind Cloud Run the real
 * client IP is the first entry of `X-Forwarded-For`; `req.socket.remoteAddress`
 * is the fallback for a direct connection. A missing address degrades to a fixed
 * bucket so the limiter still applies rather than failing open.
 */
function clientIp(req: http.IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const header = Array.isArray(fwd) ? fwd[0] : fwd;
  if (typeof header === "string" && header.trim() !== "") {
    const first = header.split(",")[0];
    if (first !== undefined && first.trim() !== "") return first.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Split a request URL into its path and raw query string (no leading `?`). */
function splitUrl(rawUrl: string): { path: string; queryString: string } {
  // Parse against a dummy origin so a relative request-target parses cleanly; the
  // origin is discarded. `URL` is a Node built-in — no framework involved.
  const parsed = new URL(rawUrl, "http://proxy.local");
  return {
    path: parsed.pathname,
    queryString: parsed.search.startsWith("?")
      ? parsed.search.slice(1)
      : parsed.search,
  };
}

/**
 * Normalize the request path by stripping a single leading `/api` prefix so the
 * Firebase Hosting `/api/**` rewrite — which forwards the FULL matched path to
 * Cloud Run — lines up with the un-prefixed paths in the fixed `ENDPOINTS`
 * allowlist. A browser request to `/api/decision-dates` arrives here as
 * `/api/decision-dates`; the allowlist registers `/decision-dates`, so without
 * this normalization the exact-match router returns a 404.
 *
 * Only a `/api` segment is stripped — never `/api` as part of a longer segment:
 *
 *   /api/decision-dates ⇒ /decision-dates   (prefix segment)
 *   /api/               ⇒ /                  (trailing slash collapses to root)
 *   /api                ⇒ /                  (bare prefix maps to root)
 *   /apixyz             ⇒ /apixyz            (NOT a segment boundary — untouched)
 *   /decision-dates     ⇒ /decision-dates   (no prefix — untouched)
 *
 * The stripped path is used BOTH for allowlist resolution AND the cache key so a
 * hit/miss stays stable regardless of whether the caller used the `/api` prefix.
 */
function stripApiPrefix(path: string): string {
  if (!path.startsWith("/api")) return path;
  const rest = path.slice("/api".length);
  // Only strip when `/api` is a whole path segment: the next char must be a `/`
  // (e.g. `/api/decision-dates`) or the string must end there (`/api`). A longer
  // segment like `/apixyz` is left untouched.
  if (rest === "") return "/";
  if (rest.startsWith("/")) return rest === "/" ? "/" : rest;
  return path;
}

/** Parse the raw query string into the flat param map `buildQueryForPath` expects. */
function rawParamsFrom(queryString: string): Record<string, string> {
  const params = new URLSearchParams(queryString);
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    // First occurrence wins; allowlist validation rejects anything unexpected.
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = value;
  }
  return out;
}

/** Write a JSON response with a status, body, and header map (sets Content-Type). */
function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(payload);
}

/**
 * Build the response (and 2xx cache) headers for a resolved endpoint. The
 * security headers (CSP, nosniff, HSTS, per-endpoint Cache-Control) are attached
 * to EVERY response the endpoint produces (Req 5.6); `bypass` flows through so a
 * refresh response is marked `no-store`.
 */
function headersForEndpoint(spec: EndpointSpec, bypass: boolean): Record<string, string> {
  return securityHeaders({ cacheTtlMs: spec.cacheTtlMs, bypass });
}

/**
 * Create the request handler with injected dependencies. The returned handler
 * processes exactly one GET flow per the design:
 *
 *   1. method guard   — non-GET ⇒ 405 (Allow: GET).
 *   2. rate-limit     — per-IP + global admission ⇒ 429 (Retry-After) on reject.
 *   3. cache lookup   — path + full query string; honored unless no-cache bypass.
 *   4. allowlist      — buildQueryForPath ⇒ 400/404 BEFORE any DB round-trip.
 *   5. select         — SELECT-only client; failures ⇒ 502/503 (credential-free).
 *   6. maxRows cap    — slice returned rows to the endpoint cap (defense in depth).
 *   7. respond + cache— 200 {rows, lastUpdated}; store under the endpoint TTL
 *                       (never when bypassing); security headers on every response.
 *
 * No secret ever reaches a response body: credential-free messages only, no stack
 * trace, no raw upstream payload (Req 3.6, 5.9).
 */
export function createHandler(deps: HandlerDeps): RequestHandler {
  const now = deps.now ?? Date.now;

  return async (req, res) => {
    // Minimal, credential-free security headers are safe to attach to any error
    // path too; the per-endpoint Cache-Control is added once an endpoint resolves.
    try {
      // (1) Method guard — GET only; everything else is 405.
      if (req.method !== "GET") {
        sendJson(
          res,
          405,
          { error: "Method not allowed" },
          { Allow: "GET" },
        );
        return;
      }

      const { path: rawPath, queryString } = splitUrl(req.url ?? "/");
      // Strip a single leading `/api` prefix so the Firebase Hosting `/api/**`
      // rewrite (which forwards the full matched path) resolves against the
      // un-prefixed allowlist. The normalized path drives both allowlist lookup
      // and the cache key, keeping hit/miss stable across prefixed/un-prefixed
      // callers.
      const path = stripApiPrefix(rawPath);

      // (2) Rate-limit admission (per-IP first, then global ceiling).
      const decision = deps.rateLimiter.admit(clientIp(req));
      if (!decision.admit) {
        const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
        sendJson(
          res,
          429,
          { error: "Too many requests" },
          { "Retry-After": String(retryAfterSec) },
        );
        return;
      }

      const spec = ENDPOINTS_BY_PATH.get(path);
      const cacheReq: CacheRequest = {
        path,
        queryString,
        cacheControl: headerValue(req.headers["cache-control"]),
      };
      const bypass = isBypassRequest(cacheReq);

      // (3) Cache lookup (only meaningful for an allowlisted path; the store keys
      // on path + full query string and honors the no-cache bypass itself).
      if (spec !== undefined) {
        const hit = deps.cache.get(cacheReq);
        if (hit !== undefined) {
          sendJson(res, 200, hit, headersForEndpoint(spec, bypass));
          return;
        }
      }

      // (4) Resolve + validate against the fixed allowlist BEFORE any DB round-trip.
      const built = buildQueryForPath(path, rawParamsFrom(queryString));
      if (!built.ok) {
        // 404 unknown path / 400 bad param. No endpoint spec on a 404, so only the
        // static security headers apply.
        const headers =
          spec === undefined
            ? staticOnlyHeaders(bypass)
            : headersForEndpoint(spec, bypass);
        sendJson(res, built.status, { error: built.message }, headers);
        return;
      }

      // `built.ok` implies the path is allowlisted, so `spec` is defined.
      const endpoint = spec ?? ENDPOINTS_BY_PATH.get(path);
      if (endpoint === undefined) {
        // Unreachable in practice; keeps the types honest without an assertion.
        sendJson(res, 404, { error: "Unknown endpoint" }, staticOnlyHeaders(bypass));
        return;
      }

      // (5) The ONLY Supabase-touching call: a GET SELECT against the view.
      let rows: Row[];
      try {
        rows = await deps.readClient.select<Row>(built.view, built.query);
      } catch (err) {
        sendReadFailure(res, err, headersForEndpoint(endpoint, bypass));
        return;
      }

      // (6) Enforce the endpoint row cap defensively (the query already carries a
      // bounded limit; this guards against an upstream returning more).
      const capped = rows.slice(0, endpoint.maxRows);

      // (7) Respond 200 {rows, lastUpdated} and populate the cache (unless bypass).
      const body: ReadResponseBody = {
        rows: capped,
        lastUpdated: new Date(now()).toISOString(),
      };
      deps.cache.set(cacheReq, body, endpoint.cacheTtlMs);
      sendJson(res, 200, body, headersForEndpoint(endpoint, bypass));
    } catch {
      // Last-resort guard: never leak an internal error. If a response was already
      // started this is a no-op; otherwise emit a credential-free 500.
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal error" });
      } else {
        res.end();
      }
    }
  };
}

/** Normalize a possibly-array header to a single string value (or undefined). */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Whether the request explicitly bypasses the cache. Delegates to the cache
 * policy's recognition of `Cache-Control: no-cache` / `no-store` by constructing
 * the same `CacheRequest` the store sees.
 */
function isBypassRequest(req: CacheRequest): boolean {
  // Re-use cache.ts semantics without importing the private isBypass: a bypass is
  // an explicit no-cache/no-store directive. Keeping this local avoids coupling to
  // an unexported symbol while matching the store's own judgment.
  const header = req.cacheControl;
  if (header === undefined || header === "") return false;
  return header
    .toLowerCase()
    .split(",")
    .map((d) => d.trim())
    .some((d) => d === "no-cache" || d === "no-store");
}

/** The static security headers plus a bypass-aware Cache-Control, with no TTL. */
function staticOnlyHeaders(bypass: boolean): Record<string, string> {
  // No endpoint TTL on an error path ⇒ non-positive TTL degrades to `no-store`.
  return securityHeaders({ cacheTtlMs: 0, bypass });
}

/**
 * Map a read failure to a credential-free `502` / `503`. A gateway/transport
 * failure (`503` on 5xx upstream or a thrown network error) is distinguished from
 * a bad upstream response (`502`), but NEITHER body carries the credential, the
 * upstream payload, or a stack trace — only a fixed, safe message.
 */
function sendReadFailure(
  res: http.ServerResponse,
  err: unknown,
  headers: Record<string, string>,
): void {
  if (err instanceof SupabaseReadError) {
    // Upstream answered with an error status. 5xx ⇒ the data source is unavailable
    // (503); anything else (e.g. a malformed 4xx from PostgREST) ⇒ bad gateway (502).
    const status = err.status >= 500 ? 503 : 502;
    sendJson(res, status, { error: "Upstream read failed" }, headers);
    return;
  }
  // A thrown error (network failure, timeout, JSON parse) ⇒ the upstream is
  // unreachable/unusable: 503. The error object is never serialized.
  sendJson(res, 503, { error: "Upstream read unavailable" }, headers);
}
