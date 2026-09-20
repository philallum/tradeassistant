// Confidence & Horizon Selector Types — Component 5 (Requirement 10).
//
// This module is part of the deterministic core: pure functions, no hidden
// mutable state, and NO LLM input. All inputs are typed numeric values or
// plain analogue records. (Requirement 2.1)

import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";

/**
 * A trading horizon of 1, 2, or 3 trading days. (Requirement 10.6)
 */
export type Horizon = 1 | 2 | 3;

/**
 * Branded number guaranteed to lie within [0, 1].
 *
 * Earned_Confidence is the historical resolution rate of an
 * Analogue_Neighborhood, adjusted by Sample_Size_Shrinkage. The brand keeps a
 * raw `number` from being passed where a validated confidence is expected.
 * (Requirements 10.1, 10.2, 10.7)
 */
export type Confidence = number & { readonly __brand: "Confidence" };

/**
 * The fixed prior weight `k` in the shrinkage formula
 * `C_shrunk = (n/(n+k))*C_raw + (k/(n+k))*0.5`. (Requirement 10.1)
 *
 * Because the prior weight is a fixed constant (not a function of `n`), a
 * neighborhood below the 30-analogue Sample_Size_Floor can never have its
 * shrunk confidence cross the Confidence_Threshold on sample size alone.
 */
export const FIXED_PRIOR_WEIGHT = 10 as const;

/**
 * The neutral prior toward which confidence is shrunk. (Requirement 10.1, 10.3)
 */
export const NEUTRAL_PRIOR = 0.5 as const;

/**
 * The Sample_Size_Floor: the minimum number of analogues a neighborhood must
 * contain before Earned_Confidence is treated as actionable. Consistent with
 * the retrieval 30-analogue floor (Requirements 9.9, 20.3, 10.3).
 *
 * NOTE: This is a semantic floor, not a hard override. The fixed-prior
 * shrinkage math already guarantees a sub-floor neighborhood cannot cross the
 * Confidence_Threshold on sample size alone; this constant exposes the floor so
 * downstream firing logic can flag/suppress rather than re-deriving it.
 */
export const SAMPLE_SIZE_FLOOR = 30 as const;

/**
 * The dead-band factor applied to ATR_14 to produce the FLAT band half-width.
 *
 * The FLAT_Dead_Band is `ATR_14 * FLAT_DEAD_BAND_FACTOR` (Requirement 10.4):
 * the band scales linearly with ATR_14 and is never a fixed pip constant. A
 * move whose magnitude is within the band classifies FLAT. (Requirement 10.5)
 */
export const FLAT_DEAD_BAND_FACTOR = 0.5;

/**
 * The Confidence & Horizon Selector — Design Component 5.
 *
 * Deterministic-core interface. Function signatures accept only typed numeric
 * inputs and analogue records; no LLM-derived type may reach them.
 */
export interface ConfidenceSelector {
  /**
   * Earned_Confidence = neighborhood resolution rate at `horizon`, shrunk
   * toward the neutral prior 0.5 by sample size. Result in [0,1].
   * (Requirements 10.1, 10.2, 10.3, 10.7)
   */
  earnedConfidence(neighborhood: readonly AnalogueRecord[], horizon: Horizon): Confidence;

  /**
   * Classify a net forward move as exactly one Direction_Class using the
   * ATR_14-scaled FLAT dead-band. (Requirements 1.4, 10.4, 10.5)
   */
  classify(netMovePips: number, atr14: number): DirectionClass;

  /**
   * Select the horizon (1, 2, or 3) with the strongest historical resolution
   * rate for the matched neighborhood. (Requirement 10.6)
   */
  selectHorizon(neighborhood: readonly AnalogueRecord[]): Horizon;
}
