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

/** A bare decision-date row (drives the Historical_Browse selector). */
export interface DecisionDateRow {
  readonly decision_date: string;
}
