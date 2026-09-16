import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateCandle } from "./ohlcIngestion.js";
import { PAIRS } from "./types.js";
import type { RawCandle } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 32: OHLC validity rejection
//
// For all candidate candles, ingestion accepts the candle if and only if its
// high is greater than or equal to its low and both open and close fall within
// the high-low range; otherwise it is rejected.
//
// Validates: Requirement 7.3.

const validCandleArb: fc.Arbitrary<RawCandle> = fc
  .tuple(
    fc.constantFrom(...PAIRS),
    fc.integer({ min: 2000, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.double({ min: 0.1, max: 200.0, noNaN: true }), // low
    fc.double({ min: 0.0, max: 10.0, noNaN: true }),  // height
    fc.double({ min: 0.0, max: 1.0, noNaN: true }),   // open fraction
    fc.double({ min: 0.0, max: 1.0, noNaN: true }),   // close fraction
  )
  .map(([asset, y, m, d, low, height, openFrac, closeFrac]) => {
    const high = low + height;
    const open = low + openFrac * height;
    const close = low + closeFrac * height;
    const date = `${y}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
    return {
      asset,
      date,
      open,
      high,
      low,
      close,
      source: "valid-gen",
    };
  });

const arbitraryCandleArb: fc.Arbitrary<RawCandle> = fc
  .tuple(
    fc.constantFrom(...PAIRS),
    fc.integer({ min: 2000, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.double({ min: -50.0, max: 250.0, noNaN: true }),
    fc.double({ min: -50.0, max: 250.0, noNaN: true }),
    fc.double({ min: -50.0, max: 250.0, noNaN: true }),
    fc.double({ min: -50.0, max: 250.0, noNaN: true }),
  )
  .map(([asset, y, m, d, open, high, low, close]) => {
    const date = `${y}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
    return {
      asset,
      date,
      open,
      high,
      low,
      close,
      source: "arb-gen",
    };
  });

describe("Property 32: OHLC validity rejection", () => {
  it("accepts candidate candle if and only if high >= low and open, close in [low, high]", () => {
    fc.assert(
      fc.property(arbitraryCandleArb, (candle) => {
        const result = validateCandle(candle);

        // Ground truth mathematical invariant:
        const isValid =
          candle.high >= candle.low &&
          candle.open >= candle.low &&
          candle.open <= candle.high &&
          candle.close >= candle.low &&
          candle.close <= candle.high;

        expect(result.ok).toBe(isValid);

        if (!result.ok) {
          expect(result.error.reason).toBe("ohlc_validity_error");
          expect(result.error.candle).toBe(candle);
        } else {
          expect(result.value.high).toBeGreaterThanOrEqual(result.value.low);
          expect(result.value.open).toBeGreaterThanOrEqual(result.value.low);
          expect(result.value.open).toBeLessThanOrEqual(result.value.high);
          expect(result.value.close).toBeGreaterThanOrEqual(result.value.low);
          expect(result.value.close).toBeLessThanOrEqual(result.value.high);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("always accepts valid candles constructed to satisfy the invariant", () => {
    fc.assert(
      fc.property(validCandleArb, (candle) => {
        const result = validateCandle(candle);
        expect(result.ok).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
