// Silent-by-Default Dashboard — Design Component 11 (Requirements 16, 1, 3).
//
// `dailyRun(decisionDate)` produces a DashboardView over all five pairs
// (Requirement 16.1). The pipeline has two stages, in this exact order:
//
//   1. PER-PAIR FIRING DECISION (Requirements 3.5, 3.6, 1.1): a pair fires iff
//      it expresses a directional view (`direction !== "FLAT"`) AND its
//      Earned_Confidence is >= the configurable Confidence_Threshold. There is
//      NO suppression step: the former Gate_Auto_Block and the news suppressor
//      have both been removed (Requirements 3.4, 7), so firing depends only on
//      the deterministic direction and confidence. A pair that does not fire is
//      an explicit "no trade" observation, not a hidden one.
//
//   2. RENDER: the firing setups become FiringCards; if none fire, the
//      dashboard renders no directional cards for the date (Requirement 3.5).
//
// The dashboard applies NO suppressor. The Choppiness_Guard (design Decision 1 /
// C2, Requirement 3.1) and the Currency_Concentration_Guard (Requirement 3.3)
// that formerly silenced an otherwise-firing pair have both been REMOVED, so a
// firing pair is always rendered — nothing is silently dropped. The
// Choppiness_Metric is retained and surfaced as a displayed field on each
// `PairEvaluation` (Requirement 3.2); it never suppresses a setup.
//
// This module is deterministic (Requirement 3.1): identical `PairEvaluation`
// inputs yield an identical view, so a scheduled unattended run reproduces an
// equivalent local run (Requirement 16.7). The firing decision takes NO LLM
// input; the only LLM-derived values are the outward-only `rationale` /
// `analogueLabels` display strings on a rendered card (Requirements 2.1, 15.4).

import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import {
  DEFAULT_DASHBOARD_CONFIG,
  type DashboardConfig,
  type DashboardView,
  type FiringCard,
  type FiringSetup,
} from "./types.js";

/**
 * The per-pair deterministic evaluation the dashboard consumes on a
 * Decision_Date. This is the boundary between the end-to-end compute pipeline
 * (ingestion → encoder → retrieval → resolver → confidence → kill-gate → news;
 * wired in task 11.1) and the presentation logic here. Every field is a plain
 * deterministic value; there is no LLM-derived type on the firing-decision path.
 *
 * `rationale` / `analogueLabels` are the already-generated OUTWARD-ONLY display
 * strings (unwrapped from their `LlmTagged<…>` markers at this render boundary).
 * They are attached to a card only AFTER the pair fires and survives the guard;
 * they never participate in the firing or suppression decision
 * (Requirements 15.2, 15.4).
 */
export interface PairEvaluation {
  readonly pair: Pair;
  /**
   * The pair's Earned_Confidence in [0,1]. Fires only when this is >= the
   * configurable Confidence_Threshold (Requirements 3.5, 1.1).
   */
  readonly earnedConfidence: FiringSetup["earnedConfidence"];
  /** The deterministic Direction_Class. A FLAT setup is not surfaced. */
  readonly direction: FiringSetup["direction"];
  /** The selected forward Horizon (1 | 2 | 3). */
  readonly horizon: FiringSetup["horizon"];
  /** The favorable-vs-adverse excursion profile (Requirement 16.3). */
  readonly excursionProfile: FiringSetup["excursionProfile"];
  /** Empirical Stop_Loss in pips (Component 15), or `null` when below the floor. */
  readonly stopLossPips: number | null;
  /** Empirical Take_Profit in pips (Component 15), or `null` when below the floor. */
  readonly takeProfitPips: number | null;
  /**
   * The look-ahead-safe Efficiency-Ratio Choppiness_Metric in `[0,1]` (~1 clean
   * trend, ~0 chop) (Requirement 3.2). This is a DISPLAYED FIELD only: the
   * former Choppiness_Guard that suppressed on it has been removed
   * (Requirement 3.1), so the metric never hides a setup. It is purely outward
   * information for the operator and feeds no firing / suppression / scoring
   * decision.
   */
  readonly choppiness: number;
  /** Outward-only plain-language AI rationale for the card (Requirement 15.1). */
  readonly rationale: string;
  /** Outward-only qualitative analogue labels for the card (Requirement 15.3). */
  readonly analogueLabels: readonly string[];
}

/**
 * Determine whether a pair fires, applying the two firing conditions
 * (Requirements 3.5, 3.6, 1.1). A FLAT setup expresses no directional view and
 * is not surfaced as a directional card. There is no suppression step: the
 * former Gate_Auto_Block and news suppressor have been removed, so firing is a
 * pure function of the deterministic direction and Earned_Confidence.
 */
