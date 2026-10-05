// dashboard-ui Read_Proxy — security response headers + CSP policy (pure).
//
// This module is PURE: it reads no clock, performs no I/O, and holds no state. It
// produces a plain headers map (Record<string, string>) describing the security
// headers the HTTP server (task 4.5) must set on EVERY proxy response. Keeping it
// pure makes it directly unit-testable (task 4.4) without an http.ServerResponse.
//
// It aligns with cache.ts: Cache-Control is derived from the endpoint's own
// `cacheTtlMs` (ms -> seconds), and a cache-bypassing request (the `no-cache` /
// `no-store` path cache.ts already recognizes) yields `no-store` so a refresh is
// never cached by any intermediary.
//
// _Requirements: 5.6 (CSP + security headers on every response; per-endpoint Cache-Control)_

/**
 * The fixed security headers set on every proxy response, independent of the
 * endpoint or request. The API serves only JSON data and must never be framed,
 * sniffed, or leak a referrer, so the policy is maximally restrictive.
 *
 * - Content-Security-Policy — the response is data, not a document: deny every
 *   resource type and forbid being embedded in a frame (Req 5.6).
 * - X-Content-Type-Options — forbid MIME sniffing; honor the declared type (Req 5.6).
 * - Referrer-Policy — never send a Referer header from this origin (Req 5.6).
 * - X-Frame-Options — legacy clickjacking defense complementing frame-ancestors (Req 5.6).
 * - Strict-Transport-Security — force HTTPS for a year, including subdomains (Req 5.6).
 */
export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
} as const;

/** Inputs that determine the per-endpoint `Cache-Control` header. */
export interface SecurityHeaderInput {
  /**
   * The endpoint's cache TTL in milliseconds (e.g. `EndpointSpec.cacheTtlMs`).
   * Converted to whole seconds for the `max-age` directive.
   */
  readonly cacheTtlMs: number;
  /**
   * Whether this response bypasses the cache (an explicit `Cache-Control:
   * no-cache` / `no-store` request, as judged by cache.ts `isBypass`). A
   * bypassing response is marked `no-store` so a refresh is never cached.
   */
  readonly bypass: boolean;
}

/**
 * PURE: derive the per-endpoint `Cache-Control` value.
 *
 * A bypassing (refresh / no-cache) response is `no-store`. Otherwise the response
 * is publicly cacheable for the endpoint's TTL in whole seconds; a non-positive
 * or non-finite TTL degrades safely to `no-store` rather than emitting a bogus
 * `max-age`.
 */
export function cacheControlFor({ cacheTtlMs, bypass }: SecurityHeaderInput): string {
  if (bypass) return "no-store";
  if (!Number.isFinite(cacheTtlMs) || cacheTtlMs <= 0) return "no-store";
  const ttlSeconds = Math.floor(cacheTtlMs / 1000);
  if (ttlSeconds <= 0) return "no-store";
  return `public, max-age=${ttlSeconds}`;
}

/**
 * PURE: the full security header map for a response — the fixed security set
 * merged with the computed per-endpoint `Cache-Control`. The returned object is a
 * fresh, mutable copy so callers may layer response-specific headers (e.g.
 * `Content-Type`) without mutating the shared static set.
 */
export function securityHeaders(input: SecurityHeaderInput): Record<string, string> {
  return {
    ...STATIC_SECURITY_HEADERS,
    "Cache-Control": cacheControlFor(input),
  };
}
