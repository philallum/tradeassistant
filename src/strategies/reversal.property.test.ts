// Feature: multi-strategy-confluence-engine, Property 11: Reversal needs extreme extension and fading momentum
//
// The Reversal_Strategy emits a directional signal only when BOTH an extreme
// ATR-scaled extension from the Baseline_MA AND fading momentum in the
// extension's direction agree: an over-extended rally (extension strictly above
// the threshold) with fading momentum reverses DOWN; an over-extended sell-off
// (extension strictly below the negative threshold) with fading momentum
// reverses UP. Every other case — extension within the band, or momentum not
// exhausting in the extension's direction — is FLAT with strength exactly 0
// (Requirements 5.2, 5.3, 5.4).
//
// An INDEPENDENT naive oracle below re-derives the extension (the latest close
// minus the SMA-of-close Baseline_MA, divided by the real ATR_14), the two
// rate-of-change windows, the exhaustion predicate, the direction, and the
// strength straight from the acceptance criteria. It reuses only the shared
// numeric primitives (`sma`, `clamp01`, `atrUsable`, `roundTo`, `computeAtr14`)
// and restates the decision logic from scratch, so the property checks the
// strategy against a spec rather than against itself.
//
// Exhaustion (Requirement 5.5): |rocRecent| < |rocPrev| AND both ROCs share the
// extension's STRICT sign. Strength for UP/DOWN (Requirement 5.6):
// clamp01((|extension| - thr) / thr); FLAT is exactly 0 (Requirement 5.4).
//
// The generators deliberately include short series and zero-ATR (flat) series
// so the insufficient-history and zero-ATR FLAT branches are exercised
// (Requirement 5.8), plus a purpose-built "stretched + decelerating" generator
// that reliably drives the UP/DOWN reversal branches.
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createReversalStrategy, DEFAULT_REVERSAL_CONFIG } from "./reversal.js";
import type { ReversalConfig } from "./reversal.js";
import { sma, clamp01, atrUsable, roundTo } from "./indicators.js";
import { computeAtr14 } from "../confidence/atr.js";
import { compareTradingDates, addTradingDays } from "../guard/tradingDate.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { SignalDirection } from "./types.js";
import { arbCandleSeries, arbDecisionDateAfter } from "./testing/arbitraries.js";

// ---------------------------------------------------------------------------
// Independent oracle — a from-scratch restatement of the acceptance criteria.
//
//   - Sort candles ascending by date (mirrors prepareCandles; the generator
//     already produces ascending dates, so this is a stable no-op in practice).
//   - required = baselinePeriod + 2 * momentumWindow. n < required -> FLAT,
//     strength 0, not usable (Requirement 5.8 history guard, surfaced so the
//     comparison holds). The history guard runs BEFORE the ATR check.
//   - atr = computeAtr14(sorted). Unusable (0 or non-finite) -> FLAT, strength 0
//     (Requirement 5.8).
//   - baselineMA = sma(closes, baselinePeriod) (last `baselinePeriod` closes
//     INCLUDING the latest); extension = (close[L] - baselineMA) / atr
//     (Requirement 5.1), unrounded.
//   - rocRecent = close[L] - close[L - w]; rocPrev = close[L - w] - close[L - 2w]
//     (Requirement 5.5).
//   - exhaustion = |rocRecent| < |rocPrev| AND both ROCs share extension's
//     STRICT sign (Requirement 5.5).
//   - DOWN iff extension > thr AND exhaustion; UP iff extension < -thr AND
//     exhaustion; else FLAT (Requirements 5.2, 5.3, 5.4).
//   - UP/DOWN strength = clamp01((|extension| - thr) / thr); FLAT -> 0
//     (Requirement 5.6).
// ---------------------------------------------------------------------------