function fires(evaluation: PairEvaluation, confidenceThreshold: number): boolean {
  return (
    evaluation.direction !== "FLAT" &&
    evaluation.earnedConfidence >= confidenceThreshold
  );
}

/** Project a firing pair evaluation into the deterministic {@link FiringSetup}. */
function toFiringSetup(evaluation: PairEvaluation): FiringSetup {
  return {
    pair: evaluation.pair,
    direction: evaluation.direction,
    horizon: evaluation.horizon,
    earnedConfidence: evaluation.earnedConfidence,
    excursionProfile: evaluation.excursionProfile,
    stopLossPips: evaluation.stopLossPips,
    takeProfitPips: evaluation.takeProfitPips,
  };
}

/** Render a surviving firing setup into a display {@link FiringCard}. */
function toFiringCard(setup: FiringSetup, evaluation: PairEvaluation): FiringCard {
  return {
    pair: setup.pair,
    direction: setup.direction,
    horizon: setup.horizon,
    earnedConfidence: setup.earnedConfidence,
    excursionProfile: setup.excursionProfile,
    stopLossPips: setup.stopLossPips,
    takeProfitPips: setup.takeProfitPips,
    rationale: evaluation.rationale,
    analogueLabels: evaluation.analogueLabels,
  };
}

/**
 * Produce the silent-by-default dashboard view for a Decision_Date across all
 * five pairs (Design Component 11; Requirements 16.1, 3.5, 3.6, 1.1).
 *
 * @param decisionDate  The Decision_Date being evaluated.
 * @param evaluations   The per-pair deterministic evaluations. Any of the five
 *                      pairs missing from the input is treated as non-firing.
 * @param config        Optional dashboard config; defaults to the configured
 *                      Confidence_Threshold.
 * @returns The DashboardView: the firing cards (empty ⇒ no directional cards).
 *          No suppressor runs, so every firing pair is rendered.
 */
export function dailyRun(
  decisionDate: TradingDate,
  evaluations: readonly PairEvaluation[],
  config: DashboardConfig = DEFAULT_DASHBOARD_CONFIG,
): DashboardView {
  // Index evaluations by pair for a deterministic, pair-ordered pass.
  const byPair = new Map<Pair, PairEvaluation>();
  for (const evaluation of evaluations) {
    byPair.set(evaluation.pair, evaluation);
  }

  // Stage 1: per-pair firing decision, iterated in the canonical PAIRS order
  // so the resulting order (and thus the view) is deterministic.
  const firing: FiringSetup[] = [];
  const firingEvaluations = new Map<Pair, PairEvaluation>();
  for (const pair of PAIRS) {
    const evaluation = byPair.get(pair);
    if (evaluation && fires(evaluation, config.confidenceThreshold)) {
      firing.push(toFiringSetup(evaluation));
      firingEvaluations.set(pair, evaluation);
    }
  }

  // Stage 2: render the firing setups. No suppressor runs — the
  // Currency_Concentration_Guard (Requirement 3.3) and Choppiness_Guard
  // (Requirement 3.1) have been removed — so every firing pair becomes a card.
  // Empty ⇒ silent (Requirement 16.2).
  const cards: FiringCard[] = firing.map((setup) => {
    const evaluation = firingEvaluations.get(setup.pair);
    // `evaluation` is always present: every firing pair recorded its evaluation
    // above. The fallback keeps the render total and satisfies the type-checker
    // without inventing display text.
    return evaluation
      ? toFiringCard(setup, evaluation)
      : toFiringCard(setup, {
          ...setup,
          choppiness: 0,
          rationale: "",
          analogueLabels: [],
        });
  });

  return { decisionDate, cards };
}

/**
 * The Dashboard as the Component 11 interface object (Requirement 16). Binds an
 * optional configuration; `dailyRun` takes the Decision_Date and the per-pair
 * evaluations produced by the compute pipeline (task 11.1).
 */
export interface Dashboard {
  dailyRun(
    decisionDate: TradingDate,
    evaluations: readonly PairEvaluation[],
  ): DashboardView;
}

/**
 * Construct a {@link Dashboard} bound to a configuration (Requirement 16.4). The
 * Confidence_Threshold is configurable and tunable against the Kill_Gate
 * backtest.
 */
export function createDashboard(config: DashboardConfig = DEFAULT_DASHBOARD_CONFIG): Dashboard {
  return {
    dailyRun(decisionDate, evaluations) {
      return dailyRun(decisionDate, evaluations, config);
    },
  };
}
