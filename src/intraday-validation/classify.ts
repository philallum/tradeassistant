// Deterministic validation classification + bounded confidence delta — Task 4
// (intraday-validation feature).
//
// Pure function mapping (candle features, original daily direction, original
// confidence) to a {@link ValidationResult}: a {@link ValidationState}, a BOUNDED
// symmetric Confidence_Delta in percentage points (`[-10, +10]`), the resulting
// Current_Confidence (`[0, 100]`), and a plain-language display-only reason.
//
// DETERMINISTIC CORE: no clock, randomness, network, or storage; no LLM input.
//
// EVIDENCE DISCIPLINE ("strength is not a probability"): the thresholds and the
// delta magnitudes below are PROVISIONAL and UNVALIDATED. They are centralized
// as the `THRESHOLDS` / `DELTA_PP` constants so a future evidence-based tune
// changes one place. The Current_Confidence is a deterministic, bounded
// adjustment of the original Earned_Confidence for DISPLAY — never a calibrated
// probability claim.

import type { DirectionClass } from "../retrieval/types.js";
import type { CandleFeatures, ValidationResult, ValidationState } from "./types.js";

/**
 * Provisional, UNVALIDATED classification thresholds. Centralized for a future
 * evidence-based tune (see RESEARCH-LOG / NEXT-STEPS). Changing these changes
 * only the strength of the displayed adjustment, never the daily decision.
 */
export const THRESHOLDS = {
  /** `bodyToRange` at/above which a same-direction body is a (weak) support. */
  supportBodyToRange: 0.25,
  /** `bodyToRange` at/above which a same-direction body may be a STRONG signal. */
  strongBodyToRange: 0.5,
  /** `pricePositionInRange` at/above which price is near the UP-favorable high. */
  nearHigh: 0.66,
  /** `pricePositionInRange` at/below which price is near the DOWN-favorable low. */
  nearLow: 0.34,
} as const;

/** The bounded, symmetric Confidence_Delta (percentage points) per state. */
export const DELTA_PP: Readonly<Record<ValidationState, number>> = {
  STRONGLY_SUPPORTS: 10,
  SUPPORTS: 5,
  NEUTRAL: 0,
  CONTRADICTS: -5,
  STRONGLY_CONTRADICTS: -10,
  NOT_APPLICABLE: 0,
} as const;

/** The hard bound on the Confidence_Delta magnitude (percentage points). */
export const MAX_DELTA_PP = 10 as const;

/** Clamp a value into the inclusive `[min, max]` range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Does a candle show a rejection wick on the FAVORABLE side for `direction`?
 * For an UP expectation a lower wick (buyers rejecting lower prices) is
 * favorable; for DOWN an upper wick (sellers rejecting higher prices) is.
 */
function favorableRejectionWick(features: CandleFeatures, direction: DirectionClass): boolean {
  return direction === "UP"
    ? features.lowerWick >= features.upperWick
    : features.upperWick >= features.lowerWick;
}

/** Is current price near the FAVORABLE extreme of the range for `direction`? */
function nearFavorableExtreme(features: CandleFeatures, direction: DirectionClass): boolean {
  return direction === "UP"
    ? features.pricePositionInRange >= THRESHOLDS.nearHigh
    : features.pricePositionInRange <= THRESHOLDS.nearLow;
}

/** Is current price near the ADVERSE extreme of the range for `direction`? */
function nearAdverseExtreme(features: CandleFeatures, direction: DirectionClass): boolean {
  // The adverse extreme for an UP expectation is the low (and vice versa), which
  // is exactly the favorable extreme of the OPPOSITE direction.
  return nearFavorableExtreme(features, direction === "UP" ? "DOWN" : "UP");
}

/**
 * Classify the forming 4H candle against the original daily direction and
 * produce the bounded confidence adjustment.
 *
 * @param features          The deterministic candle features.
 * @param originalDirection The original daily DirectionClass (UP/DOWN/FLAT).
 * @param originalConfidence The original Earned_Confidence in percentage points
 *                           `[0, 100]`. It is read only — never mutated.
 */
export function classifyValidation(
  features: CandleFeatures,
  originalDirection: DirectionClass,
  originalConfidence: number,
): ValidationResult {
  const state = classifyState(features, originalDirection);
  const delta = clamp(DELTA_PP[state], -MAX_DELTA_PP, MAX_DELTA_PP);
  const currentConfidence = clamp(originalConfidence + delta, 0, 100);
  const reason = reasonFor(state, features, originalDirection);
  return { state, confidenceDelta: delta, currentConfidence, reason };
}

/** The pure state-selection rule (no confidence arithmetic). */
export function classifyState(
  features: CandleFeatures,
  originalDirection: DirectionClass,
): ValidationState {
  // A FLAT original direction has no support/contradict defined against it.
  if (originalDirection === "FLAT") {
    return "NOT_APPLICABLE";
  }

  // Directional agreement: +1 same way, -1 opposite, 0 for a bodyless candle.
  const bodyDir = features.bodyDirection;
  if (bodyDir === "FLAT") {
    return "NEUTRAL";
  }
  const agrees = bodyDir === originalDirection;

  // A body too small relative to range is indecision regardless of direction.
  if (features.bodyToRange < THRESHOLDS.supportBodyToRange) {
    return "NEUTRAL";
  }

  if (agrees) {
    if (
      features.bodyToRange >= THRESHOLDS.strongBodyToRange &&
      nearFavorableExtreme(features, originalDirection) &&
      favorableRejectionWick(features, originalDirection)
    ) {
      return "STRONGLY_SUPPORTS";
    }
    return "SUPPORTS";
  }

  // Opposite-direction body.
  const opposite: DirectionClass = originalDirection === "UP" ? "DOWN" : "UP";
  if (
    features.bodyToRange >= THRESHOLDS.strongBodyToRange &&
    nearAdverseExtreme(features, originalDirection) &&
    favorableRejectionWick(features, opposite)
  ) {
    return "STRONGLY_CONTRADICTS";
  }
  return "CONTRADICTS";
}

/** A plain-language, display-only explanation of the classification. */
function reasonFor(
  state: ValidationState,
  features: CandleFeatures,
  originalDirection: DirectionClass,
): string {
  if (state === "NOT_APPLICABLE") {
    return "Original daily direction is FLAT; no intraday support or contradiction is defined.";
  }
  if (state === "NEUTRAL") {
    return "Current 4H price action is indecisive (small body relative to range); neither supports nor contradicts the original direction.";
  }

  const dirWord = originalDirection === "UP" ? "up" : "down";
  const bodyWord = features.bodyDirection === "UP" ? "bullish" : "bearish";
  const strong = state === "STRONGLY_SUPPORTS" || state === "STRONGLY_CONTRADICTS";
  const sizeWord = strong ? "large-bodied" : "directional";
  const wick =
    originalDirection === "UP"
      ? features.lowerWick >= features.upperWick
        ? " with a lower-wick rejection"
        : ""
      : features.upperWick >= features.lowerWick
        ? " with an upper-wick rejection"
        : "";

  const supports = state === "STRONGLY_SUPPORTS" || state === "SUPPORTS";
  const verb = supports ? "is directionally consistent with" : "runs against";
  return `Current 4H candle is a ${sizeWord} ${bodyWord} bar${wick}; this ${verb} the original ${dirWord} forecast.`;
}
