import { describe, expect, it } from "vitest";

import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";
import { SupabaseIntradayValidationStore } from "./intradayValidationStore.js";
import type { IntradayValidationRecord } from "../../intraday-validation/types.js";

// intraday-validation feature: Supabase adapter round-trip + fail-safe reads.

const CONFIG: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

function record(pair: IntradayValidationRecord["pair"]): IntradayValidationRecord {
  return {
    decisionDate: "2026-11-06",
    pair,
    originalDirection: "UP",
    originalConfidence: 58,
    validationTimestamp: "2026-11-06T08:00:00.000Z",
    barOpenUtc: "2026-11-06T04:00:00.000Z",
    candle: { open: 1.0, high: 1.1, low: 0.99, currentPrice: 1.08 },
    features: {
      range: 0.11,
      body: 0.08,
      bodyDirection: "UP",
      bodyToRange: 0.08 / 0.11,
      upperWick: 0.02,
      lowerWick: 0.01,
      pricePositionInRange: 0.8,
    },
    result: { state: "SUPPORTS", confidenceDelta: 5, currentConfidence: 63, reason: "ok" },
  };
}

/** A PostgREST stub: POST upsert stores rows; GET serves them with a bounded Content-Range. */
function makeStub(): typeof fetch {
  const rows: Record<string, unknown>[] = [];
  return ((input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (method === "POST") {
      const bodyText = typeof init?.body === "string" ? init.body : "[]";
      const posted = JSON.parse(bodyText) as Record<string, unknown>[];
      for (const p of posted) {
        const idx = rows.findIndex(
          (r) => r.decision_date === p.decision_date && r.pair === p.pair,
        );
        if (idx >= 0) rows[idx] = p;
        else rows.push(p);
      }
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    // GET select: honour a decision_date=eq.<d> filter if present.
    const m = /decision_date=eq\.([^&]*)/.exec(url);
    const date = m ? decodeURIComponent(m[1] ?? "") : undefined;
    const out = date === undefined ? rows : rows.filter((r) => r.decision_date === date);
    const last = out.length === 0 ? 0 : out.length - 1;
    return Promise.resolve(
      new Response(JSON.stringify(out), {
        status: 200,
        headers: { "Content-Type": "application/json", "Content-Range": `0-${last}/${out.length}` },
      }),
    );
  }) as unknown as typeof fetch;
}

describe("SupabaseIntradayValidationStore", () => {
  it("round-trips a record through upsert + getByDecisionDate", async () => {
    const store = new SupabaseIntradayValidationStore(new SupabaseRestClient(CONFIG, makeStub()));
    await store.upsert([record("EURUSD")]);
    const rows = await store.getByDecisionDate("2026-11-06");
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.pair).toBe("EURUSD");
    expect(r.originalConfidence).toBe(58);
    expect(r.result.state).toBe("SUPPORTS");
    expect(r.result.confidenceDelta).toBe(5);
    expect(r.candle.currentPrice).toBe(1.08);
    expect(r.features.bodyDirection).toBe("UP");
  });

  it("degrades to [] fail-safe when the table read errors (torn deploy)", async () => {
    const errorStub = (() =>
      Promise.resolve(new Response("relation does not exist", { status: 404 }))) as unknown as typeof fetch;
    const warnings: string[] = [];
    const store = new SupabaseIntradayValidationStore(new SupabaseRestClient(CONFIG, errorStub), {
      warn: (m) => warnings.push(m),
    });
    const rows = await store.getByDecisionDate("2026-11-06");
    expect(rows).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).not.toContain("scoped-write-jwt");
  });
});
