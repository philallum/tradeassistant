import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addTradingDays,
  assertPastOnly,
  compareTradingDates,
  formatTradingDate,
  isMatured,
  maturedPreDateOnly,
} from "./index.js";
import type { Analogue, Candle, TradingDate } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 2: Look-ahead guard excludes future candles and immature outcomes
//
// For all candle sets and Decision_Dates, the guarded feature/retrieval input contains
// no candle dated at or after the Decision_Date, and for all forward outcomes and
// evaluation dates, an outcome is counted only when its full Horizon window has
// closed as of the evaluation date.
//
// Validates: Requirements 4.1, 4.2, 4.4, 4.5, 7.5.

const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const;

/**
 * Generates a valid TradingDate string ('YYYY-MM-DD') within a 20-year span.
 */
const tradingDateArb: fc.Arbitrary<TradingDate> = fc
  .integer({ min: 946684800000, max: 1893456000000 }) // 2000-01-01 to 2030-01-01
  .map((ms) => {
    const d = new Date(ms);
    return formatTradingDate(d);
  });

/**
 * Generates a valid OHLC Candle.
 */
const candleArb: fc.Arbitrary<Candle> = fc
  .tuple(
    fc.constantFrom(...PAIRS),
    tradingDateArb,
    fc.double({ min: 0.5, max: 200.0, noNaN: true }),
    fc.double({ min: 0.001, max: 5.0, noNaN: true }),
  )
  .map(([asset, date, base, spread]) => ({
    asset,
    date,
    open: base,
    high: base + spread,
    low: Math.max(0.0001, base - spread),
    close: base + spread * 0.2,
    source: "feed-test",
  }));

const horizonArb = fc.constantFrom<1 | 2 | 3>(1, 2, 3);

describe("Property 2: Look-ahead guard date-boundary and maturity safety", () => {
  it("assertPastOnly passes IFF every candle in the set is strictly before the decision date", () => {
    fc.assert(
      fc.property(
        fc.array(candleArb, { maxLength: 30 }),
        tradingDateArb,
        (candles, decisionDate) => {
          const result = assertPastOnly(candles, decisionDate);

          // Ground truth: does EVERY candle strictly precede the decisionDate?
          const allStrictlyPast = candles.every(
            (c) => compareTradingDates(c.date, decisionDate) < 0,
          );

          expect(result.ok).toBe(allStrictlyPast);

          if (result.ok) {
            // Guarded output must contain NO candle dated on or after decisionDate
            expect(
              result.value.every(
                (c) => compareTradingDates(c.date, decisionDate) < 0,
              ),
            ).toBe(true);
            expect(result.value).toHaveLength(candles.length);
          } else {
            // Violation result must be typed and contain only the violating candles
            expect(result.error.reason).toBe("look_ahead_violation");
            expect(result.error.decisionDate).toBe(decisionDate);
            expect(result.error.violatingCandles.length).toBeGreaterThan(0);
            expect(
              result.error.violatingCandles.every(
                (c) => compareTradingDates(c.date, decisionDate) >= 0,
              ),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("isMatured returns true IFF the full horizon window has closed before evalDate", () => {
    fc.assert(
      fc.property(
        tradingDateArb,
        horizonArb,
        tradingDateArb,
        (outcomeStart, horizon, evalDate) => {
          const matured = isMatured(outcomeStart, horizon, evalDate);

          // Full horizon window closing requires:
          // 1. evalDate strictly after outcomeStart
          // 2. The horizon target close date is strictly before evalDate
          const isBeforeEval = compareTradingDates(outcomeStart, evalDate) < 0;
          const targetCloseDate = addTradingDays(outcomeStart, horizon);
          const expectedMatured =
            isBeforeEval && compareTradingDates(targetCloseDate, evalDate) < 0;

          expect(matured).toBe(expectedMatured);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("maturedPreDateOnly admits an analogue IFF it is strictly pre-date AND matured as of evalDate", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom(...PAIRS),
            tradingDateArb,
            horizonArb,
            fc.string({ minLength: 1, maxLength: 8 }),
          ),
          { maxLength: 40 },
        ),
        tradingDateArb,
        tradingDateArb,
        (rawAnalogues, decisionDate, evalDate) => {
          const analogues: Analogue[] = rawAnalogues.map(
            ([asset, date, horizon, id]) => ({
              asset,
              decisionDate: date,
              horizon,
              id,
            }),
          );

          const filtered = maturedPreDateOnly(analogues, decisionDate, evalDate);

          for (const analogue of filtered) {
            const date = analogue.decisionDate!;
            // Must be strictly pre-decision date
            expect(compareTradingDates(date, decisionDate)).toBeLessThan(0);
            // Must be matured as of evalDate
            expect(isMatured(date, analogue.horizon ?? 1, evalDate)).toBe(true);
          }

          // Check that every excluded analogue violated at least one condition
          const keptIds = new Set(filtered.map((a) => a.id));
          for (const analogue of analogues) {
            if (!keptIds.has(analogue.id)) {
              const date = analogue.decisionDate!;
              const isPreDate = compareTradingDates(date, decisionDate) < 0;
              const isMature = isMatured(date, analogue.horizon ?? 1, evalDate);
              expect(isPreDate && isMature).toBe(false);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
