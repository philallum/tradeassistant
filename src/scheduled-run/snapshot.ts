// Dashboard JSON snapshot writer — the Public_Read_Path producer
// (simplify-to-cloud-minimal Requirements 5.1, 5.2; design Decision 2 / C3).
//
// Under the public-data decision the read-proxy, RLS, scoped read views, and the
// SPA's PostgREST coupling are all removed. Their replacement is a single static
// JSON file — `dashboard.json` — that the Cloud_Run_Job writes at the END of the
// daily run. The hosted SPA fetches that one same-origin static asset (no proxy,
// no auth gate). This module turns the already-produced deterministic view plus
// the (optional) display-only writes and history slices into that snapshot and
// writes it fail-safely.
//
// FAIL-SAFE (Requirement 5.2, design Error Handling): the persisted DB rows are
// the source of truth. A failed snapshot write is logged and SWALLOWED — it must
// NEVER corrupt the persisted rows nor fail the run. The next run overwrites the
// snapshot; if it is missing the SPA shows an explicit empty/unavailable state
// (Requirement 5.5), so a stale-or-absent snapshot degrades gracefully.
//
// This module imports NOTHING that performs the DB write and holds no secret: it
// is a pure serialiser plus a thin, injectable write seam. The wire-format row
// shapes below are an INDEPENDENT structural copy of the SPA's wire types
// (`web/src/api/types.ts`); the core never imports from `web/` and vice versa,
// exactly as the two allowlists used to be kept in lockstep by hand.

import type { DashboardView } from "../dashboard/index.js";
import type { PairEvaluation } from "../dashboard/index.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../dashboard/index.js";
import type {
  DailyNoteWrite,
  DisplayOnlyWrite,
  ReferenceComparisonWrite,
  SignalRationaleWrite,
} from "../storage/supabase/index.js";

/**
 * The schema version of the snapshot envelope, bumped if the shape changes.
 * v2 added the `pairEvaluations` slice (the per-pair run-completion readout: all
 * five pairs' deterministic direction + earned confidence + choppiness for the
 * run, so a no-fire day shows a credible "run completed" summary rather than a
 * bare "no data" notice). v3 added the pair-INDEPENDENT `dailyCommentary` slice
 * (a short display-only AI note produced every trading day, fired or not, as an
 * LLM-path liveness signal). v4 (trader-edge-validation) adds the additive
 * evidence slices `tradeLedgerSummary`, `calibration`, `exposure`, `provenance`
 * and `validationStatus`, each defaulting to empty/absent. v5
 * (multi-strategy-confluence-engine) appends the pair-INDEPENDENT `confluence`
 * slice (the per-run Confluence_Matrix: six Strategy_Id cells per Pair plus the
 * aggregated score/status, with the weights and thresholds used and the
 * `unvalidated` Validation_Label), defaulting to `EMPTY_CONFLUENCE`. v6
 * (dashboard-simplification) adds the optional per-pair `expected_range` on the
 * `pairEvaluations` rows and the appended `trackRecord` slice (per-strategy and
 * expected-candle-size hit counts), defaulting to `EMPTY_TRACK_RECORD`. The SPA
 * tolerates a version mismatch (best-effort render) and defaults an absent slice
 * to its empty value, so each bump is backward- and forward-compatible.
 */
export const SNAPSHOT_SCHEMA_VERSION = 6 as const;

/** The canonical file name the SPA fetches as a same-origin static asset. */
export const SNAPSHOT_FILE_NAME = "dashboard.json" as const;

// ---------------------------------------------------------------------------------------
// Wire-format row shapes (structural copy of web/src/api/types.ts)
// ---------------------------------------------------------------------------------------

/** Firing direction class as persisted on `firing_setups`. */
export type SnapshotDirection = "UP" | "DOWN" | "FLAT";

/** Prediction horizon (days) — bounded small-int domain. */
export type SnapshotHorizon = 1 | 2 | 3;

/** The suppression reasons that survive the de-scope (`below_floor`, `not_fired`). */
export type SnapshotSuppressionReason = "below_floor" | "not_fired";

