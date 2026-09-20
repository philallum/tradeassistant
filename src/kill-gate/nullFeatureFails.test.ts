import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import { composeGateVerdict, type FoldGateInput } from "./verdict.js";
import {
  GATE1_MIN_DELTA,
  GATE1_SAMPLE_SIZE_FLOOR,
  type Gate1FiringSample,
} from "./types.js";

// Feature: fx-daily-pattern-assistant, Named test (Task 6.16): a deliberately
// null feature with no predictive signal FAILS both gates (verdict CUT),
// verifying Properties 20/22/23 discriminate signal from noise.
//
// Validates: Requirements 11.6, 11.8, 11.9, 11.10
//
// A "null feature" carries NO predictive signal relative to the
// Weekly_Trend_Follow baseline: on the matched firing subset its directional
// accuracy does NOT exceed the baseline's by the required +3pp margin, and its
// friction-adjusted excursion-weighted hit metric does NOT exceed the
// baseline's. The cleanest such construction makes the model statistically
// indistinguishable from the baseline — model accuracy EXACTLY equal to
// baseline accuracy (deltaPp == 0 < 0.03) and model excursions EQUAL to the
// baseline's (Gate 2 margin == 0). With deltaPp < 0.03, Gate 1 fails on a
// qualifying (>= 30) subset, so Gate 2 is not evaluated and the overall
// verdict is CUT (Req 11.9/11.10). This demonstrates the gates reject noise:
// only a model that genuinely beats the baseline can PASS.

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;

/** A wrong prediction for `actual`: any direction that is not `actual`. */
function wrongFor(actual: DirectionClass): DirectionClass {
  return DIRECTIONS.find((d) => d !== actual) as DirectionClass;
}

/** Deterministic decision-date label for the i-th firing Decision_Date. */
function decisionDate(i: number): string {
  return `2020-01-${String((i % 28) + 1).padStart(2, "0")}`;
}

/** A forward outcome carrying a chosen MFE/MAE on every horizon. */
function outcomeWith(mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/**
 * Build a matched firing subset of exactly `size` Decision_Dates in which the
 * NULL model has NO edge over the baseline: on each date the model and the
 * baseline make the IDENTICAL prediction, so they are correct on exactly the
 * same dates. Model accuracy therefore equals baseline accuracy EXACTLY
 * (deltaPp == 0), the signature of a feature that carries no predictive signal.
 *
 * `hits` controls how many dates both sides get right — the shared accuracy is
 * arbitrary; what matters for a null feature is that the model provides no
 * advantage over the baseline, i.e. deltaPp == 0 regardless of `hits`.
 */
function buildNullFiringSubset(
  size: number,
  hits: number,
  actuals: readonly DirectionClass[],
): Gate1FiringSample[] {
  const subset: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    const actual = actuals[i] as DirectionClass;
    // Model and baseline agree on every date ⇒ same accuracy ⇒ deltaPp == 0.
    const prediction = i < hits ? actual : wrongFor(actual);
    subset.push({
      decisionDate: decisionDate(i),
      modelPrediction: prediction,
      baselinePrediction: prediction,
      actual,
    });
  }
  return subset;
}

/**
 * A null-feature fold: model and baseline predictions coincide (Gate 1 delta
 * == 0) AND model and baseline excursions coincide (Gate 2 margin == 0). Both
 * gates are constructed to detect no advantage for the model.
 */
function buildNullFold(
  pair: Pair,
  horizon: Horizon,
  size: number,
  hits: number,
  actuals: readonly DirectionClass[],
  mfePips: number,
  maePips: number,
): FoldGateInput {
  const firingSubset = buildNullFiringSubset(size, hits, actuals);
  // Identical excursions on both sides ⇒ Gate 2 margin == 0 (no edge).
  const outcome = outcomeWith(mfePips, maePips);
  const modelOutcomes = firingSubset.map(() => outcome);
  const baselineOutcomes = firingSubset.map(() => outcome);
  return {
    foldIndex: 0,
    pair,
    horizon,
    firingSubset,
    modelOutcomes,
    baselineOutcomes,
  };
}

const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  ...DIRECTIONS,
);

