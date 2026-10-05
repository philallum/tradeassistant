/**
 * Pure display-only external-provider comparison shaper (property-testable — Req 19).
 *
 * This module is PURE: no `fetch`, no DOM, no clock (`Date.now()`), and it imports NOTHING
 * from the deterministic core (`src/`). It is a deterministic function of its `rows`
 * argument alone, which is what lets Property 10 exercise it exhaustively with `fast-check`.
 *
 * It turns a pair's persisted `v_external_reference_comparison` rows into the inert,
 * research-only view model the Third-party tab renders. The system's own Direction_Class,
 * the provider's reference direction, and the Reference_Comparison are copied VERBATIM
 * (Req 12.1, 20.1). An `unavailable` comparison yields an explicit non-error "reference
 * unavailable" marker rather than an error or a fabricated reference (Req 12.3).
 *
 * The rendering layer is responsible for the research-only / never-a-decision-input
 * labeling (Req 12.2).
 */

import type { ExternalReferenceComparisonRow } from "../api/endpoints.ts";

/** The system's own persisted Direction_Class. */
export type OwnDirection = "UP" | "DOWN" | "FLAT";

/** The provider's persisted reference direction. */
export type ReferenceDirection = "BUY" | "SELL" | "HOLD";

/** The persisted Reference_Comparison enum, verbatim. */
export type Comparison = "agree" | "diverge" | "neutral" | "unavailable";

/**
 * Display-only external-comparison view model for a single pair + Decision_Date.
 *
 * - `present` is false when no row exists; the Third-party section is then omitted.
 * - `referenceUnavailable` is true exactly when `comparison === "unavailable"`: the UI
 *   renders the explicit non-error "reference unavailable" marker (Req 12.3) and does not
 *   treat the absent reference as a fabricated direction.
 * - `ownDirection`, `referenceDirection`, `referenceScore`, and `provider` are copied
 *   verbatim and may be `null` when the persisted row records them as absent.
 */
export interface ExternalViewModel {
  readonly present: boolean;
  readonly referenceUnavailable: boolean;
  readonly ownDirection: OwnDirection | null;
  readonly referenceDirection: ReferenceDirection | null;
  readonly referenceScore: number | null;
  readonly provider: string | null;
  readonly comparison: Comparison | null;
}

const ABSENT: ExternalViewModel = {
  present: false,
  referenceUnavailable: false,
  ownDirection: null,
  referenceDirection: null,
  referenceScore: null,
  provider: null,
  comparison: null,
};

/**
 * Pick the row with the maximum Decision_Date (ISO `YYYY-MM-DD` → lexicographic max).
 * The external-comparison endpoint is scoped to a single pair + Decision_Date, so in
 * practice there is at most one row; selecting the latest keeps the shaper total and
 * order-independent.
 */
function latestRow(
  rows: readonly ExternalReferenceComparisonRow[],
): ExternalReferenceComparisonRow | null {
  let chosen: ExternalReferenceComparisonRow | null = null;
  for (const row of rows) {
    if (chosen === null || row.decision_date > chosen.decision_date) {
      chosen = row;
    }
  }
  return chosen;
}

/**
 * Shape a pair's `external_reference_comparison` rows into an {@link ExternalViewModel}.
 *
 * Returns an omitted (`present: false`) model when the input is empty. Otherwise copies the
 * own direction, provider reference direction, score, provider, and comparison verbatim
 * (Req 12.1, 20.1). When the persisted comparison is `unavailable`, `referenceUnavailable`
 * is set so the UI shows an explicit marker rather than a fabricated reference (Req 12.3).
 */
export function shapeExternal(
  rows: readonly ExternalReferenceComparisonRow[],
): ExternalViewModel {
  const row = latestRow(rows);
  if (row === null) {
    return ABSENT;
  }

  return {
    present: true,
    referenceUnavailable: row.comparison === "unavailable",
    ownDirection: row.own_direction,
    referenceDirection: row.reference_direction,
    referenceScore: row.reference_score,
    provider: row.provider,
    comparison: row.comparison,
  };
}
