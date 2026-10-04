/**
 * Impure Read_Proxy client (task 8.1).
 *
 * This is the SPA's ONLY data-fetch surface. It is deliberately IMPURE — it calls the
 * platform `fetch` — and therefore lives OUTSIDE `web/src/pure/` so the purity guard
 * (Req 19.1, 19.2) never covers it. It imports NOTHING from the deterministic core
 * (`src/`) and holds NO database credential of any kind: every request is a same-origin
 * `GET /api/*` that the Firebase Hosting `/api` rewrite forwards to the Read_Proxy
 * (Req 2.2, 3.1, 3.2). The browser never talks to Supabase.
 *
 * Responsibilities:
 *   - Build the `/api/<path>?<params>` URL for an allowlisted endpoint from the typed
 *     endpoint map in `endpoints.ts` (same ten endpoints the proxy allows).
 *   - Issue a same-origin `GET`, parse the `{ rows, lastUpdated }` envelope, and surface a
 *     `lastUpdated` value to the caller (Req 17.3's freshness indicator reads this).
 *   - Implement the cache-bust transform: `{ bustCache: true }` appends a `_r=<nonce>`
 *     query param AND sends a `Cache-Control: no-cache` request header, so the refresh
 *     control bypasses the proxy's cached response (Req 17.2).
 *   - Produce NON-SECRET error messages only: it never includes a credential, the raw
 *     response body, or a stack trace in a thrown message (Req 3.7, 14.2).
 */

import type { EndpointParams, EndpointPath, EndpointRow } from "./endpoints";

/**
 * A successfully parsed proxy response. `rows` is the bounded row array for the endpoint;
 * `lastUpdated` is the proxy's freshness marker surfaced to the freshness indicator
 * (Req 17.3). `lastUpdated` is `null` when the proxy did not supply one.
 */
export interface ApiResult<Row> {
  readonly rows: readonly Row[];
  readonly lastUpdated: string | null;
}

/** Per-call options. `bustCache` drives the refresh control's cache-bypassing fetch. */
export interface ApiOptions {
  /**
   * When `true`, append a `_r=<nonce>` query param and send `Cache-Control: no-cache` so
   * the proxy re-queries instead of returning a cached response (Req 17.2). The nonce makes
   * the URL distinct from the cached one, defeating any intermediary cache as well.
   */
  readonly bustCache?: boolean;
  /** Abort signal, so an in-flight request can be cancelled by the caller. */
  readonly signal?: AbortSignal;
}

/**
 * Non-secret, client-safe error raised when a read request fails. Its `message` is always
 * a fixed, human-readable string that excludes every credential value, the raw payload, and
 * any stack trace (Req 3.7, 14.2). The numeric `status` (when known) lets the UI distinguish
 * "no data" from "something broke" without exposing details.
 */
export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Dependencies injected for testability: the fetch impl and the cache-bust nonce source. */
export interface ApiClientDeps {
  /** The `fetch` implementation. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /**
   * Nonce source for the cache-bust param. Injected so a test can assert a distinct,
   * cache-bypassing URL deterministically (Property 15). Defaults to a time+random nonce.
   */
  readonly nonce?: () => string;
}

/** The same-origin prefix every request targets — forwarded by the Firebase `/api` rewrite. */
const API_PREFIX = "/api";

/** Default cache-bust nonce: monotonic-ish time plus randomness, URL-safe. */
function defaultNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Serialize an endpoint's typed params into URL query entries. Only own, defined,
 * non-empty values are emitted; numbers (e.g. `limit`) are stringified. The resulting
 * entries mirror exactly the param names the proxy allowlist accepts.
 */
function toQueryEntries(params: Record<string, unknown>): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    entries.push([key, typeof value === "number" ? String(value) : String(value)]);
  }
  return entries;
}

/**
 * Build the same-origin request URL for an allowlisted endpoint. When `bustCache` is set, a
 * `_r=<nonce>` param is appended so the URL is distinct from the cached one (Req 17.2).
 */
