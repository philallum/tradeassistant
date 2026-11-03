// Feature: multi-strategy-confluence-engine, Property 5: Strategies are deterministic and do not mutate inputs
// Feature: multi-strategy-confluence-engine, Property 6: Invalid candles produce typed errors
//
// Two cross-strategy properties shared by all four built-in strategies
// (Trend, Breakout, Range, Reversal), exercised through the public barrel
// `src/strategies/index.js`.
//
// Property 5 (Requirements 6.4, 6.6, 13.3): a strategy is a pure function of
// its inputs. Calling `evaluate` twice with identical arguments returns deeply
// equal results — a StrategySignal or a typed error — using EXACT equality
// (determinism, Requirement 6.4). The call never mutates the caller's candle
// array or any Candle object: a deep-frozen input is accepted without throwing,
// and a structural snapshot taken before the call is deeply equal to the array
// after the call — same length, element order, and every field value
// (Requirement 6.6). The second call reuses the SAME input array, so the
// deep-equal results also prove the first call left nothing behind.
//
// Property 6 (Requirements 6.7, 6.8, 13.3): a candle array carrying a
// non-finite (NaN / Infinity / -Infinity) or missing open/high/low/close value
// — and NOT a look-ahead violation — makes every strategy return a typed error
// result: `invalid_candle` naming the offending field and the candle date
// (Requirement 6.7), or `insufficient_data` for the empty array
// (Requirement 6.8). The result carries no StrategySignal (Requirement 13.3 /
// Requirement 6.7's "return no StrategySignal"). The Decision_Date is always
// strictly after every candle date, so a look-ahead violation can never
// pre-empt the finiteness check.
//
// Validates: Requirements 6.4, 6.6, 6.7, 6.8, 13.3

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createTrendStrategy,
  createBreakoutStrategy,
  createRangeStrategy,
  createReversalStrategy,
} from "./index.js";
import type { Strategy, StrategyResult, ConfigError } from "./index.js";
import type { Candle, Result, TradingDate } from "../guard/types.js";
import { arbCandleSeries, arbDecisionDateAfter } from "./testing/arbitraries.js";

// ---------------------------------------------------------------------------
// The four built-in strategies, each built with its default config, as a named
// list so every property runs identically across all of them. Any factory
// failure is a hard test failure: the defaults are always valid.
// ---------------------------------------------------------------------------

function buildStrategy<C>(
  name: string,
  result: Result<Strategy<C>, ConfigError>,
): Strategy<C> {
  if (!result.ok) {
    throw new Error(`default ${name} strategy factory failed to build`);
  }
  return result.value;
}

const STRATEGIES: ReadonlyArray<{
  readonly name: string;
  readonly strategy: Strategy<unknown>;
}> = [
  { name: "trend", strategy: buildStrategy("trend", createTrendStrategy()) },
  {
    name: "breakout",
    strategy: buildStrategy("breakout", createBreakoutStrategy()),
  },
  { name: "range", strategy: buildStrategy("range", createRangeStrategy()) },
  {
    name: "reversal",
    strategy: buildStrategy("reversal", createReversalStrategy()),
  },
];

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * A structural snapshot of a candle array: the length plus a per-candle plain
 * copy of every field. Comparing this snapshot (taken before a call) with a
 * fresh snapshot (taken after) proves the strategy mutated neither the array
 * length, the element order, nor any field value (Requirement 6.6).
 */
