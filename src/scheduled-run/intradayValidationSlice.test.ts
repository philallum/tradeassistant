import { describe, expect, it } from "vitest";

import { InMemoryIntradayValidationStore } from "../intraday-validation/store.js";
import type { IntradayValidationRecord } from "../intraday-validation/types.js";
import type { IntradayValidationStore } from "../intraday-validation/store.js";
import { buildIntradayValidationSlice } from "./intradayValidationSlice.js";
import { EMPTY_INTRADAY_VALIDATION } from "./snapshot.js";

// Task 7 (backend): the v8 slice builder. Build from store rows; empty on
// absence and on any failure.

function record(
  pair: IntradayValidationRecord["pair"],
  observedAt: string,
): IntradayValidationRecord {
  return {
    decisionDate: "2026-11-06",
    pair,
    originalDirection: "UP",
    originalConfidence: 58,
    validationTimestamp: observedAt,
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

describe("buildIntradayValidationSlice", () => {
  it("maps store rows to the v8 wire slice and reports the latest observedAt", async () => {
    const store = new InMemoryIntradayValidationStore();
    await store.upsert([
      record("EURUSD", "2026-11-06T08:00:00.000Z"),
      record("GBPUSD", "2026-11-06T08:00:05.000Z"),
    ]);
    const slice = await buildIntradayValidationSlice({ decisionDate: "2026-11-06", store });
    expect(slice.validationLabel).toBe("unvalidated");
    expect(slice.observedAt).toBe("2026-11-06T08:00:05.000Z");
    expect(slice.rows.map((r) => r.pair)).toEqual(["EURUSD", "GBPUSD"]);
    expect(slice.rows[0]?.currentConfidence).toBe(63);
    expect(slice.rows[0]?.h4.currentPrice).toBe(1.08);
  });

  it("returns the empty slice when there are no records for the date", async () => {
    const store = new InMemoryIntradayValidationStore();
    const slice = await buildIntradayValidationSlice({ decisionDate: "2026-11-06", store });
    expect(slice).toEqual(EMPTY_INTRADAY_VALIDATION);
  });

  it("returns the empty slice (never throws) when the store read fails", async () => {
    const throwing: IntradayValidationStore = {
      upsert: () => Promise.resolve(),
      getByDecisionDate: () => Promise.reject(new Error("read failed")),
      getAll: () => Promise.resolve([]),
    };
    const warnings: unknown[] = [];
    const slice = await buildIntradayValidationSlice({
      decisionDate: "2026-11-06",
      store: throwing,
      warn: (_s, e) => warnings.push(e),
    });
    expect(slice).toEqual(EMPTY_INTRADAY_VALIDATION);
    expect(warnings).toHaveLength(1);
  });
});
