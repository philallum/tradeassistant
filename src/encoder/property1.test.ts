import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { encodePatternVector } from "./patternEncoder.js";
import type { Candle } from "../guard/types.js";

// Feature: fx-daily-pattern-assistant, Property 1: Deterministic reproducibility (Encoder Scope)
//
// For all valid inputs to the pattern-vector encoder, invoking it twice with
// identical inputs produces identical outputs.
//
// Validates: Requirements 3.1, 3.2, 8.5, 8.6.

const windowLengthArb = fc.integer({ min: 10, max: 60 });

const regularWindowArb: fc.Arbitrary<{
  window: Candle[];
  decisionDate: string;
}> = fc
  .tuple(
    windowLengthArb,
    fc.double({ min: 0.1, max: 200.0, noNaN: true }),
    fc.array(fc.double({ min: -0.05, max: 0.05, noNaN: true }), {
      minLength: 60,
      maxLength: 60,
    }),
  )
  .map(([count, basePrice, steps]) => {
    const window: Candle[] = [];
    let current = basePrice;
    const start = new Date("2025-01-01");

    for (let i = 0; i < count; i++) {
      const dt = new Date(start.getTime() + i * 86_400_000);
      const date = dt.toISOString().slice(0, 10);
      const step = steps[i] ?? 0;
      current = Math.max(0.01, current + step);
      window.push({
        asset: "EURUSD",
        date,
        open: current,
        high: current + 0.005,
        low: Math.max(0.001, current - 0.005),
        close: current,
        source: "test-feed",
      });
    }

    const lastDt = new Date(start.getTime() + count * 86_400_000);
    const decisionDate = lastDt.toISOString().slice(0, 10);

    return { window, decisionDate };
  });

const zeroVarianceWindowArb: fc.Arbitrary<{
  window: Candle[];
  decisionDate: string;
}> = fc
  .tuple(windowLengthArb, fc.double({ min: 0.1, max: 200.0, noNaN: true }))
  .map(([count, constantPrice]) => {
    const window: Candle[] = [];
    const start = new Date("2025-01-01");

    for (let i = 0; i < count; i++) {
      const dt = new Date(start.getTime() + i * 86_400_000);
      const date = dt.toISOString().slice(0, 10);
      window.push({
        asset: "EURUSD",
        date,
        open: constantPrice,
        high: constantPrice,
        low: constantPrice,
        close: constantPrice,
        source: "test-feed",
      });
    }

    const lastDt = new Date(start.getTime() + count * 86_400_000);
    const decisionDate = lastDt.toISOString().slice(0, 10);

    return { window, decisionDate };
  });

const anyValidInputArb = fc.oneof(regularWindowArb, zeroVarianceWindowArb);

describe("Property 1 (Encoder Scope): Deterministic Reproducibility", () => {
  it("invoking encode twice on identical input produces identical Pattern_Vectors", () => {
    fc.assert(
      fc.property(anyValidInputArb, ({ window, decisionDate }) => {
        const run1 = encodePatternVector(window, decisionDate);
        const run2 = encodePatternVector(window, decisionDate);

        // Exact deep equality
        expect(run1).toEqual(run2);
        expect(run1.dim).toBe(70);
        expect(run2.dim).toBe(70);
        expect(run1.weeklyTrendSign).toBe(run2.weeklyTrendSign);
        expect(run1.embedding).toEqual(run2.embedding);
        expect(run1.scale10).toEqual(run2.scale10);
        expect(run1.scale20).toEqual(run2.scale20);
        expect(run1.scale40).toEqual(run2.scale40);
      }),
      { numRuns: 300 },
    );
  });
});
