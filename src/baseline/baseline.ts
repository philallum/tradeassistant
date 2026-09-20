// Weekly-Trend-Follow Baseline (Requirement 11.1, Design Component 6).
//
// The null-hypothesis predictor whose predicted direction equals the
// Weekly_Trend_Sign at the Decision_Date. It reuses the encoder's
// `weeklyTrendSign` so the baseline and the retrieval pre-filter metadata
// stay definitionally identical: UP if Close_T - Close_{T-5} >= 0, else DOWN.
//
// Pure, deterministic, no hidden mutable state (Requirement 3.2). The
// Look-Ahead Guard is enforced (inside `weeklyTrendSign`) on the input window
// so no candle dated at or after the Decision_Date can influence the result.

import { weeklyTrendSign } from "../encoder/patternEncoder.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { Baseline } from "./types.js";

/**
 * Predicts the baseline direction for `decisionDate` given the past candle
 * `window`. Delegates to the encoder's `weeklyTrendSign` (the single source of
 * truth for the 5-trading-day rolling ROC definition) so that the baseline is
 * guaranteed to equal the Weekly_Trend_Sign. (Requirement 11.1)
 *
 * The returned value is always "UP" or "DOWN" — the baseline never emits FLAT
 * and never derives a calendar-week trend.
 *
 * @throws Error if any candle in `window` is dated at or after `decisionDate`
 *   (look-ahead violation, surfaced fail-loud by the guard).
 */
export function predictBaseline(
  window: readonly Candle[],
  decisionDate: TradingDate,
): DirectionClass {
  // WeeklyTrendSign ("UP" | "DOWN") is a subset of DirectionClass ("UP" | "DOWN" | "FLAT").
  return weeklyTrendSign(window, decisionDate);
}

/** Default singleton Weekly-Trend-Follow Baseline. */
export const baseline: Baseline = {
  predict: predictBaseline,
};
