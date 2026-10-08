/**
 * Pure prediction-versus-actual shaper (property-testable — Req 19).
 *
 * This module is PURE: no `fetch`, no DOM, no clock (`Date.now()`), and it imports NOTHING
 * from the deterministic core (`src/`). It is a deterministic function of its `rows`
 * argument alone, which is what lets Property 9 exercise it exhaustively with `fast-check`.
 *
 * It turns a pair's persisted `v_realized_outcomes` rows into the view model the
 * Pattern & Outcomes tab renders. Every surfaced value is copied VERBATIM from the selected
 * row — nothing is recomputed (Req 10.4, 20.1). Decision_Dates are ISO `YYYY-MM-DD`
 * strings, so "most recent" is the plain lexicographic string maximum (see `selectDates`).
 */

import type { Direction, Horizon, RealizedOutcomeRow } from "../api/types.ts";

/**
 * The predicted side of the comparison, copied verbatim from the selected row (Req 10.1).
 */
export interface PredictedVM {
  readonly direction: Direction;
  readonly earnedConfidence: number;
  /** `null` means the row carries no actionable stop boundary — never fabricated. */
  readonly stopLossPips: number | null;
  /** `null` means the row carries no actionable target boundary — never fabricated. */
  readonly takeProfitPips: number | null;
}

/**
 * The realized (actual) side of the comparison, copied verbatim from the selected row when
 * it has matured (Req 10.1). A pending row yields {@link PredictionActualVM.actual} = null
 * and {@link PredictionActualVM.pending} = true instead of a fabricated outcome (Req 10.2).
 */
export interface RealizedVM {
  readonly direction: Direction;
  readonly mfePips: number;
  readonly maePips: number;
}

/**
 * Prediction-versus-actual view model for a single pair.
 *
 * - `hasData` is false when no `realized_outcomes` row is present at all; the tab then
 *   renders a "no data" state and all other fields are null/false.
 * - `pending` is true when the selected row's `matured` flag is false (or no matured row
 *   exists): the UI shows a pending marker and `actual` stays null (Req 10.2).
 * - `predicted` is always present when `hasData` is true (predicted fields are non-null on
 *   the row regardless of maturity).
 */
export interface PredictionActualVM {
  readonly hasData: boolean;
  readonly pending: boolean;
  readonly decisionDate: string | null;
  readonly horizon: Horizon | null;
  readonly predicted: PredictedVM | null;
  readonly actual: RealizedVM | null;
}

const EMPTY: PredictionActualVM = {
  hasData: false,
  pending: false,
  decisionDate: null,
  horizon: null,
  predicted: null,
  actual: null,
};

/**
 * Pick the row with the maximum Decision_Date from a non-empty list, preferring later
 * rows deterministically. Order- and duplicate-independent.
 */
function latestByDecisionDate(
  rows: readonly RealizedOutcomeRow[],
): RealizedOutcomeRow | null {
  let chosen: RealizedOutcomeRow | null = null;
  for (const row of rows) {
    if (chosen === null || row.decision_date > chosen.decision_date) {
      chosen = row;
    }
  }
  return chosen;
}

/**
 * Shape a pair's `realized_outcomes` rows into a {@link PredictionActualVM}.
 *
 * Selection (Req 10.3): when at least one row is matured, the matured row with the maximum
 * Decision_Date is chosen. When no row is matured, the latest row overall is chosen and the
 * result is marked `pending`. When the input is empty, an empty (`hasData: false`) model is
 * returned.
 *
 * Projection (Req 10.1, 10.2, 10.4, 20.1): predicted fields are copied verbatim. The actual
 * side is copied verbatim ONLY when the selected row is matured AND its realized fields are
 * present; otherwise the model is `pending` with `actual: null` — a pending row NEVER yields
 * a fabricated realized direction or excursion value.
 */
export function shapePredictionActual(
  rows: readonly RealizedOutcomeRow[],
): PredictionActualVM {
  if (rows.length === 0) {
    return EMPTY;
  }

  const matured = rows.filter((row) => row.matured);
  const selected =
    matured.length > 0
      ? latestByDecisionDate(matured)
      : latestByDecisionDate(rows);

  if (selected === null) {
    return EMPTY;
  }

  const predicted: PredictedVM = {
    direction: selected.predicted_direction,
    earnedConfidence: selected.earned_confidence,
    stopLossPips: selected.stop_loss_pips,
    takeProfitPips: selected.take_profit_pips,
  };

  // Treat the row as pending unless it is matured AND carries complete realized data.
  // Guarding on the realized fields keeps us from fabricating an outcome from a row whose
  // `matured` flag disagrees with its (still-null) excursion columns (Req 10.2).
  const hasRealized =
    selected.matured &&
    selected.realized_direction !== null &&
    selected.realized_mfe_pips !== null &&
    selected.realized_mae_pips !== null;

  if (!hasRealized) {
    return {
      hasData: true,
      pending: true,
      decisionDate: selected.decision_date,
      horizon: selected.horizon,
      predicted,
      actual: null,
    };
  }

  const actual: RealizedVM = {
    direction: selected.realized_direction as Direction,
    mfePips: selected.realized_mfe_pips as number,
    maePips: selected.realized_mae_pips as number,
  };

  return {
    hasData: true,
    pending: false,
    decisionDate: selected.decision_date,
    horizon: selected.horizon,
    predicted,
    actual,
  };
}
