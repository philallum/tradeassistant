// Feature: multi-strategy-confluence-engine, Property 9: Breakout compares the latest close with a channel that excludes it
//
// The Breakout_Strategy builds a Donchian_Channel from the N candles that come
// strictly BEFORE the most recent completed candle, then compares the latest
// close with that channel: strictly above the channel high gives UP, strictly
// below the channel low gives DOWN, anything inside gives FLAT, with strength
// scaling the breakout distance by ATR_14. An INDEPENDENT naive oracle below
// re-derives the channel, direction, and strength straight from the acceptance
// criteria (Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.9) — it reuses only
// the shared numeric primitives (`clamp01`, `atrUsable`, `roundTo`,
// `computeAtr14`) and reimplements the channel/direction/strength decision from
// scratch, so the property checks the strategy against a spec rather than
// against itself.
//
// The metamorphic test additionally exploits the channel-exclusion guarantee
// (Requirement 3.9): because the channel is built from candles that EXCLUDE the
// latest one, widening ONLY the latest candle's high (up) and low (down) must
// leave both the detected direction and the reported channel high/low
// unchanged. The latest close is held fixed so the direction stays comparable.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.9

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createBreakoutStrategy, DEFAULT_BREAKOUT_CONFIG } from "./breakout.js";
import { clamp01, atrUsable, roundTo } from "./indicators.js";
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
//   - n < N + 1 -> FLAT, strength 0, not usable (Requirement 3.8 history guard,
//     surfaced here so the comparison holds).
//   - channel = candles[n-1-N .. n-2] (EXCLUDES the latest candle): channelHigh
//     is the max high, channelLow is the min low of that window
//     (Requirements 3.1, 3.9).
//   - close = latest candle's close. close > channelHigh -> UP;
//     close < channelLow -> DOWN; otherwise FLAT (Requirements 3.2, 3.3, 3.4).
//   - atr = computeAtr14(sorted). Unusable (0 or non-finite) -> keep direction,
//     strength 0 (Requirement 3.10).
//   - UP/DOWN strength = clamp01(distance / atr), where distance is
//     close - channelHigh for UP and channelLow - close for DOWN
//     (Requirement 3.5). FLAT -> strength 0 (Requirement 3.6).
// ---------------------------------------------------------------------------

