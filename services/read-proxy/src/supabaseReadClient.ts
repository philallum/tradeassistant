// dashboard-ui Read_Proxy — SELECT-only PostgREST client.
//
// This is the ONLY component on the serving side that touches Supabase (spec
// Req 3.3). It mirrors the core's `src/storage/supabase/client.ts`
// (`SupabaseRestClient`) transport — Node 22 built-in `fetch`, the `apikey` +
// `Authorization: Bearer` header split, `normalizeBaseUrl` + `<url>/rest/v1/<view>`
// composition, and a secret-free error on any non-2xx — but is reimplemented here
// so `services/read-proxy/` stays standalone (imports nothing from `src/`).
//
// SELECT-ONLY GUARANTEE (spec Req 3.4, 3.5): this class exposes EXACTLY ONE
// method — `select<T>(view, query)` — issued with HTTP `GET`. It has NO
// `upsert`/`insert`/`update`/`delete`/`rpc` method, so the proxy cannot mutate a
// Supabase relation through this transport. (The database adds defense in depth:
// the `dashboard_reader` role has SELECT-only grants under default-deny RLS.)
//
// CREDENTIAL HANDLING (spec Req 3.6, 5.9): the read credential (`config.readKey`)
// and the optional publishable gateway key (`config.apiKey`) are secrets. They
// are sent ONLY in the `apikey` / `Authorization` request headers and are NEVER
// logged, echoed, or embedded in an error message or thrown value — the error
// below carries only the HTTP status, the view name, and the (credential-free)
// response body text.

import type { ReadProxyConfig } from "./config.js";

/**
 * Error raised when a PostgREST read fails. It is secret-free by construction:
 * it carries the HTTP status, the view name, and the response body text, and
 * NEVER the read credential or publishable key.
 */
export class SupabaseReadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly view: string,
  ) {
    super(message);
    this.name = "SupabaseReadError";
  }
}

/** Trim a trailing slash so `<url>/rest/v1/<view>` composes cleanly. */
function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * A narrow, SELECT-only PostgREST transport bound to one resolved
 * {@link ReadProxyConfig}. The HTTP router shares a single instance so every
 * allowlisted endpoint reuses the same connection configuration (URL + read
 * credential + fetch implementation).
 *
 * By design this class has exactly one public method, `select`. No write verb is
 * defined anywhere on it.
 */
export class SupabaseReadClient {
  readonly #baseUrl: string;
  readonly #readKey: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  /**
   * @param config   The resolved read-only Supabase connection (URL + read key +
   *                 optional publishable gateway key).
   * @param fetchImpl Injectable fetch (defaults to the global Node 22 `fetch`).
   *                 Tests can supply a stub so no network is required; the secret
   *                 still only ever travels in headers.
   */
  constructor(config: ReadProxyConfig, fetchImpl: typeof fetch = fetch) {
    this.#baseUrl = normalizeBaseUrl(config.url);
    this.#readKey = config.readKey;
    // Gateway apikey: the publishable key when provided (hosted), else fall back
    // to the read key so the single-key local setup is unchanged.
    this.#apiKey = config.apiKey ?? config.readKey;
    this.#fetch = fetchImpl;
  }

  /** The REST URL (`<url>/rest/v1/<view>`). The secret is never part of the URL. */
  #restUrl(view: string, query: string): string {
    const base = `${this.#baseUrl}/rest/v1/${view}`;
    return query === "" ? base : `${base}?${query}`;
  }

  /**
   * Request headers carrying the secret(s) (never logged).
   *
   * `apikey` is the gateway-admission credential (publishable/anon key on
   * hosted); `Authorization: Bearer` carries the `dashboard_reader` role
   * credential. When no separate `apiKey` was configured (local) both default to
   * the same read key.
   */
  #headers(): Record<string, string> {
    return {
      apikey: this.#apiKey,
      Authorization: `Bearer ${this.#readKey}`,
      Accept: "application/json",
    };
  }

  /**
   * Run a GET select against `view` with a raw PostgREST query string
   * (e.g. `decision_date=eq.2026-01-02&limit=5`). Returns the parsed row array.
   *
   * This is the ONLY method that reaches Supabase, and it is GET-only — no
   * mutating request is ever issued through this client (spec Req 3.4, 3.5).
   */
  async select<T>(view: string, query: string): Promise<T[]> {
    const res = await this.#fetch(this.#restUrl(view, query), {
      method: "GET",
      headers: this.#headers(),
    });
    await this.#assertOk(res, view);
    return (await res.json()) as T[];
  }

  /** Throw a secret-free {@link SupabaseReadError} for any non-2xx response. */
  async #assertOk(res: Response, view: string): Promise<void> {
    if (res.ok) {
      return;
    }
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // Ignore body-read failures; the status is enough for diagnosis.
    }
    throw new SupabaseReadError(
      `Supabase read ${res.status} on "${view}": ${detail}`.trim(),
      res.status,
      view,
    );
  }
}
