// Empirical Analogue-Derived Risk Boundaries Types — Component 15 (Requirement 21).
//
// This module is part of the deterministic core: pure functions, no hidden
// mutable state, and NO LLM input. All inputs are typed numeric values or plain
// analogue records. (Requirement 21.3)

import type { AnalogueRecord } from "../retrieval/types.js";
import type { Horizon } from "../confidence/types.js";

export type { Horizon } from "../confidence/types.js";

/**
 * The neighborhood floor: a firing Analogue_Neighborhood must contain at least
 * this many analogues (at the selected horizon) before Empirical_Risk_Boundaries
 * are treated as actionable. Below the floor, `derive()` returns `null`.
 * (Requirement 21.5)
 *
 * Kept consistent with the confidence Sample_Size_Floor and the retrieval
 * 30-analogue floor (Requirements 9.9, 10.3, 20.3).
 */
export const RISK_BOUNDARY_FLOOR = 30 as const;

/**
 * Default percentile of the neighborhood MAE distribution used for Stop_Loss.
 * (Requirement 21.2)
 */
export const DEFAULT_STOP_LOSS_PERCENTILE = 75 as const;

/**
 * Default percentile of the neighborhood MFE distribution used for Take_Profit.
 * (Requirement 21.2)
 */
export const DEFAULT_TAKE_PROFIT_PERCENTILE = 50 as const;

/**
 * Optional configuration for {@link EmpiricalRiskBoundaries.derive}.
 * Both percentiles are configurable (Requirement 21.2); omitted values fall
 * back to the defaults (75 for Stop_Loss, 50 for Take_Profit).
 */
export interface RiskBoundaryConfig {
  /** Percentile (0–100) of neighborhood MAE for Stop_Loss. Default 75. */
  readonly stopLossPercentile?: number;
  /** Percentile (0–100) of neighborhood MFE for Take_Profit. Default 50. */
  readonly takeProfitPercentile?: number;
}

/**
 * The derived, empirical Stop_Loss / Take_Profit for a firing setup, in pips.
 * (Requirement 21.1, 21.4)
 */
export interface RiskBoundaries {
  /** Stop_Loss in pips = configured percentile of neighborhood MAE. */
  readonly stopLossPips: number;
  /** Take_Profit in pips = configured percentile of neighborhood MFE. */
  readonly takeProfitPips: number;
}

/**
 * Empirical Analogue-Derived Risk Boundaries — Design Component 15.
 *
 * Deterministic-core interface. `derive()` accepts only analogue records plus
 * numeric configuration; no LLM-derived type may reach it. (Requirement 21.3)
 */
export interface EmpiricalRiskBoundaries {
  /**
   * Derive Stop_Loss and Take_Profit from the firing neighborhood's excursion
   * distribution at the selected horizon.
   *
   * - Stop_Loss = configured percentile (default 75th) of the neighborhood MAE
   *   distribution at `horizon`. (Requirements 21.1, 21.2)
   * - Take_Profit = configured percentile (default 50th) of the neighborhood
   *   MFE distribution at `horizon`. (Requirements 21.1, 21.2)
   * - Returns `null` (not actionable) when the neighborhood has fewer than
   *   {@link RISK_BOUNDARY_FLOOR} analogues at `horizon`. (Requirement 21.5)
   *
   * Computed deterministically with no LLM input. (Requirement 21.3)
   */
  derive(
    neighborhood: readonly AnalogueRecord[],
    horizon: Horizon,
    config?: RiskBoundaryConfig,
  ): RiskBoundaries | null;
}