/** A surfaced-or-suppressed firing-setup row (mirrors `firing_setups`). */
export interface SnapshotFiringSetupRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly strategy_id: string;
  readonly direction: SnapshotDirection;
  readonly horizon: SnapshotHorizon;
  readonly earned_confidence: number;
  readonly stop_loss_pips: number | null;
  readonly take_profit_pips: number | null;
  readonly surfaced: boolean;
  readonly suppression_reason: SnapshotSuppressionReason | null;
}

/** A matured analogue-outcome row (excursion profile). */
export interface SnapshotAnalogueOutcomeRow {
  readonly asset: string;
  readonly decision_date: string;
  readonly horizon: SnapshotHorizon;
  readonly direction: SnapshotDirection;
  readonly mfe_pips: number;
  readonly mae_pips: number;
  readonly matured: boolean;
}

/** A prediction-versus-actual realized-outcome row. */
export interface SnapshotRealizedOutcomeRow {
  readonly strategy_id: string;
  readonly pair: string;
  readonly decision_date: string;
  readonly predicted_direction: SnapshotDirection;
  readonly horizon: SnapshotHorizon;
  readonly earned_confidence: number;
  readonly stop_loss_pips: number | null;
  readonly take_profit_pips: number | null;
  readonly realized_direction: SnapshotDirection | null;
  readonly realized_mfe_pips: number | null;
  readonly realized_mae_pips: number | null;
  readonly matured: boolean;
}

/**
 * A per-pair deterministic evaluation row for the run-completion readout
 * (schema v2). Unlike `firing_setups` — which exists only for pairs that fired —
 * this carries EVERY evaluated pair for the Decision_Date, whether or not it
 * fired, so a silent (no-fire) day can show a credible "the run evaluated all
 * five pairs" summary with each pair's deterministic Direction_Class, Earned
 * Confidence, and displayed Choppiness. These are the same deterministic values
 * the firing decision reads; carrying them outward is display-only and never
 * re-enters any firing / scoring path.
 */
export interface SnapshotPairEvaluationRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly direction: SnapshotDirection;
  readonly horizon: SnapshotHorizon;
  readonly earned_confidence: number;
  /** Whether this pair fired (direction !== FLAT AND confidence >= threshold). */
  readonly fired: boolean;
  /** Efficiency-Ratio Choppiness_Metric in [0,1] (~1 clean trend, ~0 chop); displayed only. */
  readonly choppiness: number;
  /**
   * v6: the analogue-based, pair-relative expected candle size. Absent when the
   * pair could not be forecast (neighbourhood or history below its floor).
   * Display-only; says nothing about direction.
   */
  readonly expected_range?: SnapshotExpectedRange;
}

/** Wire form of the expected candle size (Small / Medium / Large + a pips range). */
export interface SnapshotExpectedRange {
  readonly bucket: "SMALL" | "MEDIUM" | "LARGE";
  readonly horizon: SnapshotHorizon;
  readonly low_pips: number;
  readonly high_pips: number;
  /** Analogues behind the forecast. */
  readonly sample_size: number;
}

/** A price (OHLC) candle row. */
export interface SnapshotCandleRow {
  readonly asset: string;
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** A single advisory research proposal (display-only). */
export interface SnapshotProposal {
  readonly proposalId: string;
  readonly kind: string;
  readonly proposalText: string;
}

/** An AI rationale row (display-only, advisory, non-scoring). */
export interface SnapshotAiRationaleRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly rationale_text: string;
  readonly analogue_labels: readonly string[];
  /** Advisory proposals; the daily-run display path emits none, so typically empty. */
  readonly proposals: readonly SnapshotProposal[];
}

/**
 * The pair-INDEPENDENT whole-day AI commentary (schema v3). A short display-only
 * note produced every trading day — fired or not — summarising the day's scan,
 * doubling as an LLM-path liveness signal. `generated` is `true` only when the
 * model actually produced a note this run; when the LLM is unavailable (or the
 * call failed) `generated` is `false` and `note_text` is empty, so the SPA can
 * show an explicit "commentary unavailable" state rather than fabricating text.
 * The note is derived only from deterministic numbers and never re-enters scoring.
 */
export interface SnapshotDailyCommentary {
  readonly decision_date: string;
  readonly note_text: string;
  readonly generated: boolean;
}

