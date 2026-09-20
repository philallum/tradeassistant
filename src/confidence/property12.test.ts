import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { earnedConfidence } from "./confidenceSelector.js";
import type { Horizon } from "./types.js";
import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import type { Pair } from "../ingestion/types.js";

// Feature: fx-daily-pattern-assistant, Property 12: For all Analogue_Neighborhoods and Horizons, the computed Earned_Confidence lies within the range [0,1].
//
// Validates: Requirement 10.2

const PAIRS: readonly Pair[] = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
] as const;

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;
const HORIZONS: readonly Horizon[] = [1, 2, 3] as const;

/** Arbitrary for a single AnalogueRecord with varied horizon and direction mix. */
const analogueArb: fc.Arbitrary<AnalogueRecord> = fc.record({
  asset: fc.constantFrom(...PAIRS),
  // Build the decision date from a bounded day-offset so the arbitrary can
  // never yield an invalid Date (fast-check's date arbitrary can).
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

describe("Property 12: Earned_Confidence is bounded within [0,1]", () => {
  it("returns a value within [0,1] for all neighborhoods and horizons", () => {
    fc.assert(
      fc.property(
        neighborhoodArb,
        fc.constantFrom(...HORIZONS),
        (neighborhood, horizon) => {
          const confidence = earnedConfidence(neighborhood, horizon);
          expect(Number.isNaN(confidence)).toBe(false);
          expect(confidence).toBeGreaterThanOrEqual(0);
          expect(confidence).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