interface OracleResult {
  readonly direction: SignalDirection;
  readonly strength: number;
  /** True when history was sufficient (the extension was computed). */
  readonly extensionComputed: boolean;
  /** True when history was sufficient AND ATR was usable. */
  readonly usable: boolean;
  readonly extension: number;
  readonly atr: number;
  readonly rocRecent: number;
  readonly rocPrev: number;
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

function oracle(candles: readonly Candle[], config: ReversalConfig): OracleResult {
  const sorted = sortedAscending(candles);
  const closes = sorted.map((candle) => candle.close);
  const n = closes.length;
  const L = n - 1;
  const w = config.momentumWindow;
  const thr = config.extensionThreshold;

  const flat = (over: Partial<OracleResult> = {}): OracleResult => ({
    direction: "FLAT",
    strength: 0,
    extensionComputed: false,
    usable: false,
    extension: NaN,
    atr: NaN,
    rocRecent: NaN,
    rocPrev: NaN,
    ...over,
  });

  const required = config.baselinePeriod + 2 * w;
  if (n < required) {
    return flat();
  }

  const atr = computeAtr14(sorted);
  if (!atrUsable(atr)) {
    return flat({ atr });
  }

  const close = closes[L] as number;
  const baselineMA = sma(closes, config.baselinePeriod);
  const extension = (close - baselineMA) / atr;

  const rocRecent = close - (closes[L - w] as number);
  const rocPrev = (closes[L - w] as number) - (closes[L - 2 * w] as number);

  const fading = Math.abs(rocRecent) < Math.abs(rocPrev);
  const sameSign =
    (extension > 0 && rocRecent > 0 && rocPrev > 0) ||
    (extension < 0 && rocRecent < 0 && rocPrev < 0);
  const exhaustion = fading && sameSign;

  let direction: SignalDirection = "FLAT";
  if (extension > thr && exhaustion) direction = "DOWN";
  else if (extension < -thr && exhaustion) direction = "UP";

  const strength =
    direction === "FLAT" ? 0 : clamp01((Math.abs(extension) - thr) / thr);

  return {
    direction,
    strength,
    extensionComputed: true,
    usable: true,
    extension,
    atr,
    rocRecent,
    rocPrev,
  };
}

/**
 * Relative-tolerance equality with an absolute fallback for the expected-0
 * case: |actual - expected| <= 1e-9 * max(1, |expected|).
 */
function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

// A small arbitrary of valid Reversal configs (extensionThreshold finite > 0,
// baselinePeriod and momentumWindow positive integers) so the property also
// exercises non-default parameters alongside the defaults.
const arbReversalConfig: fc.Arbitrary<ReversalConfig> = fc.record({
  extensionThreshold: fc.double({
    min: 0.1,
    max: 5,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  baselinePeriod: fc.integer({ min: 1, max: 25 }),
  momentumWindow: fc.integer({ min: 1, max: 6 }),
});

/**
 * A purpose-built series that reliably drives the UP/DOWN reversal branches: a
 * long flat run to pin the Baseline_MA, then a large stretch away from it whose
 * step sizes DECELERATE (fading momentum) while keeping a single direction so
 * both ROCs share the extension's sign. `up` picks the sell-off (expect UP) vs
 * the rally (expect DOWN) direction. Used with the default config
 * (baselinePeriod 20, momentumWindow 3, extensionThreshold 2.0).
 */
const arbStretchedSeries: fc.Arbitrary<{
  candles: Candle[];
  decisionDate: TradingDate;
}> = fc
  .record({
    up: fc.boolean(),
    base: fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
    stretch: fc.double({
      min: 20,
      max: 60,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    flatLen: fc.integer({ min: 20, max: 30 }),
  })
  .map(({ up, base, stretch, flatLen }) => {
    const sign = up ? -1 : 1;
    const asset = "EURUSD";
    let date: TradingDate = "2015-01-01";
    const candles: Candle[] = [];

    const push = (open: number, close: number): void => {
      const high = Math.max(open, close) + 0.5;
      const low = Math.min(open, close) - 0.5;
      candles.push({ asset, date, open, high, low, close });
      date = addTradingDays(date, 1);
    };

    // Flat run to establish the Baseline_MA near `base` (small nonzero wicks in
    // push keep ATR usable).
    for (let i = 0; i < flatLen; i++) push(base, base);

    // Decelerating stretch of exactly 2 * momentumWindow (= 6 with defaults)
    // candles so both ROC windows live inside the move. Fractions shrink so the
    // per-window rate of change fades while staying one-directional.
    const fractions = [0.4, 0.3, 0.2, 0.1, 0.06, 0.03];
    let prev = base;
    for (const fraction of fractions) {
      const next = prev + sign * stretch * fraction;
      push(prev, next);
      prev = next;
    }

    const decisionDate = addTradingDays(date, 1);
    return { candles, decisionDate };
  });

describe("Property 11: Reversal needs extreme extension and fading momentum", () => {
  it("direction, extension/ATR/ROC rationale, and strength match an independent oracle (default config)", () => {
    fc.assert(
      fc.property(
        arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
          arbDecisionDateAfter(candles).map((decisionDate) => ({
            candles,
            decisionDate,
          })),
        ),
        ({ candles, decisionDate }) => {
          const built = createReversalStrategy();
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

          const signal = result.value;
          const expected = oracle(candles, DEFAULT_REVERSAL_CONFIG);

          // Requirements 5.2-5.4: direction matches the independently derived
          // extension + exhaustion decision.
          expect(signal.direction).toBe(expected.direction);

          if (signal.direction === "DOWN") {
            // Requirement 5.2: DOWN implies an over-extended rally with fading
            // momentum (both ROCs positive, recent strictly smaller).
            expect(expected.extension > DEFAULT_REVERSAL_CONFIG.extensionThreshold).toBe(true);
            expect(Math.abs(expected.rocRecent) < Math.abs(expected.rocPrev)).toBe(true);
            expect(expected.rocRecent > 0 && expected.rocPrev > 0).toBe(true);
          } else if (signal.direction === "UP") {
            // Requirement 5.3: UP implies an over-extended sell-off with fading
            // momentum (both ROCs negative, recent strictly smaller).
            expect(expected.extension < -DEFAULT_REVERSAL_CONFIG.extensionThreshold).toBe(true);
            expect(Math.abs(expected.rocRecent) < Math.abs(expected.rocPrev)).toBe(true);
            expect(expected.rocRecent < 0 && expected.rocPrev < 0).toBe(true);
          } else {
            // Requirement 5.4: FLAT carries strength exactly 0.
            expect(signal.strength).toBe(0);
          }

          // Requirement 5.6: non-FLAT strength matches the oracle; every signal
          // (FLAT included) carries a finite strength in [0, 1].
          if (signal.direction !== "FLAT") {
            expect(closeEnough(signal.strength, expected.strength)).toBe(true);
          }
          expect(Number.isFinite(signal.strength)).toBe(true);
          expect(signal.strength).toBeGreaterThanOrEqual(0);
          expect(signal.strength).toBeLessThanOrEqual(1);

          // Requirements 5.1, 5.7: when history and ATR were usable, the
          // rationale records the extension, ATR, and both ROC values (5 dp).
          if (expected.usable) {
            const rationale = signal.rationale;
            expect(rationale).toContain("extension=");
            expect(rationale).toContain("atr=");
            expect(rationale).toContain("rocRecent=");
            expect(rationale).toContain("rocPrev=");
            expect(rationale).toContain(String(roundTo(expected.extension, 5)));
            expect(rationale).toContain(String(roundTo(expected.atr, 5)));
            expect(rationale).toContain(String(roundTo(expected.rocRecent, 5)));
            expect(rationale).toContain(String(roundTo(expected.rocPrev, 5)));
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("direction, strength, and the extreme-extension + exhaustion rule hold across varied valid configs", () => {
    fc.assert(
      fc.property(
        arbReversalConfig.chain((config) =>
          arbCandleSeries({ min: 0, max: 120 }).chain((candles) =>
            arbDecisionDateAfter(candles).map((decisionDate) => ({
              config,
              candles,
              decisionDate,
            })),
          ),
        ),
        ({ config, candles, decisionDate }) => {
          const built = createReversalStrategy(config);
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

          // A non-FLAT direction ALWAYS requires extreme extension together
          // with fading, same-signed momentum.
          if (signal.direction === "DOWN") {
            expect(expected.extension > config.extensionThreshold).toBe(true);
            expect(Math.abs(expected.rocRecent) < Math.abs(expected.rocPrev)).toBe(true);
            expect(expected.rocRecent > 0 && expected.rocPrev > 0).toBe(true);
          } else if (signal.direction === "UP") {
            expect(expected.extension < -config.extensionThreshold).toBe(true);
            expect(Math.abs(expected.rocRecent) < Math.abs(expected.rocPrev)).toBe(true);
            expect(expected.rocRecent < 0 && expected.rocPrev < 0).toBe(true);
          } else {
            expect(signal.strength).toBe(0);
          }

          if (signal.direction !== "FLAT") {
            expect(closeEnough(signal.strength, expected.strength)).toBe(true);
          }
          expect(Number.isFinite(signal.strength)).toBe(true);
          expect(signal.strength).toBeGreaterThanOrEqual(0);
          expect(signal.strength).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("drives the UP/DOWN reversal branches on stretched, decelerating series and matches the oracle", () => {
    // At least one generated case must actually reach a non-FLAT reversal, so
    // the UP/DOWN strength branch is genuinely exercised rather than vacuously
    // skipped. We track that across runs and assert it afterwards.
    let sawReversal = false;

    fc.assert(
      fc.property(arbStretchedSeries, ({ candles, decisionDate }) => {
        const built = createReversalStrategy();
        expect(built.ok).toBe(true);
        if (!built.ok) return;

        const result = built.value.evaluate(candles, decisionDate);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const signal = result.value;
        const expected = oracle(candles, DEFAULT_REVERSAL_CONFIG);

        // The strategy agrees with the independent oracle on this stretched
        // construction exactly as on random series.
        expect(signal.direction).toBe(expected.direction);
        expect(closeEnough(signal.strength, expected.strength)).toBe(true);
        expect(signal.strength).toBeGreaterThanOrEqual(0);
        expect(signal.strength).toBeLessThanOrEqual(1);

        if (signal.direction !== "FLAT") {
          sawReversal = true;
          // Requirement 5.6: a reversal strength is exactly the clamped,
          // threshold-normalised excess extension.
          const thr = DEFAULT_REVERSAL_CONFIG.extensionThreshold;
          const manual = clamp01((Math.abs(expected.extension) - thr) / thr);
          expect(closeEnough(signal.strength, manual)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );

    expect(sawReversal).toBe(true);
  });

  it("metamorphic: shifting every price by a constant leaves the extension, ROCs, direction, and strength unchanged (Requirements 5.1, 5.5)", () => {
    // The Baseline_MA tracks the close level, so the extension numerator
    // (close - baselineMA) and both rate-of-change differences are invariant
    // under a uniform price shift, and ATR (built from candle ranges) is too.
    // The detected direction and strength must therefore be unchanged.
    fc.assert(
      fc.property(
        arbCandleSeries({ min: 1, max: 120 }).chain((candles) =>
          arbDecisionDateAfter(candles).chain((decisionDate) =>
            fc
              .double({ min: 1, max: 500, noNaN: true, noDefaultInfinity: true })
              .map((shift) => ({ candles, decisionDate, shift })),
          ),
        ),
        ({ candles, decisionDate, shift }) => {
          const built = createReversalStrategy();
          expect(built.ok).toBe(true);
          if (!built.ok) return;
          const strategy = built.value;

          const base = strategy.evaluate(candles, decisionDate);
          expect(base.ok).toBe(true);
          if (!base.ok) return;

          const shifted: Candle[] = candles.map((candle) => ({
            ...candle,
            open: candle.open + shift,
            high: candle.high + shift,
            low: candle.low + shift,
            close: candle.close + shift,
          }));

          const shiftedResult = strategy.evaluate(shifted, decisionDate);
          expect(shiftedResult.ok).toBe(true);
          if (!shiftedResult.ok) return;

          // Direction is a pure function of the shift-invariant extension and
          // ROCs, so it is identical; strength matches within tolerance.
          expect(shiftedResult.value.direction).toBe(base.value.direction);
          expect(closeEnough(shiftedResult.value.strength, base.value.strength)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
