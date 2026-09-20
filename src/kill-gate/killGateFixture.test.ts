import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  DirectionClass,
  ForwardOutcome,
  HorizonOutcome,
} from "../retrieval/types.js";
import { composeGateVerdict, type FoldGateInput } from "./verdict.js";
import {
  GATE1_SAMPLE_SIZE_FLOOR,
  type Gate1FiringSample,
} from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 1 (kill-gate scope): the harness reproduces known metrics on a fixed fixture.
//
// Validates: Requirements 3.1, 11.12
//
// This is the mandated kill-gate fixture-reproducibility named test. It pins the
// two-stage Kill_Gate composition (`composeGateVerdict`) down to concrete,
// hand-computed metric values on a recorded fixture (Req 11.12), and asserts
// that repeated invocation on identical inputs is deeply equal (Req 3.1 —
// deterministic reproducibility of the harness).

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;

/** A direction that is guaranteed to be wrong for `actual`. */
function wrongFor(actual: DirectionClass): DirectionClass {
  return DIRECTIONS.find((d) => d !== actual) as DirectionClass;
}

/** Deterministic Decision_Date label for the i-th firing date. */
function decisionDate(fold: number, i: number): string {
  const day = String((i % 28) + 1).padStart(2, "0");
  const month = String((fold % 12) + 1).padStart(2, "0");
  return `2020-${month}-${day}`;
}

/**
 * Build a matched firing subset of exactly `size` Decision_Dates in which the
 * model is correct on exactly `modelCorrect` dates and the baseline is correct
 * on exactly `baselineCorrect` dates. Both are scored against the same per-date
 * `actual` (the conditional / matched-sample comparison).
 */
function buildFiringSubset(
  fold: number,
  size: number,
  modelCorrect: number,
  baselineCorrect: number,
): Gate1FiringSample[] {
  const subset: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    // Cycle actuals through the three directions deterministically.
    const actual = DIRECTIONS[i % DIRECTIONS.length] as DirectionClass;
    subset.push({
      decisionDate: decisionDate(fold, i),
      modelPrediction: i < modelCorrect ? actual : wrongFor(actual),
      baselinePrediction: i < baselineCorrect ? actual : wrongFor(actual),
      actual,
    });
  }
  return subset;
}

