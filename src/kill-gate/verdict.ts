// Kill-Gate evaluation report composition (originally Walk-Forward Verdict Composition, Task 6.5).
//
// Requirements 1, 2, 8.2, 11.2, 11.13, 19, 12.1; Design Component C1/C4.
//
// This module composes the two gates across the walk-forward folds into a single
// human-read {@link EvaluationReport}, persists it and appends it to the
// Research_Log. The concerns are deliberately separated:
//
//   1. `composeEvaluationReport()` - a PURE, deterministic function that takes the
//      per-fold gate inputs (matched firing subset + friction-adjustable
//      excursions) and produces the report. No I/O.
//   2. `persistEvaluationReport()` - a thin adapter writing the report through an
//      injected {@link EvaluationReportStore}.
//   3. `logEvaluationReport()` - appends the report to the Research_Log through the
//      injected {@link LivingDocs} writer.
//
// There is NO PASS/CUT verdict: the former `composeGateVerdict` /
// `persistGateVerdict` / `logGateVerdict` path was removed in codebase-housekeeping
// Task 5. The former thresholds survive only as non-binding `annotations`.
//
// Pooling rule (Requirements 11.5, 19.5): a fold whose matched firing subset meets
// the >=30-sample floor QUALIFIES and is pooled; folds below the floor are SKIPPED
// (their predictions are still counted in `predictionsCount`). Gate 2 is evaluated
// only after Gate 1 passes on the pooled subset (Req 11.8).

import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import type { ForwardOutcome } from "../retrieval/types.js";
import {
  GATE1_MIN_DELTA,
  GATE1_SAMPLE_SIZE_FLOOR,
  type Gate1FiringSample,
  type Gate1Result,
  type Gate2Result,
  type EvaluationReport,
  type EvaluationReportStore,
  type EvaluationSplit,
  type EvaluationUncertainty,
  type MfeMaeSummary,
  type StrengthBreakdown,
} from "./types.js";
import { evaluateGate1 } from "./gate1.js";
import { evaluateGate2, frictionPenaltyPips } from "./gate2.js";
import type {
  LivingDocs,
  EvaluationReportSummary,
} from "../living-docs/livingDocs.js";

/**
 * All inputs needed to evaluate both gates on a single walk-forward fold's
 * out-of-sample test window. Everything is supplied by the caller (upstream
 * fold selection guarantees these rows belong to the test partition); the
 * composition fetches nothing.
 */
export interface FoldGateInput {
  readonly foldIndex: number;
  /** The currency pair — selects the symmetric Gate 2 Friction_Penalty. */
  readonly pair: Pair;
  /** The selected Horizon over which Gate 2 MFE/MAE are scored. */
  readonly horizon: Horizon;
  /**
   * The matched firing subset on this fold's test window: each firing
   * Decision_Date with the model prediction, the baseline prediction on the
   * same date, and the actual matured outcome (drives Gate 1, Req 11.6).
   */
  readonly firingSubset: readonly Gate1FiringSample[];
  /** Pattern-model forward outcomes on the matched firing subset (Gate 2). */
  readonly modelOutcomes: readonly ForwardOutcome[];
  /** Weekly_Trend_Follow baseline forward outcomes on the same subset (Gate 2). */
  readonly baselineOutcomes: readonly ForwardOutcome[];
}

// ===========================================================================
// Evaluation Report composition (simplify-to-cloud-minimal, Requirement 1;
// Design Decision 3 + Component C1).
//
// `composeEvaluationReport()` reframes the two-stage Kill_Gate output from an
// automatic PASS/CUT verdict into a human-read {@link EvaluationReport}. It
// applies walk-forward pooling (per-fold Gate 1 evaluation, qualifying/skipped
// folds, union pooling, aggregate gate recomputation) - the Measurement_Engine
// math is unchanged in behaviour (Requirement 1.1; it was shared with the
// legacy verdict composition before that path was removed). What changes is the OUTPUT: a
// metrics-plus-uncertainty report with NO verdict collapse (Requirement 1.3),
// and the former thresholds survive only as non-binding `annotations`
// (Requirement 1.5). The function is pure and deterministic — identical inputs
// produce a byte-identical report (Requirement 1.6).
//
// ===========================================================================

/** Confidence-band lower bounds for the Evaluation_Report strength breakdown. */
const STRENGTH_MODERATE_FLOOR = 0.55 as const;
const STRENGTH_STRONG_FLOOR = 0.7 as const;

