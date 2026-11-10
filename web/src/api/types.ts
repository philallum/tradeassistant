/**
 * Shared read-only wire-format row types (the shape of the `dashboard.json` snapshot).
 *
 * Under the Public_Read_Path (simplify-to-cloud-minimal R5) the SPA no longer talks to a
 * read-proxy through a ten-endpoint `/api` allowlist; it fetches ONE static JSON snapshot
 * the Cloud Run Job writes (`loadSnapshot()` in `./snapshot.ts`). These interfaces describe
 * the row shapes carried in that snapshot — one interface per logical collection the
 * dashboard renders.
 *
 * They are INDEPENDENT copies: this file imports NOTHING from the deterministic core
 * (`src/`). The serving layer is a downstream consumer and must never depend on the core.
 * Every field is `readonly` (the SPA recomputes nothing) and array columns use
 * `readonly T[]`. Nullability and literal unions follow the snapshot writer's wire shape
 * (`src/scheduled-run/snapshot.ts`), kept in lockstep with this file by hand exactly as the
 * two allowlists used to be.
 */

/**
 * The five FX currency pairs the system supports. This is an INDEPENDENT copy of the core
 * `PAIRS` set in `src/ingestion/types.ts` — the serving layer declares its own wire-format
 * constants and imports NOTHING from the deterministic core. The five values are frozen by
 * the requirement text; no other pairs exist.
 */
export const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const;

/** One of the five supported FX pairs. */
export type Pair = (typeof PAIRS)[number];

/** Narrowing guard: is `value` one of the five supported {@link Pair}s? */
export function isPair(value: string): value is Pair {
  return (PAIRS as readonly string[]).includes(value);
}

/** Firing direction class as persisted on `firing_setups`. */
export type Direction = "UP" | "DOWN" | "FLAT";

/** Prediction horizon (days) — bounded small-int domain used across firing/outcome rows. */
export type Horizon = 1 | 2 | 3;

/**
 * A firing-setup row. Under the de-scope the dashboard-level suppressors are removed, so a
 * row is either a surfaced firing card or an unsurfaced `below_floor`/`not_fired`
 * observation; the `news`, `currency_concentration`, and `too_choppy` reasons and the
 * `competing_pairs` column are gone (design C2 / Data Models).
 */
export interface FiringSetupRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly strategy_id: string;
  readonly direction: Direction;
  readonly horizon: Horizon;
  readonly earned_confidence: number;
  readonly stop_loss_pips: number | null;
  readonly take_profit_pips: number | null;
  readonly surfaced: boolean;
  readonly suppression_reason: "below_floor" | "not_fired" | null;
}

/**
 * A per-pair deterministic evaluation row — the run-completion readout (schema v2). Unlike
 * {@link FiringSetupRow}, which exists only for pairs that fired, this carries EVERY pair
 * evaluated on the Decision_Date (fired or not) with its deterministic direction, earned
 * confidence, horizon, displayed choppiness, and the derived `fired` flag. It lets the
 * Setups tab's silent (no-fire) state show a credible "the run evaluated all five pairs"
 * summary instead of a bare "no data" notice. Display-only; never re-enters scoring.
 */
export interface PairEvaluationRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly direction: Direction;
  readonly horizon: Horizon;
  readonly earned_confidence: number;
  readonly fired: boolean;
  readonly choppiness: number;
  /**
   * Schema v6: the analogue-based, pair-relative expected candle size. Absent when the pair
   * could not be forecast (too few analogues or too little history). Says nothing about
   * direction; display-only.
   */
  readonly expected_range?: ExpectedRangeRow;
}

/** Schema v6: expected candle size — a Small / Medium / Large bucket plus a pips range. */
export interface ExpectedRangeRow {
  readonly bucket: "SMALL" | "MEDIUM" | "LARGE";
  readonly horizon: Horizon;
  readonly low_pips: number;
  readonly high_pips: number;
  /** Analogues behind the forecast. */
  readonly sample_size: number;
}

/** A matured analogue-outcome row — excursion profile. */
export interface AnalogueOutcomeRow {
  readonly asset: string;
  readonly decision_date: string;
  readonly horizon: Horizon;
  readonly direction: Direction;
  readonly mfe_pips: number;
  readonly mae_pips: number;
  readonly matured: boolean;
}

/**
 * A prediction-vs-actual realized-outcome row. Realized columns are null until the outcome
 * matures (`matured=false`).
 */
export interface RealizedOutcomeRow {
  readonly strategy_id: string;
  readonly pair: string;
  readonly decision_date: string;
  readonly predicted_direction: Direction;
  readonly horizon: Horizon;
  readonly earned_confidence: number;
  readonly stop_loss_pips: number | null;
  readonly take_profit_pips: number | null;
  readonly realized_direction: Direction | null;
  readonly realized_mfe_pips: number | null;
  readonly realized_mae_pips: number | null;
  readonly matured: boolean;
}

