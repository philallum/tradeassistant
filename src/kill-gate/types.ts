// Two-Stage Kill-Gate Harness Types (Requirements 11, 19, Design Component 7).
//
// This file defines the walk-forward fold model and its storage PORT.
// Only the walk-forward-fold slice (task 6.2) is implemented here; the gate
// evaluation types (Gate 1 / Gate 2 / verdicts) are added by later tasks.

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";

/**
 * A single sequential, non-overlapping walk-forward fold.
 *
 * Every train window strictly precedes its test window
 * (`trainEnd < testStart`). Boundaries are fixed once recorded
 * (`frozen === true`). (Requirements 11.2, 19.1, 19.2)
 */
export interface WalkForwardFold {
  readonly foldIndex: number;
  readonly trainStart: TradingDate;
  readonly trainEnd: TradingDate;
  readonly testStart: TradingDate;
  readonly testEnd: TradingDate;
  /** True once the fold boundaries have been recorded and are immutable. */
  readonly frozen: boolean;
}

/**
 * Configuration for `walkForwardFolds()`. Defaults match the design's
 * ~3-year train / ~1-year test rolling scheme (Requirements 11.2, 19.1).
 *
 * Windows are expressed in trading days. Using trading days (not calendar
 * days) keeps the construction deterministic and independent of weekends,
 * and it aligns with the Monday-Friday daily-candle history the harness
 * evaluates against. ~3 years ≈ 756 trading days, ~1 year ≈ 252.
 */
export interface WalkForwardConfig {
  /** Trading days in each fold's train window. Default 756 (~3 years). */
  readonly trainDays: number;
  /** Trading days in each fold's test window. Default 252 (~1 year). */
  readonly testDays: number;
}

/** Default walk-forward window sizing (~3y train / ~1y test). */
export const DEFAULT_WALK_FORWARD_CONFIG: WalkForwardConfig = {
  trainDays: 756,
  testDays: 252,
};

/**
 * Typed rejection returned when a caller attempts to overwrite already-recorded
 * fold boundaries with different dates (change-rejection). The originally
 * recorded dates are retained. (Requirement 11.4, 19.2)
 */
export interface FoldChangeRejection {
  readonly reason: "fold_change_rejected";
  readonly asset: Pair;
  readonly foldIndex: number;
  readonly recorded: WalkForwardFold;
  readonly attempted: WalkForwardFold;
  readonly message: string;
}

/**
 * Storage PORT for the `walk_forward_folds` table, keyed by (asset, fold_index).
 * Allows compute to run against any backend (in-memory, Supabase).
 * (Requirement 17.1)
 */
export interface WalkForwardFoldStore {
  /**
   * Persist folds for an asset with frozen boundaries. Idempotent for
   * identical boundaries; rejects any attempt to change the recorded dates of
   * an already-persisted (asset, fold_index) and retains the original.
   * (Requirements 19.1, 19.2, 11.4)
   */
  persistFolds(
    asset: Pair,
    folds: readonly WalkForwardFold[],
  ): Promise<PersistFoldsReport>;

  /** Read the recorded folds for an asset, ordered by fold_index. */
  getFolds(asset: Pair): Promise<readonly WalkForwardFold[]>;
}

/** Outcome of a `persistFolds` call. */
export interface PersistFoldsReport {
  readonly recorded: number;
  readonly unchanged: number;
  readonly rejected: readonly FoldChangeRejection[];
}

/**
 * In-memory reference implementation of {@link WalkForwardFoldStore}.
 *
 * Mirrors the immutability semantics of `data_splits` / `walk_forward_folds`:
 * once a fold is recorded for a given (asset, fold_index), a later write with
 * different boundary dates is rejected and the original is retained. A repeat
 * write with identical dates is treated as a no-op (idempotent).
 */
export class InMemoryWalkForwardFoldStore implements WalkForwardFoldStore {
  // Key format: `${asset}:${foldIndex}`
  private readonly store = new Map<string, WalkForwardFold>();

