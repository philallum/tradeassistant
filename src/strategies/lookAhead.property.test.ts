// Feature: multi-strategy-confluence-engine, Property 3: Look-ahead candles are rejected
// Feature: multi-strategy-confluence-engine, Property 4: Future candles never change a strategy's output
//
// Every strategy runs `prepareCandles` first, and that step enforces look-ahead
// safety before any computation (Requirements 6.1, 6.2, 6.9). These two
// properties pin that contract from the outside, against all four built-in
// strategies imported from the barrel:
//
//   - Property 3 (Requirements 6.1, 6.2, 6.9, 2.1): for any candle series and a
//     Decision_Date `D`, if at least one candle is dated on or after `D`, every
//     strategy returns a `look_ahead_violation` error and no signal, the input
//     array is unchanged, and this holds even when a candle is BOTH non-finite
//     AND at/after `D` — the look-ahead violation still wins over the
//     finiteness check (Requirement 6.9).
//   - Property 4 (Requirements 6.3, 13.4): for any past-only series `past` and
//     any set of `future` candles dated on or after `D`, evaluating the series
//     obtained by removing the at/after candles from `past ++ future` (i.e.
//     `past`) is deeply equal to evaluating `past` alone, and evaluating
//     `past ++ future` directly is rejected rather than computed — a future
//     candle can never leak into a decision.
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.9, 2.1, 13.4

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createTrendStrategy,
  createBreakoutStrategy,
  createRangeStrategy,
  createReversalStrategy,
} from "./index.js";
import type { Strategy, StrategyResult } from "./index.js";
import type { Candle, TradingDate } from "../guard/types.js";
import { compareTradingDates } from "../guard/tradingDate.js";
import {
  arbCandleSeries,
  arbDecisionDateAfter,
  arbFutureCandles,
} from "./testing/arbitraries.js";

const NUM_RUNS = 200;

// The four built-in strategies, each built with its default config. The
// factories take no candles, so building here is pure and cheap. Every factory
// should succeed on its defaults; a failure is a real defect, so we assert it.
interface NamedStrategy {
  readonly name: string;
  readonly strategy: Strategy<unknown>;
}

function buildAll(): NamedStrategy[] {
  const factories = [
    ["trend", createTrendStrategy],
    ["breakout", createBreakoutStrategy],
    ["range", createRangeStrategy],
    ["reversal", createReversalStrategy],
  ] as const;
  return factories.map(([name, factory]) => {
    const built = factory();
    expect(built.ok).toBe(true);
    if (!built.ok) {
      throw new Error(`default ${name} config should be valid`);
    }
    return { name, strategy: built.value };
  });
}

const STRATEGIES = buildAll();

/** A fixed, deterministic weekday Decision_Date used by the wholly-future cases. */
const FIXED_DECISION_DATE = "2018-06-15" as TradingDate;

/** True when `result` is a typed look-ahead violation. */
function isLookAhead(result: StrategyResult): boolean {
  return !result.ok && result.error.reason === "look_ahead_violation";
}

/** A structural deep clone of a candle array, for input-immutability checks. */
function clone(candles: readonly Candle[]): Candle[] {
  return candles.map((candle) => ({ ...candle }));
}

// ---------------------------------------------------------------------------
// Property 3: Look-ahead candles are rejected
// ---------------------------------------------------------------------------

