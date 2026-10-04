/**
 * Pure row → Setups view-model shaper (property-testable — Req 19.4).
 *
 * This module is PURE: it performs no `fetch`, touches no DOM, reads no clock
 * (`Date.now()`), and imports NOTHING from the deterministic core (`src/`). It is a
 * deterministic function of its inputs alone. Every rendered value is drawn VERBATIM from a
 * persisted `firing_setups` row — the shaper recomputes nothing and fabricates nothing
 * (Req 9.10, 20.1). It only partitions the rows into surfaced cards and suppressions and
 * computes the silent / empty flags; the impure component layer renders the result.
 */

import type { FiringSetupRow, Direction, Horizon, Pair } from "../api/endpoints";

/**
 * A surfaced firing card. Every field is copied VERBATIM from the surfaced
 * `firing_setups` row (Req 9.1, 9.10, 20.1). `stopLossPips` / `takeProfitPips` carry the
 * row's raw `number | null` — the null boundary is turned into an explicit not-actionable
 * marker at the format boundary (`format.ts`), never fabricated here (Req 9.2).
 */
export interface CardVM {
  readonly pair: string;
  readonly strategyId: string;
  readonly direction: Direction;
  readonly horizon: Horizon;
  readonly earnedConfidence: number;
  readonly stopLossPips: number | null;
  readonly takeProfitPips: number | null;
}

/**
 * A suppressed setup. Carries the suppressed pair and the `suppression_reason` verbatim
 * across all five reasons (Req 9.3, 9.4). When the reason is `currency_concentration`,
 * `competingPairs` holds the full `competing_pairs` array unchanged so the competing
 * same-currency relationship stays visible cross-pair (Req 8.5, 9.3); for the other
 * reasons it is whatever the row carried (typically `null`).
 */
export interface SuppressionVM {
  readonly pair: string;
  readonly reason: NonNullable<FiringSetupRow["suppression_reason"]>;
  readonly competingPairs: readonly string[] | null;
}

/**
 * The Setups-tab view model for a single Decision_Date (design §Representative pure
 * signatures).
 */
export interface SetupsViewModel {
  /** The Decision_Date these rows belong to (verbatim from the rows; `""` when empty). */
  readonly decisionDate: string;
  /** One card per surfaced row, scoped to the selected pair (cross-pair when `"ALL"`). */
  readonly cards: readonly CardVM[];
  /** One entry per suppressed row — always cross-pair, including `competing_pairs` (Req 8.5). */
  readonly suppressions: readonly SuppressionVM[];
  /** True IFF rows are present and none is surfaced — the "no setups fired" day (Req 13.1). */
  readonly isSilent: boolean;
  /** False IFF the input is empty — drives the "no data for this date" state (Req 7.4). */
  readonly hasRows: boolean;
}

/**
 * Shape the persisted `firing_setups` rows for a Decision_Date into the Setups view model.
 *
 * - `cards` holds exactly one card per SURFACED row, scoped to `pair`: when a specific pair
 *   is selected only that pair's surfaced rows become cards; when `"ALL"` every surfaced
 *   row across the five pairs becomes a card (Req 8.3, 8.7, 9.1). Each card's fields are
 *   copied verbatim from the row (Req 9.10, 20.1).
 * - `suppressions` holds exactly one entry per SUPPRESSED row and is ALWAYS cross-pair —
 *   suppressions are never filtered by the pair selection, so a currency-concentration
 *   suppression and its `competing_pairs` stay visible regardless of the active pair
 *   (Req 8.5, 9.3, 9.4).
 * - `isSilent` is true iff rows are present but none is surfaced (Req 13.1, 13.3).
 * - `hasRows` is true iff the input is non-empty (Req 7.4, 7.2, 6.2).
 *
 * A row counts as suppressed when it is not surfaced; its `suppression_reason` is expected
 * to be present on such rows, and rows without a reason are not shaped into a suppression
 * entry (nothing is fabricated).
 */
export function shapeDashboardView(
  rows: readonly FiringSetupRow[],
  pair: Pair | "ALL",
): SetupsViewModel {
  const cards: CardVM[] = [];
  const suppressions: SuppressionVM[] = [];
  let anySurfaced = false;

  for (const row of rows) {
    if (row.surfaced) {
      anySurfaced = true;
      // Cards are pair-scoped: include all surfaced rows for "ALL", else only the
      // selected pair's surfaced rows (Req 8.3).
      if (pair === "ALL" || row.pair === pair) {
        cards.push({
          pair: row.pair,
          strategyId: row.strategy_id,
          direction: row.direction,
          horizon: row.horizon,
          earnedConfidence: row.earned_confidence,
          stopLossPips: row.stop_loss_pips,
          takeProfitPips: row.take_profit_pips,
        });
      }
    } else if (row.suppression_reason !== null) {
      // Suppressions stay cross-pair (Req 8.5): never filtered by the pair selection.
      suppressions.push({
        pair: row.pair,
        reason: row.suppression_reason,
        competingPairs: row.competing_pairs,
      });
    }
  }

  const hasRows = rows.length > 0;
  const decisionDate = hasRows ? (rows[0]?.decision_date ?? "") : "";

  return {
    decisionDate,
    cards,
    suppressions,
    isSilent: hasRows && !anySurfaced,
    hasRows,
  };
}
