import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { selectHorizon, rawResolutionRate } from "./confidenceSelector.js";
import type { Horizon } from "./types.js";
import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import type { Pair } from "../ingestion/types.js";

// Feature: fx-daily-pattern-assistant, Property 14: For all Analogue_Neighborhoods, the resolution rate at the selected Horizon is greater than or equal to the resolution rate at every other candidate Horizon (1, 2, 3).
//
// Validates: Requirement 10.6

const PAIRS: readonly Pair[] = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCHF",
  "USDCAD",
] as const;

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;
const HORIZONS: readonly Horizon[] = [1, 2, 3] as const;

/** Arbitrary for a single AnalogueRecord mixing horizons and UP/DOWN/FLAT. */
const analogueArb: fc.Arbitrary<AnalogueRecord> = fc.record({
  asset: fc.constantFrom(...PAIRS),
  // The decision date is irrelevant to horizon selection (only horizon and
  // direction drive rawResolutionRate), so any valid ISO date suffices.
  decisionDate: fc
    .date({
      min: new Date("2000-01-01T00:00:00Z"),
      max: new Date("2025-01-01T00:00:00Z"),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString().slice(0, 10)),
  horizon: fc.constantFrom(...HORIZONS),
  direction: fc.constantFrom(...DIRECTIONS),
  mfePips: fc.double({ min: 0, max: 500, noNaN: true }),
  maePips: fc.double({ min: 0, max: 500, noNaN: true }),
  atr14: fc.double({ min: 0.0001, max: 0.05, noNaN: true }),
  matured: fc.boolean(),
});

// Neighborhoods vary in size, including the empty neighborhood (minLength: 0).
// Because each analogue's horizon is drawn independently, generated
// neighborhoods naturally mix analogues across horizons 1/2/3 as well as
// exercise single-horizon and empty cases.
const neighborhoodArb: fc.Arbitrary<AnalogueRecord[]> = fc.array(analogueArb, {
  minLength: 0,
  maxLength: 120,
});

describe("Property 14: selected horizon maximizes resolution rate", () => {
  it("selects a horizon whose resolution rate >= every other horizon", () => {
    fc.assert(
      fc.property(neighborhoodArb, (neighborhood) => {
        const selected = selectHorizon(neighborhood);
        const selectedRate = rawResolutionRate(neighborhood, selected);

        for (const h of HORIZONS) {
          expect(selectedRate).toBeGreaterThanOrEqual(
            rawResolutionRate(neighborhood, h),
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it("is deterministic: repeated calls yield the same horizon", () => {
    fc.assert(
      fc.property(neighborhoodArb, (neighborhood) => {
        expect(selectHorizon(neighborhood)).toBe(selectHorizon(neighborhood));
      }),
      { numRuns: 200 },
    );
  });
});