/** A ForwardOutcome with identical MFE/MAE on every horizon (drives Gate 2). */
function uniformOutcome(mfePips: number, maePips: number): ForwardOutcome {
  const h: HorizonOutcome = { direction: "UP", mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

function repeatOutcome(
  count: number,
  mfePips: number,
  maePips: number,
): ForwardOutcome[] {
  return Array.from({ length: count }, () => uniformOutcome(mfePips, maePips));
}

/**
 * The hand-authored, recorded fixture.
 *
 * Fold 0 — QUALIFYING (n = 40, above the 30-sample floor):
 *   Gate 1: model correct on 36/40 => modelAccuracy = 0.90; baseline correct on
 *           30/40 => baselineAccuracy = 0.75; deltaPp = 0.15 (>= 0.03) => PASS.
 *   Gate 2 (EURUSD friction = 1.5 pips, horizon 1):
 *     model    mfe=10, mae=2 => (10 - 1.5) - (2 + 1.5) = 8.5 - 3.5 =  5.0
 *     baseline mfe= 6, mae=3 => ( 6 - 1.5) - (3 + 1.5) = 4.5 - 4.5 =  0.0
 *     margin = 5.0 - 0.0 = 5.0 (>= 0) => PASS.
 *   Fold verdict: PASS (both gates pass).
 *
 * Fold 1 — SKIPPED (n = 5, below the 30-sample floor):
 *   excluded from the aggregate pass/fail and from the pooled union.
 *
 * Aggregate is pooled over the qualifying folds only (just fold 0), so the
 * aggregate metrics equal fold 0's metrics exactly.
 */
function buildFixture(): FoldGateInput[] {
  const qualifying: FoldGateInput = {
    foldIndex: 0,
    pair: "EURUSD",
    horizon: 1,
    firingSubset: buildFiringSubset(0, 40, 36, 30),
    modelOutcomes: repeatOutcome(40, 10, 2),
    baselineOutcomes: repeatOutcome(40, 6, 3),
  };

  const skipped: FoldGateInput = {
    foldIndex: 1,
    pair: "EURUSD",
    horizon: 1,
    firingSubset: buildFiringSubset(1, 5, 5, 0),
    modelOutcomes: repeatOutcome(5, 10, 2),
    baselineOutcomes: repeatOutcome(5, 6, 3),
  };

  return [qualifying, skipped];
}

describe("Property 1 (kill-gate scope): the harness reproduces known metrics on a fixed fixture", () => {
  it("produces the EXACTLY hand-computed GateVerdict metrics on the recorded fixture (Req 11.12)", () => {
    const verdict = composeGateVerdict("config-fixture-1", buildFixture());

    // ---- Aggregate Gate 1 (pooled over qualifying fold 0 only) ----
    expect(verdict.gate1.sampleSize).toBe(40);
    expect(verdict.gate1.evaluated).toBe(true);
    expect(verdict.gate1.modelAccuracy).toBeCloseTo(0.9, 10); // 36 / 40
    expect(verdict.gate1.baselineAccuracy).toBeCloseTo(0.75, 10); // 30 / 40
    expect(verdict.gate1.deltaPp).toBeCloseTo(0.15, 10); // 0.90 - 0.75
    expect(verdict.gate1.passed).toBe(true);

    // ---- Aggregate Gate 2 (EURUSD friction 1.5, horizon 1) ----
    expect(verdict.gate2.evaluated).toBe(true);
    expect(verdict.gate2.modelRiskAdj).toBeCloseTo(5.0, 10);
    expect(verdict.gate2.baselineRiskAdj).toBeCloseTo(0.0, 10);
    expect(verdict.gate2.margin).toBeCloseTo(5.0, 10);
    expect(verdict.gate2.passed).toBe(true);

    // ---- Aggregate verdict + metrics ----
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.sampleSize).toBe(40); // union of qualifying folds only
    expect(verdict.metrics.qualifyingFolds).toBe(1);
    expect(verdict.metrics.skippedFolds).toBe(1);
    expect(verdict.metrics.totalFolds).toBe(2);
    expect(verdict.metrics.accuracyVsBaseline).toBeCloseTo(0.15, 10);
    expect(verdict.metrics.riskAdjustedVsBaseline).toBeCloseTo(5.0, 10);

    // ---- Per-fold verdicts ----
    expect(verdict.foldVerdicts).toHaveLength(2);

    const fold0 = verdict.foldVerdicts.find((f) => f.foldIndex === 0);
    expect(fold0).toBeDefined();
    expect(fold0?.skipped).toBe(false);
    expect(fold0?.sampleSize).toBe(40);
    expect(fold0?.verdict).toBe("PASS");
    expect(fold0?.gate1.passed).toBe(true);
    expect(fold0?.gate1.deltaPp).toBeCloseTo(0.15, 10);
    expect(fold0?.gate2.passed).toBe(true);
    expect(fold0?.gate2.margin).toBeCloseTo(5.0, 10);

    const fold1 = verdict.foldVerdicts.find((f) => f.foldIndex === 1);
    expect(fold1).toBeDefined();
    expect(fold1?.skipped).toBe(true);
    expect(fold1?.sampleSize).toBe(5);
    expect(fold1?.gate1.evaluated).toBe(false); // below the 30-sample floor
    expect(fold1?.gate2.evaluated).toBe(false); // Gate 2 only after Gate 1 pass
  });

  it("invoking composeGateVerdict twice on identical inputs yields deeply-equal verdicts (Req 3.1)", () => {
    const first = composeGateVerdict("config-fixture-1", buildFixture());
    const second = composeGateVerdict("config-fixture-1", buildFixture());
    expect(second).toStrictEqual(first);
  });

  it("is deterministic across arbitrary fold inputs: double invocation is deeply equal (Req 3.1)", () => {
    const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
      ...DIRECTIONS,
    );

    const outcomeArb: fc.Arbitrary<ForwardOutcome> = fc
      .record({
        mfe: fc.double({ min: 0, max: 50, noNaN: true }),
        mae: fc.double({ min: 0, max: 50, noNaN: true }),
      })
      .map(({ mfe, mae }) => uniformOutcome(mfe, mae));

    const firingArb: fc.Arbitrary<Gate1FiringSample> = fc.record({
      decisionDate: fc.integer({ min: 0, max: 27 }).map((d) =>
        `2021-06-${String(d + 1).padStart(2, "0")}`,
      ),
      modelPrediction: directionArb,
      baselinePrediction: directionArb,
      actual: directionArb,
    });

    // Generate a fold whose firing subset comfortably straddles the floor so
    // both qualifying and skipped branches are exercised across runs.
    const foldArb: fc.Arbitrary<FoldGateInput> = fc
      .record({
        foldIndex: fc.integer({ min: 0, max: 10 }),
        pair: fc.constantFrom(
          "EURUSD" as const,
          "GBPUSD" as const,
          "USDJPY" as const,
          "USDCHF" as const,
          "USDCAD" as const,
        ),
        horizon: fc.constantFrom(1 as const, 2 as const, 3 as const),
        subset: fc.array(firingArb, {
          minLength: 0,
          maxLength: GATE1_SAMPLE_SIZE_FLOOR + 20,
        }),
        model: fc.array(outcomeArb, { minLength: 0, maxLength: 50 }),
        baseline: fc.array(outcomeArb, { minLength: 0, maxLength: 50 }),
      })
      .map(({ foldIndex, pair, horizon, subset, model, baseline }) => ({
        foldIndex,
        pair,
        horizon,
        firingSubset: subset,
        modelOutcomes: model,
        baselineOutcomes: baseline,
      }));

    fc.assert(
      fc.property(
        fc.array(foldArb, { minLength: 1, maxLength: 6 }),
        (folds) => {
          const a = composeGateVerdict("config-x", folds);
          const b = composeGateVerdict("config-x", folds);
          expect(b).toStrictEqual(a);
        },
      ),
      { numRuns: 200 },
    );
  });
});
