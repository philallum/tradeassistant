// Unit tests for buildSupabaseGateStores() (dashboard-data-activation Task 3.2;
// design Component 3, spec Req 1.2).
//
// `buildSupabaseGateStores(supabase, fetchImpl?)` is the ADDITIVE sibling of
// `buildSupabaseStores`: it builds ONE shared `SupabaseRestClient` and returns
// `{ gateVerdictStore, featureRegistryStore }`, so the two gate adapters reach
// storage through the same connection configuration (URL + secret key + fetch).
// It must NOT widen `PipelineStores` — `buildSupabaseStores` still returns
// exactly the candle/vector/analogue triple.
//
// These tests inject a stub `fetch` (no network, no real secret) and assert:
//   1. both adapters are constructed from ONE shared client — every request
//      from either adapter carries the SAME auth headers derived from the one
//      config, and no network is reached beyond the injected stub;
//   2. an existing `SupabaseRestClient` can be passed directly and is reused by
//      both adapters (client sharing with `buildSupabaseStores`);
//   3. `buildSupabaseStores` STILL returns exactly
//      `{ candleStore, vectorStore, analogueStore }` — the shape is unchanged.

import { describe, expect, it } from "vitest";

import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";
import { SupabaseGateVerdictStore } from "./gateVerdictStore.js";
import { SupabaseFeatureRegistryStore } from "./featureRegistryStore.js";
import { buildSupabaseGateStores, buildSupabaseStores } from "./index.js";

const CONFIG: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly apikey: string | undefined;
  readonly authorization: string | undefined;
}

/**
 * Build a fetch stub that answers every GET select with an empty page and
 * records the request's URL + auth headers. One page terminates the paginated
 * `select` (short page => no second request), so a single `get`/`all`/
 * `latestPassVerdict` call per adapter is enough to observe its transport.
 */
function recordingFetch(): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];

  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      apikey: headers.apikey,
      authorization: headers.Authorization,
    });
    return Promise.resolve(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": "0-0/0",
        },
      }),
    );
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, requests };
}

describe("buildSupabaseGateStores()", () => {
  it("returns both gate adapters", () => {
    const stub = recordingFetch();
    const stores = buildSupabaseGateStores(CONFIG, stub.fetch);

    expect(stores.gateVerdictStore).toBeInstanceOf(SupabaseGateVerdictStore);
    expect(stores.featureRegistryStore).toBeInstanceOf(
      SupabaseFeatureRegistryStore,
    );
    expect(Object.keys(stores).sort()).toEqual([
      "featureRegistryStore",
      "gateVerdictStore",
    ]);
  });

  it("constructs both adapters from ONE shared client (same transport + auth)", async () => {
    const stub = recordingFetch();
    const { gateVerdictStore, featureRegistryStore } = buildSupabaseGateStores(
      CONFIG,
      stub.fetch,
    );

    // Exercise each adapter so both route a request through their client.
    await gateVerdictStore.getVerdict("some-verdict-id");
    await featureRegistryStore.all();

    expect(stub.requests).toHaveLength(2);
    // Both requests travelled through the one injected fetch, carrying the SAME
    // auth headers derived from the single shared config — proving one client.
    for (const req of stub.requests) {
      expect(req.apikey).toBe("sb_publishable_anon");
      expect(req.authorization).toBe("Bearer scoped-write-jwt");
      expect(req.url.startsWith("https://proj.supabase.co/rest/v1/")).toBe(true);
    }
    // Each adapter hit its own table through that shared client.
    expect(stub.requests[0]?.url).toContain("/rest/v1/gate_verdicts");
    expect(stub.requests[1]?.url).toContain("/rest/v1/feature_registry");
  });

  it("reuses an existing SupabaseRestClient when one is passed", async () => {
    const stub = recordingFetch();
    const shared = new SupabaseRestClient(CONFIG, stub.fetch);
    const { gateVerdictStore, featureRegistryStore } =
      buildSupabaseGateStores(shared);

    await gateVerdictStore.getVerdict("another-verdict-id");
    await featureRegistryStore.all();

    // The passed client's injected fetch received both requests — the builder
    // did not construct a second client.
    expect(stub.requests).toHaveLength(2);
    expect(stub.requests[0]?.authorization).toBe("Bearer scoped-write-jwt");
  });
});

describe("buildSupabaseStores() shape is unchanged (no PipelineStores widening)", () => {
  it("still returns exactly { candleStore, vectorStore, analogueStore }", () => {
    const stub = recordingFetch();
    const stores = buildSupabaseStores(CONFIG, stub.fetch);

    expect(Object.keys(stores).sort()).toEqual([
      "analogueStore",
      "candleStore",
      "vectorStore",
    ]);
    // The gate adapters are NOT part of the pipeline triple.
    expect("gateVerdictStore" in stores).toBe(false);
    expect("featureRegistryStore" in stores).toBe(false);
  });
});