/** A price (OHLC) candle row. */
export interface CandleRow {
  readonly asset: string;
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/**
 * An evaluation-report summary row — the human-read measurement of the premise over the
 * out-of-sample split. It carries NO `verdict` field (R1.3); the Gate tab reads it as a
 * metrics summary, not a PASS/CUT decision.
 */
export interface EvaluationReportRow {
  readonly config_id: string;
  readonly split_test_start: string;
  readonly split_test_end: string;
  readonly sample_size: number;
  readonly predictions_count: number;
  readonly model_accuracy: number;
  readonly baseline_accuracy: number;
  readonly delta_vs_baseline: number;
}

/**
 * A single display-only research proposal carried in the AI rationale's `proposals` array.
 * Advisory / non-scoring; rendered as inert React text children only. The daily-run display
 * path does not currently emit proposals, so this array is typically empty in the snapshot.
 */
export interface SignalProposal {
  readonly proposalId: string;
  readonly kind: string;
  readonly proposalText: string;
}

/**
 * `signal_rationale` — AI tab. The AI narrative + qualitative pattern-description labels +
 * advisory proposals. Display-only / advisory / non-scoring; rendered as inert React text
 * children.
 */
export interface SignalRationaleRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly rationale_text: string;
  readonly analogue_labels: readonly string[];
  readonly proposals: readonly SignalProposal[];
}

/**
 * `external_reference_comparison` — Third-party tab. The system's own Direction_Class next
 * to the provider's reference direction. `comparison` is a NOT NULL enum including the
 * "unavailable" marker shown as an explicit non-error state.
 */
export interface ExternalReferenceComparisonRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly own_direction: "UP" | "DOWN" | "FLAT" | null;
  readonly reference_direction: "BUY" | "SELL" | "HOLD" | null;
  readonly reference_score: number | null;
  readonly provider: string | null;
  readonly comparison: "agree" | "diverge" | "neutral" | "unavailable";
}

/**
 * The pair-INDEPENDENT whole-day AI commentary (schema v3). A short display-only
 * note produced every trading day — fired or not — summarising the day's scan,
 * doubling as an LLM-path liveness signal. `generated` is `true` only when the
 * model actually produced a note this run; when `false`, `note_text` is empty
 * and the UI shows an explicit "commentary unavailable" state. Unlike every
 * other slice this is a single object, not an array. Display-only; never scoring.
 */
export interface DailyCommentary {
  readonly decision_date: string;
  readonly note_text: string;
  readonly generated: boolean;
}

// ---------------------------------------------------------------------------------------
// v4 evidence slices (trader-edge-validation R8.1, R9.1, R10). Independent structural
// copies of the writer's wire shapes in `src/scheduled-run/snapshot.ts`; display-only.
// ---------------------------------------------------------------------------------------

/** Net-of-cost performance summary for one strategy. */
export interface PerformanceSummaryRow {
  readonly strategyId: string;
  readonly netExpectancyPips: number;
  readonly netExpectancyR: number;
  readonly grossExpectancyPips: number;
  readonly winRate: number;
  readonly avgWinPips: number;
  readonly avgLossPips: number;
  /** `null` when undefined/infinite (wins with no losses). */
  readonly profitFactor: number | null;
  readonly maxDrawdownPips: number;
  readonly longestLosingStreak: number;
  readonly tradeCount: number;
  readonly timeInMarketDays: number;
  readonly ambiguousShare: number;
  readonly expiredShare: number;
}

/** One strategy row of the ledger summary: the system or a comparator. */
export interface StrategySummaryRow {
  readonly role: "system" | "comparator";
  readonly summary: PerformanceSummaryRow;
}

/** Per-strategy summary + comparator rows (empty when no ledger exists). */
export interface TradeLedgerSummary {
  readonly window: { readonly from: string; readonly to: string } | null;
  readonly strategies: readonly StrategySummaryRow[];
}

export interface CalibrationBand {
  readonly lo: number;
  readonly hi: number;
  readonly forecastCount: number;
  readonly realizedCorrectRate: number;
  readonly effectiveSampleSize: number;
}

/** Calibration report; flags are null when not measured. */
export interface Calibration {
  readonly bands: readonly CalibrationBand[];
  readonly monotonic: boolean | null;
  readonly wellCalibrated: boolean | null;
}

/** Aggregate currency exposure of the firing set. */
export interface Exposure {
  readonly perCurrency: readonly { readonly currency: string; readonly net: number }[];
  readonly concentrated: boolean;
  readonly strongestPair: string | null;
}

/** Per-forecast Signal_Provenance. */
export interface ProvenanceRow {
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

export type ValidationStatus = "validated" | "unvalidated";

/** Per-forecast validation flag: has the edge been shown OOS, net of costs? */
export interface ValidationStatusRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly status: ValidationStatus;
}