/** A third-party external-reference comparison row (display-only, research-only). */
export interface SnapshotExternalComparisonRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly own_direction: SnapshotDirection | null;
  readonly reference_direction: "BUY" | "SELL" | "HOLD" | null;
  readonly reference_score: number | null;
  readonly provider: string | null;
  readonly comparison: "agree" | "diverge" | "neutral" | "unavailable";
}

/**
 * An evaluation-report summary row (the human-read measurement, no verdict).
 * This is the "evaluation summary" slice of the snapshot (design Decision 2);
 * the Measurement_Engine's report, carrying NO PASS/CUT field (Requirement 1.3).
 */
export interface SnapshotEvaluationReportRow {
  readonly config_id: string;
  readonly split_test_start: string;
  readonly split_test_end: string;
  readonly sample_size: number;
  readonly predictions_count: number;
  readonly model_accuracy: number;
  readonly baseline_accuracy: number;
  readonly delta_vs_baseline: number;
}

// ---------------------------------------------------------------------------------------
// v4 evidence slices (trader-edge-validation R8.1, R9.1, R10). Independent structural
// copies of the SPA wire types; all derived from deterministic artifacts, LLM-free,
// display-only, and never re-entering firing / scoring.
// ---------------------------------------------------------------------------------------

/** Net-of-cost performance summary for one strategy (wire form of `PerformanceSummary`). */
export interface SnapshotPerformanceSummary {
  readonly strategyId: string;
  readonly netExpectancyPips: number;
  readonly netExpectancyR: number;
  readonly grossExpectancyPips: number;
  readonly winRate: number;
  readonly avgWinPips: number;
  readonly avgLossPips: number;
  /** `null` when undefined/infinite (wins with no losses) — JSON cannot carry Infinity. */
  readonly profitFactor: number | null;
  readonly maxDrawdownPips: number;
  readonly longestLosingStreak: number;
  readonly tradeCount: number;
  readonly timeInMarketDays: number;
  readonly ambiguousShare: number;
  readonly expiredShare: number;
}

/** One strategy row of the ledger summary: the system or a comparator. */
export interface SnapshotStrategySummaryRow {
  readonly role: "system" | "comparator";
  readonly summary: SnapshotPerformanceSummary;
}

/** Per-strategy `PerformanceSummary` + comparator rows (empty when no ledger exists). */
export interface SnapshotTradeLedgerSummary {
  /** Inclusive window the ledger rows were read over, or null when none. */
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly strategies: readonly SnapshotStrategySummaryRow[];
}

export interface SnapshotCalibrationBand {
  readonly lo: number;
  readonly hi: number;
  readonly forecastCount: number;
  readonly realizedCorrectRate: number;
  readonly effectiveSampleSize: number;
}

/** Calibration report; `monotonic`/`wellCalibrated` are null when not measured. */
export interface SnapshotCalibration {
  readonly bands: readonly SnapshotCalibrationBand[];
  readonly monotonic: boolean | null;
  readonly wellCalibrated: boolean | null;
}

export interface SnapshotExposure {
  readonly perCurrency: readonly { readonly currency: string; readonly net: number }[];
  readonly concentrated: boolean;
  readonly strongestPair: string | null;
}

/** Per-forecast Signal_Provenance (wire form). */
export interface SnapshotProvenanceRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly lastCandleTimestamp: string;
  readonly computedAt: string;
  readonly earliestEntryRef: string;
  readonly horizonStart: string;
  readonly horizonEnd: string;
  readonly dataComplete: boolean;
  readonly staleReason: string | null;
}

export type SnapshotValidationStatus = "validated" | "unvalidated";

/** Per-forecast validation flag: has the edge been shown OOS, net of costs? */
export interface SnapshotValidationStatusRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly status: SnapshotValidationStatus;
}

/** The optional v4 slices a run supplies; any omitted slice takes its empty default. */
export interface SnapshotEdgeSlices {
  readonly tradeLedgerSummary?: SnapshotTradeLedgerSummary;
  readonly calibration?: SnapshotCalibration;
  readonly exposure?: SnapshotExposure;
  readonly provenance?: readonly SnapshotProvenanceRow[];
  readonly validationStatus?: readonly SnapshotValidationStatusRow[];
}

