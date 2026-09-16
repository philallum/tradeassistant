// Look-Ahead Safety Guard (Requirements 4.1, 4.2, 4.3, 4.4, 7.5, 9.3, 9.5).
//
// The single source of truth for date-boundary safety across ingestion,
// feature computation, retrieval, and forward-outcome evaluation.
//
// All methods are pure deterministic functions with no hidden mutable state
// (Requirement 3.2). Rejections are surfaced as typed LookAheadViolation
// results (fail-loud), never silent drops (Requirement 4.4).

import { addTradingDays, compareTradingDates } from "./tradingDate.js";
import { err, ok } from "./types.js";
import type {
  Analogue,
  Candle,
  LookAheadGuard,
  LookAheadViolation,
  Result,
  TradingDate,
} from "./types.js";

/**
 * Rejects any candle dated at or after a Decision_Date for feature/retrieval use.
 * (Requirements 4.1, 4.4)
 *
 * Treated as a programming error in the pipeline (fail-loud) rather than
 * a condition to silently swallow.
 */
export function assertPastOnly(
  candles: readonly Candle[],
  decisionDate: TradingDate,
): Result<Candle[], LookAheadViolation> {
  const violatingCandles: Candle[] = [];

  for (const candle of candles) {
    if (compareTradingDates(candle.date, decisionDate) >= 0) {
      violatingCandles.push(candle);
    }
  }

  if (violatingCandles.length > 0) {
    return err({
      reason: "look_ahead_violation",
      decisionDate,
      violatingCandles,
      message: `Look-ahead violation: ${violatingCandles.length} candle(s) dated on or after decision date ${decisionDate} (first violating date: ${violatingCandles[0]?.date ?? "unknown"})`,
    });
  }

  return ok([...candles]);
}

/**
 * Returns true if and only if the full horizon window (1, 2, or 3 trading days)
 * starting after outcomeStart has closed as of evalDate.
 * (Requirement 4.2)
 *
 * For example, for an outcome on Monday with a 1-day horizon, day 1 is Tuesday.
 * The outcome closes at Tuesday's NY close and is matured as of Wednesday
 * (evalDate = Wednesday).
 */
export function isMatured(
  outcomeStart: TradingDate,
  horizonDays: 1 | 2 | 3,
  evalDate: TradingDate,
): boolean {
  if (compareTradingDates(evalDate, outcomeStart) <= 0) {
    return false;
  }
  const targetCloseDate = addTradingDays(outcomeStart, horizonDays);
  return compareTradingDates(targetCloseDate, evalDate) < 0;
}

/**
 * Filters an analogue set to matured, strictly-pre-date entries.
 * (Requirements 9.3, 9.5)
 *
 * An analogue is admitted if and only if:
 * 1. Its decision date is strictly before decisionDate (analogueDate < decisionDate).
 * 2. Its outcome window is fully matured as of evalDate (isMatured(analogueDate, horizon, evalDate)).
 */
export function maturedPreDateOnly<T extends Analogue>(
  analogues: readonly T[],
  decisionDate: TradingDate,
  evalDate: TradingDate,
): T[] {
  return analogues.filter((analogue) => {
    const analogueDate = analogue.decisionDate ?? analogue.date;
    if (!analogueDate) {
      return false;
    }
    // Must be strictly before the decision date
    if (compareTradingDates(analogueDate, decisionDate) >= 0) {
      return false;
    }
    // Must be matured as of evalDate
    const horizon = analogue.horizon ?? 1;
    return isMatured(analogueDate, horizon, evalDate);
  });
}

/**
 * The default singleton Look-Ahead Guard instance.
 */
export const lookAheadGuard: LookAheadGuard = {
  assertPastOnly,
  isMatured,
  maturedPreDateOnly,
};
