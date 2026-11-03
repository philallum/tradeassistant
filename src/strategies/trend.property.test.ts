// Feature: multi-strategy-confluence-engine, Property 8: Trend follows the EMA relation
//
// The Trend_Strategy emits UP/DOWN only when the EMA gap and the Fast_EMA slope
// agree, and scales strength by ATR_14. An INDEPENDENT naive oracle below
// re-derives the expected direction and strength straight from the acceptance
// criteria (Requirements 2.2, 2.3, 2.4, 2.5, 2.7) — it reuses only the shared
// numeric primitives (`emaSeries`, `clamp01`, `computeAtr14`) and reimplements
// the direction/strength decision from scratch, so the property checks the
// strategy against a spec rather than against itself.
//
// Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createTrendStrategy, DEFAULT_TREND_CONFIG } from "./trend.js";
import { emaSeries, clamp01, roundTo } from "./indicators.js";
import { computeAtr14 } from "../confidence/atr.js";
import { compareTradingDates } from "../guard/tradingDate.js";
import type { Candle } from "../guard/types.js";
import type { SignalDirection } from "./types.js";
import {
  arbCandleSeries,
  arbDecisionDateAfter,
} from "./testing/arbitraries.js";

// ---------------------------------------------------------------------------
// Independent oracle — a from-scratch restatement of the acceptance criteria.
//
//   - Sort candles ascending by date (mirrors prepareCandles; the generator
//     already produces ascending dates, so this is a stable no-op in practice).
//   - required = slowPeriod + slopeWindow. n < required -> FLAT, strength 0
//     (Requirement 2.9 history guard — surfaced here so the comparison holds).
//   - fast = emaSeries(closes, fastPeriod), slow = emaSeries(closes, slowPeriod).
//   - slope = fast[L] - fast[L - slopeWindow]; diff = fast[L] - slow[L].
//   - atr = computeAtr14(sorted). Unusable (0 or non-finite) -> FLAT, strength 0
//     (Requirement 2.8).
//   - diff>0 && slope>0 -> UP; diff<0 && slope<0 -> DOWN; else FLAT
//     (Requirements 2.2, 2.3, 2.4).
//   - UP/DOWN strength = clamp01(|diff|/atr); FLAT -> 0 (Requirement 2.5).
// ---------------------------------------------------------------------------

interface OracleConfig {
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly slopeWindow: number;
}

interface OracleResult {
  readonly direction: SignalDirection;
  readonly strength: number;
  /** True when history was sufficient and ATR was usable. */
  readonly usable: boolean;
  readonly fast: number;
  readonly slow: number;
  readonly slope: number;
}

function sortedAscending(candles: readonly Candle[]): Candle[] {
  return candles
    .map((candle, index) => ({ candle, index }))
    .sort((a, b) => {
      const byDate = compareTradingDates(a.candle.date, b.candle.date);
      return byDate !== 0 ? byDate : a.index - b.index;
    })
    .map((entry) => entry.candle);
}

function oracle(candles: readonly Candle[], config: OracleConfig): OracleResult {
  const sorted = sortedAscending(candles);
  const closes = sorted.map((c) => c.close);
  const n = closes.length;
  const L = n - 1;

  const flat: Omit<OracleResult, "fast" | "slow" | "slope"> = {
    direction: "FLAT",
    strength: 0,
    usable: false,
  };

  const required = config.slowPeriod + config.slopeWindow;
  if (n < required) {
    return { ...flat, fast: NaN, slow: NaN, slope: NaN };
  }

  const fastSeries = emaSeries(closes, config.fastPeriod);
  const slowSeries = emaSeries(closes, config.slowPeriod);
  const fast = fastSeries[L] as number;
  const slow = slowSeries[L] as number;
  const fastLagged = fastSeries[L - config.slopeWindow] as number;
  const slope = fast - fastLagged;
  const diff = fast - slow;

  const atr = computeAtr14(sorted);
  if (!(Number.isFinite(atr) && atr > 0)) {
    return { ...flat, fast, slow, slope };
  }

  let direction: SignalDirection = "FLAT";
  if (diff > 0 && slope > 0) direction = "UP";
  else if (diff < 0 && slope < 0) direction = "DOWN";

  const strength = direction === "FLAT" ? 0 : clamp01(Math.abs(diff) / atr);

  return { direction, strength, usable: true, fast, slow, slope };
}