/** Empty defaults for the v4 slices (also what a failed slice degrades to). */
export const EMPTY_TRADE_LEDGER_SUMMARY: SnapshotTradeLedgerSummary = { window: null, strategies: [] };
export const EMPTY_CALIBRATION: SnapshotCalibration = { bands: [], monotonic: null, wellCalibrated: null };
export const EMPTY_EXPOSURE: SnapshotExposure = { perCurrency: [], concentrated: false, strongestPair: null };

// ---------------------------------------------------------------------------------------
// v5 confluence slice (multi-strategy-confluence-engine R11). An INDEPENDENT structural
// copy of the backend `ConfluenceMatrix` output (`src/strategies/confluenceMatrix.ts`):
// the core never imports from `web/` and vice versa, so these wire types are kept in
// lockstep by hand exactly as the other slices are. The slice is derived only from
// deterministic artifacts, is LLM-free (no provenance fields; the type does not admit
// them — Requirement 11.10), display-only, and never re-enters firing / scoring.
// ---------------------------------------------------------------------------------------

/** A Strategy_Id as carried in the snapshot, in `STRATEGY_IDS` order. */
export type SnapshotConfluenceStrategyId =
  | "trend"
  | "breakout"
  | "range"
  | "reversal"
  | "custom_pattern"
  | "third_party";

/** The aggregated Confluence_Status for one Pair (mirrors `ConfluenceStatus`). */
export type SnapshotConfluenceStatus =
  | "ALIGNED_UP"
  | "ALIGNED_DOWN"
  | "NEUTRAL"
  | "CONFLICT_FLAT"
  | "INSUFFICIENT_DATA";

/**
 * One Strategy_Id cell for one Pair: either an available {@link StrategySignal}
 * (direction + strength + rationale) or an explicit `unavailable` marker with a
 * non-empty `reason` naming the failure (Requirement 11.2).
 */
export type SnapshotConfluenceCell =
  | {
      readonly strategyId: SnapshotConfluenceStrategyId;
      readonly available: true;
      readonly direction: SnapshotDirection;
      readonly strength: number;
      readonly rationale: string;
    }
  | {
      readonly strategyId: SnapshotConfluenceStrategyId;
      readonly available: false;
      readonly reason: string;
    };

/**
 * The aggregated confluence for one Pair: the bounded Confluence_Score, the
 * Confluence_Status, the opposing Strategy_Ids (non-empty ONLY when the status
 * is `CONFLICT_FLAT` — Requirements 11.3, 11.4), and exactly six cells in
 * `STRATEGY_IDS` order (Requirement 11.2).
 */
export interface SnapshotConfluencePair {
  readonly pair: string;
  readonly score: number;
  readonly status: SnapshotConfluenceStatus;
  readonly opposingStrategyIds: readonly SnapshotConfluenceStrategyId[];
  readonly cells: readonly SnapshotConfluenceCell[];
}

/**
 * The per-run Confluence_Matrix carried in the snapshot (Requirement 11). The
 * `validationLabel` is the literal `"unvalidated"` until an out-of-sample
 * measurement exists (Requirement 11.6); `weights`, `conflictThreshold`, and
 * `alignmentThreshold` are the exact values the engine used for the run
 * (Requirement 11.5). `pairs` is either empty (the fail-safe default) or exactly
 * the five Pairs in `PAIRS` order.
 */
export interface SnapshotConfluenceSlice {
  readonly validationLabel: "unvalidated";
  readonly weights: Readonly<Record<SnapshotConfluenceStrategyId, number>>;
  readonly conflictThreshold: number;
  readonly alignmentThreshold: number;
  readonly pairs: readonly SnapshotConfluencePair[];
}

/**
 * The empty/fail-safe default for the v5 confluence slice (Requirement 11.7):
 * an empty Pair collection, the `unvalidated` Validation_Label, and the default
 * weights/thresholds, so a run that supplies no evaluation (or whose confluence
 * step failed) still emits a well-formed slice with no missing keys.
 */
export const EMPTY_CONFLUENCE: SnapshotConfluenceSlice = {
  validationLabel: "unvalidated",
  weights: { trend: 1, breakout: 1, range: 1, reversal: 1, custom_pattern: 1, third_party: 0 },
  conflictThreshold: 0.5,
  alignmentThreshold: 0.4,
  pairs: [],
};