/**
 * The z-multiplier for a two-sided 95% Wald confidence interval. Fixed so the
 * interval is deterministic (Requirement 1.6).
 */
const WALD_Z_95 = 1.959963984540054 as const;

/**
 * Compose a human-read {@link EvaluationReport} from the per-fold gate inputs.
 *
 * Each fold's Gate 1 is
 * evaluated over its matched firing subset; folds below the ≥30-sample floor are
 * SKIPPED (recorded in `predictionsCount` but excluded from the pooled subset);
 * Gate 2 is evaluated only after Gate 1 passes on the pooled subset (same
 * sequencing, Requirement 11.8). The aggregate Gate 1 / Gate 2 are recomputed
 * over the UNION of the qualifying folds' firing subsets / excursions
 * (out-of-sample only).
 *
 * The report carries the measured metrics, a sample-size-aware uncertainty
 * indication on the accuracy delta, a confidence-band strength breakdown, and
 * the two non-binding annotation flags. It has NO verdict field — no PASS/CUT
 * collapse is produced on this path (Requirement 1.3).
 *
 * Pure and deterministic: identical inputs always produce an identical report;
 * fold ordering does not affect any field.
 */
export function composeEvaluationReport(
  configId: string,
  folds: readonly FoldGateInput[],
  split: EvaluationSplit,
): EvaluationReport {
  // Pooled inputs for the aggregate gates over the union of qualifying folds.
  const unionFiring: Gate1FiringSample[] = [];
  const unionModelOutcomes: ForwardOutcome[] = [];
  const unionBaselineOutcomes: ForwardOutcome[] = [];
  let predictionsCount = 0;

  const ordered = [...folds].sort((a, b) => a.foldIndex - b.foldIndex);

  for (const fold of ordered) {
    predictionsCount += fold.firingSubset.length;

    // A fold qualifies when its matched firing subset meets the ≥30 floor —
    // the SAME qualification rule the verdict path uses (Req 11.5, 19.5).
    if (fold.firingSubset.length < GATE1_SAMPLE_SIZE_FLOOR) {
      continue;
    }
    unionFiring.push(...fold.firingSubset);
    unionModelOutcomes.push(...fold.modelOutcomes);
    unionBaselineOutcomes.push(...fold.baselineOutcomes);
  }

  // Aggregate Gate 1 over the pooled firing subset of qualifying folds.
  const aggregateGate1: Gate1Result = evaluateGate1(unionFiring);
  // Aggregate Gate 2 over the pooled excursions; only meaningful once Gate 1
  // passes (same sequencing as the verdict path, Req 11.8). Use the first
  // qualifying fold's pair/horizon — a single config evaluates one pair/horizon.
  const firstQualifying = ordered.find(
    (f) => f.firingSubset.length >= GATE1_SAMPLE_SIZE_FLOOR,
  );
  const pair = firstQualifying?.pair ?? ordered[0]?.pair ?? "EURUSD";
  const horizon = firstQualifying?.horizon ?? ordered[0]?.horizon ?? 1;
  const aggregateGate2: Gate2Result = evaluateGate2({
    pair,
    horizon,
    gate1Passed: aggregateGate1.passed,
    modelOutcomes: unionModelOutcomes,
    baselineOutcomes: unionBaselineOutcomes,
  });

  const mfeMaeSummary = summarizeFrictionAdjustedExcursions(
    pair,
    horizon,
    unionModelOutcomes,
    unionBaselineOutcomes,
  );

  const strengthBreakdown = breakdownByStrength(unionFiring);

  const uncertainty = accuracyDeltaUncertainty(
    aggregateGate1.deltaPp,
    unionFiring.length,
  );

  return {
    configId,
    split,
    sampleSize: unionFiring.length,
    predictionsCount,
    modelAccuracy: aggregateGate1.modelAccuracy,
    baselineAccuracy: aggregateGate1.baselineAccuracy,
    deltaVsBaseline: aggregateGate1.deltaPp,
    frictionAdjustedModel: aggregateGate2.modelRiskAdj,
    frictionAdjustedBaseline: aggregateGate2.baselineRiskAdj,
    mfeMaeSummary,
    strengthBreakdown,
    uncertainty,
    // Non-binding annotations only (Requirement 1.5): descriptive, never gates.
    annotations: {
      deltaExceeds3pp: aggregateGate1.deltaPp >= GATE1_MIN_DELTA,
      riskAdjNonNegative: aggregateGate2.margin >= 0,
    },
  };
}

