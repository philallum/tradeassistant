// ATR_14 — 14-trading-day Average True Range. (Requirements 10.4, 23 glossary)
//
// Deterministic, pure. Used to scale the FLAT_Dead_Band (Component 5). ATR is
// the standard volatility scalar; ATR_14 uses a 14-trading-day lookback.

import type { Candle } from "../guard/types.js";

/** The standard ATR lookback in trading days. */
export const ATR_LOOKBACK = 14 as const;

/**
 * True Range for a candle relative to the previous candle's close.
 *
 * TR = max( high - low, |high - prevClose|, |low - prevClose| ).
 *
 * When there is no previous close (first candle), TR reduces to `high - low`.
 */
export function trueRange(candle: Candle, prevClose: number | undefined): number {
  const highLow = candle.high - candle.low;
  if (prevClose === undefined) return highLow;
  return Math.max(
    highLow,
    Math.abs(candle.high - prevClose),
    Math.abs(candle.low - prevClose),
  );
}

/**
 * Compute ATR_14 = the simple mean of the True Range over the most recent
 * `lookback` (default 14) trading days.
 *
 * Candles must be sorted chronologically ascending. The True Range of each
 * candle uses the immediately preceding candle's close, so the first candle in
 * the supplied window contributes `high - low`.
 *
 * Returns 0 for an empty input (a defined, non-error result), consistent with
 * the degenerate-window handling elsewhere in the deterministic core.
 *
 * This is pure and deterministic: identical inputs yield identical outputs.
 * (Requirement 3.1)
 *
 * @param candles  Chronologically-ascending daily candles.
 * @param lookback The ATR lookback in trading days (default 14).
 */
export function computeAtr14(
  candles: readonly Candle[],
  lookback: number = ATR_LOOKBACK,
): number {
  if (candles.length === 0) return 0;

  // Compute the True Range series across all supplied candles.
  const trs: number[] = [];
  let prevClose: number | undefined = undefined;
  for (const candle of candles) {
    trs.push(trueRange(candle, prevClose));
    prevClose = candle.close;
  }

  // Average the most recent `lookback` True Range values.
  const window = trs.slice(-lookback);
  const sum = window.reduce((acc, tr) => acc + tr, 0);
  return sum / window.length;
}
