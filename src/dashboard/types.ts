// Silent-by-Default Dashboard Types — Component 11 (Requirements 16, 1, 12.3).
//
// This module is part of the DETERMINISTIC CORE for the firing decision: it is a
// pure function of typed numeric inputs and enumerated values, with NO LLM input
// (Requirement 2.1).
//
// The only LLM-derived values that appear here are the OUTWARD-ONLY display
// fields on a rendered FiringCard (`rationale`, `analogueLabels`). They flow
// outward to the view and never back into any firing / scoring decision
// (Requirements 15.2, 15.4). The firing logic never reads them.

import type { Confidence, Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { TradingDate } from "../guard/types.js";

/**
 * The favorable-versus-adverse excursion profile shown on a firing card
 * (Requirement 16.3): the neighborhood's expected favorable (MFE-derived) and
 * adverse (MAE-derived) movement, in pips.
 */
export interface ExcursionProfile {
  readonly favorablePips: number;
  readonly adversePips: number;
}

/**
 * A per-pair firing setup: the deterministic outcome of a pair's firing
 * decision on a Decision_Date, BEFORE the final render. It carries only
 * deterministic-core values — no LLM-derived type.
 *
 * A `FiringSetup` exists only for a pair that has already satisfied all three
 * per-pair firing conditions: a Kill_Gate-passing pattern, Earned_Confidence at
 * or above the configurable Confidence_Threshold, and news permitting trading
 * (Requirements 16.2, 16.5, 16.6, 1.1).
 */
export interface FiringSetup {
  readonly pair: Pair;
  readonly direction: DirectionClass;
  readonly horizon: Horizon;
  readonly earnedConfidence: Confidence;
  readonly excursionProfile: ExcursionProfile;
  /**
   * The empirical Stop_Loss in pips from Component 15 (Requirement 21.4), or
   * `null` when the neighborhood is below the 30-analogue floor and boundaries
   * are not actionable (Requirement 21.5). Passed in as an input so this module
   * has no hard dependency on the (parallel) risk-boundaries module.
   */
  readonly stopLossPips: number | null;
  /** The empirical Take_Profit in pips from Component 15 (Requirement 21.4), or `null`. */
  readonly takeProfitPips: number | null;
}

/**
 * A rendered firing card — Design Component 11 (Requirements 16.3, 1.3, 1.5,
 * 21.4). Includes every required field: pair, Direction_Class, selected
 * Horizon, Earned_Confidence, the favorable-versus-adverse excursion profile,
 * the empirical Stop_Loss / Take_Profit, and the AI rationale + analogue labels.
 *
 * `rationale` and `analogueLabels` are the OUTWARD-ONLY display strings produced
 * by the `signal_rationale` / `pattern_description` roles (Requirement 15). They
 * are already unwrapped from their `LlmTagged<…>` provenance markers at the
 * render boundary and never re-enter any scoring / firing path.
 */
export interface FiringCard {
  readonly pair: Pair;
  readonly direction: DirectionClass;
  readonly horizon: Horizon;
  readonly earnedConfidence: number;
  readonly excursionProfile: ExcursionProfile;
  /** Empirical Stop_Loss in pips (Component 15), or `null` when below the floor. */
  readonly stopLossPips: number | null;
  /** Empirical Take_Profit in pips (Component 15), or `null` when below the floor. */
  readonly takeProfitPips: number | null;
  /** Plain-language AI rationale (display-only, Requirement 15.1). */
  readonly rationale: string;
  /** Qualitative analogue labels (display-only, Requirement 15.3). */
  readonly analogueLabels: readonly string[];
}

/**
 * The dashboard view for a Decision_Date — the output of `Dashboard.dailyRun()`
 * (Requirement 16.1). Silent by default: `cards` is empty when no pair satisfies
 * the firing conditions (Requirement 16.2). There are no dashboard-level
 * suppressors: the Choppiness_Guard (Requirement 3.1) and the
 * Currency_Concentration_Guard (Requirement 3.3) have both been removed, so a
 * firing pair is always rendered — nothing is silently dropped.
 */
export interface DashboardView {
  readonly decisionDate: TradingDate;
  /** The firing cards to render, in deterministic order. Empty ⇒ silent. */
  readonly cards: readonly FiringCard[];
}

/**
 * Dashboard configuration (Requirement 16.4). The Confidence_Threshold is
 * configurable and tunable against the Kill_Gate backtest.
 */
export interface DashboardConfig {
  /**
   * The Confidence_Threshold a pair's Earned_Confidence must reach (>=) to fire
   * (Requirements 16.2, 16.4, 1.1). Configurable and backtest-tunable.
   */
  readonly confidenceThreshold: number;
}

/** The default Confidence_Threshold. Configurable per {@link DashboardConfig}. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.55 as const;

/**
 * The default trailing window for the Efficiency-Ratio Choppiness_Metric, in
 * trading days. Aligned with the ATR_14 lookback so the two volatility views
 * (magnitude vs. efficiency) share a comparable horizon (Requirement 3.2). The
 * metric is displayed only — it no longer feeds any suppression decision.
 */
export const DEFAULT_CHOPPINESS_WINDOW = 14 as const;

/** The default dashboard configuration. */
export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
};
