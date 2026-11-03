// Feature: multi-strategy-confluence-engine, Property 10: Range requires both band and RSI extremes
//
// The Range_Strategy emits a directional signal only when BOTH a Bollinger_Band
// pierce AND an RSI extreme agree: UP needs the latest close strictly below the
// lower band AND the Wilder RSI strictly below the oversold threshold; DOWN
// needs the latest close strictly above the upper band AND the RSI strictly
// above the overbought threshold. Every other combination — band pierce without
// RSI agreement, RSI extreme without a band pierce, or neither — is FLAT with
// strength exactly 0 (Requirements 4.1, 4.2, 4.3).
//
// An INDEPENDENT oracle below re-derives the bands (SMA of the last `bbPeriod`
// closes including the latest completed candle, population standard deviation,
// plus/minus K*sd), the Wilder RSI, the combined-condition direction, and the
// strength (the arithmetic mean of a clamped band-penetration score and a
// clamped RSI-distance score, Requirement 4.4). It reuses only the shared
// numeric primitives (`sma`, `populationStdDev`, `rsiWilder`, `clamp01`) and
// restates the decision logic straight from the acceptance criteria, so the
// property checks the strategy against a spec rather than against itself.
//
// The property asserts, for every generated series: the strategy's direction
// equals the oracle's; a non-FLAT direction implies both the oracle's band and
// RSI conditions held together; FLAT always carries strength 0; non-FLAT
// strength matches the oracle and stays within [0, 1]; and (with sufficient
// history) the rationale carries the close, both bands, and the RSI
// (Requirement 4.5).
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createRangeStrategy, DEFAULT_RANGE_CONFIG } from "./range.js";
import type { RangeConfig } from "./range.js";
import { sma, populationStdDev, rsiWilder, clamp01, roundTo } from "./indicators.js";
import { compareTradingDates } from "../guard/tradingDate.js";
import type { Candle } from "../guard/types.js";
import type { SignalDirection } from "./types.js";
import { arbCandleSeries, arbDecisionDateAfter } from "./testing/arbitraries.js";

// ---------------------------------------------------------------------------
// Independent oracle — a from-scratch restatement of the acceptance criteria.
//
//   - Sort candles ascending by date (mirrors prepareCandles; the generator
//     already produces ascending dates, so this is a stable no-op in practice).
//   - required = max(bbPeriod, rsiPeriod + 1). n < required -> FLAT, strength 0
//     (Requirement 4.6 history guard, surfaced so the comparison holds).
//   - Bollinger_Bands over the LAST `bbPeriod` closes INCLUDING the latest:
//     mid = SMA, sd = population std dev. sd === 0 -> FLAT, strength 0
//     (Requirement 4.7).
//   - lower = mid - K*sd, upper = mid + K*sd, bandSpan = upper - lower.
//   - rsi = Wilder RSI over the full close series.
//   - UP  iff close < lower AND rsi < oversold   (Requirement 4.1).
//     DOWN iff close > upper AND rsi > overbought (Requirement 4.2).
//     anything else -> FLAT, strength 0          (Requirement 4.3).
//   - UP   strength = mean(clamp01((lower-close)/bandSpan),
//                          clamp01((oversold-rsi)/oversold))      (Req 4.4).
//     DOWN  strength = mean(clamp01((close-upper)/bandSpan),
//                          clamp01((rsi-overbought)/(100-overbought))).
// ---------------------------------------------------------------------------

