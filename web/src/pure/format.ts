/**
 * Pure display-formatting helpers for the dashboard (property-testable — Req 19).
 *
 * This module is PURE: it performs no `fetch`, touches no DOM, reads no clock
 * (`Date.now()`), and imports NOTHING from the deterministic core (`src/`). Every function
 * is a deterministic function of its arguments alone. The functions here format already-
 * persisted values for display ONLY — they never recompute, derive, or fabricate a value
 * (Req 9.10, 20.1). In particular, a null Stop_Loss / Take_Profit boundary is rendered as
 * an explicit not-actionable marker, never as a made-up number (Req 9.2).
 */

import type { Direction } from "../api/endpoints";

/**
 * The explicit "not actionable" marker rendered in place of a null Stop_Loss /
 * Take_Profit pip value (Req 9.2). It is a fixed sentinel string — never a number — so a
 * missing boundary can never be mistaken for a real pip distance.
 */
export const NOT_ACTIONABLE = "—" as const;

/** Discriminated marker type for formatting consumers that need to branch on actionability. */
export type NotActionable = typeof NOT_ACTIONABLE;

/**
 * Format a Stop_Loss / Take_Profit pip distance for display.
 *
 * Returns an explicit {@link NOT_ACTIONABLE} marker when the row value is `null`
 * (Req 9.2) — the function NEVER fabricates a number. Otherwise it renders the row's
 * numeric value verbatim, suffixed with the pip unit; no rounding or recomputation beyond
 * stringifying the stored number (Req 9.10, 20.1).
 */
export function formatPips(pips: number | null): string {
  if (pips === null) {
    return NOT_ACTIONABLE;
  }
  return `${pips} pips`;
}

/**
 * Format an Earned_Confidence value (a persisted probability in `[0, 1]`) as a whole-
 * percent string for display. This is a pure presentation transform of the stored value —
 * it does not alter, re-derive, or recompute the confidence (Req 9.10, 20.1); the raw
 * numeric value remains available on the view model for charts.
 */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Format a Direction_Class for display. Maps the persisted literal verbatim to its human
 * label; the mapping is total over the three persisted values and introduces no new
 * directions (Req 9.1, 9.10).
 */
export function formatDirection(direction: Direction): string {
  switch (direction) {
    case "UP":
      return "Up";
    case "DOWN":
      return "Down";
    case "FLAT":
      return "Flat";
  }
}
