import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { computeCandleFeatures, isCandleComputable } from "./features.js";
import type { IntradayCandle } from "./types.js";

// Task 3: deterministic 4H candle features. Known-OHLC oracles, degenerate and
// non-finite handling, and scale-invariance across EURUSD/USDJPY magnitudes.

describe("isCandleComputable", () => {
  it("accepts a valid candle", () => {
    expect(isCandleComputable({ open: 1.1, high: 1.12, low: 1.09, currentPrice: 1.11 })).toBe(true);
  });

  it("rejects non-finite OHLC", () => {
    expect(isCandleComputable({ open: NaN, high: 1, low: 0, currentPrice: 0.5 })).toBe(false);
    expect(isCandleComputable({ open: 1, high: Infinity, low: 0, currentPrice: 0.5 })).toBe(false);
  });

  it("rejects an OHLC-invariant violation (high < low, or open/price out of band)", () => {
    expect(isCandleComputable({ open: 1, high: 0.9, low: 1.0, currentPrice: 0.95 })).toBe(false);
    expect(isCandleComputable({ open: 2, high: 1.1, low: 1.0, currentPrice: 1.05 })).toBe(false);
    expect(isCandleComputable({ open: 1.05, high: 1.1, low: 1.0, currentPrice: 2 })).toBe(false);
  });
});

describe("computeCandleFeatures (known oracles)", () => {
  it("a bullish bar near the high with a lower wick", () => {
    // open 1.00, high 1.10, low 0.95, current 1.08
    const f = computeCandleFeatures({ open: 1.0, high: 1.1, low: 0.95, currentPrice: 1.08 });
    expect(f.range).toBeCloseTo(0.15, 10);
    expect(f.body).toBeCloseTo(0.08, 10);
    expect(f.bodyDirection).toBe("UP");
    expect(f.bodyToRange).toBeCloseTo(0.08 / 0.15, 10);
    expect(f.upperWick).toBeCloseTo(1.1 - 1.08, 10);
    expect(f.lowerWick).toBeCloseTo(1.0 - 0.95, 10);
    expect(f.pricePositionInRange).toBeCloseTo((1.08 - 0.95) / 0.15, 10);
  });

  it("a bearish bar near the low with an upper wick", () => {
    const f = computeCandleFeatures({ open: 1.1, high: 1.12, low: 1.0, currentPrice: 1.02 });
    expect(f.body).toBeCloseTo(-0.08, 10);
    expect(f.bodyDirection).toBe("DOWN");
    expect(f.upperWick).toBeCloseTo(1.12 - 1.1, 10);
    expect(f.lowerWick).toBeCloseTo(1.02 - 1.0, 10);
  });

  it("a zero-range candle degrades safely (bodyToRange 0, position 0.5)", () => {
    const f = computeCandleFeatures({ open: 1.0, high: 1.0, low: 1.0, currentPrice: 1.0 });
    expect(f.range).toBe(0);
    expect(f.body).toBe(0);
    expect(f.bodyDirection).toBe("FLAT");
    expect(f.bodyToRange).toBe(0);
    expect(f.pricePositionInRange).toBe(0.5);
    expect(Number.isNaN(f.bodyToRange)).toBe(false);
  });
});

/** A fast-check arbitrary for a valid candle at a given price scale. */
function validCandle(scale: number): fc.Arbitrary<IntradayCandle> {
  return fc
    .tuple(
      fc.double({ min: 0.1, max: 2, noNaN: true }),
      fc.double({ min: 0, max: 0.5, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0, max: 1, noNaN: true }),
    )
    .map(([base, span, a, b]) => {
      const low = base * scale;
      const high = (base + span + 1e-6) * scale;
      const open = low + a * (high - low);
      const currentPrice = low + b * (high - low);
      return { open, high, low, currentPrice };
    });
}

describe("computeCandleFeatures (properties)", () => {
  it("ratios are always finite and in-range for a valid candle", () => {
    fc.assert(
      fc.property(validCandle(1), (candle) => {
        expect(isCandleComputable(candle)).toBe(true);
        const f = computeCandleFeatures(candle);
        expect(Number.isFinite(f.bodyToRange)).toBe(true);
        expect(f.bodyToRange).toBeGreaterThanOrEqual(0);
        expect(f.bodyToRange).toBeLessThanOrEqual(1 + 1e-9);
        expect(f.pricePositionInRange).toBeGreaterThanOrEqual(-1e-9);
        expect(f.pricePositionInRange).toBeLessThanOrEqual(1 + 1e-9);
        expect(f.upperWick).toBeGreaterThanOrEqual(-1e-9);
        expect(f.lowerWick).toBeGreaterThanOrEqual(-1e-9);
      }),
    );
  });

  it("is scale-invariant in the ratio features (EURUSD ~1 vs USDJPY ~150)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.2, max: 1.5, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (base, a, b) => {
          const mk = (scale: number): IntradayCandle => {
            const low = base * scale;
            const high = (base + 0.3) * scale;
            return {
              open: low + a * (high - low),
              high,
              low,
              currentPrice: low + b * (high - low),
            };
          };
          const major = computeCandleFeatures(mk(1));
          const jpy = computeCandleFeatures(mk(150));
          expect(jpy.bodyToRange).toBeCloseTo(major.bodyToRange, 9);
          expect(jpy.pricePositionInRange).toBeCloseTo(major.pricePositionInRange, 9);
          expect(jpy.bodyDirection).toBe(major.bodyDirection);
        },
      ),
    );
  });
});