  persistFolds(
    asset: Pair,
    folds: readonly WalkForwardFold[],
  ): Promise<PersistFoldsReport> {
    let recorded = 0;
    let unchanged = 0;
    const rejected: FoldChangeRejection[] = [];

    for (const fold of folds) {
      const key = `${asset}:${fold.foldIndex}`;
      const existing = this.store.get(key);
      const frozenFold: WalkForwardFold = { ...fold, frozen: true };

      if (existing === undefined) {
        this.store.set(key, frozenFold);
        recorded += 1;
        continue;
      }

      if (sameBoundaries(existing, frozenFold)) {
        unchanged += 1;
        continue;
      }

      // Recorded dates differ from the attempted write: reject and retain.
      rejected.push({
        reason: "fold_change_rejected",
        asset,
        foldIndex: fold.foldIndex,
        recorded: existing,
        attempted: frozenFold,
        message:
          `Fold ${fold.foldIndex} for ${asset} is already recorded and frozen; ` +
          `attempt to change its boundary dates was rejected and the original retained.`,
      });
    }

    return Promise.resolve({ recorded, unchanged, rejected });
  }

  getFolds(asset: Pair): Promise<readonly WalkForwardFold[]> {
    const out: WalkForwardFold[] = [];
    for (const [key, fold] of this.store) {
      if (key.startsWith(`${asset}:`)) {
        out.push(fold);
      }
    }
    out.sort((a, b) => a.foldIndex - b.foldIndex);
    return Promise.resolve(out);
  }

  clear(): void {
    this.store.clear();
  }
}

/** True when two folds have identical boundary dates (frozen flag ignored). */
function sameBoundaries(a: WalkForwardFold, b: WalkForwardFold): boolean {
  return (
    a.trainStart === b.trainStart &&
    a.trainEnd === b.trainEnd &&
    a.testStart === b.testStart &&
    a.testEnd === b.testEnd
  );
}

// ---------------------------------------------------------------------------
// Gate 1 — Conditional / matched-subset directional comparison (Task 6.3).
//
// Requirements 11.3, 11.5, 11.6; Design Component 7, Properties 18/19/20.
//
// Gate 1 is a CONDITIONAL, matched-sample comparison. Because the model is
// silent-by-default and fires on only a small subset of Decision_Dates, the
// model's directional accuracy is compared against the Weekly_Trend_Follow
// baseline's accuracy computed on the SAME subset of Decision_Dates where the
// model produces a firing setup — never against the baseline's accuracy over
// all trading days.
// ---------------------------------------------------------------------------

/**
 * The Sample_Size_Floor for Gate 1: the matched firing subset must contain at
 * least this many Decision_Dates before a pass/fail is evaluated. Consistent
 * with the retrieval / confidence 30-analogue floor (Requirements 11.5, 11.6).
 */
export const GATE1_SAMPLE_SIZE_FLOOR = 30 as const;

/**
 * The Gate 1 directional-accuracy margin, expressed as a fraction (3 percentage
 * points). Gate 1 passes only where `modelAccuracy - baselineAccuracy` is at
 * least this margin (Requirement 11.6).
 */
export const GATE1_MIN_DELTA = 0.03 as const;

/**
 * A single firing Decision_Date on the Out_Of_Sample_Test, paired with the
 * model's predicted direction, the baseline's predicted direction on the same
 * date, and the actual matured forward outcome direction against which both are
 * scored.
 *
 * Only dates where the model fires a setup are included — this IS the matched
 * firing subset that drives which Decision_Dates the baseline is scored on
 * (Requirement 11.6). All dates supplied must belong to the Out_Of_Sample_Test
 * partition (Requirement 11.3); Gate 1 does not verify the partition itself,
 * it scores exactly the firing rows it is given.
 */
export interface Gate1FiringSample {
  readonly decisionDate: TradingDate;
  /** The model's predicted direction for this firing setup. */
  readonly modelPrediction: DirectionClass;
  /** The Weekly_Trend_Follow baseline's predicted direction on the same date. */
  readonly baselinePrediction: DirectionClass;
  /** The actual matured forward-outcome direction at the selected horizon. */
  readonly actual: DirectionClass;
  /**
   * Optional model Earned_Confidence in [0, 1] on this firing Decision_Date.
   * Used only to populate the Evaluation_Report's `strengthBreakdown` (counts
   * by confidence band); it never affects any gate math. Absent samples are
   * excluded from the strength breakdown. (Design C1, Requirement 1.2)
   */
  readonly confidence?: number;
}

