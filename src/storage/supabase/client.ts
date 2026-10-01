// Minimal Supabase PostgREST client over the IPv4 pooler/REST endpoint.
//
// Compute/storage separation (Requirement 17.1): the deterministic core reaches
// storage only through the three PORT interfaces (`CandleStore`,
// `PatternVectorStore`, `AnalogueStore`). This module is the concrete transport
// those adapters share — a thin wrapper over the PostgREST HTTP surface Supabase
// exposes at `<url>/rest/v1`. It deliberately adds NO new dependency (parent
// Req 18: exact pinned toolchain): it uses the Node 22 built-in `fetch`, so the
// adapters connect to the same REST endpoint a client library would, without
// changing package.json.
//
// `SupabaseConfig.key` (the Bearer credential) and the optional
// `SupabaseConfig.apiKey` (the gateway `apikey`) are `Secret_Key`s. They are
// sent ONLY in the `apikey` / `Authorization` request headers and are NEVER
// logged, echoed, or embedded in an error message (design Component 3; spec
// Req 3.3, 6.2, 6.3).

import type { SupabaseConfig } from "../supabaseConfig.js";

/** Error raised when a PostgREST request fails. Never carries the secret key. */
export class SupabaseRestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly table: string,
  ) {
    super(message);
    this.name = "SupabaseRestError";
  }
}

/**
 * PostgREST `Prefer` header value used for idempotent upserts: merge rows that
 * collide on the target's primary key rather than erroring on conflict.
 */
const UPSERT_PREFER = "resolution=merge-duplicates,return=minimal";

/** Trim a trailing slash so `<url>/rest/v1/<table>` composes cleanly. */
function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * A narrow PostgREST transport bound to one resolved {@link SupabaseConfig}.
 * The three storage adapters share a single instance so they reuse the same
 * connection configuration (URL + secret key + fetch implementation).
 */
export class SupabaseRestClient {
  readonly #baseUrl: string;
  readonly #key: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  /**
   * @param config The resolved Supabase connection (IPv4 pooler/REST URL + key).
   * @param fetchImpl Injectable fetch (defaults to the global). Tests can supply
   *                  a stub so no network is required; the secret still only ever
   *                  travels in headers.
   */
  constructor(config: SupabaseConfig, fetchImpl: typeof fetch = fetch) {
    this.#baseUrl = normalizeBaseUrl(config.url);
    this.#key = config.key;
    // Gateway apikey: the publishable (anon) key when provided (hosted), else
    // fall back to `key` so legacy anon/service-key setups are unchanged.
    this.#apiKey = config.apiKey ?? config.key;
    this.#fetch = fetchImpl;
  }

  /** The REST base (`<url>/rest/v1`). The secret key is not part of the URL. */
  #restUrl(table: string, query?: string): string {
    const base = `${this.#baseUrl}/rest/v1/${table}`;
    return query === undefined || query === "" ? base : `${base}?${query}`;
  }

  /**
   * Headers carrying the `Secret_Key`(s) (never logged).
   *
   * `apikey` is the gateway-admission credential (publishable/anon key on
   * hosted); `Authorization: Bearer` carries the role credential — the
   * Scoped_Write_Credential JWT on hosted. When no separate `apiKey` was
   * configured both default to the same `key` (legacy behavior).
   */
  #headers(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: this.#apiKey,
      Authorization: `Bearer ${this.#key}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  /**
   * Upsert rows into `table` (idempotent merge on the primary key). Mirrors the
   * `(key) -> replace` semantics of the in-memory reference stores.
   */
  async upsert(
    table: string,
    rows: readonly Record<string, unknown>[],
    onConflict?: string,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const query = onConflict === undefined ? "" : `on_conflict=${onConflict}`;
    const res = await this.#fetch(this.#restUrl(table, query), {
      method: "POST",
      headers: this.#headers({ Prefer: UPSERT_PREFER }),
      body: JSON.stringify(rows),
    });
    await this.#assertOk(res, table);
  }

  /**
   * Run a GET select against `table` with a raw PostgREST query string
   * (e.g. `asset=eq.EURUSD&order=date.asc`). Returns the parsed row array.
   */
  async select<T>(table: string, query: string): Promise<T[]> {
    const res = await this.#fetch(this.#restUrl(table, query), {
      method: "GET",
      headers: this.#headers(),
    });
    await this.#assertOk(res, table);
    return (await res.json()) as T[];
  }

  /** Delete rows matching a raw PostgREST filter query (used by tests/cleanup). */
  async delete(table: string, query: string): Promise<void> {
    const res = await this.#fetch(this.#restUrl(table, query), {
      method: "DELETE",
      headers: this.#headers({ Prefer: "return=minimal" }),
    });
    await this.#assertOk(res, table);
  }

  /** Throw a secret-free {@link SupabaseRestError} for any non-2xx response. */
  async #assertOk(res: Response, table: string): Promise<void> {
    if (res.ok) {
      return;
    }
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // Ignore body-read failures; the status is enough for diagnosis.
    }
    throw new SupabaseRestError(
      `Supabase REST ${res.status} on "${table}": ${detail}`.trim(),
      res.status,
      table,
    );
  }
}

/** PostgREST value encoder: URL-encode a filter value used in `col=eq.<v>`. */
export function eq(value: string): string {
  return `eq.${encodeURIComponent(value)}`;
}
