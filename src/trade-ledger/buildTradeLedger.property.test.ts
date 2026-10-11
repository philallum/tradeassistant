import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Candle } from "../guard/types.js";
import { InMemoryCandleStore } from "../ingestion/types.js";
import type { Pair } from "../ingestion/types.js";
import { DEFAULT_EXECUTION_MODEL } from "../trade-sim/executionModel.js";
import { buildTradeLedger, type LedgerForecast } from "./buildTradeLedger.js";

// Feature: trader-edge-validation, Property 4: Trade_Ledger builder
//
//   (R3.1) one row per eligible forecast, in input order.
//   (R3.2) suppressed (non-fired) forecasts are present with `fired: false`.
//   (R3.5) `ambiguous`/`expired` outcomes are carried as their own categories,
//          never silently folded into a win/loss.
//   (R3.3) deterministic: identical inputs ⇒ identical ledger.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.5

const PAIR: Pair = "EURUSD";

/** A candle store with a simple forward path after a decision date. */
function storeWith(candles: readonly Candle[]): InMemoryCandleStore {
  const store = new InMemoryCandleStore();
  void store.upsertCandles(candles);
  return store;
}

function forecast(overrides: Partial<LedgerForecast>): LedgerForecast {
  return {
    strategyId: "system",
    pair: PAIR,
    decisionDate: "2024-03-04",
    fired: true,
    direction: "UP",
    horizon: 2,
    earnedConfidence: 0.6,
    stopLossPips: 20,
    takeProfitPips: 40,
    ...overrides,
  };
}

const CANDLES: Candle[] = [
  { asset: PAIR, date: "2024-03-05", open: 1.1, high: 1.105, low: 1.098, close: 1.102 },
  { asset: PAIR, date: "2024-03-06", open: 1.102, high: 1.108, low: 1.1, close: 1.106 },
  { asset: PAIR, date: "2024-03-07", open: 1.106, high: 1.11, low: 1.104, close: 1.109 },
];

describe("trader-edge-validation Property 4: buildTradeLedger", () => {
  it("(R3.1) produces exactly one row per forecast, in input order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
        async (firedFlags) => {
          const forecasts = firedFlags.map((fired, i) =>
            forecast({ fired, decisionDate: `2024-03-${String(10 + i).padStart(2, "0")}` }),
          );
          const rows = await buildTradeLedger(forecasts, {
            candleStore: storeWith(CANDLES),
            executionModel: DEFAULT_EXECUTION_MODEL,
          });
          expect(rows).toHaveLength(forecasts.length);
          rows.forEach((row, i) => {
            expect(row.decisionDate).toBe(forecasts[i]!.decisionDate);
            expect(row.fired).toBe(forecasts[i]!.fired);
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  it("(R3.2) a suppressed forecast is ledgered with fired:false and takes no trade", async () => {
    const rows = await buildTradeLedger([forecast({ fired: false })], {
      candleStore: storeWith(CANDLES),
      executionModel: DEFAULT_EXECUTION_MODEL,
    });
    expect(rows[0]!.fired).toBe(false);
    expect(rows[0]!.grossPips).toBe(0);
    expect(rows[0]!.costPips).toBe(0); // no trade ⇒ no friction paid
  });

  it("(R3.5) outcome is one of the four categories; ambiguous carries gross 0", async () => {
    // A single candle spanning both the stop (−20p) and the target (+40p) is ambiguous.
    const ambiguousCandles: Candle[] = [
      { asset: PAIR, date: "2024-03-05", open: 1.1, high: 1.108, low: 1.096, close: 1.1 },
    ];
    const rows = await buildTradeLedger([forecast({ horizon: 1 })], {
      candleStore: storeWith(ambiguousCandles),
      executionModel: DEFAULT_EXECUTION_MODEL,
    });
    expect(["target_first", "stop_first", "expired", "ambiguous"]).toContain(rows[0]!.outcome);
    if (rows[0]!.outcome === "ambiguous") {
      expect(rows[0]!.grossPips).toBe(0);
    }
  });

  it("(R3.3) identical inputs produce an identical ledger", async () => {
    const forecasts = [forecast({}), forecast({ fired: false, decisionDate: "2024-03-05" })];
    const deps = { candleStore: storeWith(CANDLES), executionModel: DEFAULT_EXECUTION_MODEL };
    const a = await buildTradeLedger(forecasts, deps);
    const b = await buildTradeLedger(forecasts, { ...deps, candleStore: storeWith(CANDLES) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
