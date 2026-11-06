// Deterministic 4H candle shape features — Task 3 (intraday-validation feature).
//
// Pure, pip-agnostic computation of the smallest useful candle feature set from
// a (possibly still-forming) 4H candle's OHLC. Every feature is a ratio or a
// signed price delta — NOT a pip count — so EURUSD and USDJPY are described by
// identical numbers and the downstream classification uses identical rules.
//
// DETERMINISTIC CORE: no clock, randomness, network, or storage; a pure function
// of its OHLC input. Degenerate inputs are handled explicitly and safely:
//   - a zero range (high === low) yields `bodyToRange = 0` and a neutral
//     `pricePositionInRange = 0.5` (no division by zero);
//   - a non-finite OHLC value is reported via {@link isCandleComputable} so the
//     caller can degrade that pair to "validation unavailable" rather than
//     classify garbage.

import type { DirectionClass } from "../retrieval/types.js";
import type { CandleFeatures, IntradayCandle } from "./types.js";

/**
 * True iff every OHLC field is finite and the candle satisfies the basic OHLC
 * invariant (`high ≥ low`, and `open`/`currentPrice` within `[low, high]`). A
 * candle that fails this is NOT computable — the caller marks the pair
 * "validation unavailable" instead of fabricating features.
 */
export function isCandleComputable(candle: IntradayCandle): boolean {
  const { open, high, low, currentPrice } = candle;
  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(currentPrice)
  ) {
    return false;
  }
  if (high < low) return false;
  if (open < low || open > high) return false;
  if (currentPrice < low || currentPrice > high) return false;
  return true;
}

/**
 * Compute the deterministic shape features of a 4H candle.
 *
 * Preconditions: `candle` must satisfy {@link isCandleComputable}. The caller is
 * responsible for that check (so the "unavailable" path stays explicit); if a
 * degenerate `range === 0` candle slips through, the ratios degrade safely
 * (`bodyToRange = 0`, `pricePositionInRange = 0.5`) rather than producing NaN.
 */
export function computeCandleFeatures(candle: IntradayCandle): CandleFeatures {
  const { open, high, low, currentPrice } = candle;

  const range = high - low;
  const body = currentPrice - open;
  const bodyDirection: DirectionClass = body > 0 ? "UP" : body < 0 ? "DOWN" : "FLAT";

  // Pip-agnostic ratios; a zero range degrades to neutral rather than NaN.
  const bodyToRange = range === 0 ? 0 : Math.abs(body) / range;
  const pricePositionInRange = range === 0 ? 0.5 : (currentPrice - low) / range;

  const upperWick = high - Math.max(open, currentPrice);
  const lowerWick = Math.min(open, currentPrice) - low;

  return {
    range,
    body,
    bodyDirection,
    bodyToRange,
    upperWick,
    lowerWick,
    pricePositionInRange,
  };
}
