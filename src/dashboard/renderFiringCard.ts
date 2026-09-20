// Firing-card rendering — Design Component 11 (Requirements 16.3, 1.3, 1.5,
// 21.4, 21.5).
//
// `renderFiringCard(card)` turns a deterministic {@link FiringCard} into a
// display projection that surfaces EVERY required field explicitly: the Pair,
// the Direction_Class, the selected Horizon, the Earned_Confidence, the
// favorable-versus-adverse excursion profile, the empirical Stop_Loss /
// Take_Profit (from Component 15, Requirement 21.4), and the AI rationale plus
// qualitative analogue labels (Requirement 15).
//
// This module is DETERMINISTIC: for a given card it always produces the same
// rendered output. It takes no LLM input on any decision path — `rationale` and
// `analogueLabels` arrive on the card as already-generated OUTWARD-ONLY display
// strings and are surfaced verbatim; they never influence any field derived
// here (Requirements 2.1, 15.4).
//
// Below-floor handling (Requirement 21.5): when the Analogue_Neighborhood is
// below the 30-analogue floor, Component 15 passes `stopLossPips` /
// `takeProfitPips` as `null`. Such boundaries are NOT actionable, so the render
// exposes them as `null` on the structured field and as a fixed, explicit
// "not actionable (below sample-size floor)" marker in the display line rather
// than fabricating a number.

import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { ExcursionProfile, FiringCard } from "./types.js";

/**
 * The display marker used for an empirical risk boundary (Stop_Loss or
 * Take_Profit) whose Analogue_Neighborhood is below the 30-analogue floor and
 * is therefore NOT surfaced as actionable (Requirement 21.5).
 */
export const RISK_BOUNDARY_NOT_ACTIONABLE = "not actionable (below sample-size floor)" as const;

/**
 * The rendered, display-ready projection of a {@link FiringCard} — the output of
 * {@link renderFiringCard} (Design Component 11; Requirements 16.3, 1.3, 1.5,
 * 21.4, 21.5).
 *
 * Every required firing-card field is present here explicitly, both as its
 * typed value (`pair`, `direction`, `horizon`, …) and as a human-readable
 * display string (`*Display`). A property/unit test can import this type and
 * assert on either representation.
 *
 * `stopLossPips` / `takeProfitPips` preserve the card's `number | null`: `null`
 * denotes a below-floor, non-actionable boundary (Requirement 21.5), which the
 * corresponding display string renders as {@link RISK_BOUNDARY_NOT_ACTIONABLE}.
 */
export interface RenderedCard {
  readonly pair: Pair;
  readonly pairDisplay: string;

  readonly direction: DirectionClass;
  readonly directionDisplay: string;

  readonly horizon: Horizon;
  /** e.g. "2 trading days" (Requirement 1.5: the Horizon is stated explicitly). */
  readonly horizonDisplay: string;

  readonly earnedConfidence: number;
  /** The Earned_Confidence as a whole-number percentage, e.g. "62%". */
  readonly earnedConfidenceDisplay: string;

  readonly excursionProfile: ExcursionProfile;
  /** e.g. "favorable 40.0 pips vs adverse 25.0 pips" (Requirement 16.3). */
  readonly excursionDisplay: string;

  /** Empirical Stop_Loss in pips (Component 15), or `null` when below floor. */
  readonly stopLossPips: number | null;
  /** e.g. "25.0 pips" or the not-actionable marker (Requirements 21.4, 21.5). */
  readonly stopLossDisplay: string;

  /** Empirical Take_Profit in pips (Component 15), or `null` when below floor. */
  readonly takeProfitPips: number | null;
  /** e.g. "40.0 pips" or the not-actionable marker (Requirements 21.4, 21.5). */
  readonly takeProfitDisplay: string;

  /** The AI-generated plain-language rationale, verbatim (Requirement 15.1). */
  readonly rationale: string;
  /** The qualitative analogue labels, verbatim (Requirement 15.3). */
  readonly analogueLabels: readonly string[];