/** A bare decision-date row (drives the Historical_Browse selector). */
export interface DecisionDateRow {
  readonly decision_date: string;
}

// ---------------------------------------------------------------------------------------
// v5 confluence slice (multi-strategy-confluence-engine R11). An INDEPENDENT, hand-duplicated
// structural copy of the writer's wire shapes in `src/scheduled-run/snapshot.ts`
// (`SnapshotConfluence*` / `EMPTY_CONFLUENCE`). This file imports NOTHING from the
// deterministic core (`src/`); the two definitions are kept in lockstep by hand, exactly as
// the other slices are. The slice is derived only from deterministic artifacts, carries NO
// LLM provenance fields (Requirement 11.10), is display-only, and never re-enters scoring.
// ---------------------------------------------------------------------------------------

/**
 * A Strategy_Id as carried in the snapshot, in `STRATEGY_IDS` order. Mirrors the backend
 * `SnapshotConfluenceStrategyId`; kept in lockstep by hand.
 */
export type ConfluenceStrategyId =
  | "trend"
  | "breakout"
  | "range"
  | "reversal"
  | "custom_pattern"
  | "third_party";

/** The aggregated Confluence_Status for one Pair (mirrors the backend `ConfluenceStatus`). */
export type ConfluenceStatus =
  | "ALIGNED_UP"
  | "ALIGNED_DOWN"
  | "NEUTRAL"
  | "CONFLICT_FLAT"
  | "INSUFFICIENT_DATA";

/**
 * One Strategy_Id cell for one Pair: either an available `StrategySignal` (direction +
 * strength + rationale) or an explicit `unavailable` marker with a non-empty `reason` naming
 * the failure (Requirement 11.2). `direction` reuses the shared {@link Direction} union.
 */
export type ConfluenceCell =
  | {
      readonly strategyId: ConfluenceStrategyId;
      readonly available: true;
      readonly direction: Direction;
      readonly strength: number;
      readonly rationale: string;
    }
  | {
      readonly strategyId: ConfluenceStrategyId;
      readonly available: false;
      readonly reason: string;
    };

/**
 * The aggregated confluence for one Pair: the bounded Confluence_Score, the
 * Confluence_Status, the opposing Strategy_Ids (non-empty ONLY when the status is
 * `CONFLICT_FLAT` — Requirements 11.3, 11.4), and exactly six cells in `STRATEGY_IDS` order
 * (Requirement 11.2).
 */
export interface ConfluencePair {
  readonly pair: string;
  readonly score: number;
  readonly status: ConfluenceStatus;
  readonly opposingStrategyIds: readonly ConfluenceStrategyId[];
  readonly cells: readonly ConfluenceCell[];
}

/**
 * The per-run Confluence_Matrix carried in the snapshot (Requirement 11). The
 * `validationLabel` is the literal `"unvalidated"` until an out-of-sample measurement exists
 * (Requirement 11.6); `weights`, `conflictThreshold`, and `alignmentThreshold` are the exact
 * values the engine used for the run (Requirement 11.5). `pairs` is either empty (the
 * fail-safe default) or exactly the five Pairs in `PAIRS` order.
 */
export interface Confluence {
  readonly validationLabel: "unvalidated";
  readonly weights: Readonly<Record<ConfluenceStrategyId, number>>;
  readonly conflictThreshold: number;
  readonly alignmentThreshold: number;
  readonly pairs: readonly ConfluencePair[];
}

// ---------------------------------------------------------------------------------------
// v6 track-record slice. Independent structural copy of the writer's wire shapes in
// `src/scheduled-run/snapshot.ts` (`SnapshotTrackRecordSlice`); kept in lockstep by hand.
// Plain counts of recent directional calls and how many were right, built by look-ahead-safe
// replay. Display-only; never re-enters scoring.
// ---------------------------------------------------------------------------------------

/** Recent directional calls (UP/DOWN) of one strategy on one pair, and how many were right. */
export interface StrategyRecordRow {
  readonly pair: string;
  readonly strategyId: ConfluenceStrategyId;
  readonly calls: number;
  readonly correct: number;
}

/** Recent expected-candle-size forecasts on one pair, and how many landed in the right bucket. */
export interface RangeRecordRow {
  readonly pair: string;
  readonly forecasts: number;
  readonly correct: number;
}

/** The v6 `trackRecord` slice; `lookbackDays` is the trading-day replay window. */
export interface TrackRecord {
  readonly lookbackDays: number;
  readonly strategies: readonly StrategyRecordRow[];
  readonly rangeForecast: readonly RangeRecordRow[];
}