/**
 * Deterministic Wald (normal-approximation) confidence interval on the accuracy
 * delta (`modelAccuracy - baselineAccuracy`) given the matched sample size
 * (Requirements 1.6, 2.5).
 *
 * The delta is a difference of two proportions measured on the SAME matched
 * subset, so the two accuracies are maximally dependent. We use the
 * conservative single-proportion normal-approximation standard error at the
 * neutral prior (p = 0.5), `se = z * sqrt(0.25 / n)`, as the half-width of a
 * symmetric interval centred on the observed delta. This is monotone in `n`:
 * the half-width widens as `n` shrinks, so a thinner subset yields a wider
 * interval. On an empty subset (`n === 0`) the interval is the full `[-1, 1]`
 * range (no information). The computation is pure — no clock, no randomness.
 *
 * `note` always states the sample size and, when the matched subset is below
 * the {@link GATE1_SAMPLE_SIZE_FLOOR} (30), carries an explicit LOW-N caveat so
 * a thin read is never presented as a confident one (Requirement 2.5).
 */
export function accuracyDeltaUncertainty(
  deltaVsBaseline: number,
  sampleSize: number,
): EvaluationUncertainty {
  if (sampleSize <= 0) {
    return {
      accuracyDeltaCI: [-1, 1],
      note:
        "No matched out-of-sample firing dates (n=0): the accuracy delta is " +
        "unmeasured and the interval spans the full range. No read is possible.",
    };
  }

  const halfWidth = WALD_Z_95 * Math.sqrt(0.25 / sampleSize);
  const lo = clampAccuracyDelta(deltaVsBaseline - halfWidth);
  const hi = clampAccuracyDelta(deltaVsBaseline + halfWidth);

  const belowFloor = sampleSize < GATE1_SAMPLE_SIZE_FLOOR;
  const base =
    `95% Wald interval on the accuracy delta from the matched subset ` +
    `(n=${sampleSize}); half-width ±${round4(halfWidth)}.`;
  const note = belowFloor
    ? `${base} LOW-N: the matched subset is below the ${GATE1_SAMPLE_SIZE_FLOOR}-sample ` +
      `floor, so this interval is wide and the read is not statistically meaningful.`
    : base;

  return { accuracyDeltaCI: [lo, hi], note };
}

/** Clamp an accuracy-delta bound to the achievable [-1, 1] range. */
function clampAccuracyDelta(value: number): number {
  return Math.max(-1, Math.min(1, round4(value)));
}

/**
 * Count the pooled matched firing samples by model-confidence band. Samples
 * without a recorded `confidence` are excluded from all three counts (Design
 * C1). Bands: weak < 0.55, moderate in [0.55, 0.70), strong >= 0.70.
 */
function breakdownByStrength(
  firing: readonly Gate1FiringSample[],
): StrengthBreakdown {
  let weak = 0;
  let moderate = 0;
  let strong = 0;
  for (const sample of firing) {
    if (typeof sample.confidence !== "number") {
      continue;
    }
    if (sample.confidence >= STRENGTH_STRONG_FLOOR) {
      strong += 1;
    } else if (sample.confidence >= STRENGTH_MODERATE_FLOOR) {
      moderate += 1;
    } else {
      weak += 1;
    }
  }
  return { weak, moderate, strong };
}

/**
 * Mean friction-adjusted favorable (MFE) and adverse (MAE) excursions of the
 * model and baseline over the selected horizon, after the symmetric
 * pair-specific Friction_Penalty — the same friction model Gate 2 uses. Empty
 * sets summarize to zeros. Pure helper.
 */
function summarizeFrictionAdjustedExcursions(
  pair: FoldGateInput["pair"],
  horizon: FoldGateInput["horizon"],
  modelOutcomes: readonly ForwardOutcome[],
  baselineOutcomes: readonly ForwardOutcome[],
): MfeMaeSummary {
  const friction = frictionPenaltyPips(pair);
  const model = meanAdjustedExcursions(modelOutcomes, horizon, friction);
  const baseline = meanAdjustedExcursions(baselineOutcomes, horizon, friction);
  return {
    modelMfe: model.mfe,
    modelMae: model.mae,
    baselineMfe: baseline.mfe,
    baselineMae: baseline.mae,
  };
}

/**
 * Mean friction-adjusted MFE/MAE over a set of outcomes at a horizon. The
 * favorable excursion has the friction deducted and the adverse excursion has
 * it added, each clamped at 0 — mirroring the Gate 2 friction treatment.
 */
