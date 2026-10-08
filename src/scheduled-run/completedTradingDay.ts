// Most-recent Completed_Trading_Day computation — Design Component 3
// (Requirements 2.2, 3.1).
//
// The daily candle is defined on the 17:00 America/New_York (NY close) session
// boundary, and the Look_Ahead rule requires candles strictly BEFORE the
// Decision_Date. The most recent Completed_Trading_Day is therefore the latest
// weekday strictly before `decisionDate`, computed by `addTradingDays(..., -1)`
// (which skips weekends via `isTradingDay`). This reuses the existing
// trading-date helpers and re-implements NO calendar math.
//
// WEEKENDS are handled by `isTradingDay` / `addTradingDays` (Sat/Sun are never
// Completed_Trading_Days). HOLIDAYS are a documented limitation: the project has
// no holiday calendar, so a market holiday is treated as a trading day for gap
// purposes. The consequence is bounded and benign — a provider simply returns no
// candle for a holiday, the stage logs a residual gap, and proceeds. Introducing
// a holiday calendar is explicitly out of scope.

import { addTradingDays } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";

/**
 * The most recent Completed_Trading_Day for a Decision_Date: the latest weekday
 * strictly before `decisionDate`. `addTradingDays(decisionDate, -1)` steps back
 * one trading day, skipping weekends, so the result is always a weekday and
 * always strictly earlier than `decisionDate`.
 */
export function mostRecentCompletedTradingDay(
  decisionDate: TradingDate,
): TradingDate {
  return addTradingDays(decisionDate, -1);
}