/**
 * The RECORDED (not replayed) direction history for one signal on one pair (schema v7). Built
 * from the dated `signal_predictions` rows, so it covers all six signals including the
 * non-replayable `third_party`. `calls`/`correct` count matured directional (UP/DOWN)
 * predictions; `flat` counts matured abstentions (outcome known, not scored); `pending` counts
 * predictions whose next session has not closed yet.
 */
export interface SignalScorecardRow {
  readonly pair: string;
  readonly strategyId: ConfluenceStrategyId;
  readonly calls: number;
  readonly correct: number;
  readonly flat: number;
  readonly pending: number;
}

/** The v7 `signalScorecard` slice: the recorded per-signal direction ledger. */
export interface SignalScorecard {
  readonly totalRecorded: number;
  readonly rows: readonly SignalScorecardRow[];
}

/** The deterministic intraday validation state (schema v8; mirrors the backend). */
export type ValidationState =
  | "STRONGLY_SUPPORTS"
  | "SUPPORTS"
  | "NEUTRAL"
  | "CONTRADICTS"
  | "STRONGLY_CONTRADICTS"
  | "NOT_APPLICABLE";

/** The forming 4H candle's minimal OHLC (schema v8). */
export interface IntradayCandle {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly currentPrice: number;
}

/**
 * One intraday-validation row (schema v8): the read-only 4H enrichment produced a few hours
 * after the immutable daily run, tied to the original daily prediction for `(decisionDate,
 * pair)`. `originalDirection`/`originalConfidence` are a SNAPSHOT of the untouched daily
 * values; `confidenceDelta` is a BOUNDED, UNVALIDATED adjustment (percentage points), never a
 * calibrated probability.
 */
export interface IntradayValidationRow {
  readonly pair: string;
  readonly decisionDate: string;
  readonly originalDirection: Direction;
  readonly originalConfidence: number;
  readonly validationState: ValidationState;
  readonly confidenceDelta: number;
  readonly currentConfidence: number;
  readonly reason: string;
  readonly barOpenUtc: string;
  readonly h4: IntradayCandle;
}

/** The v8 `intradayValidation` slice: the read-only intraday 4H validation ledger. */
export interface IntradayValidation {
  readonly observedAt: string | null;
  readonly validationLabel: "unvalidated";
  readonly rows: readonly IntradayValidationRow[];
}

/** The ordered set of intraday validation states (for exhaustive iteration/tests). */
export const VALIDATION_STATES: readonly ValidationState[] = [
  "STRONGLY_SUPPORTS",
  "SUPPORTS",
  "NEUTRAL",
  "CONTRADICTS",
  "STRONGLY_CONTRADICTS",
  "NOT_APPLICABLE",
] as const;

/** Why a pair did not fire (v9 `runHealth`). Priority order is the declaration order. */
export type SilenceReason =
  | "DATA_BEHIND"
  | "THIN_NEIGHBOURHOOD"
  | "NO_DIRECTIONAL_VIEW"
  | "BELOW_THRESHOLD";

/** The ordered set of silence reasons (for exhaustive iteration/tests). */
export const SILENCE_REASONS: readonly SilenceReason[] = [
  "DATA_BEHIND",
  "THIN_NEIGHBOURHOOD",
  "NO_DIRECTIONAL_VIEW",
  "BELOW_THRESHOLD",
] as const;

/** One pair's run-health row (v9). */
export interface RunHealthRow {
  readonly pair: string;
  /** Analogue neighbourhood size n at the selected horizon, or null when not recorded. */
  readonly analogue_count: number | null;
  /** True when the pair's candles were still behind after the freshness stage. */
  readonly data_behind: boolean;
  /** The single reason the pair is silent, or null when it fired. */
  readonly silence_reason: SilenceReason | null;
}

/** The v9 `runHealth` slice: why each pair is silent and which pairs ran on stale candles. */
export interface RunHealth {
  readonly rows: readonly RunHealthRow[];
  readonly degradedPairs: readonly string[];
  /** The firing line used to derive reasons (for wording "below X%"). */
  readonly confidenceThreshold: number;
}

/** Kind of scheduled high-impact event (v9 `eventFlags`). */
export type EventKind = "FOMC" | "ECB" | "US_NFP";
export const EVENT_KINDS: readonly EventKind[] = ["FOMC", "ECB", "US_NFP"] as const;

/** One scheduled event on the Decision_Date. `basis: "rule"` means the date is rule-derived. */
export interface EventFlag {
  readonly kind: EventKind;
  readonly label: string;
  readonly basis: "official" | "rule";
}

/** The v9 `eventFlags` slice: scheduled high-impact events on the Decision_Date (caution only). */
export interface EventFlags {
  readonly decisionDate: string;
  readonly events: readonly EventFlag[];
  /** False when the date is beyond the maintained calendar, so "no events" cannot be claimed. */
  readonly calendarCovers: boolean;
}
