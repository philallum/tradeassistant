import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { structuralLiquidityDistanceFromLevels } from "./candidateFeatures.js";
import type { StructuralLevels } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 27: For all prices and reference-level sets, the Structural_Liquidity_SR feature equals the minimum absolute distance to the nearest of Previous Day High/Low, Previous Week High/Low, and 20-Day High/Low.
//
// Validates: Requirement 13.6.

// Finite, non-NaN prices across a range wide enough to exercise both tightly
// clustered and far-apart reference levels.
const priceArb = fc.double({ min: -10_000, max: 10_000, noNaN: true });

// A StructuralLevels set is six independent finite prices. They intentionally
// need not satisfy any ordering invariant (e.g. high >= low): Property 27 is a
// pure "minimum absolute distance to the nearest of six references" statement,
// so any six numbers form a valid input to the function under test.
const structuralLevelsArb: fc.Arbitrary<StructuralLevels> = fc.record({
  prevDayHigh: priceArb,
  prevDayLow: priceArb,
  prevWeekHigh: priceArb,
  prevWeekLow: priceArb,
  high20d: priceArb,
  low20d: priceArb,
});

describe("Property 27: Structural_Liquidity_SR is the nearest structural level distance", () => {
  it("equals the minimum absolute distance over the six reference levels", () => {
    fc.assert(
      fc.property(priceArb, structuralLevelsArb, (price, levels) => {
        const actual = structuralLiquidityDistanceFromLevels(price, levels);

        // Independently re-derive the expected minimum over exactly the six
        // documented references (Previous Day High/Low, Previous Week High/Low,
        // 20-Day High/Low).
        const references = [
          levels.prevDayHigh,
          levels.prevDayLow,
          levels.prevWeekHigh,
          levels.prevWeekLow,
          levels.high20d,
          levels.low20d,
        ];
        const expected = Math.min(
          ...references.map((level) => Math.abs(price - level)),
        );

        // Distance is a non-negative magnitude.
        expect(actual).toBeGreaterThanOrEqual(0);
        // The feature equals the minimum nearest-level distance exactly.
        expect(actual).toBe(expected);
      }),
      { numRuns: 300 },
    );
  });
});
