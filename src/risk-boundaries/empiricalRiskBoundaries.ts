// Empirical Analogue-Derived Risk Boundaries — Component 15 (Requirement 21).
//
// A deterministic-core component that derives Stop_Loss and Take_Profit from
// the firing neighborhood's excursion distribution rather than from generic
// ATR multipliers:
//
//   - Stop_Loss  = configured percentile (default 75th) of neighborhood MAE.
//   - Take_Profit = configured percentile (default 50th) of neighborhood MFE.
//
// Both percentiles are configurable (Req 21.2). The computation is pure and
// takes NO LLM input (Req 21.3). When the neighborhood is below the 30-analogue
// floor at the selected horizon, `derive()` returns null (not actionable,
// Req 21.5).
//
// Pure functions, no hidden mutable state.

import type { AnalogueRecord } from "../retrieval/types.js";
import {
  DEFAULT_STOP_LOSS_PERCENTILE,
  DEFAULT_TAKE_PROFIT_PERCENTILE,
  RISK_BOUNDARY_FLOOR,
  type EmpiricalRiskBoundaries,
  type Horizon,
  type RiskBoundaries,
  type RiskBoundaryConfig,
} from "./types.js";

/**
 * Deterministic percentile of a numeric sample.
 *
 * METHOD (documented, fixed): **linear interpolation between closest ranks**,
 * a.k.a. the C = 1 variant / `numpy.percentile` default / Excel `PERCENTILE.INC`.
 * The property test in task 10.8 asserts exactly this method.
 *
 * Given a sample sorted ascending as `x[0..n-1]` and a percentile `p` in
 * `[0, 100]`, the rank is:
 *
 *   rank = (p / 100) * (n - 1)          // a 0-based, fractional index
 *   lo   = floor(rank), hi = ceil(rank)
 *   frac = rank - lo
 *   result = x[lo] + frac * (x[hi] - x[lo])
 *
 * Edge behavior:
 *   - `p = 0`   → the sample minimum.
 *   - `p = 100` → the sample maximum.
 *   - `n = 1`   → that single value for any `p`.
 * `p` is clamped into `[0, 100]` so out-of-range configuration is total, not a
 * throw. The input array is copied before sorting so the caller's data is never
 * mutated (no hidden state).
 *
 * @throws RangeError if `values` is empty — callers must guard length first
 *         (the floor check in `derive` guarantees a non-empty sample).
 */
export function percentile(values: readonly number[], p: number): number {
  const n = values.length;
  if (n === 0) {
    throw new RangeError("percentile requires a non-empty sample");
  }

  const clampedP = p < 0 ? 0 : p > 100 ? 100 : p;
  const sorted = [...values].sort((a, b) => a - b);

  if (n === 1) return sorted[0]!;

  const rank = (clampedP / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;

  const lower = sorted[lo]!;
  const upper = sorted[hi]!;
  return lower + frac * (upper - lower);
}

/**
 * Extract the MAE (adverse) excursions of the analogues at a given horizon.
 */
function maeAt(
  neighborhood: readonly AnalogueRecord[],
  horizon: Horizon,
): number[] {
  const out: number[] = [];
  for (const a of neighborhood) {
    if (a.horizon === horizon) out.push(a.maePips);
  }
  return out;
}

/**
 * Extract the MFE (favorable) excursions of the analogues at a given horizon.
 */
function mfeAt(
  neighborhood: readonly AnalogueRecord[],
  horizon: Horizon,
): number[] {
  const out: number[] = [];
  for (const a of neighborhood) {
    if (a.horizon === horizon) out.push(a.mfePips);
  }
  return out;
}

/**
 * Derive Empirical_Risk_Boundaries from a firing neighborhood at a horizon.
 * See {@link EmpiricalRiskBoundaries.derive}. (Requirement 21)
 */
export function derive(
  neighborhood: readonly AnalogueRecord[],
  horizon: Horizon,
  config?: RiskBoundaryConfig,
): RiskBoundaries | null {
  const mae = maeAt(neighborhood, horizon);
  const mfe = mfeAt(neighborhood, horizon);

  // Below the 30-analogue floor at the selected horizon: not actionable.
  // (Requirement 21.5). MAE and MFE come from the same rows, so their counts
  // are identical; guarding on either is equivalent.
  if (mae.length < RISK_BOUNDARY_FLOOR) return null;

  const stopLossPercentile =
    config?.stopLossPercentile ?? DEFAULT_STOP_LOSS_PERCENTILE;
  const takeProfitPercentile =
    config?.takeProfitPercentile ?? DEFAULT_TAKE_PROFIT_PERCENTILE;

  return {
    stopLossPips: percentile(mae, stopLossPercentile),
    takeProfitPips: percentile(mfe, takeProfitPercentile),
  };
}

/**
 * Concrete EmpiricalRiskBoundaries binding the pure `derive` function above.
 */
export const empiricalRiskBoundaries: EmpiricalRiskBoundaries = {
  derive,
};
