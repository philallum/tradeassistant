// Unit tests for SupabaseGateVerdictStore.latestPassVerdict() (dashboard-data-
// activation Task 1.3; design Component 1 / Component 5).
//
// `latestPassVerdict(configId)` is the pure read the GatePassingResolver binds
// to: it issues a single paginated `select` on `gate_verdicts` filtered to the
// config's PASS verdicts, ordered by `created_at` descending and limited to
// one, through the SAME `eq()` encoder and `SupabaseRestClient.select` the rest
// of the adapter uses, and returns `{ verdictId } | null`. It re-implements no
// gate math — it reports only the id of the newest recorded PASS (Req 1.7,
// 1.8). These tests inject a stub `fetch` via the shared client (no network, no
// real secret) and assert:
//   1. the request filters config_id + verdict=PASS, orders created_at desc,
//      limit 1, through the eq() encoder (URL-encoded values);
//   2. the newest PASS row's generated id is returned as `{ verdictId }`;
//   3. an empty result set returns null;
//   4. a non-success status raises a secret-free SupabaseRestError augmented
//      with the config_id (the key never appears).

import { describe, expect, it } from "vitest";

import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient, SupabaseRestError } from "./client.js";
import { SupabaseGateVerdictStore } from "./gateVerdictStore.js";

const CONFIG: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
}

/**
 * Build a fetch stub that returns `rows` for any GET select and records every
 * request. Replies 200 with a bounded `Content-Range` so the paginated
 * `select` terminates after the single page (short page => no second request).
 */
function selectFetch(
  rows: readonly Record<string, unknown>[],
  status = 200,
): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];

  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    requests.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      headers,
    });

    if (status >= 400) {
      return Promise.resolve(
        new Response("denied", {
          status,
          headers: { "Content-Type": "text/plain" },
        }),
      );
    }

    const last = rows.length === 0 ? 0 : rows.length - 1;
    return Promise.resolve(
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `0-${last}/${rows.length}`,
        },
      }),
    );
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, requests };
}

describe("SupabaseGateVerdictStore.latestPassVerdict()", () => {
  it("selects config_id + verdict=PASS, ordered created_at desc, limit 1 via eq()", async () => {
    const stub = selectFetch([{ id: "verdict-newest-pass" }]);
    const store = new SupabaseGateVerdictStore(
      new SupabaseRestClient(CONFIG, stub.fetch),
    );

    const result = await store.latestPassVerdict("EUR USD-active");

    expect(result).toEqual({ verdictId: "verdict-newest-pass" });

    expect(stub.requests).toHaveLength(1);
    const req = stub.requests[0];
    expect(req?.method).toBe("GET");
    // eq() URL-encodes the value (the space becomes %20) and prefixes `eq.`.
    expect(req?.url).toContain("config_id=eq.EUR%20USD-active");
    expect(req?.url).toContain("verdict=eq.PASS");
    expect(req?.url).toContain("order=created_at.desc");
    expect(req?.url).toContain("limit=1");
  });

  it("returns the newest PASS row's generated id as { verdictId }", async () => {
    const stub = selectFetch([{ id: "v-123", config_id: "GBPUSD-active" }]);
    const store = new SupabaseGateVerdictStore(
      new SupabaseRestClient(CONFIG, stub.fetch),
    );

    expect(await store.latestPassVerdict("GBPUSD-active")).toEqual({
      verdictId: "v-123",
    });
  });

  it("returns null when the config has no recorded PASS", async () => {
    const stub = selectFetch([]);
    const store = new SupabaseGateVerdictStore(
      new SupabaseRestClient(CONFIG, stub.fetch),
    );

    expect(await store.latestPassVerdict("USDJPY-active")).toBeNull();
  });

  it("raises a secret-free SupabaseRestError augmented with the config_id", async () => {
    const stub = selectFetch([], 403);
    const store = new SupabaseGateVerdictStore(
      new SupabaseRestClient(CONFIG, stub.fetch),
    );

    await expect(
      store.latestPassVerdict("USDCHF-active"),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SupabaseRestError);
      const restErr = err as SupabaseRestError;
      expect(restErr.status).toBe(403);
      expect(restErr.table).toBe("gate_verdicts");
      expect(restErr.message).toContain("config_id=USDCHF-active");
      // The secret must never leak into the error message.
      expect(restErr.message).not.toContain("scoped-write-jwt");
      expect(restErr.message).not.toContain("sb_publishable_anon");
      return true;
    });
  });
});
