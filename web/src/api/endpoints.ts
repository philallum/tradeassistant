/**
 * Shared read-only wire-format row types (SPA ↔ Read_Proxy contract).
 *
 * These interfaces describe the JSON row shapes the Read_Proxy returns, one interface per
 * read-only view declared in migration `20260916000003_dashboard_read_views_rls.sql`.
 *
 * They are INDEPENDENT copies: this file imports NOTHING from the deterministic core
 * (`src/`). The serving layer is a downstream consumer and must never depend on the core
 * (Req 20.2). Every field is `readonly` (the SPA recomputes nothing — Req 20.1) and array
 * columns use `readonly T[]`. Nullability and literal unions are taken from the view
 * projections and the base-table CHECK constraints in the migration.
 */

/**
 * The five FX currency pairs the system supports (Req 8.1). This is an INDEPENDENT copy of
 * the core `PAIRS` set in `src/ingestion/types.ts` — the serving layer declares its own
 * wire-format constants and imports NOTHING from the deterministic core (Req 20.2). The
 * five values are frozen by the requirement text; no other pairs exist.
 */
export const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const;

/** One of the five supported FX pairs. */
export type Pair = (typeof PAIRS)[number];

/** Narrowing guard: is `value` one of the five supported {@link Pair}s? */
export function isPair(value: string): value is Pair {
  return (PAIRS as readonly string[]).includes(value);
}

/** Firing direction class as persisted on `firing_setups` / `v_firing_setups`. */
export type Direction = "UP" | "DOWN" | "FLAT";

/** Prediction horizon (days) — bounded small-int domain used across firing/outcome rows. */
export type Horizon = 1 | 2 | 3;

/**
 * `v_firing_setups` — cards + suppressions + confidence trend.
 * Matches the design's verbatim example exactly.
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
  readonly suppression_reason:
    | "news"
    | "currency_concentration"
    | "below_floor"
    | "not_fired"
    | "too_choppy"
    | null;
  readonly competing_pairs: readonly string[] | null;
}

/**
 * `v_analogue_outcomes` — excursion profile.
 * Columns: asset, decision_date, horizon, direction, mfe_pips, mae_pips, matured.
 */
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
 * `v_realized_outcomes` — prediction-vs-actual journal.
 * Columns: strategy_id, pair, decision_date, predicted_direction, horizon,
 * earned_confidence, stop_loss_pips, take_profit_pips, realized_direction,
 * realized_mfe_pips, realized_mae_pips, matured.
 * Realized columns are null until the outcome matures (`matured=false`).
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

/**
 * `v_candles` — price chart OHLC.
 * Columns: asset, date, open, high, low, close.
 */
export interface CandleRow {
  readonly asset: string;
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/**
 * `v_gate_verdicts` — model-vs-baseline gate verdict visual (cross-config, not pair-scoped).
 * Columns: id, config_id, sample_size, gate1_model_acc, gate1_baseline_acc, gate1_delta_pp,
 * gate1_passed, gate2_model_ra, gate2_baseline_ra, gate2_margin, gate2_passed, verdict,
 * selected_horizon, split_test_start, split_test_end, created_at.
 */
export interface GateVerdictRow {
  readonly id: string;
  readonly config_id: string;
  readonly sample_size: number;
  readonly gate1_model_acc: number;
  readonly gate1_baseline_acc: number;
  readonly gate1_delta_pp: number;
  readonly gate1_passed: boolean;
  readonly gate2_model_ra: number | null;
  readonly gate2_baseline_ra: number | null;
  readonly gate2_margin: number | null;
  readonly gate2_passed: boolean | null;
  readonly verdict: "PASS" | "CUT";
  readonly selected_horizon: Horizon | null;
  readonly split_test_start: string;
  readonly split_test_end: string;
  readonly created_at: string;
}

/**
 * `v_gate_fold_verdicts` — walk-forward folds (cross-config, not pair-scoped).
 * Columns: verdict_id, fold_index, sample_size, skipped, gate1_passed, gate2_passed, verdict.
 * A skipped fold has no gate pass/fail outcome.
 */
export interface GateFoldVerdictRow {
  readonly verdict_id: string;
  readonly fold_index: number;
  readonly sample_size: number;
  readonly skipped: boolean;
  readonly gate1_passed: boolean | null;
  readonly gate2_passed: boolean | null;
  readonly verdict: "PASS" | "CUT" | null;
}

/**
 * A single display-only research proposal carried in the `signal_rationale.proposals`
 * jsonb column (shape `[{proposalId, kind, proposalText}]`, design §Read_Only_View set).
 * Advisory / non-scoring; rendered as inert React text children only.
 */
export interface SignalProposal {
  readonly proposalId: string;
  readonly kind: string;
  readonly proposalText: string;
}

/**
 * `v_signal_rationale` — AI tab.
 * Columns: decision_date, pair, strategy_id, rationale_text, analogue_labels, proposals,
 * provenance, is_display_only.
 * `analogue_labels` is a text[]; `proposals` is a jsonb array of {@link SignalProposal}.
 */
export interface SignalRationaleRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly strategy_id: string;
  readonly rationale_text: string;
  readonly analogue_labels: readonly string[];
  readonly proposals: readonly SignalProposal[];
  readonly provenance: string;
  readonly is_display_only: boolean;
}

