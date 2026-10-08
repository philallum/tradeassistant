// Candle_Gap detection + bounded-lookback helper — Design Component 5
// (Requirements 3.1, 3.2, 4.4).
//
// A small pure module (separate from the stage for testability): classify the
// gap between a pair's last stored candle and the most recent
// Completed_Trading_Day, and compute a backfill range start bounded by a
// configured maximum lookback so an ancient (or null) `latestDate` can never
// trigger an unbounded request.

import { addTradingDays, compareTradingDates } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";

/** Env var carrying the Gap_Backfill lookback bound (non-secret). */
export const MAX_LOOKBACK_ENV = "CANDLE_FRESHNESS_MAX_LOOKBACK_DAYS" as const;

/** Default Gap_Backfill lookback (~18 weeks of trading days). */
export const DEFAULT_MAX_LOOKBACK_TRADING_DAYS = 90 as const;

/**
 * The gap classification for a pair, driving the stage's fetch decision:
 *   - `up_to_date`: last stored candle is already the target — no fetch needed.
 *   - `top_up`: exactly one trading day behind — a Daily_Top_Up.
 *   - `backfill`: more than one trading day behind (or no history) — a
 *     bounded Gap_Backfill.
 */
export type GapClass = "up_to_date" | "top_up" | "backfill";

/**
 * Read the Gap_Backfill maximum lookback from the environment
 * (`CANDLE_FRESHNESS_MAX_LOOKBACK_DAYS`, non-secret), defaulting to
 * {@link DEFAULT_MAX_LOOKBACK_TRADING_DAYS}. A missing, non-numeric, NaN, or
 * non-positive value falls back to the default so the bound is always a
 * positive integer.
 */
export function resolveMaxLookback(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env[MAX_LOOKBACK_ENV]?.trim();
  if (raw === undefined || raw === "") {
    return DEFAULT_MAX_LOOKBACK_TRADING_DAYS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_LOOKBACK_TRADING_DAYS;
  }
  return Math.floor(parsed);
}

/**
 * Classify the Candle_Gap between the last stored candle date and the target
 * (most recent Completed_Trading_Day).
 *
 *   - `latestDate === null` (no history for the pair) ⇒ `backfill`.
 *   - `latestDate >= target` ⇒ `up_to_date` (already fresh; nothing to fetch).
 *   - the trading day immediately after `latestDate` equals `target`
 *     (exactly one trading day behind) ⇒ `top_up`.
 *   - otherwise (more than one trading day behind) ⇒ `backfill`.
 */
export function classifyGap(
  latestDate: TradingDate | null,
  target: TradingDate,
): GapClass {
  if (latestDate === null) {
    return "backfill";
  }
  if (compareTradingDates(latestDate, target) >= 0) {
    return "up_to_date";
  }
  const nextAfterLatest = addTradingDays(latestDate, 1);
  if (compareTradingDates(nextAfterLatest, target) >= 0) {
    return "top_up";
  }
  return "backfill";
}

/**
 * Compute the bounded Gap_Backfill range start.
 *
 * When `latestDate` is present the range starts at the trading day after it,
 * but never earlier than `maxLookbackTradingDays` before the target:
 *   `from = max(addTradingDays(latestDate, +1), addTradingDays(target, -maxLookback))`.
 *
 * When `latestDate` is `null` (a pair with no history) the window is simply the
 * last `maxLookbackTradingDays` trading days ending at `target`, i.e.
 *   `from = addTradingDays(target, -(maxLookback - 1))`.
 *
 * The `max` is taken with `compareTradingDates` so the bound always wins against
 * an ancient `latestDate` (Requirement 3.2).
 */
export function backfillRangeStart(
  latestDate: TradingDate | null,
  target: TradingDate,
  maxLookbackTradingDays: number,
): TradingDate {
  const bound = Math.max(1, Math.floor(maxLookbackTradingDays));

  if (latestDate === null) {
    // The last `bound` trading days ending at (and including) `target`.
    return addTradingDays(target, -(bound - 1));
  }

  const afterLatest = addTradingDays(latestDate, 1);
  const boundedStart = addTradingDays(target, -bound);
  return compareTradingDates(afterLatest, boundedStart) >= 0
    ? afterLatest
    : boundedStart;
}
