// Gate 2 — Risk-Adjusted MFE/MAE Gate (Task 6.4).
//
// Requirements 11.7, 11.8; Design Component 7.
//
// Gate 2 is the second stage of the two-stage Kill_Gate. It is evaluated ONLY
// AFTER Gate 1 has passed (Requirement 11.8). It compares the pattern-model's
// excursion-weighted hit metric against the Weekly_Trend_Follow baseline's,
// over the selected Horizon, AFTER a pair-specific Friction_Penalty has been
// deducted symmetrically from the MFE/MAE excursions of BOTH sides
// (Requirement 11.7). Gate 2 passes iff the model's post-friction metric is at
// least the baseline's (`margin = modelRiskAdj - baselineRiskAdj >= 0`).
//
// Everything here is pure and deterministic (Requirement 3.2): callers pass in
// the model and baseline excursion sets and a `gate1Passed` guard; nothing is
// fetched internally.

import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import type { ForwardOutcome, HorizonOutcome } from "../retrieval/types.js";
import { FRICTION_PENALTY_PIPS, type Gate2Result } from "./types.js";

/**
 * Pure pair-specific Friction_Penalty lookup (pips). 1.5 for EURUSD/GBPUSD,
 * 2.0 for USDJPY/USDCHF/USDCAD. (Requirement 11.7)
 */
export function frictionPenaltyPips(pair: Pair): number {
  return FRICTION_PENALTY_PIPS[pair];
}

/**
 * The horizon-scoped, friction-adjusted excursion-weighted hit metric for a
 * single outcome.
 *
 * The Friction_Penalty models the cost of transacting around the daily
 * rollover, so it makes favorable moves smaller and adverse moves larger. We
 * therefore deduct the penalty from the favorable excursion (MFE) and add it to
 * the adverse excursion (MAE), then score the outcome by the *net* excursion
 * it achieved: `(MFE - friction) - (MAE + friction)`. This is
 * excursion-weighted — larger favorable moves score higher and larger adverse
 * moves score lower — and it collapses to the classic favorable-minus-adverse
 * "hit" quality once friction is applied. Excursions are clamped at 0 after the
 * deduction because an excursion cannot be negative in magnitude.
 */
export function frictionAdjustedNetExcursion(
  outcome: HorizonOutcome,
  frictionPips: number,
): number {
  const mfeAdj = Math.max(0, outcome.mfePips - frictionPips);
  const maeAdj = Math.max(0, outcome.maePips + frictionPips);
  return mfeAdj - maeAdj;
}

/**
 * The excursion-weighted hit metric for a whole excursion set over the selected
 * Horizon, after Friction_Penalty deduction: the mean friction-adjusted net
 * excursion across the set. An empty set scores 0 (neutral). Pure and
 * deterministic. (Requirements 11.7, 11.8)
 */
export function excursionWeightedHitMetric(
  outcomes: readonly ForwardOutcome[],
  horizon: Horizon,
  frictionPips: number,
): number {
  if (outcomes.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const outcome of outcomes) {
    sum += frictionAdjustedNetExcursion(outcome.perHorizon[horizon], frictionPips);
  }
  return sum / outcomes.length;
}

/** Inputs to a single Gate 2 evaluation. Excursions are supplied by the caller. */
export interface Gate2Input {
  /** The currency pair — selects the symmetric Friction_Penalty. */
  readonly pair: Pair;
  /** The selected Horizon over which MFE/MAE are scored. */
  readonly horizon: Horizon;
  /** Whether Gate 1 passed. Gate 2 is evaluated only after Gate 1 passes. */
  readonly gate1Passed: boolean;
  /** Pattern-model forward outcomes on the matched firing subset. */
  readonly modelOutcomes: readonly ForwardOutcome[];
  /** Weekly_Trend_Follow baseline forward outcomes on the same subset. */
  readonly baselineOutcomes: readonly ForwardOutcome[];
}

/** A Gate 2 result that was not evaluated because Gate 1 did not pass. */
const NOT_EVALUATED: Gate2Result = {
  modelRiskAdj: 0,
  baselineRiskAdj: 0,
  margin: 0,
  passed: false,
  evaluated: false,
};

/**
 * Evaluate Gate 2 (risk-adjusted MFE/MAE) for a configuration.
 *
 * Sequencing (Requirement 11.8): if Gate 1 did not pass, Gate 2 is NOT
 * evaluated — a not-evaluated result (`evaluated: false`, `passed: false`) is
 * returned and no comparison is performed.
 *
 * When Gate 1 passed, the pair-specific Friction_Penalty is deducted
 * symmetrically from the MFE/MAE of both the model and baseline outcomes
 * (Requirement 11.7), each side is reduced to its excursion-weighted hit metric
 * over the selected Horizon, and Gate 2 passes iff
 * `margin = modelRiskAdj - baselineRiskAdj >= 0` (Requirement 11.8).
 *
 * Pure and deterministic: identical inputs always produce identical results.
 */
export function evaluateGate2(input: Gate2Input): Gate2Result {
  if (!input.gate1Passed) {
    return NOT_EVALUATED;
  }

  const frictionPips = frictionPenaltyPips(input.pair);
  const modelRiskAdj = excursionWeightedHitMetric(
    input.modelOutcomes,
    input.horizon,
    frictionPips,
  );
  const baselineRiskAdj = excursionWeightedHitMetric(
    input.baselineOutcomes,
    input.horizon,
    frictionPips,
  );
  const margin = modelRiskAdj - baselineRiskAdj;

  return {
    modelRiskAdj,
    baselineRiskAdj,
    margin,
    passed: margin >= 0,
    evaluated: true,
  };
}