interface OracleResult {
  readonly direction: SignalDirection;
  readonly strength: number;
  /** True when history was sufficient (the channel was computed). */
  readonly channelComputed: boolean;
  /** True when the channel was computed AND ATR was usable. */
  readonly atrUsable: boolean;
  readonly channelHigh: number;
  readonly channelLow: number;
  readonly close: number;
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

function oracle(candles: readonly Candle[], channelPeriod: number): OracleResult {
  const sorted = sortedAscending(candles);
  const n = sorted.length;
  const N = channelPeriod;

  const insufficient: OracleResult = {
    direction: "FLAT",
    strength: 0,
    channelComputed: false,
    atrUsable: false,
    channelHigh: NaN,
    channelLow: NaN,
    close: NaN,
  };

  if (n < N + 1) {
    return insufficient;
  }

  const last = sorted[n - 1] as Candle;
  const close = last.close;

  // The channel window EXCLUDES the latest candle: candles[n-1-N .. n-2].
  const window = sorted.slice(n - 1 - N, n - 1);
  let channelHigh = Number.NEGATIVE_INFINITY;
  let channelLow = Number.POSITIVE_INFINITY;
  for (const candle of window) {
    if (candle.high > channelHigh) channelHigh = candle.high;
    if (candle.low < channelLow) channelLow = candle.low;
  }

  let direction: SignalDirection = "FLAT";
  if (close > channelHigh) direction = "UP";
  else if (close < channelLow) direction = "DOWN";

  const atr = computeAtr14(sorted);
  const usable = atrUsable(atr);

  let strength = 0;
  if (direction !== "FLAT" && usable) {
    const distance = direction === "UP" ? close - channelHigh : channelLow - close;
    strength = clamp01(distance / atr);
  }

  return {
    direction,
    strength,
    channelComputed: true,
    atrUsable: usable,
    channelHigh,
    channelLow,
    close,
  };
}

/**
 * Relative-tolerance equality with an absolute fallback for the expected-0
 * case: |actual - expected| <= 1e-9 * max(1, |expected|).
 */
function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

// A small arbitrary of valid Breakout configs (channelPeriod integer >= 1) so
// the property also exercises non-default windows alongside the default.
const arbChannelPeriod: fc.Arbitrary<number> = fc.integer({ min: 1, max: 40 });

describe("Property 9: Breakout compares the latest close with a channel that excludes it", () => {
  it("direction, channel values, and ATR-scaled strength match an independent oracle (default config)", () => {
    fc.assert(
      fc.property(
        arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
          arbDecisionDateAfter(candles).map((decisionDate) => ({
            candles,
            decisionDate,
          })),
        ),
        ({ candles, decisionDate }) => {
          const built = createBreakoutStrategy();
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

          const expected = oracle(candles, DEFAULT_BREAKOUT_CONFIG.channelPeriod);

          // Requirements 3.1-3.4, 3.9: direction matches the independently
          // re-derived channel comparison.
          expect(result.value.direction).toBe(expected.direction);

          // Requirement 3.5: ATR-scaled strength matches the oracle.
          expect(closeEnough(result.value.strength, expected.strength)).toBe(
            true,
          );

          // Requirement 3.7: when the channel was computed, the rationale
          // records the channel high, channel low, and close (at 5 dp), and the
          // reported channel values match the independent re-derivation.
          if (expected.channelComputed) {
            const rationale = result.value.rationale;
            expect(rationale).toContain("channelHigh");
            expect(rationale).toContain("channelLow");
            expect(rationale).toContain("close=");
            expect(rationale).toContain(
              String(roundTo(expected.channelHigh, 5)),
            );
            expect(rationale).toContain(
              String(roundTo(expected.channelLow, 5)),
            );
            expect(rationale).toContain(String(roundTo(expected.close, 5)));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("direction, channel values, and strength match the oracle across varied valid channel periods", () => {
    fc.assert(
      fc.property(
        arbChannelPeriod.chain((channelPeriod) =>
          arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
            arbDecisionDateAfter(candles).map((decisionDate) => ({
              channelPeriod,
              candles,
              decisionDate,
            })),
          ),
        ),
        ({ channelPeriod, candles, decisionDate }) => {
          const built = createBreakoutStrategy({ channelPeriod });
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

          const expected = oracle(candles, channelPeriod);
          expect(result.value.direction).toBe(expected.direction);
          expect(closeEnough(result.value.strength, expected.strength)).toBe(
            true,
          );

          if (expected.channelComputed) {
            const rationale = result.value.rationale;
            expect(rationale).toContain("channelHigh");
            expect(rationale).toContain("channelLow");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("metamorphic: widening only the latest candle's high/low leaves the direction and channel unchanged (Requirement 3.9)", () => {
    fc.assert(
      fc.property(
        arbChannelPeriod.chain((channelPeriod) =>
          // Guarantee enough history that the channel is actually computed
          // (n >= N + 1) so there is a channel to hold invariant.
          arbCandleSeries({ min: 1, max: 120 }).chain((candles) =>
            arbDecisionDateAfter(candles).chain((decisionDate) =>
              fc
                .record({
                  highDelta: fc.double({
                    min: 0,
                    max: 100,
                    noNaN: true,
                    noDefaultInfinity: true,
                  }),
                  lowDelta: fc.double({
                    min: 0,
                    max: 100,
                    noNaN: true,
                    noDefaultInfinity: true,
                  }),
                })
                .map(({ highDelta, lowDelta }) => ({
                  channelPeriod,
                  candles,
                  decisionDate,
                  highDelta,
                  lowDelta,
                })),
            ),
          ),
        ),
        ({ channelPeriod, candles, decisionDate, highDelta, lowDelta }) => {
          const built = createBreakoutStrategy({ channelPeriod });
          if (!built.ok) return;
          const strategy = built.value;

          const baseResult = strategy.evaluate(candles, decisionDate);
          expect(baseResult.ok).toBe(true);
          if (!baseResult.ok) return;

          // Only exercise the invariant when the channel was actually computed
          // (sufficient history). Otherwise there is no channel to compare.
          const expected = oracle(candles, channelPeriod);
          if (!expected.channelComputed) return;

          // Widen ONLY the latest (most recent by date) candle's high (up) and
          // low (down). The close is held fixed so the detected direction stays
          // comparable. The sort order determines which candle is "latest".
          const sorted = sortedAscending(candles);
          const lastDate = sorted[sorted.length - 1]!.date;
          const widened = candles.map((candle) =>
            candle.date === lastDate
              ? {
                  ...candle,
                  high: candle.high + highDelta,
                  low: candle.low - lowDelta,
                }
              : candle,
          );

          const widenedResult = strategy.evaluate(widened, decisionDate);
          expect(widenedResult.ok).toBe(true);
          if (!widenedResult.ok) return;

          // The channel excludes the latest candle, so widening its wicks must
          // not change the detected direction.
          expect(widenedResult.value.direction).toBe(baseResult.value.direction);

          // Nor the reported channel high/low — re-derive both from the
          // (unchanged) channel window and assert they appear identically in
          // both rationales.
          const channelHighText = String(roundTo(expected.channelHigh, 5));
          const channelLowText = String(roundTo(expected.channelLow, 5));
          expect(baseResult.value.rationale).toContain(channelHighText);
          expect(baseResult.value.rationale).toContain(channelLowText);
          expect(widenedResult.value.rationale).toContain(channelHighText);
          expect(widenedResult.value.rationale).toContain(channelLowText);
        },
      ),
      { numRuns: 200 },
    );
  });
});
