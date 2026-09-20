// Gate 1 — Conditional / matched-subset directional comparison (Task 6.3).
//
// Requirements 11.3, 11.5, 11.6; Design Component 7, Properties 18/19/20.
//
// `evaluateGate1()` is a pure, deterministic function (Requirement 3.2): given
// the model's firing subset on the Out_Of_Sample_Test — each firing
// Decision_Date paired with the model's prediction, the Weekly_Trend_Follow
// baseline's prediction on the SAME date, and the actual matured outcome — it
// scores the model's directional accuracy against the baseline's accuracy on
// that identical matched subset and decides Gate 1.
//
// Because the model is silent-by-default and fires on only a small subset of
// Decision_Dates, Gate 1 is a CONDITIONAL comparison: the baseline is scored on
// exactly the Decision_Dates where the model fires — never over all trading
// days (Requirement 11.6).
//
// The caller supplies firing predictions, actual matured outcomes, and baseline
// predictions as typed inputs; nothing is fetched internally. All supplied
// samples must belong to the Out_Of_Sample_Test partition (Requirement 11.3) —
// upstream fold selection guarantees this, and Gate 1 scores exactly the rows
// it is handed.

import type { DirectionClass } from "../retrieval/types.js";
import {
  GATE1_MIN_DELTA,
  GATE1_SAMPLE_SIZE_FLOOR,
  type Gate1FiringSample,
  type Gate1Result,
} from "./types.js";

/**
 * Evaluate Gate 1 over the model's matched firing subset.
 *
 * Both accuracies are the fraction of firing Decision_Dates whose predicted
 * direction equals the actual matured outcome direction, measured on the SAME
 * set of firing dates (a conditional / matched-sample comparison). Gate 1
 * passes iff the subset meets the ≥30-sample floor AND
 * `modelAccuracy - baselineAccuracy >= 0.03` (3 percentage points).
 *
 * Sample-size floor (Requirement 11.5): when the firing subset contains fewer
 * than {@link GATE1_SAMPLE_SIZE_FLOOR} Decision_Dates, the pass/fail evaluation
 * is WITHHELD — the result reports `evaluated: false` and `passed: false`
 * (neither a pass nor a cut). The accuracy fields still report what was
 * measurable on the undersized subset (0 on an empty subset) for diagnostics.
 *
 * Pure and deterministic: identical inputs always produce identical results;
 * ordering of `firingSubset` does not affect the outcome.
 *
 * @param firingSubset The matched firing subset on the Out_Of_Sample_Test. Each
 *   entry is a firing Decision_Date with the model prediction, the baseline
 *   prediction on the same date, and the actual matured outcome.
 * @returns A {@link Gate1Result} of shape
 *   `{ modelAccuracy, baselineAccuracy, deltaPp, sampleSize, evaluated, passed }`.
 */
export function evaluateGate1(
  firingSubset: readonly Gate1FiringSample[],
): Gate1Result {
  const sampleSize = firingSubset.length;

  const modelAccuracy = accuracy(firingSubset, (s) => s.modelPrediction);
  const baselineAccuracy = accuracy(firingSubset, (s) => s.baselinePrediction);
  const deltaPp = modelAccuracy - baselineAccuracy;

  // Sample-size floor: below the floor, withhold the pass/fail (Req 11.5).
  const evaluated = sampleSize >= GATE1_SAMPLE_SIZE_FLOOR;
  const passed = evaluated && deltaPp >= GATE1_MIN_DELTA;

  return {
    modelAccuracy,
    baselineAccuracy,
    deltaPp,
    sampleSize,
    evaluated,
    passed,
  };
}

/**
 * Fraction of firing samples whose selected prediction equals the actual
 * matured outcome direction. Returns 0 for an empty subset (no dates scored).
 */
function accuracy(
  firingSubset: readonly Gate1FiringSample[],
  predict: (sample: Gate1FiringSample) => DirectionClass,
): number {
  if (firingSubset.length === 0) {
    return 0;
  }
  let correct = 0;
  for (const sample of firingSubset) {
    if (predict(sample) === sample.actual) {
      correct += 1;
    }
  }
  return correct / firingSubset.length;
}
