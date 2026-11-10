/**
 * Pure shaper for the "invalidation distance" line on a firing card.
 *
 * DELIBERATE, LABELLED reintroduction of one removed UI element (decision recorded in
 * docs/state/DECISIONS.md): the backend already derives, per firing pair, the 75th percentile
 * of the neighbourhood's historical adverse excursion (MAE) measured from the next session's
 * open over one session. This shaper restates that single number as the distance beyond which
 * the pattern thesis is treated as invalidated. It is NOT a stop recommendation, never a
 * target, and carries no expectancy. It stays tagged "unvalidated".
 *
 * Absent (null) when the pair did not surface, is FLAT, or the backend had too few analogues
 * to derive the value (`stop_loss_pips` null). Pure: copies the persisted value, derives
 * nothing, never mutates its input.
 */
import type { FiringSetupRow } from "../api/types";

export const INVALIDATION_UNVALIDATED_TAG = "unvalidated";

export const INVALIDATION_NOTE =
  "75th percentile historical adverse move for similar shapes. Not a stop recommendation.";

export interface InvalidationVM {
  /** "31.5" or "32" - the persisted pip distance, rounded for display only. */
  readonly pipsText: string;
  readonly direction: "UP" | "DOWN";
  /** One sentence: "If price falls 31.5 pips below the next session's open ..." */
  readonly text: string;
  readonly tag: typeof INVALIDATION_UNVALIDATED_TAG;
  readonly note: string;
}

function formatPips(pips: number): string {
  const rounded = Math.round(pips * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function shapeInvalidation(
  pair: string,
  firingSetups: readonly FiringSetupRow[],
  decisionDate: string,
): InvalidationVM | null {
  const firing = firingSetups.find((f) => f.pair === pair && f.decision_date === decisionDate);
  if (firing === undefined || !firing.surfaced) return null;
  if (firing.direction === "FLAT") return null;
  const pips = firing.stop_loss_pips;
  if (pips === null || !Number.isFinite(pips) || pips <= 0) return null;

  const pipsText = formatPips(pips);
  const text =
    firing.direction === "UP"
      ? `If price falls ${pipsText} pips below the next session's open before that session closes, this pattern thesis is invalidated.`
      : `If price rises ${pipsText} pips above the next session's open before that session closes, this pattern thesis is invalidated.`;

  return {
    pipsText,
    direction: firing.direction,
    text,
    tag: INVALIDATION_UNVALIDATED_TAG,
    note: INVALIDATION_NOTE,
  };
}
