import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { encodePatternVector } from "./patternEncoder.js";
import type { Candle } from "../guard/types.js";

// Feature: fx-daily-pattern-assistant, Property 9: Pattern vector is shape-only and scale-invariant
//
// For all input windows and positive price scalars, encoding the window and
// encoding the window with all prices multiplied by that scalar produce identical
// Pattern_Vectors, so absolute price level does not dominate the representation.
//
// Validates: Requirement 8.2.

const candleWindowArb: fc.Arbitrary<{
  window: Candle[];
  decisionDate: string;
}> = fc
  .tuple(
    fc.integer({ min: 40, max: 60 }),
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
        source: "scale-test",
      });
    }

    const lastDt = new Date(start.getTime() + count * 86_400_000);
    const decisionDate = lastDt.toISOString().slice(0, 10);

    return { window, decisionDate };
  });

const positiveScalarArb = fc.oneof(
  fc.double({ min: 0.01, max: 0.99, noNaN: true }),
  fc.double({ min: 1.01, max: 100.0, noNaN: true }),
  fc.double({ min: 100.0, max: 10000.0, noNaN: true }),
);

describe("Property 9: Shape-only scale invariance", () => {
  it("multiplication by any positive scalar produces an identical PatternVector", () => {
    fc.assert(
      fc.property(
        candleWindowArb,
        positiveScalarArb,
        ({ window, decisionDate }, scalar) => {
          // Base vector
          const baseVector = encodePatternVector(window, decisionDate);

          // Scaled window (all prices multiplied by scalar)
          const scaledWindow: Candle[] = window.map((c) => ({
            ...c,
            open: c.open * scalar,
            high: c.high * scalar,
            low: c.low * scalar,
            close: c.close * scalar,
          }));

          const scaledVector = encodePatternVector(scaledWindow, decisionDate);

          // 1. Weekly trend sign must be strictly identical
          expect(scaledVector.weeklyTrendSign).toBe(baseVector.weeklyTrendSign);

          // 2. Fixed dimension must be identical (70)
          expect(scaledVector.dim).toBe(baseVector.dim);
          expect(scaledVector.embedding.length).toBe(baseVector.embedding.length);

          // 3. Each element of the embedding must be identical within floating point tolerance
          for (let i = 0; i < baseVector.embedding.length; i++) {
            const baseVal = baseVector.embedding[i]!;
            const scaledVal = scaledVector.embedding[i]!;
            expect(Math.abs(baseVal - scaledVal)).toBeLessThan(1e-4);
          }

          // 4. Per-scale slices must match
          for (let i = 0; i < baseVector.scale10.length; i++) {
            expect(
              Math.abs(baseVector.scale10[i]! - scaledVector.scale10[i]!),
            ).toBeLessThan(1e-4);
          }
          for (let i = 0; i < baseVector.scale20.length; i++) {
            expect(
              Math.abs(baseVector.scale20[i]! - scaledVector.scale20[i]!),
            ).toBeLessThan(1e-4);
          }
          for (let i = 0; i < baseVector.scale40.length; i++) {
            expect(
              Math.abs(baseVector.scale40[i]! - scaledVector.scale40[i]!),
            ).toBeLessThan(1e-4);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
