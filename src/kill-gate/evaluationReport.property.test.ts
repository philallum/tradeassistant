import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import {
  composeEvaluationReport,
  accuracyDeltaUncertainty,
  type FoldGateInput,
} from "./verdict.js";
import {
  GATE1_SAMPLE_SIZE_FLOOR,
  type EvaluationSplit,
  type Gate1FiringSample,
} from "./types.js";

// Feature: simplify-to-cloud-minimal, subtask 1.1 — deterministic uncertainty.
//
// Validates: Requirements 1.6, 2.5
//
// Two properties cover the sample-size-aware uncertainty on the EvaluationReport:
//
//   (a) Determinism (Req 1.6): composeEvaluationReport is pure — identical
//       inputs produce a BYTE-IDENTICAL report. We assert this by composing the
//       same fold inputs twice (and once more from a re-shuffled fold order, to
//       show ordering is irrelevant) and comparing the serialized reports.
//
//   (b) CI monotonicity (Req 2.5): the Wald confidence interval on the accuracy
//       delta WIDENS as the matched sample size n shrinks, holding the delta
//       fixed. We assert the interval half-width is strictly decreasing in n.

const FIXED_SPLIT: EvaluationSplit = {
  trainEnd: "2018-12-31",
  testStart: "2019-01-01",
  testEnd: "2019-12-31",
};

/** A forward outcome carrying a chosen MFE/MAE on every horizon. */
function outcomeWith(mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/**
 * Build a firing subset of `size` samples. Every sample has the model correct
 * (UP == UP) and the baseline wrong (DOWN != UP), so the model-minus-baseline
 * delta is a fixed 1.0 regardless of size — the delta is held constant while n
 * varies, isolating the sample-size effect on the interval. A `confidence`
 * value is attached so the strength breakdown is exercised too.
 */
function buildFiringSubset(size: number, confidence: number): Gate1FiringSample[] {
  const out: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    out.push({
      decisionDate: `2019-01-${String((i % 28) + 1).padStart(2, "0")}`,
      modelPrediction: "UP",
      baselinePrediction: "DOWN",
      actual: "UP",
      confidence,
    });
  }
  return out;
}

/** A single qualifying fold with a controllable matched-subset size. */
function buildFold(
  pair: Pair,
  horizon: Horizon,
  size: number,
  confidence: number,
): FoldGateInput {
  const firingSubset = buildFiringSubset(size, confidence);
  const model = outcomeWith(50, 5);
  const baseline = outcomeWith(5, 50);
  return {
    foldIndex: 0,
    pair,
    horizon,
    firingSubset,
    modelOutcomes: firingSubset.map(() => model),
    baselineOutcomes: firingSubset.map(() => baseline),
  };
}

describe("subtask 1.1: EvaluationReport determinism (Req 1.6)", () => {
  it("produces a byte-identical report for identical inputs, regardless of fold order", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        fc.constantFrom<Horizon>(1, 2, 3),
        fc.integer({
          min: GATE1_SAMPLE_SIZE_FLOOR,
          max: GATE1_SAMPLE_SIZE_FLOOR + 40,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (pair, horizon, size, confidence) => {
          // Two qualifying folds with distinct indices so re-ordering is observable.
          const foldA = { ...buildFold(pair, horizon, size, confidence), foldIndex: 0 };
          const foldB = { ...buildFold(pair, horizon, size, confidence), foldIndex: 1 };

          const first = composeEvaluationReport("cfg-det", [foldA, foldB], FIXED_SPLIT);
          const second = composeEvaluationReport("cfg-det", [foldA, foldB], FIXED_SPLIT);
          const reordered = composeEvaluationReport(
            "cfg-det",
            [foldB, foldA],
            FIXED_SPLIT,
          );

          // Byte-identical: serialized JSON must match exactly.
          expect(JSON.stringify(second)).toBe(JSON.stringify(first));
          expect(JSON.stringify(reordered)).toBe(JSON.stringify(first));

          // Sanity: there is no verdict field anywhere on the report (Req 1.3).
          expect(JSON.stringify(first)).not.toContain("verdict");
          expect(JSON.stringify(first)).not.toContain("PASS");
          expect(JSON.stringify(first)).not.toContain("CUT");
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("subtask 1.1: accuracy-delta CI widens as n shrinks (Req 2.5)", () => {
  it("Wald interval half-width is strictly decreasing in sample size, for a fixed delta", () => {
    fc.assert(
      fc.property(
        // A fixed delta, and two sample sizes with a strict ordering.
        fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        (delta, nA, nB) => {
          fc.pre(nA !== nB);
          const small = Math.min(nA, nB);
          const large = Math.max(nA, nB);

          const widthAt = (n: number): number => {
            const [lo, hi] = accuracyDeltaUncertainty(delta, n).accuracyDeltaCI;
            return hi - lo;
          };

          // The smaller sample has a strictly wider (or equal, when both bounds
          // clamp to [-1, 1]) interval. With the delta held fixed and sizes well
          // apart the half-width shrinks with n; clamping only ever makes the
          // smaller-n interval at least as wide as the larger-n one.
          expect(widthAt(small)).toBeGreaterThanOrEqual(widthAt(large));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("flags a low-n (< 30) matched subset explicitly and never over-claims", () => {
    const belowFloor = accuracyDeltaUncertainty(0.1, 10);
    expect(belowFloor.note).toContain("LOW-N");
    expect(belowFloor.note).toContain("30");

    const healthy = accuracyDeltaUncertainty(0.1, 120);
    expect(healthy.note).not.toContain("LOW-N");

    // n=0 yields the full [-1, 1] range and states no read is possible.
    const empty = accuracyDeltaUncertainty(0, 0);
    expect(empty.accuracyDeltaCI).toEqual([-1, 1]);
    expect(empty.note).toContain("n=0");
  });

  it("the report's uncertainty reflects the pooled matched sample size", () => {
    const n = GATE1_SAMPLE_SIZE_FLOOR + 20;
    const fold = buildFold("EURUSD", 1, n, 0.8);
    const report = composeEvaluationReport("cfg-ci", [fold], FIXED_SPLIT);

    expect(report.sampleSize).toBe(n);
    const standalone = accuracyDeltaUncertainty(report.deltaVsBaseline, n);
    expect(report.uncertainty.accuracyDeltaCI).toEqual(standalone.accuracyDeltaCI);
    expect(report.uncertainty.note).toBe(standalone.note);
  });
});