function meanAdjustedExcursions(
  outcomes: readonly ForwardOutcome[],
  horizon: FoldGateInput["horizon"],
  frictionPips: number,
): { readonly mfe: number; readonly mae: number } {
  if (outcomes.length === 0) {
    return { mfe: 0, mae: 0 };
  }
  let mfeSum = 0;
  let maeSum = 0;
  for (const outcome of outcomes) {
    const h = outcome.perHorizon[horizon];
    mfeSum += Math.max(0, h.mfePips - frictionPips);
    maeSum += Math.max(0, h.maePips + frictionPips);
  }
  return {
    mfe: round4(mfeSum / outcomes.length),
    mae: round4(maeSum / outcomes.length),
  };
}

/** Round to 4 decimals for stable, reproducible report metrics. */
function round4(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : value;
}

/**
 * Project an {@link EvaluationReport} onto the {@link EvaluationReportSummary}
 * shape the Living-Docs writer renders into a RESEARCH-LOG evaluation entry
 * (simplify-to-cloud-minimal Requirements 2.2, 2.4). A structural pass-through:
 * the report already carries exactly the measured fields the summary renders,
 * and — like the report — the summary carries NO verdict in any form. Pure.
 */
export function toReportSummary(
  report: EvaluationReport,
): EvaluationReportSummary {
  return {
    configId: report.configId,
    split: {
      trainEnd: report.split.trainEnd,
      testStart: report.split.testStart,
      testEnd: report.split.testEnd,
    },
    sampleSize: report.sampleSize,
    predictionsCount: report.predictionsCount,
    modelAccuracy: report.modelAccuracy,
    baselineAccuracy: report.baselineAccuracy,
    deltaVsBaseline: report.deltaVsBaseline,
    frictionAdjustedModel: report.frictionAdjustedModel,
    frictionAdjustedBaseline: report.frictionAdjustedBaseline,
    mfeMaeSummary: report.mfeMaeSummary,
    strengthBreakdown: report.strengthBreakdown,
    uncertainty: report.uncertainty,
    annotations: report.annotations,
  };
}

/**
 * Persist an {@link EvaluationReport} through the injected
 * {@link EvaluationReportStore} (writes the `evaluation_reports` row). The
 * Side-effecting adapter kept separate from the pure composition.
 */
export function persistEvaluationReport(
  store: EvaluationReportStore,
  report: EvaluationReport,
): Promise<{ readonly reportId: string }> {
  return store.persistReport(report);
}

/**
 * Auto-append an {@link EvaluationReport} to the Research_Log via the injected
 * {@link LivingDocs} writer (simplify-to-cloud-minimal Requirements 2.2, 2.4).
 * It records the measured metrics with NO PASS/CUT routing and no verdict — a single evaluation entry,
 * regardless of what the metrics show.
 */
export function logEvaluationReport(
  docs: LivingDocs,
  report: EvaluationReport,
): Promise<void> {
  return docs.appendEvaluationReport(toReportSummary(report));
}

/**
 * End-to-end composition for one config evaluation on the report path: compose
 * the {@link EvaluationReport} over the fixed out-of-sample split, persist it
 * (through the {@link EvaluationReportStore}), and auto-append it to the
 * Research_Log — with NO verdict in any form (Requirement 1.3, 2.4).
 *
 * This is the report-path sibling of {@link evaluateAndRecordVerdict}: it is the
 * write path the evaluation flow now uses (simplify-to-cloud-minimal
 * Requirement 8.2). The verdict path is retained unchanged and left in place —
 * its backing `gate_verdicts` table is only dropped later (Phase 4) — but this
 * is the active write path for a recorded evaluation.
 *
 * The pure computation is exposed separately via {@link composeEvaluationReport}
 * for testing; this convenience orchestrates the two injected side-effecting
 * dependencies. Returns the composed report and its generated `reportId`.
 */
export async function evaluateAndRecordReport(
  args: {
    readonly configId: string;
    readonly folds: readonly FoldGateInput[];
    readonly split: EvaluationSplit;
    readonly store: EvaluationReportStore;
    readonly docs: LivingDocs;
  },
): Promise<{ readonly report: EvaluationReport; readonly reportId: string }> {
  const report = composeEvaluationReport(args.configId, args.folds, args.split);
  const { reportId } = await persistEvaluationReport(args.store, report);
  await logEvaluationReport(args.docs, report);
  return { report, reportId };
}
