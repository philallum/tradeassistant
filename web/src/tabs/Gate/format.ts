/**
 * Pure display-formatting helpers for the Gate tab (property-testable spirit — Req 19).
 *
 * This module is PURE: it performs no `fetch`, touches no DOM, reads no clock, and imports
 * only wire-format types from `../../api/endpoints`. Every function is a deterministic
 * function of its arguments alone.
 *
 * The Gate tab renders PERSISTED gate verdicts verbatim (Req 9.7, 9.8, 9.10, 20.1): it
 * recomputes no gate decision and fabricates no value. These helpers only format already-
 * stored numbers/flags for display. In particular, a PASS vs CUT verdict is conveyed by an
 * explicit text label AND a shape glyph — never by color alone (Req 18.3).
 */

import type { GateVerdictRow } from "../../api/endpoints";

/**
 * Explicit marker rendered in place of a `null` gate figure (e.g. gate-2 fields that are
 * null when gate-2 was not evaluated, or a skipped fold's missing outcome). It is a fixed
 * sentinel string — never a number — so a missing value can never be mistaken for a real
 * measurement (Req 9.10, no fabrication).
 */
export const NOT_EVALUATED = "—" as const;

/** The persisted top-level verdict literal. */
export type Verdict = GateVerdictRow["verdict"];

/**
 * A per-fold verdict, which may be `null` for a skipped fold (a skipped fold has no gate
 * pass/fail outcome — Req 9.8).
 */
export type FoldVerdict = Verdict | null;

/**
 * Human label for a top-level PASS/CUT verdict. The mapping is total over the two persisted
 * literals and introduces no new verdicts.
 */
export function formatVerdict(verdict: Verdict): string {
  switch (verdict) {
    case "PASS":
      return "PASS";
    case "CUT":
      return "CUT";
  }
}

/**
 * A shape glyph that distinguishes PASS from CUT WITHOUT relying on color (Req 18.3): PASS
 * is a check, CUT is a cross. Paired with the text label and an explicit `aria-label` in
 * the view, the verdict is conveyed redundantly through text and shape.
 */
export function verdictGlyph(verdict: Verdict): string {
  switch (verdict) {
    case "PASS":
      return "✓";
    case "CUT":
      return "✕";
  }
}

/**
 * Human label for a per-fold verdict, including the skipped case. A `null` fold verdict is
 * rendered as the explicit {@link NOT_EVALUATED} marker — never guessed.
 */
export function formatFoldVerdict(verdict: FoldVerdict): string {
  if (verdict === null) {
    return NOT_EVALUATED;
  }
  return formatVerdict(verdict);
}

/**
 * Format a persisted boolean gate pass/fail flag for display. `null` (not evaluated) is
 * rendered as the explicit {@link NOT_EVALUATED} marker. The two boolean states use text
 * labels ("passed" / "failed"), never color alone (Req 18.3).
 */
export function formatPassFlag(passed: boolean | null): string {
  if (passed === null) {
    return NOT_EVALUATED;
  }
  return passed ? "passed" : "failed";
}

/**
 * Format a persisted numeric gate figure (accuracy, risk-adjusted score, margin) for
 * display. `null` is rendered as the explicit {@link NOT_EVALUATED} marker. A present number
 * is shown verbatim — no rounding, scaling, or recomputation beyond stringifying the stored
 * value (Req 9.10, 20.1).
 */
export function formatFigure(value: number | null): string {
  if (value === null) {
    return NOT_EVALUATED;
  }
  return String(value);
}

/**
 * Format a persisted percentage-point delta figure (`gate1_delta_pp`) verbatim, suffixed
 * with the "pp" unit so the reader knows the stored number is already in percentage points.
 * No sign is added or stripped and no recomputation occurs (Req 9.10).
 */
export function formatDeltaPp(value: number): string {
  return `${value} pp`;
}
