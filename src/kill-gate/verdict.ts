// Walk-Forward Verdict Composition (Task 6.5).
//
// Requirements 11.2, 11.9, 11.10, 11.11, 11.13, 19, 5.4, 5.5, 12.1;
// Design Component 7.
//
// This module composes the two gates across the walk-forward folds into a
// single config-level verdict, then persists it and auto-appends it to the
// Research_Log. The three concerns are deliberately separated:
//
//   1. `composeGateVerdict()` — a PURE, deterministic function that takes the
//      per-fold gate inputs (matched firing subset + friction-adjustable
//      excursions) and produces the {@link GateVerdict}. No I/O.
//   2. `persistGateVerdict()` — a thin adapter that writes the verdict + its
//      per-fold rows through an injected {@link GateVerdictStore}.
//   3. `logGateVerdict()` — auto-appends the aggregate + per-fold verdicts and
//      the accuracy-vs-baseline / risk-adjusted-vs-baseline metrics to the
//      Research_Log via the injected {@link LivingDocs} writer (Req 5.4, 5.5,
//      11.11), routing PASS through appendVerdict and CUT through appendCut.
//
// The composition rule (Requirements 11.13, 19.3, 19.5): a config PASSES iff it
// passes BOTH Gate 1 and Gate 2 on EVERY qualifying fold — a fold whose matched
// firing subset meets the ≥30-sample floor. Folds below the floor are SKIPPED
// and recorded (excluded from pass/fail). A single failing qualifying fold =>
// CUT. Gate 2 is evaluated only after Gate 1 passes on that fold (Req 11.8).

import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import type { ForwardOutcome } from "../retrieval/types.js";
import {
  GATE1_SAMPLE_SIZE_FLOOR,
  type Gate1FiringSample,
  type Gate1Result,
  type Gate2Result,
  type FoldVerdict,
  type GateMetrics,
  type GateVerdict,
  type GateVerdictSplit,
  type GateVerdictStore,
  type PersistVerdictReport,
} from "./types.js";
import { evaluateGate1 } from "./gate1.js";
import { evaluateGate2 } from "./gate2.js";
import type { LivingDocs, GateVerdictSummary } from "../living-docs/livingDocs.js";

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

/**
 * Compose the config-level {@link GateVerdict} from per-fold gate inputs.
 *
 * For each fold: Gate 1 is evaluated over the matched firing subset; a fold
 * whose subset is below the ≥30-sample floor is marked `skipped` and excluded
 * from the pass/fail determination (Requirements 11.5, 19.5). Gate 2 is
 * evaluated only after Gate 1 passes on that fold (Requirement 11.8). A
 * qualifying fold's per-fold verdict is PASS iff both gates passed.
 *
 * The aggregate verdict is PASS iff there is at least one qualifying fold AND
 * every qualifying fold passed both gates (Requirements 11.13, 19.3); a single
 * failing qualifying fold => CUT. When no fold qualifies, the verdict is CUT
 * (nothing was proven out-of-sample).
 *
 * Aggregate `gate1`/`gate2` are recomputed over the UNION of the qualifying
 * folds' firing subsets / excursions (out-of-sample only; Req 11.2, 11.3), so
 * the aggregate metrics reflect the pooled matched sample rather than a mean of
 * per-fold ratios.
 *
 * Pure and deterministic: identical inputs always produce identical verdicts;
 * fold ordering does not affect the aggregate gate metrics or the verdict.
 */
export function composeGateVerdict(
  configId: string,
  folds: readonly FoldGateInput[],
): GateVerdict {
  const foldVerdicts: FoldVerdict[] = [];

  // Pooled inputs for the aggregate gates over the union of qualifying folds.
  const unionFiring: Gate1FiringSample[] = [];
  const unionModelOutcomes: ForwardOutcome[] = [];
  const unionBaselineOutcomes: ForwardOutcome[] = [];

  let qualifyingFolds = 0;
  let skippedFolds = 0;
  let allQualifyingPass = true;

  const ordered = [...folds].sort((a, b) => a.foldIndex - b.foldIndex);

  for (const fold of ordered) {
    const gate1 = evaluateGate1(fold.firingSubset);
    const gate2 = evaluateGate2({
      pair: fold.pair,
      horizon: fold.horizon,
      gate1Passed: gate1.passed,
      modelOutcomes: fold.modelOutcomes,
      baselineOutcomes: fold.baselineOutcomes,
    });

    const skipped = gate1.sampleSize < GATE1_SAMPLE_SIZE_FLOOR;
    const passed = !skipped && gate1.passed && gate2.passed;

    foldVerdicts.push({
      foldIndex: fold.foldIndex,
      sampleSize: gate1.sampleSize,
      skipped,
      gate1,
      gate2,
      verdict: passed ? "PASS" : "CUT",
    });

    if (skipped) {
      skippedFolds += 1;
      continue;
    }

    // Qualifying fold: contributes to the aggregate and the pass/fail decision.
    qualifyingFolds += 1;
    unionFiring.push(...fold.firingSubset);
    unionModelOutcomes.push(...fold.modelOutcomes);
    unionBaselineOutcomes.push(...fold.baselineOutcomes);
    if (!passed) {
      allQualifyingPass = false;
    }
  }

  // Aggregate Gate 1 over the pooled firing subset of qualifying folds.
  const aggregateGate1: Gate1Result = evaluateGate1(unionFiring);
  // Aggregate Gate 2 over the pooled excursions; only meaningful once Gate 1
  // passes (same sequencing as per-fold, Req 11.8). Use the first qualifying
  // fold's pair/horizon — a single config evaluates one pair/horizon per run.
  const firstQualifying = ordered.find(
    (f) => f.firingSubset.length >= GATE1_SAMPLE_SIZE_FLOOR,
  );
  const aggregateGate2: Gate2Result = evaluateGate2({
    pair: firstQualifying?.pair ?? ordered[0]?.pair ?? "EURUSD",
    horizon: firstQualifying?.horizon ?? ordered[0]?.horizon ?? 1,
    gate1Passed: aggregateGate1.passed,
    modelOutcomes: unionModelOutcomes,
    baselineOutcomes: unionBaselineOutcomes,
  });

  const verdict: "PASS" | "CUT" =
    qualifyingFolds > 0 && allQualifyingPass ? "PASS" : "CUT";

  const metrics: GateMetrics = {
    qualifyingFolds,
    skippedFolds,
    totalFolds: ordered.length,
    accuracyVsBaseline: aggregateGate1.deltaPp,
    riskAdjustedVsBaseline: aggregateGate2.margin,
  };

  return {
    configId,
    foldVerdicts,
    gate1: aggregateGate1,
    gate2: aggregateGate2,
    sampleSize: unionFiring.length,
    verdict,
    metrics,
  };
}