/**
 * `v_external_reference_comparison` — Third-party tab.
 * Columns: decision_date, pair, own_direction, reference_direction, reference_score,
 * provider, comparison, provenance, is_display_only, fetched_at.
 * Literal unions / nullability follow the base-table CHECK constraints: own_direction is
 * nullable UP/DOWN/FLAT, reference_direction is nullable BUY/SELL/HOLD, and comparison is
 * a NOT NULL enum including the "unavailable" marker.
 */
export interface ExternalReferenceComparisonRow {
  readonly decision_date: string;
  readonly pair: string;
  readonly own_direction: "UP" | "DOWN" | "FLAT" | null;
  readonly reference_direction: "BUY" | "SELL" | "HOLD" | null;
  readonly reference_score: number | null;
  readonly provider: string | null;
  readonly comparison: "agree" | "diverge" | "neutral" | "unavailable";
  readonly provenance: string;
  readonly is_display_only: boolean;
  readonly fetched_at: string | null;
}

// ---------------------------------------------------------------------------------------
// Typed endpoint map (task 8.1) — mirrors the Read_Proxy allowlist
// ---------------------------------------------------------------------------------------
//
// The ten endpoints below mirror, one-for-one, the fixed allowlist the Read_Proxy enforces
// in `services/read-proxy/src/allowlist.ts` (paths, accepted params, and the row type each
// returns). This map is the SPA's compile-time contract for the `/api/*` surface: it names
// every path, declares which params each endpoint accepts (and which are required), and
// ties each endpoint to the `*Row` interface above. It imports NOTHING from the proxy or
// the core (Req 20.2) — the two allowlists are independent copies kept in lockstep by
// hand, exactly as the wire-format row types are.
//
// This file remains type-only + plain data; the impure `fetch` wrapper that consumes this
// map lives in `web/src/api/client.ts`.
//
// _Requirements: 3.1, 3.2 (read only through the /api rewrite; fixed allowlist)_

/** The ten allowlisted read endpoints, as fixed paths under the `/api` rewrite. */
export const ENDPOINT_PATHS = [
  "/decision-dates",
  "/firing-setups",
  "/confidence-trend",
  "/analogue-outcomes",
  "/realized-outcomes",
  "/gate-verdicts",
  "/gate-fold-verdicts",
  "/candles",
  "/ai-rationale",
  "/external-comparison",
] as const;

/** One of the ten allowlisted endpoint paths. */
export type EndpointPath = (typeof ENDPOINT_PATHS)[number];

/**
 * The accepted query parameters for each endpoint, keyed by path. `?`-optional keys mirror
 * the proxy's optional params; required keys mirror the proxy's required params. All values
 * are strings on the wire; `limit` is a bounded integer rendered as a string. Narrower types
 * (e.g. {@link Pair}) are used where the proxy constrains the value, so a mistyped call is a
 * compile error in the SPA before any request is issued.
 */
export interface EndpointParams {
  "/decision-dates": Record<string, never>;
  "/firing-setups": { readonly decisionDate: string; readonly pair?: Pair };
  "/confidence-trend": { readonly pair: Pair; readonly limit?: number };
  "/analogue-outcomes": { readonly pair: Pair; readonly decisionDate?: string };
  "/realized-outcomes": { readonly pair: Pair; readonly decisionDate?: string };
  "/gate-verdicts": { readonly limit?: number };
  "/gate-fold-verdicts": { readonly verdictId: string };
  "/candles": { readonly pair: Pair; readonly from?: string; readonly to?: string };
  "/ai-rationale": { readonly decisionDate: string; readonly pair: Pair };
  "/external-comparison": { readonly decisionDate: string; readonly pair: Pair };
}

/**
 * The row type each endpoint returns (the element type of the response `rows` array). The
 * `/decision-dates` endpoint returns bare `{ decision_date }` rows projected by
 * `v_decision_dates`.
 */
export interface DecisionDateRow {
  readonly decision_date: string;
}

/** Maps each endpoint path to the element type of its `rows` payload. */
export interface EndpointRow {
  "/decision-dates": DecisionDateRow;
  "/firing-setups": FiringSetupRow;
  "/confidence-trend": FiringSetupRow;
  "/analogue-outcomes": AnalogueOutcomeRow;
  "/realized-outcomes": RealizedOutcomeRow;
  "/gate-verdicts": GateVerdictRow;
  "/gate-fold-verdicts": GateFoldVerdictRow;
  "/candles": CandleRow;
  "/ai-rationale": SignalRationaleRow;
  "/external-comparison": ExternalReferenceComparisonRow;
}