interface OracleResult {
  readonly direction: SignalDirection;
  readonly strength: number;
  /** True when history was sufficient and std dev was non-zero. */
  readonly bandsComputed: boolean;
  /** The band pierce condition alone (close beyond the relevant band). */
  readonly bandExtreme: boolean;
  /** The RSI extreme condition alone (oversold or overbought). */
  readonly rsiExtreme: boolean;
  readonly close: number;
  readonly lower: number;
  readonly upper: number;
  readonly rsi: number;
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

function oracle(candles: readonly Candle[], config: RangeConfig): OracleResult {
  const sorted = sortedAscending(candles);
  const closes = sorted.map((candle) => candle.close);
  const n = closes.length;

  const flat = (over: Partial<OracleResult> = {}): OracleResult => ({
    direction: "FLAT",
    strength: 0,
    bandsComputed: false,
    bandExtreme: false,
    rsiExtreme: false,
    close: NaN,
    lower: NaN,
    upper: NaN,
    rsi: NaN,
    ...over,
  });

  const required = Math.max(config.bbPeriod, config.rsiPeriod + 1);
  if (n < required) {
    return flat();
  }

  const window = closes.slice(-config.bbPeriod);
  const mid = sma(window, config.bbPeriod);
  const sd = populationStdDev(window);
  const close = closes[n - 1] as number;

  if (sd === 0) {
    return flat();
  }

  const lower = mid - config.bbK * sd;
  const upper = mid + config.bbK * sd;
  const bandSpan = upper - lower;
  const rsi = rsiWilder(closes, config.rsiPeriod);

  const bandExtreme = close < lower || close > upper;
  const rsiExtreme = rsi < config.oversold || rsi > config.overbought;

  let direction: SignalDirection = "FLAT";
  if (close < lower && rsi < config.oversold) direction = "UP";
  else if (close > upper && rsi > config.overbought) direction = "DOWN";

  let strength = 0;
  if (direction === "UP") {
    const penetration = (lower - close) / bandSpan;
    const rsiScore = (config.oversold - rsi) / config.oversold;
    strength = (clamp01(penetration) + clamp01(rsiScore)) / 2;
  } else if (direction === "DOWN") {
    const penetration = (close - upper) / bandSpan;
    const rsiScore = (rsi - config.overbought) / (100 - config.overbought);
    strength = (clamp01(penetration) + clamp01(rsiScore)) / 2;
  }

  return {
    direction,
    strength,
    bandsComputed: true,
    bandExtreme,
    rsiExtreme,
    close,
    lower,
    upper,
    rsi,
  };
}

/**
 * Relative-tolerance equality with an absolute fallback for the expected-0
 * case: |actual - expected| <= 1e-9 * max(1, |expected|).
 */
function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

// Valid Range configs: periods are integers >= 2, K > 0, and thresholds satisfy
// 0 <= oversold < overbought <= 100. This exercises non-default parameters
// alongside the defaults so the "both extremes" rule is tested across the
// threshold space, not just at 30/70.
const arbRangeConfig: fc.Arbitrary<RangeConfig> = fc
  .record({
    bbPeriod: fc.integer({ min: 2, max: 30 }),
    bbK: fc.double({ min: 0.5, max: 3, noNaN: true, noDefaultInfinity: true }),
    rsiPeriod: fc.integer({ min: 2, max: 20 }),
    oversold: fc.integer({ min: 5, max: 45 }),
    overboughtGap: fc.integer({ min: 10, max: 50 }),
  })
  .map(({ bbPeriod, bbK, rsiPeriod, oversold, overboughtGap }) => ({
    bbPeriod,
    bbK,
    rsiPeriod,
    oversold,
    overbought: Math.min(100, oversold + overboughtGap),
  }));

describe("Property 10: Range requires both band and RSI extremes", () => {
  it("direction, both-extreme requirement, and strength match an independent oracle (default config)", () => {
    fc.assert(
      fc.property(
        arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
          arbDecisionDateAfter(candles).map((decisionDate) => ({
            candles,
            decisionDate,
          })),
        ),
        ({ candles, decisionDate }) => {
          const built = createRangeStrategy();
          expect(built.ok).toBe(true);
          if (!built.ok) return;

          const result = built.value.evaluate(candles, decisionDate);

          // An empty candle array is a hard `insufficient_data` error, not a
          // FLAT signal (prepareCandles, Requirement 6.8).
          if (candles.length === 0) {
            expect(result.ok).toBe(false);
            return;
          }

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const signal = result.value;
          const expected = oracle(candles, DEFAULT_RANGE_CONFIG);

          // Requirements 4.1-4.3: direction matches the independently derived
          // combined-condition decision.
          expect(signal.direction).toBe(expected.direction);

          if (signal.direction === "UP") {
            // Requirement 4.1: UP implies BOTH a lower-band pierce AND oversold
            // RSI held together.
            expect(expected.close < expected.lower).toBe(true);
            expect(expected.rsi < DEFAULT_RANGE_CONFIG.oversold).toBe(true);
          } else if (signal.direction === "DOWN") {
            // Requirement 4.2: DOWN implies BOTH an upper-band pierce AND
            // overbought RSI held together.
            expect(expected.close > expected.upper).toBe(true);
            expect(expected.rsi > DEFAULT_RANGE_CONFIG.overbought).toBe(true);
          } else {
            // Requirement 4.3: FLAT means the combined condition did NOT hold,
            // and strength is exactly 0. This covers the "one extreme without
            // the other" cases — a band pierce or an RSI extreme alone is not
            // enough.
            expect(signal.strength).toBe(0);
            const bothUp =
              expected.close < expected.lower &&
              expected.rsi < DEFAULT_RANGE_CONFIG.oversold;
            const bothDown =
              expected.close > expected.upper &&
              expected.rsi > DEFAULT_RANGE_CONFIG.overbought;
            expect(bothUp || bothDown).toBe(false);
          }

          // Requirement 4.4: non-FLAT strength matches the oracle and is in
          // [0, 1].
          if (signal.direction !== "FLAT") {
            expect(closeEnough(signal.strength, expected.strength)).toBe(true);
            expect(signal.strength).toBeGreaterThanOrEqual(0);
            expect(signal.strength).toBeLessThanOrEqual(1);
          }

          // Requirement 4.5: with sufficient history and non-zero volatility,
          // the rationale carries the close, both bands (5 dp), and the RSI
          // (2 dp).
          if (expected.bandsComputed) {
            const rationale = signal.rationale;
            expect(rationale).toContain("close=");
            expect(rationale).toContain("lower=");
            expect(rationale).toContain("upper=");
            expect(rationale).toContain("rsi=");
            expect(rationale).toContain(String(roundTo(expected.close, 5)));
            expect(rationale).toContain(String(roundTo(expected.lower, 5)));
            expect(rationale).toContain(String(roundTo(expected.upper, 5)));
            expect(rationale).toContain(String(roundTo(expected.rsi, 2)));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("the both-extremes rule and strength bounds hold across varied valid configs", () => {
    fc.assert(
      fc.property(
        arbRangeConfig.chain((config) =>
          arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
            arbDecisionDateAfter(candles).map((decisionDate) => ({
              config,
              candles,
              decisionDate,
            })),
          ),
        ),
        ({ config, candles, decisionDate }) => {
          const built = createRangeStrategy(config);
          // Only valid configs are generated, so the factory should succeed; if
          // not, skip rather than fail the property.
          if (!built.ok) return;

          const result = built.value.evaluate(candles, decisionDate);

          if (candles.length === 0) {
            expect(result.ok).toBe(false);
            return;
          }

          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const signal = result.value;
          const expected = oracle(candles, config);

          expect(signal.direction).toBe(expected.direction);

          // A non-FLAT direction ALWAYS requires both extremes together.
          if (signal.direction === "UP") {
            expect(expected.close < expected.lower).toBe(true);
            expect(expected.rsi < config.oversold).toBe(true);
          } else if (signal.direction === "DOWN") {
            expect(expected.close > expected.upper).toBe(true);
            expect(expected.rsi > config.overbought).toBe(true);
          } else {
            expect(signal.strength).toBe(0);
          }

          if (signal.direction !== "FLAT") {
            expect(closeEnough(signal.strength, expected.strength)).toBe(true);
            expect(signal.strength).toBeGreaterThanOrEqual(0);
            expect(signal.strength).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
