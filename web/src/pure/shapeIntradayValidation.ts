/**
 * Pure intraday 4H-validation shaper (property-testable — Req 19 spirit).
 *
 * PURE: no `fetch`, no DOM, no clock, imports NOTHING from the deterministic core (`src/`).
 * Deterministic over its input alone.
 *
 * It turns the snapshot's v8 `intradayValidation` slice into the compact per-pair view model
 * the dashboard renders BESIDE the original daily forecast. The temporal separation is
 * explicit: the original daily direction/confidence are a verbatim SNAPSHOT (never
 * recomputed), and the intraday block carries the validation state, the current confidence,
 * and the bounded delta clearly LABELLED as an unvalidated adjustment — never a probability.
 *
 * Three states the UI must distinguish for a pair:
 *   - a validation row exists → `status: "available"` (render the intraday block),
 *   - the slice exists but has no row for this pair (provider was unavailable / the pair was
 *     stale) → `status: "unavailable"` (render the explicit "validation unavailable" marker),
 *   - no slice / no rows at all (older snapshot, or the intraday Job has not run) →
 *     `status: "unavailable"` as well, so the caller shows the same explicit marker.
 */

import type { IntradayValidation, ValidationState } from "../api/types";

/** The display state of the intraday validation block for one pair. */
export type IntradayValidationStatus = "available" | "unavailable";

/** The per-pair intraday-validation view model. */
export interface IntradayValidationViewModel {
  readonly status: IntradayValidationStatus;
  /** Human label for the validation state, or `null` when unavailable. */
  readonly stateLabel: string | null;
  /** The raw validation state, or `null` when unavailable. */
  readonly state: ValidationState | null;
  /** Current confidence as a whole-percent string (e.g. `"63%"`), or `null`. */
  readonly currentConfidenceText: string | null;
  /** Signed delta as a percentage-point string (e.g. `"+5pp"`, `"0pp"`), or `null`. */
  readonly changeText: string | null;
  /** Verbatim plain-language reason, or `null` when unavailable. */
  readonly reason: string | null;
  /** The observed instant (ISO-8601 UTC) the forming bar was read, or `null`. */
  readonly observedAt: string | null;
  /** Fixed label making clear the adjustment is not a calibrated probability. */
  readonly adjustmentLabel: string;
}

/** The fixed, non-probability disclaimer carried on every available row. */
export const UNVALIDATED_ADJUSTMENT_LABEL = "unvalidated adjustment" as const;

/** The explicit marker rendered when no validation is available for a pair. */
export const VALIDATION_UNAVAILABLE_TEXT = "Intraday validation unavailable" as const;

/** Map a {@link ValidationState} to its human label. Total over the six states. */
export function validationStateLabel(state: ValidationState): string {
  switch (state) {
    case "STRONGLY_SUPPORTS":
      return "Strongly supports";
    case "SUPPORTS":
      return "Supports";
    case "NEUTRAL":
      return "Neutral";
    case "CONTRADICTS":
      return "Contradicts";
    case "STRONGLY_CONTRADICTS":
      return "Strongly contradicts";
    case "NOT_APPLICABLE":
      return "Not applicable";
  }
}

/** Format a percentage-point confidence `[0,100]` as a whole-percent string. */
function formatPercentPoints(pp: number): string {
  return `${Math.round(pp)}%`;
}

/** Format a signed percentage-point delta (e.g. `+5pp`, `0pp`, `-10pp`). */
function formatDeltaPp(delta: number): string {
  const rounded = Math.round(delta);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}pp`;
}

/**
 * Shape the `intradayValidation` slice into the per-pair {@link IntradayValidationViewModel}.
 * Returns the explicit "unavailable" view model when the slice has no row for `pair` (absent
 * slice, pre-v8 snapshot, or a pair the intraday Job could not validate). Values are copied
 * verbatim and only formatted for display; nothing is recomputed or fabricated.
 */
export function shapeIntradayValidation(
  slice: IntradayValidation,
  pair: string,
): IntradayValidationViewModel {
  const row = slice.rows.find((r) => r.pair === pair);
  if (row === undefined) {
    return {
      status: "unavailable",
      stateLabel: null,
      state: null,
      currentConfidenceText: null,
      changeText: null,
      reason: null,
      observedAt: slice.observedAt,
      adjustmentLabel: UNVALIDATED_ADJUSTMENT_LABEL,
    };
  }
  return {
    status: "available",
    stateLabel: validationStateLabel(row.validationState),
    state: row.validationState,
    currentConfidenceText: formatPercentPoints(row.currentConfidence),
    changeText: formatDeltaPp(row.confidenceDelta),
    reason: row.reason,
    observedAt: slice.observedAt,
    adjustmentLabel: UNVALIDATED_ADJUSTMENT_LABEL,
  };
}
