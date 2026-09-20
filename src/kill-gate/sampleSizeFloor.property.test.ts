import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import { evaluateGate1 } from "./gate1.js";
import { composeGateVerdict, type FoldGateInput } from "./verdict.js";
import { GATE1_SAMPLE_SIZE_FLOOR, type Gate1FiringSample } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 19: For all configurations whose matched Analogue_Neighborhood contains fewer than 30 analogues, the Kill_Gate withholds a pass/cut evaluation for that configuration.
//
// Validates: Requirement 11.5

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;

const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  ...DIRECTIONS,
);

/** A firing Decision_Date on the Out_Of_Sample_Test with model/baseline/actual. */
const firingSampleArb: fc.Arbitrary<Gate1FiringSample> = fc.record({
  decisionDate: fc
    .integer({ min: 0, max: 9999 })
    .map((n) => `2020-01-${String((n % 28) + 1).padStart(2, "0")}`),
  modelPrediction: directionArb,
  baselinePrediction: directionArb,
  actual: directionArb,
});

/** A firing subset that is BELOW the ≥30-sample floor (size in [0, 29]). */
const belowFloorSubsetArb: fc.Arbitrary<readonly Gate1FiringSample[]> =
  fc.array(firingSampleArb, {
    minLength: 0,
    maxLength: GATE1_SAMPLE_SIZE_FLOOR - 1,
  });

/** A firing subset that MEETS the ≥30-sample floor (size >= 30). */
const atOrAboveFloorSubsetArb: fc.Arbitrary<readonly Gate1FiringSample[]> =
  fc.array(firingSampleArb, {
    minLength: GATE1_SAMPLE_SIZE_FLOOR,
    maxLength: GATE1_SAMPLE_SIZE_FLOOR + 40,
  });

/** A neutral forward outcome (excursion values irrelevant to this property). */
function outcome(): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips: 5, maePips: 3 };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/** Build a single-fold input carrying `firingSubset` and matching outcomes. */
function foldInput(
  foldIndex: number,
  firingSubset: readonly Gate1FiringSample[],
): FoldGateInput {
  const outcomes = firingSubset.map(() => outcome());
  return {
    foldIndex,
    pair: "EURUSD",
    horizon: 1,
    firingSubset,
    modelOutcomes: outcomes,
    baselineOutcomes: outcomes,
  };
}

describe("Property 19: sample-size floor withholds pass/cut below 30 analogues", () => {
  it("Gate 1 withholds evaluation (evaluated=false, passed=false) for every firing subset below the floor", () => {
    fc.assert(
      fc.property(belowFloorSubsetArb, (firingSubset) => {
        const result = evaluateGate1(firingSubset);

        // Below the floor: the pass/cut evaluation is WITHHELD — neither a pass
        // nor a cut. (Requirement 11.5)
        expect(firingSubset.length).toBeLessThan(GATE1_SAMPLE_SIZE_FLOOR);
        expect(result.evaluated).toBe(false);
        expect(result.passed).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("Gate 1 DOES evaluate (evaluated=true) once the firing subset meets the floor (contrast)", () => {
    fc.assert(
      fc.property(atOrAboveFloorSubsetArb, (firingSubset) => {
        const result = evaluateGate1(firingSubset);

        expect(firingSubset.length).toBeGreaterThanOrEqual(
          GATE1_SAMPLE_SIZE_FLOOR,
        );
        expect(result.evaluated).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("a fold whose firing subset is below the floor is marked skipped and excluded from the aggregate pass/fail", () => {
    fc.assert(
      fc.property(belowFloorSubsetArb, (firingSubset) => {
        const verdict = composeGateVerdict("cfg", [foldInput(0, firingSubset)]);

        const fold = verdict.foldVerdicts[0];
        expect(fold).toBeDefined();
        expect(fold?.skipped).toBe(true);
        expect(fold?.gate1.evaluated).toBe(false);
        expect(fold?.gate1.passed).toBe(false);

        // Excluded from the pass/fail: no qualifying fold means the config is
        // not marked PASS on the strength of a below-floor fold. (Req 19.5)
        expect(verdict.metrics.qualifyingFolds).toBe(0);
        expect(verdict.metrics.skippedFolds).toBe(1);
        expect(verdict.verdict).toBe("CUT");
      }),
      { numRuns: 200 },
    );
  });

  it("a below-floor fold does not contribute to the aggregate even when a qualifying fold is present", () => {
    fc.assert(
      fc.property(
        belowFloorSubsetArb,
        atOrAboveFloorSubsetArb,
        (belowSubset, qualifyingSubset) => {
          const verdict = composeGateVerdict("cfg", [
            foldInput(0, belowSubset),
            foldInput(1, qualifyingSubset),
          ]);

          const belowFold = verdict.foldVerdicts.find((f) => f.foldIndex === 0);
          const qualFold = verdict.foldVerdicts.find((f) => f.foldIndex === 1);

          expect(belowFold?.skipped).toBe(true);
          expect(qualFold?.skipped).toBe(false);

          // Only the qualifying fold's firing subset is pooled into the
          // aggregate sample; the below-floor fold contributes nothing.
          expect(verdict.metrics.qualifyingFolds).toBe(1);
          expect(verdict.metrics.skippedFolds).toBe(1);
          expect(verdict.sampleSize).toBe(qualifyingSubset.length);
        },
      ),
      { numRuns: 200 },
    );
  });
});