/**
 * The Gate 1 result. Shape follows Design Component 7:
 * `{ modelAccuracy, baselineAccuracy, deltaPp, passed }`, extended with
 * `sampleSize` and `evaluated` so callers can distinguish a withheld
 * evaluation (below the ≥30-sample floor) from an actual fail.
 *
 * When `evaluated` is false the firing subset is below the Sample_Size_Floor:
 * the pass/fail evaluation is WITHHELD (neither pass nor cut), `passed` is
 * false, and the accuracy fields report whatever was measurable on the
 * undersized subset for diagnostics (Requirement 11.5).
 */
export interface Gate1Result {
  /** Model directional accuracy on the firing subset, in [0, 1]. */
  readonly modelAccuracy: number;
  /**
   * Weekly_Trend_Follow baseline accuracy on the SAME firing subset, in [0, 1]
   * (conditional / matched-sample; Requirement 11.6).
   */
  readonly baselineAccuracy: number;
  /**
   * `modelAccuracy - baselineAccuracy`, as a fraction (e.g. 0.03 == 3pp).
   * Named `deltaPp` per the design's Gate 1 shape.
   */
  readonly deltaPp: number;
  /** Size of the matched firing subset (number of firing Decision_Dates). */
  readonly sampleSize: number;
  /**
   * True when the firing subset met the ≥30-sample floor and a pass/fail was
   * determined; false when the evaluation was withheld below the floor
   * (Requirement 11.5).
   */
  readonly evaluated: boolean;
  /**
   * True iff `evaluated` and `deltaPp >= GATE1_MIN_DELTA` (Requirement 11.6).
   * Always false when the evaluation is withheld.
   */
  readonly passed: boolean;
}

// ===========================================================================
// Gate 2 — Risk-Adjusted MFE/MAE Gate (Task 6.4; Requirements 11.7, 11.8;
// Design Component 7). Appended as a separate block to avoid edit conflicts
// with the parallel Gate 1 task; do not fold these into the definitions above.
// ===========================================================================

/**
 * Pair-specific Friction_Penalty in pips, applied symmetrically to the MFE/MAE
 * excursions of BOTH the pattern-model and the Weekly_Trend_Follow baseline
 * before the Gate 2 comparison. Models the 17:00 America/New_York daily
 * rollover liquidity thinning: 1.5 pips for EURUSD/GBPUSD, 2.0 pips for
 * USDJPY/USDCHF/USDCAD. (Requirement 11.7)
 */
export const FRICTION_PENALTY_PIPS: Readonly<Record<Pair, number>> = {
  EURUSD: 1.5,
  GBPUSD: 1.5,
  USDJPY: 2.0,
  USDCHF: 2.0,
  USDCAD: 2.0,
};

/**
 * Result of a single Gate 2 (risk-adjusted) evaluation on a fold, matching the
 * `gate2` shape in the design. The metrics are the
 * excursion-weighted hit metric of each side AFTER Friction_Penalty deduction;
 * `margin = modelRiskAdj - baselineRiskAdj` and Gate 2 passes iff `margin >= 0`.
 * (Requirements 11.7, 11.8; Design Component 7)
 */
export interface Gate2Result {
  readonly modelRiskAdj: number;
  readonly baselineRiskAdj: number;
  readonly margin: number;
  readonly passed: boolean;
  /**
   * True when Gate 2 was actually computed. Gate 2 is evaluated ONLY AFTER
   * Gate 1 has passed (Requirement 11.8); when Gate 1 did not pass, Gate 2 is
   * returned not-evaluated (`evaluated: false`, `passed: false`) rather than
   * being computed.
   */
  readonly evaluated: boolean;
}

