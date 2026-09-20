import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DirectionClass } from "../retrieval/types.js";
import { evaluateGate1 } from "./gate1.js";
import {
  GATE1_MIN_DELTA,
  GATE1_SAMPLE_SIZE_FLOOR,
  type Gate1FiringSample,
} from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 20: For all out-of-sample metrics, Gate_1 passes if and only if the pattern-model's directional accuracy exceeds the baseline's accuracy by at least 3 percentage points, where the baseline's accuracy is computed on the matched subset of Decision_Dates on which the model fires, and that matched subset contains at least 30 samples.
//
// Validates: Requirement 11.6

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;

/** A wrong prediction for `actual`: any direction that is not `actual`. */
function wrongFor(actual: DirectionClass): DirectionClass {
  return DIRECTIONS.find((d) => d !== actual) as DirectionClass;
}

/** Deterministic decision-date label for the i-th firing Decision_Date. */
function decisionDate(i: number): string {
  return `2020-01-${String((i % 28) + 1).padStart(2, "0")}`;
}

/**
 * Build a matched firing subset of exactly `size` Decision_Dates in which the
 * model is correct on exactly `modelCorrect` of them and the baseline is
 * correct on exactly `baselineCorrect` of them. Every prediction is scored
 * against the same per-date `actual`, so both accuracies are measured over the
 * identical firing subset (the conditional / matched-sample comparison).
 */
function buildFiringSubset(
  size: number,
  modelCorrect: number,
  baselineCorrect: number,
  actuals: readonly DirectionClass[],
): Gate1FiringSample[] {
  const subset: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    const actual = actuals[i] as DirectionClass;
    subset.push({
      decisionDate: decisionDate(i),
      modelPrediction: i < modelCorrect ? actual : wrongFor(actual),
      baselinePrediction: i < baselineCorrect ? actual : wrongFor(actual),
      actual,
    });
  }
  return subset;
}

const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  ...DIRECTIONS,
);

/**
 * Generator over matched firing subsets that MEET the ≥30-sample floor with a
 * fully controllable delta: pick a size >= 30, then independently choose how
 * many dates the model and the baseline each get correct. `actuals` are drawn
 * freely so the property does not depend on any particular direction.
 */
const controllableSubsetArb = fc
  .integer({ min: GATE1_SAMPLE_SIZE_FLOOR, max: GATE1_SAMPLE_SIZE_FLOOR + 70 })
  .chain((size) =>
    fc.record({
      size: fc.constant(size),
      modelCorrect: fc.integer({ min: 0, max: size }),
      baselineCorrect: fc.integer({ min: 0, max: size }),
      actuals: fc.array(directionArb, { minLength: size, maxLength: size }),
    }),
  )
  .map(({ size, modelCorrect, baselineCorrect, actuals }) =>
    buildFiringSubset(size, modelCorrect, baselineCorrect, actuals),
  );

describe("Property 20: Gate 1 passes iff model beats baseline by >= 3pp on the matched firing subset", () => {
  it("passes if and only if deltaPp >= GATE1_MIN_DELTA (0.03) for any subset meeting the floor", () => {
    fc.assert(
      fc.property(controllableSubsetArb, (firingSubset) => {
        const result = evaluateGate1(firingSubset);

        // Subset meets the ≥30-sample floor, so a verdict is rendered.
        expect(firingSubset.length).toBeGreaterThanOrEqual(
          GATE1_SAMPLE_SIZE_FLOOR,
        );
        expect(result.evaluated).toBe(true);

        // The iff: pass exactly when the model's directional accuracy exceeds
        // the baseline's by at least 3 percentage points. (Requirement 11.6)
        expect(result.passed).toBe(result.deltaPp >= GATE1_MIN_DELTA);
      }),
      { numRuns: 300 },
    );
  });

  it("measures baseline accuracy ONLY over the supplied firing dates (conditional / matched subset)", () => {
    fc.assert(
      fc.property(controllableSubsetArb, (firingSubset) => {
        const result = evaluateGate1(firingSubset);

        // Recompute both accuracies directly from the same firing rows; the
        // baseline is never scored on any date outside this matched subset.
        const n = firingSubset.length;
        const modelHits = firingSubset.filter(
          (s) => s.modelPrediction === s.actual,
        ).length;
        const baselineHits = firingSubset.filter(
          (s) => s.baselinePrediction === s.actual,
        ).length;

        expect(result.sampleSize).toBe(n);
        expect(result.modelAccuracy).toBeCloseTo(modelHits / n, 10);
        expect(result.baselineAccuracy).toBeCloseTo(baselineHits / n, 10);
        expect(result.deltaPp).toBeCloseTo(
          modelHits / n - baselineHits / n,
          10,
        );
      }),
      { numRuns: 300 },
    );
  });

  it("boundary: delta exactly 0.03 passes; just below 0.03 fails; above 0.03 passes", () => {
    // On a 100-date matched subset, 1 correct date == 1 percentage point, so
    // the delta lands on exact hundredths and we can pin the boundary.
    const size = 100;
    const baselineCorrect = 50;
    const actuals = Array.from({ length: size }, (_, i) =>
      DIRECTIONS[i % DIRECTIONS.length],
    ) as DirectionClass[];

    // deltaPp == 0.03 exactly (53 vs 50): passes.
    const atBoundary = buildFiringSubset(
      size,
      baselineCorrect + 3,
      baselineCorrect,
      actuals,
    );
    const atResult = evaluateGate1(atBoundary);
    expect(atResult.deltaPp).toBeCloseTo(0.03, 10);
    expect(atResult.passed).toBe(true);

    // deltaPp == 0.02 (just below the 3pp margin): fails.
    const belowBoundary = buildFiringSubset(
      size,
      baselineCorrect + 2,
      baselineCorrect,
      actuals,
    );
    const belowResult = evaluateGate1(belowBoundary);
    expect(belowResult.deltaPp).toBeCloseTo(0.02, 10);
    expect(belowResult.passed).toBe(false);

    // deltaPp == 0.04 (above the margin): passes.
    const aboveBoundary = buildFiringSubset(
      size,
      baselineCorrect + 4,
      baselineCorrect,
      actuals,
    );
    const aboveResult = evaluateGate1(aboveBoundary);
    expect(aboveResult.deltaPp).toBeCloseTo(0.04, 10);
    expect(aboveResult.passed).toBe(true);
  });
});