/**
 * Persist an aggregate {@link GateVerdict} and its per-fold verdicts through the
 * injected {@link GateVerdictStore} (writes the `gate_verdicts` row plus the
 * `gate_fold_verdicts` rows). Side-effecting adapter kept separate from the
 * pure composition.
 */
export function persistGateVerdict(
  store: GateVerdictStore,
  verdict: GateVerdict,
  split: GateVerdictSplit,
): Promise<PersistVerdictReport> {
  return store.persistVerdict(verdict, split);
}

/**
 * Render the accuracy-vs-baseline and risk-adjusted-vs-baseline metrics plus a
 * compact per-fold verdict summary into the freeform `metrics` string the
 * Research_Log entry carries (Requirements 11.11, 19.4). Pure helper.
 */
export function renderVerdictMetrics(verdict: GateVerdict): string {
  const m = verdict.metrics;
  const perFold = verdict.foldVerdicts
    .map((f) => {
      if (f.skipped) {
        return `fold ${f.foldIndex}: SKIPPED (n=${f.sampleSize} < ${GATE1_SAMPLE_SIZE_FLOOR})`;
      }
      return (
        `fold ${f.foldIndex}: ${f.verdict} ` +
        `(n=${f.sampleSize}, g1Δ=${round(f.gate1.deltaPp)} g1=${f.gate1.passed}, ` +
        `g2margin=${round(f.gate2.margin)} g2=${f.gate2.passed})`
      );
    })
    .join("; ");

  return (
    `accuracyVsBaseline=${round(m.accuracyVsBaseline)} ` +
    `riskAdjustedVsBaseline=${round(m.riskAdjustedVsBaseline)} ` +
    `qualifyingFolds=${m.qualifyingFolds} skippedFolds=${m.skippedFolds} ` +
    `totalFolds=${m.totalFolds} | ${perFold}`
  );
}

/** Round to 4 decimals for stable, readable log metrics. */
function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : value;
}

/**
 * Project a {@link GateVerdict} onto the {@link GateVerdictSummary} shape the
 * Living-Docs writer renders. The aggregate gate results drive the entry's
 * Gate 1 / Gate 2 lines; {@link renderVerdictMetrics} supplies the metrics line
 * carrying accuracy-vs-baseline, risk-adjusted-vs-baseline, and per-fold
 * verdicts (Requirements 11.11, 19.4).
 */
export function toVerdictSummary(verdict: GateVerdict): GateVerdictSummary {
  return {
    configId: verdict.configId,
    verdict: verdict.verdict,
    gate1: {
      modelAccuracy: verdict.gate1.modelAccuracy,
      baselineAccuracy: verdict.gate1.baselineAccuracy,
      deltaPp: verdict.gate1.deltaPp,
      passed: verdict.gate1.passed,
    },
    gate2: {
      modelRiskAdj: verdict.gate2.modelRiskAdj,
      baselineRiskAdj: verdict.gate2.baselineRiskAdj,
      margin: verdict.gate2.margin,
      passed: verdict.gate2.passed,
    },
    sampleSize: verdict.sampleSize,
    metrics: renderVerdictMetrics(verdict),
  };
}

/**
 * Auto-append the aggregate verdict + per-fold verdicts and their
 * accuracy-vs-baseline / risk-adjusted-vs-baseline metrics to the Research_Log
 * (Requirements 5.4, 11.11). A PASS is logged via `appendVerdict`; a CUT is
 * logged as a cut with metrics via `appendCut` (Requirement 5.5, 11.10).
 */
export function logGateVerdict(
  docs: LivingDocs,
  verdict: GateVerdict,
): Promise<void> {
  const summary = toVerdictSummary(verdict);
  return verdict.verdict === "PASS"
    ? docs.appendVerdict(summary)
    : docs.appendCut(summary);
}

/**
 * End-to-end composition for one config run: compute the verdict, persist it
 * (aggregate + per-fold), and auto-append it to the Research_Log. Returns the
 * composed verdict and the persistence report. The pure computation is exposed
 * separately via {@link composeGateVerdict} for testing; this convenience
 * orchestrates the two injected side-effecting dependencies.
 */
export async function evaluateAndRecordVerdict(
  args: {
    readonly configId: string;
    readonly folds: readonly FoldGateInput[];
    readonly split: GateVerdictSplit;
    readonly store: GateVerdictStore;
    readonly docs: LivingDocs;
  },
): Promise<{ readonly verdict: GateVerdict; readonly persisted: PersistVerdictReport }> {
  const verdict = composeGateVerdict(args.configId, args.folds);
  const persisted = await persistGateVerdict(args.store, verdict, args.split);
  await logGateVerdict(args.docs, verdict);
  return { verdict, persisted };
}
