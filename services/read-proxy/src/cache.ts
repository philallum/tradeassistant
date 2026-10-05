// dashboard-ui Read_Proxy — short-TTL cache policy (pure) + response store (impure).
//
// The cache POLICY is PURE: it derives a cache KEY from a request (path + the full
// query string, so a cache-busting `_r=<nonce>` naturally misses), decides whether
// a request bypasses the cache (`Cache-Control: no-cache`), resolves the TTL for
// an endpoint (120 s default; 300 s for `decision-dates`), and judges whether a
// stored entry is still fresh at a given instant. It performs no I/O and reads no
// clock — the instant is always supplied by the caller — so it is property-testable.
//
// The response STORE is the impure companion: an in-memory map from key to a
// stored entry with its expiry, with the clock injected (never `Date.now()` in the
// policy). It consults the pure policy for freshness and bypass.
//
// _Requirements: 5.2 (short TTL cache absorbing repeat loads; honor no-cache bypass)_

/** Default cache TTL: data changes ~once per daily run (design "Public-API hardening"). */
export const DEFAULT_TTL_MS = 120_000; // 120 s

/** The `decision-dates` endpoint changes only on a new run, so it caches longer. */
export const DECISION_DATES_TTL_MS = 300_000; // 300 s

/** Path of the longer-TTL decision-dates endpoint. */
export const DECISION_DATES_PATH = "/decision-dates";

/**
 * Resolve the cache TTL (ms) for a request path. The `decision-dates` endpoint
 * gets the longer window; every other allowlisted endpoint gets the default.
 * A caller MAY instead pass the endpoint's own `cacheTtlMs` to `storeFor`;
 * this helper exists so the policy is self-contained and testable per Req 5.2.
 */
export function ttlForPath(path: string): number {
  return path === DECISION_DATES_PATH ? DECISION_DATES_TTL_MS : DEFAULT_TTL_MS;
}

/**
 * The parts of a request that determine cache identity and bypass. The cache key
 * is `path` plus the FULL query string, so any differing param — including the
 * refresh nonce `_r=<nonce>` — produces a distinct key and misses the cache
 * (Req 17.2). `cacheControl` carries the request's `Cache-Control` header value
 * (if any) so an explicit `no-cache` bypass is honored.
 */
export interface CacheRequest {
  readonly path: string;
  /** Raw query string exactly as received (without a leading `?`), may be empty. */
  readonly queryString: string;
  /** Raw `Cache-Control` request header value, or `undefined` when absent. */
  readonly cacheControl?: string | undefined;
}

/**
 * PURE cache key: the path and the full query string, joined so two requests
 * share a key only when BOTH match exactly. An empty query string still yields a
 * stable key for that path.
 */
export function cacheKey(req: CacheRequest): string {
  return `${req.path}?${req.queryString}`;
}

/**
 * PURE bypass decision: honor `Cache-Control: no-cache` as an explicit bypass
 * (Req 5.2 / 17.2). Matching is case-insensitive and tolerant of the directive
 * appearing among other comma-separated directives (e.g. `no-cache, no-store`).
 * `no-store` is also treated as a bypass. Absent header ⇒ not a bypass.
 */
export function isBypass(req: CacheRequest): boolean {
  const header = req.cacheControl;
  if (header === undefined || header === "") return false;
  const directives = header
    .toLowerCase()
    .split(",")
    .map((d) => d.trim());
  return directives.includes("no-cache") || directives.includes("no-store");
}

/** A stored cache entry: the payload plus the instant it expires (exclusive). */
export interface CacheEntry<T> {
  readonly value: T;
  /** Absolute expiry instant (ms epoch); the entry is fresh while `now < expiresAt`. */
  readonly expiresAt: number;
}

/**
 * PURE freshness test: an entry is fresh when the current instant is strictly
 * before its expiry. At or past expiry it is stale and must not be served.
 */
export function isFresh<T>(entry: CacheEntry<T>, now: number): boolean {
  return now < entry.expiresAt;
}

/**
 * The impure response cache. Keyed by the pure `cacheKey`, it stores one entry
 * per key with an absolute expiry derived from the per-request TTL. The clock is
 * injected so the store never calls `Date.now()` directly.
 *
 * All freshness and bypass judgments delegate to the pure policy above; the store
 * only holds state and prunes expired entries lazily on access.
 */
export class ResponseCacheStore<T> {
  private readonly now: () => number;
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Look up a fresh cached value for `req`, or `undefined`.
   *
   * Returns `undefined` when the request is an explicit bypass
   * (`Cache-Control: no-cache`/`no-store`), when no entry exists, or when the
   * stored entry has expired (in which case it is also evicted).
   */
  get(req: CacheRequest): T | undefined {
    if (isBypass(req)) return undefined;

    const key = cacheKey(req);
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;

    if (!isFresh(entry, this.now())) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Store `value` for `req` with a TTL of `ttlMs`. A bypassing request is never
   * written to the cache, so a refresh neither serves nor pollutes the cache.
   * The expiry is computed from the injected clock at store time.
   */
  set(req: CacheRequest, value: T, ttlMs: number): void {
    if (isBypass(req)) return;
    const key = cacheKey(req);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  /** Current number of stored entries (fresh or not). Intended for tests. */
  get size(): number {
    return this.entries.size;
  }
}