describe("Property 3: Look-ahead candles are rejected", () => {
  // A series whose candles ALL sit at or after the Decision_Date. Every
  // strategy must reject it with a look_ahead_violation and leave the input
  // array deeply unchanged (Requirements 6.1, 6.2, 2.1).
  it("every strategy rejects a wholly at/after-the-decision-date series and leaves the input unchanged", () => {
    fc.assert(
      fc.property(
        arbFutureCandles(FIXED_DECISION_DATE, { min: 1, max: 60 }),
        (candles) => {
          // Sanity: the generator really placed every candle at/after the date.
          for (const candle of candles) {
            expect(
              compareTradingDates(candle.date, FIXED_DECISION_DATE),
            ).toBeGreaterThanOrEqual(0);
          }

          const before = clone(candles);
          for (const { strategy } of STRATEGIES) {
            const result = strategy.evaluate(candles, FIXED_DECISION_DATE);
            expect(isLookAhead(result)).toBe(true);
          }
          // Requirement 2.1 / Property 3: the input array is unchanged.
          expect(candles).toEqual(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // A valid past-only series with at least one offending candle appended
  // (dated at/after the Decision_Date). The presence of ANY such candle forces
  // a look_ahead_violation for every strategy (Requirements 6.1, 6.2).
  it("one at/after-the-decision-date candle anywhere forces rejection", () => {
    fc.assert(
      fc.property(
        arbCandleSeries({ min: 1, max: 60 })
          .chain((past) =>
            arbDecisionDateAfter(past).map((decisionDate) => ({
              past,
              decisionDate,
            })),
          )
          .chain(({ past, decisionDate }) =>
            arbFutureCandles(decisionDate, { min: 1, max: 10 }).map(
              (future) => ({ past, decisionDate, future }),
            ),
          ),
        ({ past, decisionDate, future }) => {
          const mixed = [...past, ...future];
          const before = clone(mixed);
          for (const { strategy } of STRATEGIES) {
            const result = strategy.evaluate(mixed, decisionDate);
            expect(isLookAhead(result)).toBe(true);
          }
          expect(mixed).toEqual(before);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // A candle that is BOTH non-finite AND dated at/after the Decision_Date. The
  // look-ahead check runs before the finiteness check, so the violation still
  // wins and the error is look_ahead_violation, never invalid_candle
  // (Requirement 6.9).
  it("look-ahead wins over a non-finite OHLC field on the same candle", () => {
    fc.assert(
      fc.property(
        arbFutureCandles(FIXED_DECISION_DATE, { min: 1, max: 40 }).chain(
          (future) =>
            fc
              .record({
                corruptIndex: fc.nat({ max: future.length - 1 }),
                field: fc.constantFrom<"open" | "high" | "low" | "close">(
                  "open",
                  "high",
                  "low",
                  "close",
                ),
                badValue: fc.constantFrom(
                  Number.NaN,
                  Number.POSITIVE_INFINITY,
                  Number.NEGATIVE_INFINITY,
                ),
              })
              .map(({ corruptIndex, field, badValue }) =>
                future.map((candle, index) =>
                  index === corruptIndex
                    ? { ...candle, [field]: badValue }
                    : candle,
                ),
              ),
        ),
        (candles) => {
          for (const { strategy } of STRATEGIES) {
            const result = strategy.evaluate(candles, FIXED_DECISION_DATE);
            // The violation wins over finiteness: reason must be look_ahead,
            // not invalid_candle (Requirement 6.9).
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.reason).toBe("look_ahead_violation");
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Future candles never change a strategy's output
// ---------------------------------------------------------------------------

describe("Property 4: Future candles never change a strategy's output", () => {
  it("removing at/after-the-decision-date candles reproduces the past-only output, and the mixed series is rejected", () => {
    fc.assert(
      fc.property(
        arbCandleSeries({ min: 0, max: 80 })
          .chain((past) =>
            arbDecisionDateAfter(past).map((decisionDate) => ({
              past,
              decisionDate,
            })),
          )
          .chain(({ past, decisionDate }) =>
            arbFutureCandles(decisionDate, { min: 1, max: 20 }).map(
              (future) => ({ past, decisionDate, future }),
            ),
          ),
        ({ past, decisionDate, future }) => {
          const mixed = [...past, ...future];

          // Removing every candle dated on or after D from `past ++ future`
          // yields exactly `past` (the generators keep `past` strictly before
          // D and `future` on or after it).
          const filtered = mixed.filter(
            (candle) => compareTradingDates(candle.date, decisionDate) < 0,
          );
          expect(filtered).toEqual(past);

          for (const { strategy } of STRATEGIES) {
            // (a) Evaluating the filtered series is deeply equal to evaluating
            //     `past` alone — the future candles leave no trace once removed
            //     (Requirement 6.3).
            const onFiltered = strategy.evaluate(clone(filtered), decisionDate);
            const onPast = strategy.evaluate(clone(past), decisionDate);
            expect(onFiltered).toEqual(onPast);

            // (b) Evaluating `past ++ future` DIRECTLY is rejected rather than
            //     computed — a future candle is never silently dropped
            //     (Requirements 6.3, 13.4).
            const onMixed = strategy.evaluate(clone(mixed), decisionDate);
            expect(isLookAhead(onMixed)).toBe(true);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
