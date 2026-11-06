import { describe, expect, it } from "vitest";

import { InMemoryIntradayValidationStore } from "./store.js";
import type { IntradayValidationRecord } from "./types.js";

// Task 5: in-memory store round-trip (the Supabase adapter's fail-safe behaviour
// is covered by its own test).

function record(
  decisionDate: string,
  pair: IntradayValidationRecord["pair"],
): IntradayValidationRecord {
  return {
    decisionDate,
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

describe("InMemoryIntradayValidationStore", () => {
  it("upserts and reads back by decision date, sorted by pair", async () => {
    const store = new InMemoryIntradayValidationStore();
    await store.upsert([record("2026-11-06", "GBPUSD"), record("2026-11-06", "EURUSD")]);
    const rows = await store.getByDecisionDate("2026-11-06");
    expect(rows.map((r) => r.pair)).toEqual(["EURUSD", "GBPUSD"]);
  });

  it("is idempotent on (decisionDate, pair) — a re-upsert overwrites", async () => {
    const store = new InMemoryIntradayValidationStore();
    await store.upsert([record("2026-11-06", "EURUSD")]);
    const updated = { ...record("2026-11-06", "EURUSD"), originalConfidence: 70 };
    await store.upsert([updated]);
    const rows = await store.getByDecisionDate("2026-11-06");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.originalConfidence).toBe(70);
  });

  it("filters getAll by an optional window", async () => {
    const store = new InMemoryIntradayValidationStore();
    await store.upsert([record("2026-11-05", "EURUSD"), record("2026-11-06", "EURUSD")]);
    const all = await store.getAll();
    expect(all).toHaveLength(2);
    const windowed = await store.getAll("2026-11-06", "2026-11-06");
    expect(windowed.map((r) => r.decisionDate)).toEqual(["2026-11-06"]);
  });
});