/**
 * Relative-tolerance equality with an absolute fallback for the expected-0
 * case: |actual - expected| <= 1e-9 * max(1, |expected|).
 */
function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

// A small arbitrary of valid Trend configs (integers >= 1, fast < slow) so the
// property also exercises non-default windows. Includes the default config.
const arbTrendConfig: fc.Arbitrary<OracleConfig> = fc
  .record({
    fastPeriod: fc.integer({ min: 1, max: 30 }),
    gap: fc.integer({ min: 1, max: 30 }),
    slopeWindow: fc.integer({ min: 1, max: 10 }),
  })
  .map(({ fastPeriod, gap, slopeWindow }) => ({
    fastPeriod,
    slowPeriod: fastPeriod + gap,
    slopeWindow,
  }));

describe("Property 8: Trend follows the EMA relation", () => {
  it("direction and ATR-scaled strength match an independent oracle (default config)", () => {
    fc.assert(
      fc.property(
        arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
          arbDecisionDateAfter(candles).map((decisionDate) => ({
            candles,
            decisionDate,
          })),
        ),
        ({ candles, decisionDate }) => {
          const built = createTrendStrategy();
          expect(built.ok).toBe(true);
          if (!built.ok) return;

          const result = built.value.evaluate(candles, decisionDate);

          // An empty candle array is a hard `insufficient_data` error, not a
          // FLAT signal (prepareCandles, Requirement 6.8). Every non-empty
          // series produces an ok signal we can compare to the oracle.
          if (candles.length === 0) {
            expect(result.ok).toBe(false);
            return;
          }

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const expected = oracle(candles, DEFAULT_TREND_CONFIG);
          expect(result.value.direction).toBe(expected.direction);
          expect(closeEnough(result.value.strength, expected.strength)).toBe(
            true,
          );

          // Requirement 2.7: when usable, the rationale records the fast, slow,
          // and slope values (labelled and at 5 dp).
          if (expected.usable) {
            const rationale = result.value.rationale;
            expect(rationale).toContain("fastEMA");
            expect(rationale).toContain("slowEMA");
            expect(rationale).toContain("slope");
            expect(rationale).toContain(
              String(roundTo(expected.fast, 5)),
            );
            expect(rationale).toContain(
              String(roundTo(expected.slow, 5)),
            );
            expect(rationale).toContain(
              String(roundTo(expected.slope, 5)),
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("direction and ATR-scaled strength match the oracle across varied valid configs", () => {
    fc.assert(
      fc.property(
        arbTrendConfig.chain((config) =>
          arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
            arbDecisionDateAfter(candles).map((decisionDate) => ({
              config,
              candles,
              decisionDate,
            })),
          ),
        ),
        ({ config, candles, decisionDate }) => {
          const built = createTrendStrategy(config);
          // Valid configs only, so the factory should always succeed; if not,
          // skip this case rather than fail the property.
          if (!built.ok) return;

          const result = built.value.evaluate(candles, decisionDate);

          if (candles.length === 0) {
            expect(result.ok).toBe(false);
            return;
          }

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const expected = oracle(candles, config);
          expect(result.value.direction).toBe(expected.direction);
          expect(closeEnough(result.value.strength, expected.strength)).toBe(
            true,
          );

          if (expected.usable) {
            const rationale = result.value.rationale;
            expect(rationale).toContain("fastEMA");
            expect(rationale).toContain("slowEMA");
            expect(rationale).toContain("slope");
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
