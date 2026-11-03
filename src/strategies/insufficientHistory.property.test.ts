// Feature: multi-strategy-confluence-engine, Property 7: Insufficient history yields FLAT without error
//
// Every built-in strategy has a minimum-history requirement below which it
// cannot compute its indicators. Property 7 asserts that a non-empty, past-only
// candle series SHORTER than that minimum never produces an error: the strategy
// returns an `ok` result whose direction is FLAT, whose strength is exactly 0,
// and whose rationale states that history was insufficient. (An EMPTY series is
// a separate `insufficient_data` error from `prepareCandles`, not this FLAT
// case, so the generator stays strictly non-empty.)
//
// Each strategy is driven across lengths in [1, threshold - 1] using its OWN
// minimum, resolved from the default config the barrel exports:
//   - trend:    slowPeriod + slopeWindow        = 50 + 5     = 55
//   - breakout: channelPeriod + 1               = 20 + 1     = 21
//   - range:    max(bbPeriod, rsiPeriod + 1)     = max(20,15) = 20
//   - reversal: baselinePeriod + 2*momentumWindow = 20 + 6    = 26
//
// Validates: Requirements 2.9, 3.8, 4.6, 5.8

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createTrendStrategy,
  DEFAULT_TREND_CONFIG,
  createBreakoutStrategy,
  DEFAULT_BREAKOUT_CONFIG,
  createRangeStrategy,
  DEFAULT_RANGE_CONFIG,
  createReversalStrategy,
  DEFAULT_REVERSAL_CONFIG,
} from "./index.js";
import type { Strategy } from "./types.js";
import { arbCandleSeries, arbDecisionDateAfter } from "./testing/arbitraries.js";

/** A strategy under test paired with its minimum-history threshold. */
interface Case {
  readonly name: string;
  readonly build: () => Strategy<unknown>;
  /** The smallest series length that is SUFFICIENT; lengths below this are short. */
  readonly threshold: number;
}

/** Unwrap a strategy factory, failing loudly if a default config is rejected. */
function mustBuild(
  result:
    | { ok: true; value: Strategy<unknown> }
    | { ok: false; error: unknown },
): Strategy<unknown> {
  if (!result.ok) {
    throw new Error(
      `strategy factory rejected its default config: ${String(result.error)}`,
    );
  }
  return result.value;
}

const CASES: readonly Case[] = [
  {
    name: "trend",
    build: () => mustBuild(createTrendStrategy()),
    threshold: DEFAULT_TREND_CONFIG.slowPeriod + DEFAULT_TREND_CONFIG.slopeWindow,
  },
  {
    name: "breakout",
    build: () => mustBuild(createBreakoutStrategy()),
    threshold: DEFAULT_BREAKOUT_CONFIG.channelPeriod + 1,
  },
  {
    name: "range",
    build: () => mustBuild(createRangeStrategy()),
    threshold: Math.max(
      DEFAULT_RANGE_CONFIG.bbPeriod,
      DEFAULT_RANGE_CONFIG.rsiPeriod + 1,
    ),
  },
  {
    name: "reversal",
    build: () => mustBuild(createReversalStrategy()),
    threshold:
      DEFAULT_REVERSAL_CONFIG.baselinePeriod +
      2 * DEFAULT_REVERSAL_CONFIG.momentumWindow,
  },
];

describe("Property 7: Insufficient history yields FLAT without error", () => {
  for (const { name, build, threshold } of CASES) {
    it(`${name}: a non-empty series shorter than ${threshold} candles yields FLAT, strength 0, and an insufficient-history rationale`, () => {
      const strategy = build();

      fc.assert(
        fc.property(
          // Lengths strictly in [1, threshold - 1]: non-empty (so the empty
          // insufficient_data error is excluded) and below the minimum.
          arbCandleSeries({ min: 1, max: threshold - 1 }).chain((candles) =>
            arbDecisionDateAfter(candles).map((decisionDate) => ({
              candles,
              decisionDate,
            })),
          ),
          ({ candles, decisionDate }) => {
            // Guard the generator's own invariant: strictly below threshold and
            // non-empty, so we are always on the insufficient-history path.
            expect(candles.length).toBeGreaterThanOrEqual(1);
            expect(candles.length).toBeLessThan(threshold);

            const result = strategy.evaluate(candles, decisionDate);

            // No error is raised or returned for a short (non-empty) series.
            expect(result.ok).toBe(true);
            if (!result.ok) return;

            const signal = result.value;
            expect(signal.direction).toBe("FLAT");
            expect(signal.strength).toBe(0);
            expect(signal.rationale.toLowerCase()).toContain("insufficient");
          },
        ),
        { numRuns: 100 },
      );
    });
  }
});