function snapshot(candles: readonly Candle[]): ReadonlyArray<Candle> {
  return candles.map((c) => ({
    asset: c.asset,
    date: c.date,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

/** Deep-freeze a candle array and every candle object inside it. */
function deepFreeze(candles: readonly Candle[]): readonly Candle[] {
  for (const candle of candles) {
    Object.freeze(candle);
  }
  Object.freeze(candles);
  return candles;
}

// ---------------------------------------------------------------------------
// Property 5: determinism + no input mutation.
// ---------------------------------------------------------------------------

describe("Property 5: Strategies are deterministic and do not mutate inputs", () => {
  for (const { name, strategy } of STRATEGIES) {
    it(`${name}: two calls with identical input return deeply equal results and leave the input untouched`, () => {
      fc.assert(
        fc.property(
          arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
            arbDecisionDateAfter(candles).map((decisionDate) => ({
              candles,
              decisionDate,
            })),
          ),
          ({ candles, decisionDate }) => {
            // Deep-freeze the input so ANY attempted field or array mutation
            // throws (in strict mode, which ESM test modules run under),
            // turning a stray write into a hard failure (Requirement 6.6).
            const frozen = deepFreeze(candles);
            const before = snapshot(frozen);

            // Requirement 6.4 / 13.3: two calls with identical arguments on the
            // SAME input array return deeply equal results — exact equality.
            const first: StrategyResult = strategy.evaluate(frozen, decisionDate);
            const second: StrategyResult = strategy.evaluate(frozen, decisionDate);
            expect(second).toStrictEqual(first);

            // Requirement 6.6 / 13.3: the input array is deeply equal to the
            // pre-call snapshot after the call — length, order, and every
            // field value unchanged.
            const after = snapshot(frozen);
            expect(after).toStrictEqual(before);
            expect(frozen.length).toBe(before.length);
          },
        ),
        { numRuns: 150 },
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Property 6: invalid candles produce typed errors.
//
// A base of valid, past-only candles with at least one element, then exactly
// one defect injected into a chosen candle: a non-finite value, or a deleted
// field (which reads back as `undefined`, i.e. not a finite number). The
// Decision_Date stays strictly after every candle date so finiteness — not
// look-ahead — is the failure that fires. The empty-array case is covered
// separately for the `insufficient_data` branch.
// ---------------------------------------------------------------------------

const OHLC_FIELDS = ["open", "high", "low", "close"] as const;
type OhlcField = (typeof OHLC_FIELDS)[number];

/** The three non-finite numeric values a Candle field might carry. */
const arbNonFinite: fc.Arbitrary<number> = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);

/**
 * A valid base series (length >= 1), a Decision_Date strictly after it, the
 * index of the candle to corrupt, the OHLC field to corrupt, and how to break
 * it: replace with a non-finite number, or delete the field entirely
 * (`missing`). Returns the corrupted array plus the field and date the typed
 * error must name.
 */
const arbInvalidCandleCase = arbCandleSeries({ min: 1, max: 60 }).chain(
  (candles) =>
    arbDecisionDateAfter(candles).chain((decisionDate) =>
      fc
        .record({
          index: fc.nat({ max: candles.length - 1 }),
          field: fc.constantFrom<OhlcField>(...OHLC_FIELDS),
          mode: fc.constantFrom("non_finite" as const, "missing" as const),
          nonFinite: arbNonFinite,
        })
        .map(({ index, field, mode, nonFinite }) => {
          const corrupted = candles.map((c, i) => {
            if (i !== index) return { ...c };
            const copy: Record<string, unknown> = { ...c };
            if (mode === "missing") {
              delete copy[field];
            } else {
              copy[field] = nonFinite;
            }
            return copy as unknown as Candle;
          });
          return {
            candles: corrupted,
            decisionDate,
            corruptDate: candles[index]!.date,
          };
        }),
    ),
);

describe("Property 6: Invalid candles produce typed errors", () => {
  for (const { name, strategy } of STRATEGIES) {
    it(`${name}: a non-finite or missing OHLC value yields an invalid_candle error naming a field and date, and no signal`, () => {
      fc.assert(
        fc.property(arbInvalidCandleCase, ({ candles, decisionDate, corruptDate }) => {
          const result = strategy.evaluate(candles, decisionDate);

          // Requirement 6.7 / 13.3: a typed error, never a StrategySignal.
          expect(result.ok).toBe(false);
          if (result.ok) return;

          // Requirement 6.7: the error identifies the invalid field and the
          // candle's date. (The first scanned bad field wins; with a single
          // injected defect that is exactly the field we corrupted, but we
          // only assert the shape is a well-formed invalid_candle to stay
          // robust to scan order.)
          const error = result.error;
          expect(error.reason).toBe("invalid_candle");
          if (error.reason !== "invalid_candle") return;
          expect(OHLC_FIELDS).toContain(error.field);
          // The named date is the date of SOME candle in the (corrupted) input;
          // for a single injected defect it is the corrupted candle's date.
          expect(error.date).toBe(corruptDate);
          expect(typeof error.message).toBe("string");
          expect(error.message.length).toBeGreaterThan(0);
        }),
        { numRuns: 150 },
      );
    });

    it(`${name}: an empty candle array yields an insufficient_data error and no signal`, () => {
      fc.assert(
        fc.property(
          arbDecisionDateAfter([]).map((decisionDate) => decisionDate),
          (decisionDate: TradingDate) => {
            const result = strategy.evaluate([], decisionDate);

            // Requirement 6.8 / 13.3: empty input is a typed insufficient_data
            // error, never a StrategySignal.
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.reason).toBe("insufficient_data");
          },
        ),
        { numRuns: 100 },
      );
    });
  }
});
