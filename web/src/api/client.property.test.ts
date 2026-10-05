// Feature: dashboard-ui, Property 15: Refresh produces a distinct, cache-bypassing request.
// For any allowlisted endpoint and any valid param set, the client's cache-bust transform
// (`{ bustCache: true }`) yields a request whose URL is DISTINCT from the normal request's
// URL for the same endpoint/params — because a `_r=<nonce>` param is appended — AND that
// carries a `Cache-Control: no-cache` request header (with `cache: 'no-store'`), so the
// Read_Proxy's cached response is bypassed. A normal (`bustCache` false/absent) request
// carries NO `_r` param and NO no-cache header. The injected `fetchImpl` captures the exact
// URL + headers, and the injected deterministic nonce makes the distinctness provable.
//
// **Validates: Requirements 17.1, 17.2**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fetchEndpoint, type ApiClientDeps, type ApiOptions } from "./client.ts";
import {
  PAIRS,
  type EndpointParams,
  type EndpointPath,
  type Pair,
} from "./endpoints.ts";

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/**
 * A captured request: the exact URL string the client passed to `fetchImpl` and the headers
 * it attached. Everything the property asserts over is read back from here, so the test
 * observes only what the client actually requested — never what it intended.
 */
interface CapturedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly cache: RequestCache | undefined;
}

/**
 * Build a fake `fetchImpl` that records each request and returns a well-formed, empty
 * `{ rows, lastUpdated }` envelope so `fetchEndpoint` resolves without ever touching the
 * network. The capture array is shared so the caller can read back the single request each
 * `fetchEndpoint` call issues.
 */
function makeCapturingFetch(captured: CapturedRequest[]): typeof fetch {
  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[k] = v;
      }
    }
    captured.push({ url, headers, cache: init?.cache });
    return new Response(JSON.stringify({ rows: [], lastUpdated: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return fakeFetch as unknown as typeof fetch;
}

/**
 * Arbitrary over ISO calendar-date strings in the fixed `YYYY-MM-DD` form the serving layer
 * uses — a representative valid value for every `decisionDate` / `from` / `to` param.
 */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2020-01-01T00:00:00.000Z"),
    max: new Date("2021-12-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

/** One of the five supported pairs, drawn verbatim from the wire-format `PAIRS` set. */
const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);

/** A bounded positive integer, a representative valid `limit`. */
const limitArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 500 });

/** A representative valid uuid for the `verdictId` param. */
const uuidArb: fc.Arbitrary<string> = fc.uuid();

/**
 * One (path, params) pair for a randomly chosen endpoint, each generator yielding only
 * representative VALID params for that endpoint (optional params present or absent). This
 * drives the property across the whole allowlist, not just one endpoint.
 */
const endpointCallArb: fc.Arbitrary<{
  path: EndpointPath;
  params: EndpointParams[EndpointPath];
}> = fc.oneof(
  fc.record({
    path: fc.constant("/decision-dates" as const),
    params: fc.constant({} as EndpointParams["/decision-dates"]),
  }),
  fc.record({
    path: fc.constant("/firing-setups" as const),
    params: fc.record(
      { decisionDate: isoDateArb, pair: pairArb },
      { requiredKeys: ["decisionDate"] },
    ),
  }),
  fc.record({
    path: fc.constant("/confidence-trend" as const),
    params: fc.record({ pair: pairArb, limit: limitArb }, { requiredKeys: ["pair"] }),
  }),
  fc.record({
    path: fc.constant("/analogue-outcomes" as const),
    params: fc.record(
      { pair: pairArb, decisionDate: isoDateArb },
      { requiredKeys: ["pair"] },
    ),
  }),
  fc.record({
    path: fc.constant("/realized-outcomes" as const),
    params: fc.record(
      { pair: pairArb, decisionDate: isoDateArb },
      { requiredKeys: ["pair"] },
    ),
  }),
  fc.record({
    path: fc.constant("/gate-verdicts" as const),
    params: fc.record({ limit: limitArb }, { requiredKeys: [] }),
  }),
  fc.record({
    path: fc.constant("/gate-fold-verdicts" as const),
    params: fc.record({ verdictId: uuidArb }),
  }),
  fc.record({
    path: fc.constant("/candles" as const),
    params: fc.record(
      { pair: pairArb, from: isoDateArb, to: isoDateArb },
      { requiredKeys: ["pair"] },
    ),
  }),
  fc.record({
    path: fc.constant("/ai-rationale" as const),
    params: fc.record({ decisionDate: isoDateArb, pair: pairArb }),
  }),
  fc.record({
    path: fc.constant("/external-comparison" as const),
    params: fc.record({ decisionDate: isoDateArb, pair: pairArb }),
  }),
) as fc.Arbitrary<{ path: EndpointPath; params: EndpointParams[EndpointPath] }>;

