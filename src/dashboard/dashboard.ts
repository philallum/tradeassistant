// Silent-by-Default Dashboard — Design Component 11 (Requirements 16, 1, 12.3).
//
// `dailyRun(decisionDate)` produces a DashboardView over all five pairs
// (Requirement 16.1). The pipeline has three stages, in this exact order:
//
//   1. PER-PAIR FIRING DECISION (Requirements 16.2, 16.5, 16.6, 1.1, 12.3):
//      a pair fires iff it has a Kill_Gate-passing pattern AND its
//      Earned_Confidence is >= the configurable Confidence_Threshold AND the
//      news filter permits trading. A pair that has NOT passed the gate is never
//      displayed (Requirement 16.5); news suppression is respected
//      (Requirement 16.6). FLAT setups are not surfaced as directional cards.
//
//   2. CURRENCY CONCENTRATION GUARD (Requirement 22): runs AFTER the per-pair
//      firing decisions and BEFORE the final render, de-duplicating aligned
//      same-currency setups by conviction (Design Component 16).
//
//   3. RENDER: the surviving setups become FiringCards; if none survive, the
//      dashboard is empty (silent by default, Requirement 16.2).
//
// This module is deterministic (Requirement 3.1): identical `PairEvaluation`
// inputs yield an identical view, so a scheduled unattended run reproduces an
// equivalent local run (Requirement 16.7). The firing decision and guard take
// NO LLM input; the only LLM-derived values are the outward-only `rationale` /
// `analogueLabels` display strings on a rendered card (Requirements 2.1, 15.4).

import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import { applyCurrencyConcentrationGuard } from "./currencyConcentrationGuard.js";
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
  /** True iff this pair has a Kill_Gate-passing pattern (Requirement 16.5). */
  readonly gatePassing: boolean;
  /**
   * The pair's Earned_Confidence in [0,1]. Fires only when this is >= the
   * configurable Confidence_Threshold (Requirements 16.2, 1.1).
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
   * True when the news filter suppresses this pair for the Decision_Date
   * (Requirement 16.6). When true, the pair never fires regardless of gate /
   * confidence. Sourced from the News Filter's deterministic suppression
   * decision (Component 10); the dashboard consumes only the boolean outcome.
   */
  readonly newsSuppressed: boolean;
  /** Outward-only plain-language AI rationale for the card (Requirement 15.1). */
  readonly rationale: string;
  /** Outward-only qualitative analogue labels for the card (Requirement 15.3). */
  readonly analogueLabels: readonly string[];
}

/**
 * Determine whether a pair fires, applying all three firing conditions
 * (Requirements 16.2, 16.5, 16.6, 1.1). A FLAT setup expresses no directional
 * view and is not surfaced as a directional card.
 */
function fires(evaluation: PairEvaluation, confidenceThreshold: number): boolean {
  return (
    evaluation.gatePassing &&
    !evaluation.newsSuppressed &&
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
 * five pairs (Design Component 11; Requirements 16.1, 16.2, 16.5, 16.6, 1.1,
 * 12.3, 22).
 *
 * @param decisionDate The Decision_Date being evaluated.
 * @param evaluations  The per-pair deterministic evaluations. Any of the five
 *                     pairs missing from the input is treated as non-firing.
 * @param config       Optional dashboard config; defaults to the configured
 *                     Confidence_Threshold and `maxConcurrentAligned = 2`.
 * @returns The DashboardView: firing cards (empty ⇒ silent) plus the
 *          currency-concentration suppressions applied before render.
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

  // Stage 2: Currency Concentration Guard (after firing decisions, before
  // render) — de-duplicate aligned same-currency setups by conviction (Req 22).
  const { kept, suppressed } = applyCurrencyConcentrationGuard(firing, decisionDate, {
    maxConcurrentAligned: config.maxConcurrentAligned,
  });

  // Stage 3: render the survivors. Empty ⇒ silent (Requirement 16.2).
  const cards: FiringCard[] = kept.map((setup) => {
    const evaluation = firingEvaluations.get(setup.pair);
    // `evaluation` is always present: `kept` is a subset of `firing`, and every
    // firing pair recorded its evaluation above. The fallback keeps the render
    // total and satisfies the type-checker without inventing display text.
    return evaluation
      ? toFiringCard(setup, evaluation)
      : toFiringCard(setup, {
          ...setup,
          gatePassing: true,
          newsSuppressed: false,
          rationale: "",
          analogueLabels: [],
        });
  });

  return { decisionDate, cards, suppressed };
}

/**
 * The Dashboard as the Component 11 interface object (Requirement 16). Binds an
 * optional configuration; `dailyRun` takes the Decision_Date and the per-pair
 * evaluations produced by the compute pipeline (task 11.1).
 */
export interface Dashboard {
  dailyRun(decisionDate: TradingDate, evaluations: readonly PairEvaluation[]): DashboardView;
}

/**
 * Construct a {@link Dashboard} bound to a configuration (Requirement 16.4). The
 * Confidence_Threshold and `maxConcurrentAligned` are configurable and tunable
 * against the Kill_Gate backtest.
 */
export function createDashboard(config: DashboardConfig = DEFAULT_DASHBOARD_CONFIG): Dashboard {
  return {
    dailyRun(decisionDate, evaluations) {
      return dailyRun(decisionDate, evaluations, config);
    },
  };
}