function buildUrl(
  path: EndpointPath,
  params: Record<string, unknown>,
  bustCache: boolean,
  nonce: () => string,
): string {
  const search = new URLSearchParams(toQueryEntries(params));
  if (bustCache) {
    search.set("_r", nonce());
  }
  const query = search.toString();
  return query.length > 0 ? `${API_PREFIX}${path}?${query}` : `${API_PREFIX}${path}`;
}

/**
 * Narrow an untrusted parsed JSON body to the `{ rows, lastUpdated }` envelope the proxy
 * returns. A malformed body is rejected with a non-secret error rather than propagating the
 * raw payload (Req 14.2). `rows` must be an array; `lastUpdated`, when present, must be a
 * string (otherwise it is normalized to `null`).
 */
function parseEnvelope<Row>(body: unknown): ApiResult<Row> {
  if (typeof body !== "object" || body === null || !("rows" in body)) {
    throw new ApiError("The server returned an unexpected response.");
  }
  const rows = (body as { rows: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new ApiError("The server returned an unexpected response.");
  }
  const rawUpdated = (body as { lastUpdated?: unknown }).lastUpdated;
  const lastUpdated = typeof rawUpdated === "string" ? rawUpdated : null;
  return { rows: rows as readonly Row[], lastUpdated };
}

/**
 * Map a transport/HTTP failure to a fixed, non-secret message. The message NEVER contains a
 * credential, the raw response body, or a stack trace (Req 3.7, 14.2). Status drives the
 * wording only coarsely so the UI can tell "no data" from "something broke".
 */
function messageForStatus(status: number): string {
  if (status === 404) return "The requested data was not found.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return "The data service is temporarily unavailable.";
  if (status >= 400) return "The request could not be completed.";
  return "The request could not be completed.";
}

/**
 * Fetch an allowlisted endpoint and return its `{ rows, lastUpdated }` result.
 *
 * `path` + `params` are checked at compile time against the typed endpoint map, so a call
 * with the wrong param shape never compiles (let alone reaches the proxy). On any failure a
 * NON-SECRET {@link ApiError} is thrown — the credential, the raw body, and stack traces are
 * never surfaced (Req 3.7, 14.2).
 */
export async function fetchEndpoint<P extends EndpointPath>(
  path: P,
  params: EndpointParams[P],
  options: ApiOptions = {},
  deps: ApiClientDeps = {},
): Promise<ApiResult<EndpointRow[P]>> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const nonce = deps.nonce ?? defaultNonce;
  const bustCache = options.bustCache === true;

  const url = buildUrl(path, params as Record<string, unknown>, bustCache, nonce);

  // Base headers; the cache-bust path adds an explicit no-cache directive so the proxy
  // bypasses its own cached response (Req 17.2).
  const headers: Record<string, string> = { Accept: "application/json" };
  if (bustCache) {
    headers["Cache-Control"] = "no-cache";
  }

  const requestInit: RequestInit = {
    method: "GET",
    headers,
    // Belt-and-braces: tell the browser cache to revalidate on a bust as well.
    cache: bustCache ? "no-store" : "default",
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };

  let response: Response;
  try {
    response = await fetchImpl(url, requestInit);
  } catch (cause) {
    // A network-level failure (offline, DNS, CORS) — never echo the underlying error text,
    // which could in principle carry URL/credential fragments (Req 3.7, 14.2).
    if (cause instanceof DOMException && cause.name === "AbortError") {
      throw cause;
    }
    throw new ApiError("Could not reach the data service.");
  }

  if (!response.ok) {
    // Do NOT read or forward the error body — it is an untrusted raw payload (Req 14.2).
    throw new ApiError(messageForStatus(response.status), response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("The server returned an unexpected response.", response.status);
  }

  return parseEnvelope<EndpointRow[P]>(body);
}