// ===========================================================================
// Evaluation Report (simplify-to-cloud-minimal, Requirement 1; Design C1).
//
// Reframes the two-stage Kill_Gate from an automatic PASS/CUT verdict into a
// human-read EVALUATION REPORT. The Measurement_Engine math
// (`evaluateGate1`/`evaluateGate2` and the walk-forward pooling) is unchanged
// in behaviour; only the OUTPUT type changes. The report carries the measured
// metrics plus a sample-size-aware uncertainty indication and NON-BINDING
// annotation flags.
//
// It has NO `verdict` field (Requirement 1.3): the former Kill_Verdict collapse
// is removed from the evaluation path, and the former GATE1_MIN_DELTA / Gate-2
// `margin >= 0` thresholds survive only as `annotations.*` flags that annotate,
// but never hide, suppress, or block any displayed data (Requirement 1.5).
//
// (The legacy PASS/CUT `GateVerdict` / `GateVerdictStore` types that preceded this block
// were removed in codebase-housekeeping Task 5.)
// ===========================================================================

/**
 * The chronological out-of-sample split an {@link EvaluationReport} was measured
 * over. Mirrors the `evaluation_reports` columns `split_train_end`,
 * `split_test_start`, `split_test_end`. The train window strictly precedes the
 * test window (`trainEnd < testStart`), preserving look-ahead safety.
 */
export interface EvaluationSplit {
  readonly trainEnd: TradingDate;
  readonly testStart: TradingDate;
  readonly testEnd: TradingDate;
}

/**
 * The friction-adjusted MFE/MAE summary carried on an {@link EvaluationReport}.
 * These are the mean favorable (MFE) and adverse (MAE) excursions of the model
 * and the Weekly_Trend_Follow baseline over the matched firing subset, AFTER
 * the symmetric pair-specific Friction_Penalty has been applied — the same
 * friction model the Measurement_Engine uses for Gate 2. (Design C1)
 */
export interface MfeMaeSummary {
  /** Mean friction-adjusted favorable excursion of the model (pips). */
  readonly modelMfe: number;
  /** Mean friction-adjusted adverse excursion of the model (pips). */
  readonly modelMae: number;
  /** Mean friction-adjusted favorable excursion of the baseline (pips). */
  readonly baselineMfe: number;
  /** Mean friction-adjusted adverse excursion of the baseline (pips). */
  readonly baselineMae: number;
}

/**
 * Counts of matched firing samples by model-confidence band (Design C1). Bands
 * partition the Earned_Confidence [0, 1] range relative to the neutral prior
 * (0.5): `weak` < 0.55, `moderate` in [0.55, 0.70), `strong` >= 0.70. Samples
 * without a recorded confidence are excluded from all three counts, so the
 * three counts need not sum to the sample size.
 */
export interface StrengthBreakdown {
  readonly weak: number;
  readonly moderate: number;
  readonly strong: number;
}

/**
 * Sample-size-aware statistical uncertainty on the accuracy delta
 * (`modelAccuracy - baselineAccuracy`), carried on the {@link EvaluationReport}
 * (Requirements 1.6, 2.5).
 *
 * `accuracyDeltaCI` is a Wald (normal-approximation) confidence interval
 * `[lo, hi]` on the delta, derived deterministically from the matched sample
 * size. `note` is a plain-language indication of the uncertainty, including an
 * explicit LOW-N caveat when the matched subset is below the
 * {@link GATE1_SAMPLE_SIZE_FLOOR} (30), so a thin read is never presented as a
 * confident one.
 */
export interface EvaluationUncertainty {
  readonly accuracyDeltaCI: readonly [number, number];
  readonly note: string;
}

/**
 * Non-binding annotation flags on an {@link EvaluationReport} (Requirement 1.5).
 *
 * These preserve the former thresholds as DESCRIPTIVE context only — they are
 * never consulted to hide, suppress, or block any displayed data. `deltaExceeds3pp`
 * reports whether the aggregate Gate 1 accuracy delta reaches the former
 * {@link GATE1_MIN_DELTA} (+3pp); `riskAdjNonNegative` reports whether the
 * aggregate Gate 2 friction-adjusted margin is non-negative (the former
 * `margin >= 0` rule). Both are annotations, not gates.
 */
