import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import { evaluateGate1 } from "./gate1.js";
import { composeEvaluationReport, type FoldGateInput } from "./verdict.js";
import {
  GATE1_SAMPLE_SIZE_FLOOR,
  type EvaluationSplit,
  type Gate1FiringSample,
} from "./types.js";

/** A fixed out-of-sample split; the floor property does not depend on it. */
const SPLIT: EvaluationSplit = {
  trainEnd: "2019-12-31",
  testStart: "2020-01-01",
  testEnd: "2020-12-31",
};

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

describe("Property 19: sample-size floor withholds the evaluation below 30 analogues", () => {
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

  it("a fold whose firing subset is below the floor is excluded from the pooled measurement (nothing is proven)", () => {
    fc.assert(
      fc.property(belowFloorSubsetArb, (firingSubset) => {
        const report = composeEvaluationReport("cfg", [foldInput(0, firingSubset)], SPLIT);

        // Excluded from the pool: the below-floor fold contributes no matched
        // sample, so the report measures nothing (Req 11.5, 19.5). The predictions
        // are still RECORDED in predictionsCount so the thin read is visible.
        expect(report.sampleSize).toBe(0);
        expect(report.predictionsCount).toBe(firingSubset.length);

        // With no matched sample the interval spans the full range: no read possible.
        expect(report.uncertainty.accuracyDeltaCI).toEqual([-1, 1]);
        expect(report.annotations.deltaExceeds3pp).toBe(false);
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
          const report = composeEvaluationReport(
            "cfg",
            [foldInput(0, belowSubset), foldInput(1, qualifyingSubset)],
            SPLIT,
          );

          // Only the qualifying fold's firing subset is pooled into the
          // aggregate sample; the below-floor fold contributes nothing to it,
          // but its predictions are still counted in predictionsCount.
          expect(report.sampleSize).toBe(qualifyingSubset.length);
          expect(report.predictionsCount).toBe(
            belowSubset.length + qualifyingSubset.length,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