// ---------------------------------------------------------------------------------------
// v6 track-record slice. Plain "how often was each strategy right lately" counts, built by
// deterministic, look-ahead-safe replay (see `src/track-record/`). Display-only, LLM-free,
// and never re-enters firing / scoring. A call is a directional (UP/DOWN) signal; FLAT is an
// abstention and is not counted.
// ---------------------------------------------------------------------------------------

/** Recent directional calls and how many were right, for one strategy on one pair. */
export interface SnapshotStrategyRecordRow {
  readonly pair: string;
  readonly strategyId: SnapshotConfluenceStrategyId;
  /** Directional (UP/DOWN) calls made in the look-back window that have a realized outcome. */
  readonly calls: number;
  /** Calls whose direction matched the realized direction. */
  readonly correct: number;
}

/** Recent expected-candle-size forecasts and how many landed in the right bucket. */
export interface SnapshotRangeRecordRow {
  readonly pair: string;
  readonly forecasts: number;
  readonly correct: number;
}

/** The v6 `trackRecord` slice. `lookbackDays` is the trading-day replay window. */
export interface SnapshotTrackRecordSlice {
  readonly lookbackDays: number;
  readonly strategies: readonly SnapshotStrategyRecordRow[];
  readonly rangeForecast: readonly SnapshotRangeRecordRow[];
}

/** The empty/fail-safe default for the v6 track-record slice. */
export const EMPTY_TRACK_RECORD: SnapshotTrackRecordSlice = {
  lookbackDays: 0,
  strategies: [],
  rangeForecast: [],
};

/**
 * The complete `dashboard.json` envelope the SPA fetches. Every field is a
 * read-only array of wire-format rows plus the Decision_Date the run was for and
 * a generation timestamp (the SPA's freshness marker). An absent slice is an
 * empty array, never `undefined`, so the SPA can render an explicit empty state
 * without guarding for missing keys (Requirement 5.5).
 */
export interface DashboardSnapshot {
  readonly schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  /** The Decision_Date this snapshot was generated for. */
  readonly decisionDate: string;
  /** ISO timestamp the snapshot was generated (freshness marker). */
  readonly generatedAt: string;
  /** Every Decision_Date with persisted data, newest-last (drives the browse selector). */
  readonly decisionDates: readonly string[];
  readonly firingSetups: readonly SnapshotFiringSetupRow[];
  /**
   * Every pair evaluated this run (fired or not) with its deterministic
   * direction + earned confidence + choppiness — the run-completion readout
   * (schema v2). Empty only when the run supplied no evaluations.
   */
  readonly pairEvaluations: readonly SnapshotPairEvaluationRow[];
  readonly analogueOutcomes: readonly SnapshotAnalogueOutcomeRow[];
  readonly realizedOutcomes: readonly SnapshotRealizedOutcomeRow[];
  readonly candles: readonly SnapshotCandleRow[];
  readonly aiRationale: readonly SnapshotAiRationaleRow[];
  /**
   * The pair-independent whole-day AI commentary (schema v3). Always present:
   * when no note was generated this run it carries `generated: false` + an empty
   * `note_text` for today's Decision_Date, so the SPA renders an explicit state
   * without guarding for a missing key.
   */
  readonly dailyCommentary: SnapshotDailyCommentary;
  readonly externalComparison: readonly SnapshotExternalComparisonRow[];
  readonly evaluationReports: readonly SnapshotEvaluationReportRow[];
  /** v4: per-strategy net-of-cost summary + comparator rows. Empty by default. */
  readonly tradeLedgerSummary: SnapshotTradeLedgerSummary;
  /** v4: OOS calibration by confidence band. Empty by default. */
  readonly calibration: SnapshotCalibration;
  /** v4: aggregate currency exposure of the firing set. Empty by default. */
  readonly exposure: SnapshotExposure;
  /** v4: per-forecast Signal_Provenance. Empty by default. */
  readonly provenance: readonly SnapshotProvenanceRow[];
  /** v4: per-forecast `validated` | `unvalidated`. Empty by default. */
  readonly validationStatus: readonly SnapshotValidationStatusRow[];
  /**
   * v5: the per-run Confluence_Matrix (six Strategy_Id cells per Pair plus the
   * aggregated score/status, the weights/thresholds used, and the `unvalidated`
   * Validation_Label). `EMPTY_CONFLUENCE` by default. Always present so the SPA
   * renders an explicit state without guarding for a missing key.
   */
  readonly confluence: SnapshotConfluenceSlice;
  /**
   * v6: recent per-strategy hit counts and expected-candle-size hit counts, built
   * by look-ahead-safe replay. `EMPTY_TRACK_RECORD` by default. Always present.
   */
  readonly trackRecord: SnapshotTrackRecordSlice;
}

