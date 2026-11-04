// Realized candle size — the "what actually happened" side of the range forecast.
//
// Mirrors the analogue resolver's conventions exactly so a forecast and its
// outcome are measured the same way: the forward window is the first `horizon`
// candles dated STRICTLY AFTER the decision date, the entry price is the open of
// the first forward candle, and the span is the high-low envelope relative to
// that entry (highest high above entry + lowest low below entry, each floored at
// zero). The realized ratio divides by the SAME ATR the forecast was scaled with,
// and is bucketed with the SAME as-of-decision cut-offs, so scoring never uses
// information the forecast did not have except the realized candles themselves.
//
// Look-ahead safety: a realized outcome exists only once the whole horizon window
// has closed (`isMatured`); until then `realizedBucket` returns null.

import { isMatured } from "../guard/lookAheadGuard.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import { toPips } from "../trade-sim/pip.js";
import { bucketOf } from "./expectedRange.js";
import type { ExpectedRange, RangeBucket, RangeHorizon } from "./types.js";

/**
 * The realized span in pips over the first `horizon` candles strictly after
 * `decisionDate`, or null when fewer than `horizon` forward candles exist.
 */
export function realizedSpanPips(
  candles: readonly Candle[],
  decisionDate: TradingDate,
  horizon: RangeHorizon,
  pair: Pair,
): number | null {
  const forward = candles
    .filter((c) => c.date > decisionDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, horizon);
  if (forward.length < horizon) return null;

  const entry = forward[0]!.open;
  let highest = entry;
  let lowest = entry;
  for (const c of forward) {
    if (c.high > highest) highest = c.high;
    if (c.low < lowest) lowest = c.low;
  }
  return toPips(highest - entry, pair) + toPips(entry - lowest, pair);
}

/**
 * The realized bucket of a matured forecast, or null while the horizon window is
 * still open (as of `evalDate`) or the forward candles are not yet available.
 */
export function realizedBucket(
  forecast: ExpectedRange,
  candles: readonly Candle[],
  decisionDate: TradingDate,
  pair: Pair,
  evalDate: TradingDate,
): RangeBucket | null {
  if (!isMatured(decisionDate, forecast.horizon, evalDate)) return null;
  const span = realizedSpanPips(candles, decisionDate, forecast.horizon, pair);
  if (span === null || !(forecast.atrPips > 0)) return null;
  return bucketOf(span / forecast.atrPips, forecast.cutoffs);
}
