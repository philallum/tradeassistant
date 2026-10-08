// Choppiness Metric (Efficiency Ratio) — DISPLAY-ONLY (Requirements 3.1, 3.2).
//
// A DETERMINISTIC-CORE measurement of how directional recent price action is.
// It is NO LONGER a suppressor: the former Choppiness_Guard that silenced an
// otherwise-firing setup has been removed (design Decision 1 / C2). The metric
// is retained and surfaced as a DISPLAYED FIELD on the per-pair observation so
// the operator can see it and decide — no software hides a setup on its basis.
//
// Metric (Requirement 3.2): the Kaufman Efficiency Ratio over a fixed trailing
// window `w`,
//
//     ER = |Close_T − Close_{T−w}| / Σ_{i} |Close_i − Close_{i−1}|
//
// yielding a value in [0,1] where ~1 is a clean, efficient trend and ~0 is pure
// chop. This is DISTINCT from raw volatility magnitude (ATR_14 / FLAT_Dead_Band):
// a pair can have wide ATR yet near-zero efficiency (loud but directionless).
//
// Look-ahead safety: the metric is computed ONLY from candles dated strictly
// before the Decision_Date, via the shared Look-Ahead Guard. No future
// information can leak into it, and identical inputs yield identical values.
//
// Boundary discipline: the metric NEVER generates a Direction_Class or signal,
// and it is NOT an input to the directional probability, Earned_Confidence,
// Direction_Class classification, retrieval, or the measurement engine. It is a
// pure, deterministic read of past closes, exposed outward for display only.

import { assertPastOnly } from "../guard/lookAheadGuard.js";
import type { Candle, TradingDate } from "../guard/types.js";
import { DEFAULT_CHOPPINESS_WINDOW } from "./types.js";

/**
 * Compute the Kaufman Efficiency Ratio over the most recent `window` steps of a
 * chronologically-ascending close series.
 *
 *     ER = |Close_T − Close_{T−w}| / Σ |Close_i − Close_{i−1}|
 *
 * The numerator is the NET move across the window; the denominator is the TOTAL
 * path length (sum of absolute per-step moves). A straight-line move gives
 * ER = 1; a path that returns to where it started gives ER = 0.
 *
 * Degenerate cases resolve to a defined, non-error value (consistent with the
 * degenerate-window handling elsewhere in the deterministic core, e.g. ATR_14):
 *   - fewer than 2 closes ⇒ 0 (no measurable movement, treated as fully choppy);
 *   - a flat series (total path length 0) ⇒ 0 (no movement to be efficient).
 *
 * Pure and deterministic: identical inputs yield identical outputs
 * (Requirement 3.1).
 *
 * @param closes A chronologically-ascending series of close prices.
 * @param window The trailing window `w` in steps (number of price changes
 *               considered). Values <= 0 disable the metric (returns 0).
 */
export function efficiencyRatioFromCloses(
  closes: readonly number[],
  window: number,
): number {
  const w = Math.trunc(window);
  if (w <= 0 || closes.length < 2) return 0;

  // Take the most recent `w + 1` closes so there are exactly `w` per-step moves
  // in the window (or fewer, if the series is shorter than the window).
  const series = closes.slice(-(w + 1));
  if (series.length < 2) return 0;

  const first = series[0] as number;
  const last = series[series.length - 1] as number;
  const netMove = Math.abs(last - first);

  let pathLength = 0;
  for (let i = 1; i < series.length; i += 1) {
    pathLength += Math.abs((series[i] as number) - (series[i - 1] as number));
  }

  if (pathLength === 0) return 0;
  return netMove / pathLength;
}

/**
 * Compute the look-ahead-safe Efficiency-Ratio Choppiness_Metric for a pair over
 * a trailing window (Requirements 3.1, 3.2).
 *
 * The candles are first passed through the shared Look-Ahead Guard: any candle
 * dated on or after the Decision_Date is a look-ahead violation and is dropped
 * from the computation. Only candles strictly before the Decision_Date are used,
 * so no future information can leak into the displayed metric.
 *
 * @param candles      Daily candles for the pair (any order; sorted internally).
 * @param decisionDate The Decision_Date; only pre-date candles are used.
 * @param window       The trailing window `w` in trading days (defaults to the
 *                     standard Choppiness_Metric window).
 * @returns The Efficiency Ratio in [0,1] (~1 clean trend, ~0 chop).
 */
export function efficiencyRatio(
  candles: readonly Candle[],
  decisionDate: TradingDate,
  window: number = DEFAULT_CHOPPINESS_WINDOW,
): number {
  // Look-ahead guard: keep only candles strictly before the Decision_Date.
  const guarded = assertPastOnly(candles, decisionDate);
  const pastCandles = guarded.ok
    ? guarded.value
    : candles.filter((c) => c.date < decisionDate);

  const closes = [...pastCandles]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((c) => c.close);

  return efficiencyRatioFromCloses(closes, window);
}