/** The v1 deterministic system Strategy_Source (schema default 'system'). */
const SYSTEM_STRATEGY_ID = "system";

/**
 * History slices the daily run has already loaded/computed and wants carried in
 * the snapshot. All optional: an omitted slice becomes an empty array so a run
 * that cannot (yet) supply history still writes a valid, renderable snapshot.
 */
export interface SnapshotHistory {
  readonly decisionDates?: readonly string[];
  /**
   * Firing-setup rows from PRIOR runs (every Decision_Date already persisted),
   * so the Setups / Pattern-Outcomes tabs can browse history rather than only
   * today's view. Today's produced cards are merged ON TOP of these and win on
   * a `(decision_date, pair, strategy_id)` collision, so re-running today's date
   * never double-counts. Omitted → only today's view is surfaced.
   */
  readonly firingSetups?: readonly SnapshotFiringSetupRow[];
  readonly analogueOutcomes?: readonly SnapshotAnalogueOutcomeRow[];
  readonly realizedOutcomes?: readonly SnapshotRealizedOutcomeRow[];
  readonly candles?: readonly SnapshotCandleRow[];
  readonly evaluationReports?: readonly SnapshotEvaluationReportRow[];
}

/**
 * Merge today's view-derived firing rows with any historical rows, de-duping on
 * the `firing_setups` primary key `(decision_date, pair, strategy_id)`. Today's
 * rows take precedence so a re-run of the current Decision_Date overwrites
 * rather than duplicates its own prior rows. Order is history-first then today's
 * NEW rows appended, which is stable for the SPA (it filters/sorts by date).
 */
function mergeFiringSetups(
  today: readonly SnapshotFiringSetupRow[],
  history: readonly SnapshotFiringSetupRow[],
): readonly SnapshotFiringSetupRow[] {
  const key = (r: SnapshotFiringSetupRow): string =>
    `${r.decision_date}|${r.pair}|${r.strategy_id}`;
  const todayKeys = new Set(today.map(key));
  const kept = history.filter((r) => !todayKeys.has(key(r)));
  return [...kept, ...today];
}

/** Map a produced firing card into a surfaced wire-format `firing_setups` row. */
function firingSetupRow(decisionDate: string, card: DashboardView["cards"][number]): SnapshotFiringSetupRow {
  return {
    decision_date: decisionDate,
    pair: card.pair,
    strategy_id: SYSTEM_STRATEGY_ID,
    direction: card.direction,
    horizon: card.horizon,
    earned_confidence: card.earnedConfidence,
    stop_loss_pips: card.stopLossPips,
    take_profit_pips: card.takeProfitPips,
    surfaced: true,
    suppression_reason: null,
  };
}

/**
 * Map the run's full per-pair evaluations into the `pairEvaluations` readout
 * rows (schema v2). EVERY evaluated pair is carried — fired or not — with its
 * deterministic direction, earned confidence, horizon, and displayed choppiness,
 * plus the derived `fired` flag (direction !== FLAT AND confidence >= threshold).
 * These are display-only outward values and never re-enter the firing / scoring
 * path. Pure given its inputs. The `confidenceThreshold` defaults to the
 * dashboard default so a caller that does not thread a custom threshold still
 * computes the same `fired` flag the view used.
 */
export function pairEvaluationRows(
  decisionDate: string,
  evaluations: readonly PairEvaluation[],
  confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
): readonly SnapshotPairEvaluationRow[] {
  return evaluations.map((ev) => ({
    decision_date: decisionDate,
    pair: ev.pair,
    direction: ev.direction,
    horizon: ev.horizon,
    earned_confidence: ev.earnedConfidence,
    fired: ev.direction !== "FLAT" && ev.earnedConfidence >= confidenceThreshold,
    choppiness: ev.choppiness,
    ...(ev.expectedRange !== undefined
      ? {
          expected_range: {
            bucket: ev.expectedRange.bucket,
            horizon: ev.expectedRange.horizon,
            low_pips: ev.expectedRange.lowPips,
            high_pips: ev.expectedRange.highPips,
            sample_size: ev.expectedRange.sampleSize,
          },
        }
      : {}),
  }));
}

