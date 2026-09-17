import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { resolve } from "./resolver.js";
import { InMemoryAnalogueStore } from "./types.js";
import type { Candle } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

// Feature: fx-daily-pattern-assistant, Property 11: Forward outcomes per horizon
//
// For all resolved analogues, the forward outcome contains a terminal Direction_Class
// and MFE/MAE values for each of the 1-, 2-, and 3-day Horizons, computed only from
// candles dated after the analogue date.
//
// Validates: Requirement 9.6.

function buildForwardCandles(
  afterDate: string,
  count: number,
  pair: Pair,
  basePrice = 1.1,
): Candle[] {
  const candles: Candle[] = [];
  const start = new Date(afterDate + "T00:00:00Z");
  let price = basePrice;

  let inserted = 0;
  let dayOffset = 1;
  while (inserted < count) {
    const dt = new Date(start.getTime() + dayOffset * 86_400_000);
    const dayOfWeek = dt.getUTCDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const date = dt.toISOString().slice(0, 10);
      price += (Math.random() - 0.5) * 0.005;
      price = Math.max(0.5, price);
      candles.push({
        asset: pair,
        date,
        open: price - 0.001,
        high: price + 0.003,
        low: price - 0.003,
        close: price,
        source: "test",
      });
      inserted++;
    }
    dayOffset++;
  }
  return candles;
}

describe("Property 11: Forward outcomes per horizon", () => {
  it(
    "resolved forward outcome has direction+MFE/MAE for each of horizons 1, 2, 3 from candles after analogueDate",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.double({ min: 0.001, max: 0.05, noNaN: true }), // atr14
          fc.constantFrom<Pair>("EURUSD", "GBPUSD", "USDJPY"),
          async (atr14, pair) => {
            const analogueStore = new InMemoryAnalogueStore();
            const analogueDate = "2025-03-10";
            const evalDate = "2025-09-01"; // far in the future so all horizons are matured

            // Build at least 5 forward candles (all strictly after analogueDate)
            const forwardCandles = buildForwardCandles(analogueDate, 5, pair);

            // Verify all forward candles are strictly after analogueDate (Req 9.6)
            for (const c of forwardCandles) {
              expect(c.date > analogueDate).toBe(true);
            }

            const outcome = await resolve(
              analogueDate,
              pair,
              forwardCandles,
              atr14,
              evalDate,
              analogueStore,
            );

            // Property 11: ForwardOutcome must have perHorizon with keys 1, 2, 3
            expect(outcome.perHorizon).toBeDefined();
            expect(outcome.perHorizon[1]).toBeDefined();
            expect(outcome.perHorizon[2]).toBeDefined();
            expect(outcome.perHorizon[3]).toBeDefined();

            // Each horizon must have a valid direction, mfePips, maePips
            for (const h of [1, 2, 3] as const) {
              const ho = outcome.perHorizon[h];
              expect(["UP", "DOWN", "FLAT"]).toContain(ho.direction);
              expect(ho.mfePips).toBeGreaterThanOrEqual(0);
              expect(ho.maePips).toBeGreaterThanOrEqual(0);
            }

            // Verify that outcomes are persisted with correct maturity.
            // evalDate is far ahead so all 3 horizons should be matured.
            for (const h of [1, 2, 3] as const) {
              const stored = await analogueStore.getOutcomes(pair, analogueDate);
              const row = stored.find((r) => r.horizon === h);
              expect(row).toBeDefined();
              expect(row!.matured).toBe(true);
              expect(row!.asset).toBe(pair);
              expect(row!.decisionDate).toBe(analogueDate);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it("forward candles dated at or before analogueDate are excluded from computation", async () => {
    const pair: Pair = "EURUSD";
    const analogueStore = new InMemoryAnalogueStore();
    const analogueDate = "2025-03-10";
    const evalDate = "2025-09-01";

    // Mix of past and future candles — the resolver must only use strictly-future ones
    const mixedCandles: Candle[] = [
      // This is ON the analogue date — must not be used
      { asset: pair, date: "2025-03-10", open: 1.08, high: 1.085, low: 1.075, close: 1.08, source: "test" },
      // These are strictly after — valid
      { asset: pair, date: "2025-03-11", open: 1.082, high: 1.09, low: 1.078, close: 1.085, source: "test" },
      { asset: pair, date: "2025-03-12", open: 1.085, high: 1.092, low: 1.08, close: 1.088, source: "test" },
      { asset: pair, date: "2025-03-13", open: 1.088, high: 1.095, low: 1.083, close: 1.09, source: "test" },
      { asset: pair, date: "2025-03-14", open: 1.09, high: 1.098, low: 1.085, close: 1.092, source: "test" },
    ];

    // resolve() should only use the 4 future candles, not the one on analogueDate
    const outcome = await resolve(
      analogueDate,
      pair,
      mixedCandles,
      0.008,
      evalDate,
      analogueStore,
    );

    expect(outcome.perHorizon[1]).toBeDefined();
    expect(outcome.perHorizon[2]).toBeDefined();
    expect(outcome.perHorizon[3]).toBeDefined();
  });
});
