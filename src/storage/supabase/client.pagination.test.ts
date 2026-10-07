// Unit tests for SupabaseRestClient.select() transparent pagination.
//
// Hosted PostgREST silently truncates an unbounded GET at ~1000 rows, which is
// why backfill only ever encoded the first ~1000 candles per pair. `select`
// now pages through the whole table using `Range` headers + the authoritative
// `Content-Range` total, returning the COMPLETE result set. These tests inject
// a stub `fetch` via the constructor (no network, no real secret) and assert:
//   1. a multi-page result is returned complete, with correct Range offsets;
//   2. the first request sends `Prefer: count=exact` and the client drives the
//      loop off `Content-Range: 0-999/<total>`;
//   3. a single short page returns without a second request;
//   4. an exact-multiple boundary stops without spinning (no infinite loop);
//   5. apikey + Authorization are present on EVERY page request.

import { describe, expect, it } from "vitest";

import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";

const CONFIG: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

interface RecordedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** A row shape; the content is irrelevant, only the counts/order matter. */
interface Row {
  readonly i: number;
}

/**
 * Build a fetch stub backed by a fixed `total`-row dataset. Each call reads the
 * requested `Range: start-end` header, slices the dataset accordingly, and
 * replies 206 with a `Content-Range: start-end/total` header — exactly as
 * PostgREST does for a ranged select. Every request is recorded for assertions.
 */
function pagingFetch(total: number): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const dataset: Row[] = Array.from({ length: total }, (_v, i) => ({ i }));
  const requests: RecordedRequest[] = [];

  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({ url: String(url), headers });

    const range = headers.Range ?? "0-";
    const [startStr, endStr] = range.split("-");
    const start = Number.parseInt(startStr ?? "0", 10);
    const endInclusive = Number.parseInt(endStr ?? "", 10);
    const sliceEnd = Number.isFinite(endInclusive)
      ? endInclusive + 1
      : dataset.length;
    const batch = dataset.slice(start, sliceEnd);
    const lastIndex = start + batch.length - 1;

    return Promise.resolve(
      new Response(JSON.stringify(batch), {
        status: 206,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `${start}-${lastIndex}/${total}`,
        },
      }),
    );
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, requests };
}

describe("SupabaseRestClient.select() pagination (read-path truncation fix)", () => {
  it("returns a result set larger than one page complete and in order", async () => {
    // 2500 rows, page size 1000 => 3 ranged requests, 2500 rows concatenated.
    const stub = pagingFetch(2500);
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    const rows = await client.select<Row>("candles", "asset=eq.EURUSD&order=date.asc");

    expect(rows).toHaveLength(2500);
    // Rows are concatenated in page order (0,1,2,...,2499).
    expect(rows[0]?.i).toBe(0);
    expect(rows[2499]?.i).toBe(2499);
    for (let k = 0; k < rows.length; k += 1) {
      expect(rows[k]?.i).toBe(k);
    }

    // Three requests with the correct Range windows.
    expect(stub.requests).toHaveLength(3);
    expect(stub.requests[0]?.headers.Range).toBe("0-999");
    expect(stub.requests[1]?.headers.Range).toBe("1000-1999");
    expect(stub.requests[2]?.headers.Range).toBe("2000-2999");
    // Range-Unit is declared on every page.
    for (const req of stub.requests) {
      expect(req.headers["Range-Unit"]).toBe("items");
    }
  });

  it("sends Prefer: count=exact only on the first page and drives the loop off Content-Range", async () => {
    const stub = pagingFetch(2500);
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    await client.select<Row>("candles", "asset=eq.EURUSD");

    // First page requests the authoritative count.
    expect(stub.requests[0]?.headers.Prefer).toBe("count=exact");
    // Subsequent pages do not re-request the count.
    expect(stub.requests[1]?.headers.Prefer).toBeUndefined();
    expect(stub.requests[2]?.headers.Prefer).toBeUndefined();
  });

  it("preserves the caller's query string verbatim on every page", async () => {
    const stub = pagingFetch(2500);
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    await client.select<Row>("candles", "asset=eq.EURUSD&order=date.asc");

    for (const req of stub.requests) {
      expect(req.url).toBe(
        "https://proj.supabase.co/rest/v1/candles?asset=eq.EURUSD&order=date.asc",
      );
    }
  });

  it("returns a single short page immediately without a second request", async () => {
    const stub = pagingFetch(42);
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    const rows = await client.select<Row>("candles", "asset=eq.EURUSD");

    expect(rows).toHaveLength(42);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.headers.Range).toBe("0-999");
  });

  it("stops cleanly on an exact page-size multiple without an extra empty-page request", async () => {
    // 2000 rows, page size 1000 => the count says stop after the 2nd full page.
    const stub = pagingFetch(2000);
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    const rows = await client.select<Row>("candles", "asset=eq.EURUSD");

    expect(rows).toHaveLength(2000);
    // Count-driven termination: exactly two requests, no superfluous third.
    expect(stub.requests).toHaveLength(2);
    expect(stub.requests[0]?.headers.Range).toBe("0-999");
    expect(stub.requests[1]?.headers.Range).toBe("1000-1999");
  });

  it("terminates on an exact-multiple boundary even when the server declines to count (Content-Range total `*`)", async () => {
    // Server returns `*` for the total; termination falls back to the short
    // page. At an exact multiple the server returns one terminating empty page.
    const total = 2000;
    const dataset: Row[] = Array.from({ length: total }, (_v, i) => ({ i }));
    const requests: RecordedRequest[] = [];
    const fetchImpl = ((url: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({ url: String(url), headers });
      const range = headers.Range ?? "0-";
      const [startStr, endStr] = range.split("-");
      const start = Number.parseInt(startStr ?? "0", 10);
      const endInclusive = Number.parseInt(endStr ?? "", 10);
      const batch = dataset.slice(start, endInclusive + 1);
      const lastIndex = batch.length === 0 ? start : start + batch.length - 1;
      return Promise.resolve(
        new Response(JSON.stringify(batch), {
          status: 206,
          headers: {
            "Content-Type": "application/json",
            // No authoritative count available.
            "Content-Range": `${start}-${lastIndex}/*`,
          },
        }),
      );
    }) as unknown as typeof fetch;

    const client = new SupabaseRestClient(CONFIG, fetchImpl);
    const rows = await client.select<Row>("candles", "asset=eq.EURUSD");

    expect(rows).toHaveLength(2000);
    // Two full pages + one terminating empty page => 3 requests, no infinite loop.
    expect(requests).toHaveLength(3);
    expect(requests[2]?.headers.Range).toBe("2000-2999");
  });

  it("carries apikey + Authorization on every page request", async () => {
    const stub = pagingFetch(2500);
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    await client.select<Row>("candles", "asset=eq.EURUSD");

    expect(stub.requests).toHaveLength(3);
    for (const req of stub.requests) {
      expect(req.headers.apikey).toBe("sb_publishable_anon");
      expect(req.headers.Authorization).toBe("Bearer scoped-write-jwt");
    }
  });
});