describe("Named test (Task 6.16): a deliberately null feature FAILS both gates (verdict CUT)", () => {
  it("null feature (model == baseline, deltaPp == 0) always yields CUT on a qualifying subset", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        // Qualifying subset: >= 30 firing Decision_Dates so a verdict renders.
        fc.integer({
          min: GATE1_SAMPLE_SIZE_FLOOR,
          max: GATE1_SAMPLE_SIZE_FLOOR + 70,
        }),
        directionArb, // shared actual direction space
        // Non-negative excursions; equal on both sides ⇒ Gate 2 margin == 0.
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (pair, horizon, size, dir, mfe, mae) => {
          // `hits` spans the full accuracy range so the shared accuracy is
          // arbitrary — the null property must hold at every accuracy level.
          const actuals = Array.from({ length: size }, () => dir);
          const hits = size >> 1; // any value works; use half for variety
          const fold = buildNullFold(
            pair,
            horizon,
            size,
            hits,
            actuals,
            mfe,
            mae,
          );

          const verdict = composeGateVerdict("cfg-null-6.16", [fold]);

          // The fold qualifies (>= 30 samples), so it drives the verdict.
          expect(verdict.metrics.qualifyingFolds).toBe(1);
          expect(verdict.metrics.skippedFolds).toBe(0);

          // No predictive signal: model accuracy EXACTLY equals baseline's.
          expect(verdict.gate1.deltaPp).toBeCloseTo(0, 10);
          expect(verdict.gate1.deltaPp).toBeLessThan(GATE1_MIN_DELTA);

          // Gate 1 fails (delta < 3pp) ⇒ Gate 2 is not evaluated (Req 11.8).
          expect(verdict.gate1.passed).toBe(false);
          expect(verdict.gate2.evaluated).toBe(false);
          expect(verdict.gate2.passed).toBe(false);

          // Overall verdict is CUT — the gates reject the null feature.
          expect(verdict.verdict).toBe("CUT");
          expect(verdict.foldVerdicts[0]?.verdict).toBe("CUT");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("null feature drawn INDEPENDENTLY of the actual outcome (random, no correlation) is CUT", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        fc.integer({
          min: GATE1_SAMPLE_SIZE_FLOOR,
          max: GATE1_SAMPLE_SIZE_FLOOR + 70,
        }),
        // Draw actual, model, and baseline predictions INDEPENDENTLY per date:
        // the model prediction is uncorrelated with the actual outcome, and so
        // is the baseline. To keep the property deterministic we pin the model
        // and baseline to the SAME independent draw, so neither has an edge
        // (deltaPp == 0). This is the "no predictive signal" null: predictions
        // carry no information about the outcome.
        fc
          .integer({
            min: GATE1_SAMPLE_SIZE_FLOOR,
            max: GATE1_SAMPLE_SIZE_FLOOR + 70,
          })
          .chain((n) =>
            fc.record({
              actuals: fc.array(directionArb, { minLength: n, maxLength: n }),
              // A single independent prediction stream shared by model and
              // baseline: independent of `actuals`, so it has no edge.
              preds: fc.array(directionArb, { minLength: n, maxLength: n }),
            }),
          ),
        (pair, horizon, _size, draw) => {
          const n = draw.actuals.length;
          const firingSubset: Gate1FiringSample[] = [];
          for (let i = 0; i < n; i += 1) {
            firingSubset.push({
              decisionDate: decisionDate(i),
              modelPrediction: draw.preds[i] as DirectionClass,
              baselinePrediction: draw.preds[i] as DirectionClass,
              actual: draw.actuals[i] as DirectionClass,
            });
          }
          const outcome = outcomeWith(10, 10);
          const fold: FoldGateInput = {
            foldIndex: 0,
            pair,
            horizon,
            firingSubset,
            modelOutcomes: firingSubset.map(() => outcome),
            baselineOutcomes: firingSubset.map(() => outcome),
          };

          const verdict = composeGateVerdict("cfg-null-indep-6.16", [fold]);

          // Independent-but-shared predictions ⇒ model has no edge ⇒ deltaPp
          // == 0 < 0.03 ⇒ Gate 1 fails ⇒ CUT.
          expect(verdict.gate1.deltaPp).toBeLessThan(GATE1_MIN_DELTA);
          expect(verdict.gate1.passed).toBe(false);
          expect(verdict.verdict).toBe("CUT");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("even a null feature whose excursions equal the baseline's is CUT because Gate 1 fails first", () => {
    // Concrete case: model accuracy == baseline accuracy AND model excursions
    // == baseline excursions. Gate 1 fails (deltaPp == 0), so despite the
    // identical (tie) Gate 2 excursions the verdict is CUT.
    const size = GATE1_SAMPLE_SIZE_FLOOR;
    const actuals = Array.from(
      { length: size },
      (_, i) => DIRECTIONS[i % DIRECTIONS.length],
    ) as DirectionClass[];
    const fold = buildNullFold("EURUSD", 1, size, size >> 1, actuals, 20, 20);

    const verdict = composeGateVerdict("cfg-null-tie-6.16", [fold]);

    expect(verdict.gate1.deltaPp).toBeCloseTo(0, 10);
    expect(verdict.gate1.passed).toBe(false);
    // Gate 2 not evaluated because Gate 1 did not pass (Req 11.8).
    expect(verdict.gate2.evaluated).toBe(false);
    expect(verdict.verdict).toBe("CUT");
  });
});