  /**
   * A single deterministic multi-line text rendering of the whole card,
   * convenient for a plain-text dashboard. Every required field appears exactly
   * once, in a fixed order.
   */
  readonly text: string;
}

/** Human-readable label for each Direction_Class. */
const DIRECTION_LABELS: Readonly<Record<DirectionClass, string>> = {
  UP: "Long (UP)",
  DOWN: "Short (DOWN)",
  FLAT: "Flat",
};

/** Format a pip magnitude deterministically to one decimal place, e.g. "40.0 pips". */
function formatPips(pips: number): string {
  return `${pips.toFixed(1)} pips`;
}

/**
 * Format an empirical risk boundary: a pip value when actionable, or the fixed
 * not-actionable marker when the neighborhood is below the floor (`null`,
 * Requirement 21.5).
 */
function formatRiskBoundary(pips: number | null): string {
  return pips === null ? RISK_BOUNDARY_NOT_ACTIONABLE : formatPips(pips);
}

/** Format Earned_Confidence in [0,1] as a whole-number percentage, e.g. "62%". */
function formatConfidence(earnedConfidence: number): string {
  return `${Math.round(earnedConfidence * 100)}%`;
}

/**
 * Render a {@link FiringCard} into its display projection {@link RenderedCard}
 * (Design Component 11; Requirements 16.3, 1.3, 1.5, 21.4, 21.5).
 *
 * Pure and deterministic: the same card always renders identically, and no
 * field derived here depends on the outward-only `rationale` / `analogueLabels`
 * (Requirements 2.1, 15.4). Below-floor Stop_Loss / Take_Profit (`null`) is
 * surfaced as {@link RISK_BOUNDARY_NOT_ACTIONABLE} rather than a fabricated
 * number (Requirement 21.5).
 *
 * @param card The deterministic firing card to render.
 * @returns The display-ready projection with every required field explicit.
 */
export function renderFiringCard(card: FiringCard): RenderedCard {
  const pairDisplay = card.pair;
  const directionDisplay = DIRECTION_LABELS[card.direction];
  const horizonDisplay = `${card.horizon} trading day${card.horizon === 1 ? "" : "s"}`;
  const earnedConfidenceDisplay = formatConfidence(card.earnedConfidence);
  const excursionDisplay =
    `favorable ${formatPips(card.excursionProfile.favorablePips)} ` +
    `vs adverse ${formatPips(card.excursionProfile.adversePips)}`;
  const stopLossDisplay = formatRiskBoundary(card.stopLossPips);
  const takeProfitDisplay = formatRiskBoundary(card.takeProfitPips);

  const analogueLine =
    card.analogueLabels.length > 0 ? card.analogueLabels.join(", ") : "(none)";

  const text = [
    `Pair: ${pairDisplay}`,
    `Direction: ${directionDisplay}`,
    `Horizon: ${horizonDisplay}`,
    `Earned Confidence: ${earnedConfidenceDisplay}`,
    `Excursion: ${excursionDisplay}`,
    `Stop Loss: ${stopLossDisplay}`,
    `Take Profit: ${takeProfitDisplay}`,
    `Rationale: ${card.rationale}`,
    `Analogues: ${analogueLine}`,
  ].join("\n");

  return {
    pair: card.pair,
    pairDisplay,
    direction: card.direction,
    directionDisplay,
    horizon: card.horizon,
    horizonDisplay,
    earnedConfidence: card.earnedConfidence,
    earnedConfidenceDisplay,
    excursionProfile: card.excursionProfile,
    excursionDisplay,
    stopLossPips: card.stopLossPips,
    stopLossDisplay,
    takeProfitPips: card.takeProfitPips,
    takeProfitDisplay,
    rationale: card.rationale,
    analogueLabels: card.analogueLabels,
    text,
  };
}
