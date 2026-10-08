/**
 * Pure display-formatting helpers for the Evaluation (Gate) tab (property-testable spirit —
 * Req 19).
 *
 * This module is PURE: no `fetch`, no DOM, no clock, and it imports only wire-format types.
 * Every function is a deterministic function of its arguments alone.
 *
 * The tab renders a PERSISTED evaluation report verbatim (R1.2, 20.1): it recomputes no
 * metric and fabricates no value, and it emits NO PASS/CUT verdict (R1.3). These helpers
 * only format already-stored numbers for display.
 */

/** Explicit marker rendered in place of a `null` figure — never a number, never fabricated. */
export const NOT_EVALUATED = "—" as const;

/**
 * Format a persisted numeric metric (accuracy, delta) verbatim. `null` renders as the
 * explicit {@link NOT_EVALUATED} marker. A present number is shown verbatim — no rounding or
 * recomputation beyond stringifying the stored value (R1.2, 20.1).
 */
export function formatFigure(value: number | null): string {
  if (value === null) {
    return NOT_EVALUATED;
  }
  return String(value);
}

/**
 * Format a stored accuracy fraction (0..1) as a percentage string for display, verbatim —
 * the stored value is only scaled by 100 for readability, not recomputed.
 */
export function formatAccuracy(value: number): string {
  return `${value * 100}%`;
}

/**
 * Format a stored delta-vs-baseline fraction as a signed percentage-point figure, suffixed
 * with "pp". No sign is added or stripped beyond what the stored value carries.
 */
export function formatDeltaPp(value: number): string {
  const pp = value * 100;
  const sign = pp > 0 ? "+" : "";
  return `${sign}${pp} pp`;
}
