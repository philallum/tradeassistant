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
 * `gate2` shape in the design's FoldVerdict/GateVerdict. The metrics are the
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
// Walk-Forward Verdict Composition (Task 6.5).
//
// Requirements 11.2, 11.9, 11.10, 11.11, 11.13, 19, 5.4, 5.5, 12.1;
// Design Component 7 (FoldVerdict / GateVerdict).
//
// Composition combines Gate 1 (matched-subset directional) and Gate 2
// (risk-adjusted MFE/MAE) per walk-forward fold into a single config-level
// verdict. A config PASSES iff it passes BOTH gates on EVERY qualifying fold
// (matched-firing subset ≥30-sample floor); folds below the floor are SKIPPED
// and recorded and excluded from the pass/fail determination; a single failing
// qualifying fold makes the verdict CUT (Requirements 11.13, 19.3, 19.5).
//
// Appended as a separate block to avoid edit conflicts with the parallel Gate 1
// / Gate 2 tasks; do not fold these into the definitions above.
// ===========================================================================

/**
 * The verdict for a single walk-forward fold. Shape follows Design Component 7:
 * `{ foldIndex, sampleSize, skipped, gate1, gate2, verdict }`.
 *
 * `skipped` is true when the matched-firing subset on this fold's test window is
 * below the {@link GATE1_SAMPLE_SIZE_FLOOR} (30) — such folds are recorded but
 * excluded from the pass/fail determination (Requirement 19.5). Gate 2 is only
 * evaluated after Gate 1 passes on that fold (Requirement 11.8), so on a fold
 * that fails or skips Gate 1 the Gate 2 result is not-evaluated.
 */
export interface FoldVerdict {
  readonly foldIndex: number;
  /** Matched-firing-subset size on this fold's out-of-sample test window. */
  readonly sampleSize: number;
  /** True when `sampleSize < 30` (below floor); excluded from pass/fail. */
  readonly skipped: boolean;
  readonly gate1: Gate1Result;
  readonly gate2: Gate2Result;
  /**
   * Per-fold verdict: PASS iff (not skipped) and both gates passed; otherwise
   * CUT. A skipped fold is recorded as CUT for the field's type but is excluded
   * from the aggregate pass/fail — inspect `skipped` to distinguish.
   */
  readonly verdict: "PASS" | "CUT";
}

/**
 * The accuracy-versus-baseline and risk-adjusted-versus-baseline metrics
 * emitted with every verdict and auto-appended to the Research_Log
 * (Requirement 11.11). Aggregated over the union of qualifying test folds.
 */
export interface GateMetrics {
  /** Number of qualifying (non-skipped) folds folded into the aggregate. */
  readonly qualifyingFolds: number;
  /** Number of folds skipped below the ≥30-sample floor (Req 19.5). */
  readonly skippedFolds: number;
  /** Total folds evaluated. */
  readonly totalFolds: number;
  /** Accuracy-vs-baseline: model minus baseline directional accuracy (Req 11.11). */
  readonly accuracyVsBaseline: number;
  /** Risk-adjusted-vs-baseline: model minus baseline risk-adjusted metric (Req 11.11). */
  readonly riskAdjustedVsBaseline: number;
}

/**
 * The aggregate config-level verdict across all walk-forward folds. Shape
 * follows Design Component 7:
 * `{ configId, foldVerdicts, gate1, gate2, sampleSize, verdict, metrics }`.
 *
 * Aggregate `gate1`/`gate2` are computed over the UNION of qualifying test
 * folds (out-of-sample only; Requirements 11.2, 11.3). `verdict` is PASS iff
 * every qualifying fold passed both gates (Requirements 11.13, 19.3); a single
 * failing qualifying fold => CUT.
 */
export interface GateVerdict {
  readonly configId: string;
  /** Per-fold verdicts + metrics (Requirements 11.13, 19.3, 19.4). */
  readonly foldVerdicts: readonly FoldVerdict[];
  /** Aggregate Gate 1 over the union of qualifying test folds. */
  readonly gate1: Gate1Result;
  /** Aggregate Gate 2 over the union of qualifying test folds. */
  readonly gate2: Gate2Result;
  /** Total matched-firing subset size across qualifying folds (Req 11.5). */
  readonly sampleSize: number;
  /** PASS iff every qualifying fold passes both gates (Req 11.13, 19.3). */
  readonly verdict: "PASS" | "CUT";
  readonly metrics: GateMetrics;
}

/**
 * Storage PORT for the aggregate `gate_verdicts` row plus its per-fold
 * `gate_fold_verdicts` rows (keyed by `(verdict_id, fold_index)`), mirroring the
 * shared Supabase schema. Follows the same compute/storage separation as
 * {@link WalkForwardFoldStore} (Requirement 17.1).
 */
export interface GateVerdictStore {
  /**
   * Persist an aggregate verdict and all of its per-fold verdicts atomically,
   * returning the generated `verdict_id`. Each call records a new verdict row
   * (verdicts are an append-only research history, Requirement 5.2).
   */
  persistVerdict(
    verdict: GateVerdict,
    split: GateVerdictSplit,
  ): Promise<PersistVerdictReport>;

  /** Read back a persisted aggregate verdict by its `verdict_id`, or null. */
  getVerdict(verdictId: string): Promise<PersistedGateVerdict | null>;
}

/**
 * The Data_Split bounds recorded alongside an aggregate verdict, matching the
 * `gate_verdicts` columns `split_train_end`, `split_test_start`,
 * `split_test_end`, and the optional `selected_horizon`.
 */
export interface GateVerdictSplit {
  readonly trainEnd: TradingDate;
  readonly testStart: TradingDate;
  readonly testEnd: TradingDate;
  /** The selected Horizon (1|2|3), when a horizon was chosen for this config. */
  readonly selectedHorizon?: 1 | 2 | 3;
}

/** Outcome of a {@link GateVerdictStore.persistVerdict} call. */
export interface PersistVerdictReport {
  readonly verdictId: string;
  /** Number of per-fold rows written to `gate_fold_verdicts`. */
  readonly foldRows: number;
}

/** A verdict read back from a {@link GateVerdictStore}, carrying its id + split. */
export interface PersistedGateVerdict {
  readonly verdictId: string;
  readonly verdict: GateVerdict;
  readonly split: GateVerdictSplit;
}

/**
 * In-memory reference implementation of {@link GateVerdictStore}.
 *
 * Mirrors the `gate_verdicts` / `gate_fold_verdicts` schema: each verdict is
 * assigned a fresh id and its per-fold rows are stored keyed by
 * `(verdictId, foldIndex)`. Append-only, matching the Research_Log semantics.
 * Ids are generated deterministically from an internal counter so tests are
 * reproducible without pulling in a UUID dependency.
 */
export class InMemoryGateVerdictStore implements GateVerdictStore {
  private seq = 0;
  private readonly verdicts = new Map<string, PersistedGateVerdict>();

  persistVerdict(
    verdict: GateVerdict,
    split: GateVerdictSplit,
  ): Promise<PersistVerdictReport> {
    this.seq += 1;
    const verdictId = `verdict-${this.seq}`;
    this.verdicts.set(verdictId, { verdictId, verdict, split });
    return Promise.resolve({
      verdictId,
      foldRows: verdict.foldVerdicts.length,
    });
  }

  getVerdict(verdictId: string): Promise<PersistedGateVerdict | null> {
    return Promise.resolve(this.verdicts.get(verdictId) ?? null);
  }

  clear(): void {
    this.seq = 0;
    this.verdicts.clear();
  }
}
