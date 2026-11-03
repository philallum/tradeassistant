// Shared candle preparation for every strategy
// (Requirements 6.1, 6.2, 6.6, 6.7, 6.8, 6.9; Design "2. Shared candle
// preparation: src/strategies/candles.ts").
//
// A single pure helper every strategy runs before it computes anything, so
// look-ahead safety, emptiness, and OHLC finiteness are enforced identically
// across all producers. The check order is fixed so a look-ahead violation
// always wins over any other defect (Requirement 6.9).

import { compareTradingDates } from "../guard/tradingDate.js";
import { assertPastOnly } from "../guard/lookAheadGuard.js";
import { ok, err } from "../guard/types.js";
import type { Candle, Result, TradingDate } from "../guard/types.js";
import type { StrategyError } from "./types.js";

/** The four OHLC fields, checked in a fixed order (Requirement 6.7). */
const OHLC_FIELDS = ["open", "high", "low", "close"] as const;

/**
 * Validate and normalize a candle array for strategy evaluation.
 *
 * Checks run in a fixed order and the FIRST failure is returned, so a
 * look-ahead violation always wins over any other defect (Requirement 6.9):
 *
 *   1. {@link assertPastOnly} — any candle dated at or after `decisionDate` is
 *      a look-ahead violation and is returned as-is. `assertPastOnly` only
 *      reads each candle's `date`, so it never chokes on a non-finite OHLC
 *      value; the look-ahead violation therefore wins even when a candle also
 *      carries a bad field (Requirements 6.1, 6.2, 6.9).
 *   2. An empty array is `insufficient_data` (Requirement 6.8).
 *   3. Every candle's `open`/`high`/`low`/`close` must be a finite `number`.
 *      The first bad field and its candle date are returned as
 *      `invalid_candle` (Requirement 6.7).
 *
 * On success a stably date-sorted copy is returned. The caller's array and
 * candle objects are never mutated — `assertPastOnly` already returns a fresh
 * array and the sort runs on that copy (Requirement 6.6).
 */
export function prepareCandles(
  candles: readonly Candle[],
  decisionDate: TradingDate,
): Result<readonly Candle[], StrategyError> {
  // 1. Look-ahead safety runs first on the raw input so a violation wins over
  //    any other defect (Requirements 6.1, 6.2, 6.9). assertPastOnly returns a
  //    copy, which also keeps the caller's array unmutated.
  const pastOnly = assertPastOnly(candles, decisionDate);
  if (!pastOnly.ok) {
    return err(pastOnly.error);
  }
  const copy = pastOnly.value;

  // 2. Emptiness (Requirement 6.8).
  if (copy.length === 0) {
    return err({
      reason: "insufficient_data",
      message: "no candles provided for strategy evaluation",
    });
  }

  // 3. OHLC finiteness — first bad field, with the candle date (Requirement 6.7).
  for (const candle of copy) {
    for (const field of OHLC_FIELDS) {
      const value = candle[field];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return err({
          reason: "invalid_candle",
          field,
          date: candle.date,
          message: `candle ${candle.date} has a non-finite ${field} value`,
        });
      }
    }
  }

  // 4. Stable date-sorted copy. We sort the fresh array from assertPastOnly, so
  //    the caller's array and candle objects are left untouched (Requirement 6.6).
  const sorted = copy
    .map((candle, index) => ({ candle, index }))
    .sort((a, b) => {
      const byDate = compareTradingDates(a.candle.date, b.candle.date);
      return byDate !== 0 ? byDate : a.index - b.index;
    })
    .map((entry) => entry.candle);

  return ok(sorted);
}
