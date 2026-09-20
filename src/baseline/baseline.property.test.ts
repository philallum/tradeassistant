import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { baseline, predictBaseline } from "./baseline.js";
import { weeklyTrendSign } from "../encoder/patternEncoder.js";
import { PAIRS } from "../ingestion/types.js";
import type { Candle } from "../guard/types.js";

// Feature: fx-daily-pattern-assistant, Property 15: For all Decision_Dates and Pairs, the Weekly_Trend_Follow baseline's predicted direction equals the Weekly_Trend_Sign, defined as the 5-trading-day rolling ROC: UP when Close_T - Close_{T-5} >= 0, otherwise DOWN.
//
// Validates: Requirement 11.1.

const DAY_MS = 86_400_000;

/**
 * Generates a strictly-pre-Decision_Date candle window for a random pair, plus
 * the Decision_Date itself. Every candle is dated before the Decision_Date so
 * the Look-Ahead Guard admits the whole window. Windows range from a single
 * candle up to well beyond the 5-day rolling lookback so the T-5 boundary is
 * exercised on both sides.
 */
const scenarioArb: fc.Arbitrary<{
  window: Candle[];
  decisionDate: string;
  pair: string;
}> = fc
  .tuple(
    fc.constantFrom(...PAIRS),
    // Bounded day offset for the window start keeps every generated Date valid.
    fc.integer({ min: 0, max: 9000 }),
    // Per-step close deltas (either sign, including zero) drive the ROC.
    fc.array(fc.double({ min: -0.05, max: 0.05, noNaN: true }), {
      minLength: 1,
      maxLength: 30,
    }),
    // Starting close level.
    fc.double({ min: 0.1, max: 200.0, noNaN: true }),
  )
  .map(([pair, startOffset, steps, basePrice]) => {
    const start = new Date("2000-01-01").getTime() + startOffset * DAY_MS;
    const window: Candle[] = [];
    let current = basePrice;

    for (let i = 0; i < steps.length; i++) {
      const dt = new Date(start + i * DAY_MS);
      const date = dt.toISOString().slice(0, 10);
      current = Math.max(0.01, current + steps[i]!);
      window.push({
        asset: pair,
        date,
        open: current,
        high: current + 0.005,
        low: Math.max(0.001, current - 0.005),
        close: current,
        source: "prop15",
      });
    }

    // Decision_Date strictly after every candle in the window.
    const decisionDate = new Date(start + steps.length * DAY_MS)
      .toISOString()
      .slice(0, 10);

    return { window, decisionDate, pair };
  });

describe("Property 15: baseline equals Weekly_Trend_Sign (5-day rolling ROC)", () => {
  it("baseline.predict equals weeklyTrendSign and equals sign(Close_T - Close_{T-5})", () => {
    fc.assert(
      fc.property(scenarioArb, ({ window, decisionDate }) => {
        const predicted = baseline.predict(window, decisionDate);

        // 1. The baseline must delegate to the encoder's single source of truth.
        expect(predicted).toBe(weeklyTrendSign(window, decisionDate));
        expect(predictBaseline(window, decisionDate)).toBe(predicted);

        // 2. The prediction is always UP or DOWN, never FLAT.
        expect(["UP", "DOWN"]).toContain(predicted);

        // 3. Independently verify the 5-trading-day rolling ROC sign:
        //    UP when Close_T - Close_{T-5} >= 0, otherwise DOWN. With fewer than
        //    6 candles the earliest available close is the T-5 reference (the
        //    documented lookback clamp). The tie-break is scale-invariant: a
        //    difference that is negligible relative to the price scale (pure
        //    floating-point noise) counts as a tie resolved to UP, so this oracle
        //    matches the documented scale-invariant semantics (Property 9 /
        //    Requirement 8.3) rather than the raw sign of a ~1e-17 fp residual.
        const sorted = [...window].sort((a, b) =>
          a.date.localeCompare(b.date),
        );
        const n = sorted.length;
        const closeT = sorted[n - 1]!.close;
        const closeTminus5 = sorted[Math.max(0, n - 6)]!.close;
        const diff = closeT - closeTminus5;
        const scale = Math.max(Math.abs(closeT), Math.abs(closeTminus5), 1e-12);
        const expected =
          diff < 0 && Math.abs(diff) / scale >= 1e-9 ? "DOWN" : "UP";

        expect(predicted).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });
});