/**
 * Case-insensitive header lookup — `fetch` header names are case-insensitive, so the
 * property must not depend on the exact casing the client happens to use.
 */
function header(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** Extract the query string (after the first `?`), or "" when there is none. */
function queryOf(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? "" : url.slice(i + 1);
}

/** The `_r` cache-bust param value present in a URL, or `null` when absent. */
function cacheBustParam(url: string): string | null {
  return new URLSearchParams(queryOf(url)).get("_r");
}

describe("Property 15: Refresh produces a distinct, cache-bypassing request", () => {
  it("bust request appends a distinct _r nonce + no-cache header; normal request has neither", async () => {
    // A deterministic, strictly-varying nonce: each call returns a fresh, unique value, so
    // (a) the bust URL is provably distinct from the normal URL, and (b) two successive
    // bust requests for the SAME endpoint/params are themselves distinct — the essence of
    // "cache-busting". A monotonically increasing counter guarantees uniqueness without any
    // reliance on the real clock or randomness.
    let counter = 0;
    const nonce = (): string => `n${(counter += 1).toString(36)}`;

    await fc.assert(
      fc.asyncProperty(endpointCallArb, async ({ path, params }) => {
        const captured: CapturedRequest[] = [];
        const deps: ApiClientDeps = {
          fetchImpl: makeCapturingFetch(captured),
          nonce,
        };

        // 1) Normal request (bustCache absent).
        await fetchEndpoint(path, params as never, {} as ApiOptions, deps);
        // 2) Refresh request (bustCache: true) — same endpoint + params.
        await fetchEndpoint(path, params as never, { bustCache: true }, deps);
        // 3) A second refresh — proves successive busts are distinct from each other too.
        await fetchEndpoint(path, params as never, { bustCache: true }, deps);

        expect(captured.length).toBe(3);
        const [normal, bust1, bust2] = captured as [
          CapturedRequest,
          CapturedRequest,
          CapturedRequest,
        ];

        // --- Normal request: no cache-bust param, no no-cache directive. ---
        expect(cacheBustParam(normal.url)).toBeNull();
        expect(header(normal.headers, "Cache-Control")).toBeUndefined();
        expect(normal.cache).not.toBe("no-store");
        // It still targets the same-origin /api path for the endpoint.
        expect(normal.url.startsWith(`/api${path}`)).toBe(true);

        // --- Refresh request: carries the _r nonce AND the no-cache header. ---
        expect(cacheBustParam(bust1.url)).not.toBeNull();
        expect(header(bust1.headers, "Cache-Control")).toBe("no-cache");
        expect(bust1.cache).toBe("no-store");
        expect(bust1.url.startsWith(`/api${path}`)).toBe(true);

        // --- Distinctness: the refresh URL differs from the normal URL. ---
        expect(bust1.url).not.toBe(normal.url);

        // The ONLY difference is the added `_r` param: stripping `_r` from the bust URL
        // reproduces the normal query exactly, so the client bypasses the cache WITHOUT
        // perturbing any real endpoint param.
        const strip = (url: string): string => {
          const sp = new URLSearchParams(queryOf(url));
          sp.delete("_r");
          sp.sort();
          return sp.toString();
        };
        const normalSorted = ((): string => {
          const sp = new URLSearchParams(queryOf(normal.url));
          sp.sort();
          return sp.toString();
        })();
        expect(strip(bust1.url)).toBe(normalSorted);

        // --- Successive busts are distinct from each other (fresh nonce each time). ---
        expect(bust2.url).not.toBe(bust1.url);
        expect(cacheBustParam(bust2.url)).not.toBe(cacheBustParam(bust1.url));
        expect(header(bust2.headers, "Cache-Control")).toBe("no-cache");
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