/** Map a display-only rationale write into a wire-format AI rationale row. */
function aiRationaleRow(decisionDate: string, write: SignalRationaleWrite): SnapshotAiRationaleRow {
  return {
    decision_date: decisionDate,
    pair: write.pair,
    // `rationale`/`analogueLabels` are `LlmTagged<…>` at the write boundary;
    // unwrap `.value` to the plain display strings exactly as the DB write
    // boundary does (display-only, never re-entering scoring).
    rationale_text: write.rationale.value,
    analogue_labels: [...write.analogueLabels.value],
    // The daily-run display path does not generate research proposals; the slice
    // is present (empty) so the SPA renders without guarding for a missing key.
    proposals: [],
  };
}

/**
 * Map the optional display-only daily note into the wire-format
 * `dailyCommentary` record. When a note was produced, unwrap its `LlmTagged`
 * `.value` to plain display text (exactly as `aiRationaleRow` does) and mark
 * `generated: true`. When absent (no LLM / failed / nothing to summarise), emit
 * a well-formed `generated: false` record with empty text for `decisionDate`, so
 * the slice is always present and the SPA shows an explicit "unavailable" state.
 */
function dailyCommentaryRecord(
  decisionDate: string,
  write: DailyNoteWrite | undefined,
): SnapshotDailyCommentary {
  if (write === undefined) {
    return { decision_date: decisionDate, note_text: "", generated: false };
  }
  return {
    decision_date: decisionDate,
    // `note` is `LlmTagged<string>` at the write boundary; unwrap `.value` to the
    // plain display string — display-only, never re-entering scoring.
    note_text: write.note.value,
    generated: true,
  };
}

/** Map a display-only comparison write into a wire-format external-comparison row. */
function externalComparisonRow(
  decisionDate: string,
  write: ReferenceComparisonWrite,
): SnapshotExternalComparisonRow {
  const reference = write.reference;
  return {
    decision_date: decisionDate,
    pair: write.pair,
    own_direction: write.ownDirection,
    reference_direction: reference?.direction ?? null,
    reference_score: reference?.score ?? null,
    provider: reference?.provider ?? null,
    comparison: write.comparison,
  };
}

/**
 * Build the complete {@link DashboardSnapshot} for a Decision_Date from the
 * produced dashboard view, the optional display-only writes, and any history
 * slices the run supplied. Pure and deterministic given its inputs (plus the
 * injected `now` for the freshness marker), so it is unit-testable without I/O.
 *
 * @param view            The produced dashboard view (the firing cards).
 * @param displayOnly     The display-only writes (AI rationale + external comparison), if any.
 * @param history         History slices already loaded by the run, if any.
 * @param now             Injected clock for the freshness marker (defaults to `new Date()`).
 * @param pairEvaluations The per-pair run-completion readout rows (every pair
 *                        evaluated this run, fired or not). Omitted → `[]`.
 * @param edge            The v4 evidence slices; each omitted slice takes its empty default.
 * @param confluence      The v5 per-run Confluence_Matrix slice; omitted → `EMPTY_CONFLUENCE`.
 * @param trackRecord     The v6 track-record slice; omitted → `EMPTY_TRACK_RECORD`.
 */