export interface EvaluationAnnotations {
  readonly deltaExceeds3pp: boolean;
  readonly riskAdjNonNegative: boolean;
}

/**
 * The structured output of the Measurement_Engine for one configuration over
 * the Out_Of_Sample_Test — a set of metrics with uncertainty intended for human
 * interpretation (Requirement 1.2; Design C1). It is the evaluation output and carries **NO** `verdict`/`PASS`/`CUT`/`KILL` field
 * (Requirement 1.3).
 *
 * All fields are measured deterministically from the pooled matched firing
 * subset of the qualifying walk-forward folds; identical inputs always produce a
 * byte-identical report (Requirement 1.6).
 */
export interface EvaluationReport {
  readonly configId: string;
  readonly split: EvaluationSplit;
  /** Size of the pooled matched firing subset across qualifying folds. */
  readonly sampleSize: number;
  /** Total firing predictions supplied across all folds (incl. skipped). */
  readonly predictionsCount: number;
  /** Model directional accuracy on the matched subset, in [0, 1]. */
  readonly modelAccuracy: number;
  /** Weekly_Trend_Follow baseline accuracy on the SAME matched subset, in [0, 1]. */
  readonly baselineAccuracy: number;
  /** `modelAccuracy - baselineAccuracy`, as a fraction (0.03 == 3pp). */
  readonly deltaVsBaseline: number;
  /** Model friction-adjusted excursion-weighted hit metric (Gate 2 model side). */
  readonly frictionAdjustedModel: number;
  /** Baseline friction-adjusted excursion-weighted hit metric (Gate 2 baseline side). */
  readonly frictionAdjustedBaseline: number;
  readonly mfeMaeSummary: MfeMaeSummary;
  readonly strengthBreakdown: StrengthBreakdown;
  readonly uncertainty: EvaluationUncertainty;
  readonly annotations: EvaluationAnnotations;
  // NO `verdict` field (Requirement 1.3).
}

/**
 * Storage PORT for the `evaluation_reports` table (simplify-to-cloud-minimal
 * Requirement 1.3, 8.2; design C4 / Data Models). The evaluation write path:
 * it persists a measured {@link EvaluationReport} and reads one back by its
 * generated id.
 *
 * The {@link EvaluationReport} already carries its {@link EvaluationSplit}, so no
 * separate split argument is needed. Each call records a NEW report row (reports are an append-only
 * research history, mirroring the Research_Log). It carries NO verdict in any
 * form (Requirement 1.3).
 */
export interface EvaluationReportStore {
  /**
   * Persist one {@link EvaluationReport}, returning the generated `reportId`.
   * Append-only: a repeat call records another row rather than overwriting.
   */
  persistReport(report: EvaluationReport): Promise<{ readonly reportId: string }>;

  /** Read back a persisted {@link EvaluationReport} by its `reportId`, or null. */
  getReport(reportId: string): Promise<EvaluationReport | null>;
}

/**
 * In-memory reference implementation of {@link EvaluationReportStore}.
 *
 * Mirrors the `evaluation_reports` schema: each report is assigned a fresh id
 * and stored by that id. Append-only, matching the Research_Log semantics. Ids
 * are generated deterministically from an internal counter (`report-1`,
 * `report-2`, …) so tests are reproducible without a UUID dependency.
 */
export class InMemoryEvaluationReportStore implements EvaluationReportStore {
  private seq = 0;
  private readonly reports = new Map<string, EvaluationReport>();

  persistReport(
    report: EvaluationReport,
  ): Promise<{ readonly reportId: string }> {
    this.seq += 1;
    const reportId = `report-${this.seq}`;
    this.reports.set(reportId, report);
    return Promise.resolve({ reportId });
  }

  getReport(reportId: string): Promise<EvaluationReport | null> {
    return Promise.resolve(this.reports.get(reportId) ?? null);
  }

  clear(): void {
    this.seq = 0;
    this.reports.clear();
  }
}
