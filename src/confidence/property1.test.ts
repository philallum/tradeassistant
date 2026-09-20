import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { classify, earnedConfidence, selectHorizon } from "./confidenceSelector.js";
import type { Horizon } from "./types.js";
import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import type { Pair } from "../ingestion/types.js";

// Feature: fx-daily-pattern-assistant, Property 1: For all valid inputs to a scoring or evaluation function, invoking it twice with identical inputs produces identical outputs (confidence scope).
//
// Validates: Requirements 3.1, 10.7

const PAIRS: readonly Pair[] = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
] as const;

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;
const HORIZONS: readonly Horizon[] = [1, 2, 3] as const;

/** Arbitrary for a single AnalogueRecord with a varied horizon/direction mix. */
const analogueArb: fc.Arbitrary<AnalogueRecord> = fc.record({
  asset: fc.constantFrom(...PAIRS),
  // Build the decision date from a bounded integer day-offset so the arbitrary
  // can never yield an invalid Date (fast-check's date arbitrary can). Safe
  // pattern mirrored from property12.test.ts.
  decisionDate: fc
    .integer({ min: 0, max: 9131 }) // days from 2000-01-01 through ~2025-01-01
    .map((days) =>
      new Date(Date.UTC(2000, 0, 1) + days * 86_400_000)
        .toISOString()
        .slice(0, 10),
    ),
  horizon: fc.constantFrom(...HORIZONS),
  direction: fc.constantFrom(...DIRECTIONS),
  mfePips: fc.double({ min: 0, max: 500, noNaN: true }),
  maePips: fc.double({ min: 0, max: 500, noNaN: true }),
  atr14: fc.double({ min: 0.0001, max: 0.05, noNaN: true }),
  matured: fc.boolean(),
});

// Neighborhoods vary in size, including the empty neighborhood (minLength: 0).
const neighborhoodArb: fc.Arbitrary<AnalogueRecord[]> = fc.array(analogueArb, {
  minLength: 0,
  maxLength: 120,
});

describe("Property 1: confidence-scope determinism", () => {
  it("earnedConfidence returns strictly identical values for identical inputs", () => {
    fc.assert(
      fc.property(
        neighborhoodArb,
        fc.constantFrom(...HORIZONS),
        (neighborhood, horizon) => {
          const first = earnedConfidence(neighborhood, horizon);
          const second = earnedConfidence(neighborhood, horizon);
          // Strict identity: same inputs -> byte-identical output (Req 3.1, 10.7).
          expect(second).toBe(first);
          // A fresh, structurally-identical copy must also produce the same value:
          // the function must not depend on object identity or hidden state.
          const copy = neighborhood.map((a) => ({ ...a }));
          expect(earnedConfidence(copy, horizon)).toBe(first);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("selectHorizon returns strictly identical values for identical inputs", () => {
    fc.assert(
      fc.property(neighborhoodArb, (neighborhood) => {
        const first = selectHorizon(neighborhood);
        const second = selectHorizon(neighborhood);
        expect(second).toBe(first);
        const copy = neighborhood.map((a) => ({ ...a }));
        expect(selectHorizon(copy)).toBe(first);
      }),
      { numRuns: 200 },
    );
  });

  it("classify returns strictly identical values for identical inputs", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 0.05, noNaN: true }),
        (netMovePips, atr14) => {
          const first = classify(netMovePips, atr14);
          const second = classify(netMovePips, atr14);
          expect(second).toBe(first);
        },
      ),
      { numRuns: 200 },
    );
  });
});
