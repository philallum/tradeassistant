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

/**
 * PostgREST `Prefer` header value used by {@link SupabaseRestClient.insertReturning}:
 * a plain insert that returns the inserted rows in the response body. This lets a
 * caller read back DB-generated columns — notably a `gen_random_uuid()` primary
 * key — that `return=minimal` (used by {@link SupabaseRestClient.upsert}) withholds.
 */
const INSERT_RETURNING_PREFER = "return=representation";

/**
 * Rows fetched per paged `select` request. PostgREST on the hosted gateway caps
 * an unbounded GET at ~1000 rows, so reads MUST page explicitly or they are
 * silently truncated (this is the bug that limited backfill coverage). A page
 * size of 1000 matches that server ceiling so every full page is a round trip
 * the server would have returned anyway.
 */
const SELECT_PAGE_SIZE = 1000;

/**
 * Hard upper bound on paged `select` iterations. A guard against a server that
 * never signals termination (e.g. always returns a full page): 100_000 pages ×
 * 1000 rows = 100M rows, far beyond any real table, so this never trips in
 * practice but makes an infinite loop impossible.
 */
const SELECT_MAX_PAGES = 100_000;

/**
 * Parse the authoritative total row count from a PostgREST `Content-Range`
 * response header. The format is `start-end/total` (e.g. `0-999/4183`); the
 * total may be `*` when the server declines to count, in which case this
 * returns `undefined` and the caller falls back to short-page termination.
 */
function parseContentRangeTotal(header: string | null): number | undefined {
  if (header === null) {
    return undefined;
  }
  const slash = header.lastIndexOf("/");
  if (slash === -1) {
    return undefined;
  }
  const totalPart = header.slice(slash + 1).trim();
  if (totalPart === "" || totalPart === "*") {
    return undefined;
  }
  const total = Number.parseInt(totalPart, 10);
  return Number.isFinite(total) && total >= 0 ? total : undefined;
}

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
   * Insert rows into `table` and read the inserted rows back from the response.
   *
   * Additive sibling to {@link upsert}: where `upsert` sends
   * `Prefer: resolution=merge-duplicates,return=minimal` (idempotent merge, no
   * body), this issues a plain insert with `Prefer: return=representation` so the
   * response carries the inserted rows — including DB-generated columns such as a
   * `gen_random_uuid()` primary key. The gate-verdict adapter uses this to read
   * back the generated `id` of the aggregate row before inserting its fold rows.
   *
   * Reuses the same headers/transport/`fetch` as every other method; introduces no
   * new dependency and leaves `upsert`'s behaviour unchanged. On a non-success
   * status it throws the same secret-free {@link SupabaseRestError}.
   *
   * @returns The inserted rows as returned by PostgREST (empty when `rows` is empty).
   */
  async insertReturning<T>(
    table: string,
    rows: readonly Record<string, unknown>[],
  ): Promise<T[]> {
    if (rows.length === 0) {
      return [];
    }
    const res = await this.#fetch(this.#restUrl(table), {
      method: "POST",
      headers: this.#headers({ Prefer: INSERT_RETURNING_PREFER }),
      body: JSON.stringify(rows),
    });
    await this.#assertOk(res, table);
    return (await res.json()) as T[];
  }

  /**
   * Run a GET select against `table` with a raw PostgREST query string
   * (e.g. `asset=eq.EURUSD&order=date.asc`) and return the COMPLETE result set.
   *
   * Hosted PostgREST silently truncates an unbounded GET at ~1000 rows, so this
   * pages through the table using `Range` headers (`Range-Unit: items`,
   * `Range: <start>-<end>`) until every row has been fetched. The first page
   * asks for `Prefer: count=exact` and reads the authoritative total from the
   * `Content-Range` response header (`start-end/total`); the loop stops when
   * that total has been reached, or defensively when a page returns fewer than
   * {@link SELECT_PAGE_SIZE} rows (covers servers that return `*` for the
   * count). The caller's `query` — filters AND any `order=...` — is preserved
   * verbatim; ordering is the caller's responsibility.
   */
  async select<T>(table: string, query: string): Promise<T[]> {
    const url = this.#restUrl(table, query);
    const rows: T[] = [];
    let offset = 0;
    let total: number | undefined;

    for (let page = 0; page < SELECT_MAX_PAGES; page += 1) {
      const end = offset + SELECT_PAGE_SIZE - 1;
      // `Prefer: count=exact` only on the first page: it is the one that reads
      // the total; subsequent pages do not need the (potentially costly) count.
      const rangeHeaders: Record<string, string> = {
        "Range-Unit": "items",
        Range: `${offset}-${end}`,
      };
      if (page === 0) {
        rangeHeaders.Prefer = "count=exact";
      }
      const res = await this.#fetch(url, {
        method: "GET",
        headers: this.#headers(rangeHeaders),
      });
      await this.#assertOk(res, table);

      if (page === 0) {
        total = parseContentRangeTotal(res.headers.get("Content-Range"));
      }

      const batch = (await res.json()) as T[];
      rows.push(...batch);

      // Terminate on: a short/empty page (fewer rows than requested means the
      // server has no more), or once we have fetched the authoritative total.
      if (
        batch.length < SELECT_PAGE_SIZE ||
        batch.length === 0 ||
        (total !== undefined && rows.length >= total)
      ) {
        break;
      }
      offset += SELECT_PAGE_SIZE;
    }

    return rows;
  }

  /** Delete rows matching a raw PostgREST filter query (used by tests/cleanup). */
  async delete(table: string, query: string): Promise<void> {
    const res = await this.#fetch(this.#restUrl(table, query), {
      method: "DELETE",
      headers: this.#headers({ Prefer: "return=minimal" }),
    });
    await this.#assertOk(res, table);
  }

  /**
   * Throw a secret-free {@link SupabaseRestError} for any non-2xx response.
   *
   * `res.ok` is true for the whole 200–299 range, so the `206 Partial Content`
   * that PostgREST returns for a ranged `select` page is accepted as success.
   */
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