export function buildDashboardSnapshot(
  view: DashboardView,
  displayOnly: DisplayOnlyWrite | undefined,
  history: SnapshotHistory = {},
  now: Date = new Date(),
  pairEvaluations: readonly SnapshotPairEvaluationRow[] = [],
  edge: SnapshotEdgeSlices = {},
  confluence: SnapshotConfluenceSlice = EMPTY_CONFLUENCE,
  trackRecord: SnapshotTrackRecordSlice = EMPTY_TRACK_RECORD,
): DashboardSnapshot {
  const decisionDate = view.decisionDate;
  const todayFiring = view.cards.map((card) => firingSetupRow(decisionDate, card));
  const firingSetups = mergeFiringSetups(todayFiring, history.firingSetups ?? []);
  const aiRationale = (displayOnly?.rationales ?? []).map((w) =>
    aiRationaleRow(decisionDate, w),
  );
  const externalComparison = (displayOnly?.comparisons ?? []).map((w) =>
    externalComparisonRow(decisionDate, w),
  );
  const dailyCommentary = dailyCommentaryRecord(decisionDate, displayOnly?.dailyNote);

  // The browse selector lists every Decision_Date with persisted data. Union
  // today's date with the supplied history and sort ascending (newest-last, as
  // documented) so today is always selectable even if the history slice omitted
  // it, and so duplicates collapse.
  const decisionDates = Array.from(
    new Set([...(history.decisionDates ?? []), decisionDate]),
  ).sort();

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    decisionDate,
    generatedAt: now.toISOString(),
    decisionDates,
    firingSetups,
    pairEvaluations,
    analogueOutcomes: history.analogueOutcomes ?? [],
    realizedOutcomes: history.realizedOutcomes ?? [],
    candles: history.candles ?? [],
    aiRationale,
    dailyCommentary,
    externalComparison,
    evaluationReports: history.evaluationReports ?? [],
    tradeLedgerSummary: edge.tradeLedgerSummary ?? EMPTY_TRADE_LEDGER_SUMMARY,
    calibration: edge.calibration ?? EMPTY_CALIBRATION,
    exposure: edge.exposure ?? EMPTY_EXPOSURE,
    provenance: edge.provenance ?? [],
    validationStatus: edge.validationStatus ?? [],
    // v5: appended so every earlier key keeps its byte order (Requirement 11.8).
    confluence,
    // v6: appended LAST for the same reason.
    trackRecord,
  };
}

/**
 * Serialise a snapshot to the exact JSON text written to `dashboard.json`.
 * Stable 2-space indentation keeps the hosted asset diffable; the SPA parses it
 * with a plain `JSON.parse`.
 */
export function serializeSnapshot(snapshot: DashboardSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * The injectable sink that persists the serialised snapshot JSON to its public
 * destination (Firebase Hosting / a public bucket). It receives the file name
 * and the already-serialised body; the concrete uploader is wired by the caller
 * so this module stays I/O-free and testable. It may reject on failure — the
 * fail-safe wrapper {@link writeDashboardSnapshot} swallows the rejection.
 */
export type SnapshotSink = (fileName: string, body: string) => Promise<void>;

/**
 * Fail-safely write the dashboard snapshot through the injected sink
 * (Requirement 5.2, design Error Handling).
 *
 * The write is best-effort: on ANY sink failure the error is logged
 * (secret-free) and SWALLOWED, returning `false`, so the snapshot step can never
 * corrupt the persisted DB rows (the source of truth) nor fail the daily run.
 * Returns `true` iff the snapshot was written. A `null`/absent sink is treated
 * as "no destination configured" and is a logged no-op (also `false`), so a run
 * without a hosting target still completes cleanly.
 *
 * @param snapshot The snapshot to write.
 * @param sink     The destination sink, or `undefined` when none is configured.
 */
export async function writeDashboardSnapshot(
  snapshot: DashboardSnapshot,
  sink: SnapshotSink | undefined,
): Promise<boolean> {
  if (sink === undefined) {
    console.warn(
      JSON.stringify({
        event: "scheduled_run.snapshot_skipped",
        reason: "no_sink_configured",
        decisionDate: snapshot.decisionDate,
      }),
    );
    return false;
  }

  try {
    await sink(SNAPSHOT_FILE_NAME, serializeSnapshot(snapshot));
    console.log(
      JSON.stringify({
        event: "scheduled_run.snapshot_written",
        decisionDate: snapshot.decisionDate,
        // The rolling count of ALL surfaced setups carried in the written
        // snapshot (today's firing view merged on top of the historical
        // firing_setups), NOT the number that fired this run — see
        // `firedToday` on the `scheduled_run.complete` event.
        surfacedSetupsTotal: snapshot.firingSetups.length,
      }),
    );
    return true;
  } catch (err) {
    // Fail-safe: a snapshot write failure NEVER corrupts the persisted rows and
    // never fails the run. Log a secret-free warning and move on; the next run
    // overwrites the snapshot (design Error Handling, Requirement 5.2, 5.5).
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        event: "scheduled_run.snapshot_write_failed",
        decisionDate: snapshot.decisionDate,
        message,
      }),
    );
    return false;
  }
}
