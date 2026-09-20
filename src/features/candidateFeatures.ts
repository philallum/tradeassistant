// Candidate Feature Computations (Requirements 13.5, 13.6, 13.8, 4.1).
//
// Pure, self-contained, deterministic computation of the candidate features the
// Feature Registry (Component 8) evaluates one at a time through the Kill_Gate:
//   - percentB              (Bollinger %B)
//   - rsi                   (Wilder-smoothed Relative Strength Index)
//   - volumeProxyRegime     (a price-range volume proxy expressed as a REGIME)
//   - weeklyTrendContext    (medium-term trend direction, scale-invariant)
//   - distanceToSma         (distance from close to its Simple Moving Average)
//   - structuralLiquidityDistance (nearest structural S/R level, Requirement 13.6)
//   - yieldSpread10y        (base-country 10Y minus quote-country 10Y, Requirement 13.8)
//
// Every function that consumes a candle window enforces the shared Look-Ahead
// Guard (only candles dated strictly before the Decision_Date contribute), and
// the yield spread applies the missing-yield fail-safe: the feature is treated
// as unavailable rather than fabricated, interpolated, or future-valued.

import { lookAheadGuard } from "../guard/lookAheadGuard.js";
import type { Candle, TradingDate } from "../guard/types.js";
import { compareTradingDates } from "../guard/tradingDate.js";
import type { Pair } from "../ingestion/types.js";
import { PAIR_YIELD_COUNTRIES } from "../yields/types.js";
import type { CountryCode } from "../yields/types.js";
import type {
  StructuralLevels,
  VolumeRegime,
  WeeklyTrendContext,
  YieldObservation,
} from "./types.js";

/**
 * Guard the input window and return the surviving candles sorted chronologically
 * ascending. Rejections are fail-loud (Requirement 4.4): a candle dated at or
 * after the Decision_Date is a pipeline error, not a value to silently drop.
 */
function guardedSortedWindow(
  window: readonly Candle[],
  decisionDate: TradingDate,
): Candle[] {
  const guardResult = lookAheadGuard.assertPastOnly(window, decisionDate);
  if (!guardResult.ok) {
    throw new Error(guardResult.error.message);
  }
  return [...guardResult.value].sort((a, b) =>
    compareTradingDates(a.date, b.date),
  );
}

/** Simple arithmetic mean of a numeric series. Returns 0 for an empty series. */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/** Population standard deviation of a numeric series. Returns 0 for <2 samples. */
function populationStdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mu = mean(values);
  const variance =
    values.reduce((acc, v) => acc + (v - mu) * (v - mu), 0) / values.length;
  return Math.sqrt(variance);
}

/** Standard SMA lookback and default indicator periods. */
export const SMA_LOOKBACK = 20 as const;
export const BOLLINGER_LOOKBACK = 20 as const;
export const BOLLINGER_STDDEV = 2 as const;
export const RSI_LOOKBACK = 14 as const;
export const VOLUME_PROXY_LOOKBACK = 20 as const;
export const WEEKLY_TREND_LOOKBACK = 5 as const;

/**
 * Bollinger %B = (Close - LowerBand) / (UpperBand - LowerBand), where the bands
 * are SMA ± k·σ over the lookback window. %B locates the close within the band
 * envelope (0 at the lower band, 1 at the upper band); it can fall outside
 * [0,1] when price pierces a band.
 *
 * Degenerate case: a zero-width band (flat window) yields 0.5 — the close sits
 * at the midline by definition — a defined, non-error result.
 *
 * @returns %B for the most recent guarded close, or null when the window has
 *          fewer than `lookback` candles.
 */
export function percentB(
  window: readonly Candle[],
  decisionDate: TradingDate,
  lookback: number = BOLLINGER_LOOKBACK,
  numStdDev: number = BOLLINGER_STDDEV,
): number | null {
  const sorted = guardedSortedWindow(window, decisionDate);
  if (sorted.length < lookback) return null;

  const closes = sorted.slice(-lookback).map((c) => c.close);
  const sma = mean(closes);
  const sigma = populationStdDev(closes);
  const upper = sma + numStdDev * sigma;
  const lower = sma - numStdDev * sigma;
  const bandWidth = upper - lower;

  const close = closes[closes.length - 1]!;
  if (bandWidth === 0) return 0.5;
  return (close - lower) / bandWidth;
}

/**
 * Wilder-smoothed Relative Strength Index over `lookback` (default 14) trading
 * days: RSI = 100 - 100/(1 + RS) with RS = avgGain / avgLoss.
 *
 * Uses the standard Wilder recursive smoothing: the first average is the simple
 * mean of the first `lookback` gains/losses, then each subsequent average is
 * `(prev*(lookback-1) + current) / lookback`.
 *
 * Degenerate cases: when there are no losses in the smoothed window RSI is 100;
 * when there are no gains RSI is 0; a perfectly flat series yields 50.
 *
 * @returns RSI in [0,100] for the most recent guarded close, or null when the
 *          window has fewer than `lookback + 1` candles.
 */
export function rsi(
  window: readonly Candle[],
  decisionDate: TradingDate,
  lookback: number = RSI_LOOKBACK,
): number | null {
  const sorted = guardedSortedWindow(window, decisionDate);
  if (sorted.length < lookback + 1) return null;

  const closes = sorted.map((c) => c.close);
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i]! - closes[i - 1]!);
  }

  const gains = deltas.map((d) => (d > 0 ? d : 0));
  const losses = deltas.map((d) => (d < 0 ? -d : 0));

  // Seed with the simple mean over the first `lookback` deltas.
  let avgGain = mean(gains.slice(0, lookback));
  let avgLoss = mean(losses.slice(0, lookback));

  // Wilder recursive smoothing over the remaining deltas.
  for (let i = lookback; i < deltas.length; i++) {
    avgGain = (avgGain * (lookback - 1) + gains[i]!) / lookback;
    avgLoss = (avgLoss * (lookback - 1) + losses[i]!) / lookback;
  }

  if (avgLoss === 0) {
    // No downward pressure in the window.
    return avgGain === 0 ? 50 : 100;
  }
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Volume-proxy REGIME (Requirement 13.5: "a volume proxy used as regime rather
 * than magnitude"). FX daily candles carry no true volume, so the proxy is the
 * candle's high-low range — a well-established activity surrogate. The most
 * recent range is classified against the median range of the lookback window
 * into a discrete regime, deliberately discarding the raw magnitude:
 *   - HIGH   when range >= 1.5x the window median
 *   - LOW    when range <= 0.5x the window median
 *   - NORMAL otherwise
 *
 * This is scale-invariant: multiplying every price by a positive scalar scales
 * both the range and the median by the same factor, leaving the ratio — and
 * therefore the regime — unchanged.
 *
 * @returns the regime for the most recent guarded candle, or null when the
 *          window has fewer than `lookback` candles.
 */
export function volumeProxyRegime(
  window: readonly Candle[],
  decisionDate: TradingDate,
  lookback: number = VOLUME_PROXY_LOOKBACK,
): VolumeRegime | null {
  const sorted = guardedSortedWindow(window, decisionDate);
  if (sorted.length < lookback) return null;

  const recent = sorted.slice(-lookback);
  const ranges = recent.map((c) => c.high - c.low);
  const currentRange = ranges[ranges.length - 1]!;

  const median = medianOf(ranges);
  if (median === 0) return "NORMAL";

  const ratio = currentRange / median;
  if (ratio >= 1.5) return "HIGH";
  if (ratio <= 0.5) return "LOW";
  return "NORMAL";
}

/** Median of a numeric series (pure; does not mutate the input). */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Weekly-trend context: the sign of the 5-trading-day rolling rate of change of
 * the close (UP when Close_T - Close_{T-lookback} >= 0, else DOWN). This mirrors
 * the encoder's Weekly_Trend_Sign definition and is scale-invariant: the
 * classification depends only on the relative move, not on the absolute price
 * level, so multiplying all prices by a positive scalar leaves it unchanged.
 *
 * @returns the trend context for the most recent guarded close, or null when
 *          the window is empty.
 */
export function weeklyTrendContext(
  window: readonly Candle[],
  decisionDate: TradingDate,
  lookback: number = WEEKLY_TREND_LOOKBACK,
): WeeklyTrendContext | null {
  const sorted = guardedSortedWindow(window, decisionDate);
  const n = sorted.length;
  if (n === 0) return null;

  const currentClose = sorted[n - 1]!.close;
  const lookbackIndex = Math.max(0, n - 1 - lookback);
  const lookbackClose = sorted[lookbackIndex]!.close;

  // Scale-invariant tie-break mirroring the encoder: a difference negligible
  // relative to the price scale is treated as a tie resolved to UP (preserving
  // ">= 0 => UP"), so floating-point noise cannot flip the classification.
  const diff = currentClose - lookbackClose;
  const scale = Math.max(
    Math.abs(currentClose),
    Math.abs(lookbackClose),
    1e-12,
  );
  return diff < 0 && Math.abs(diff) / scale >= 1e-9 ? "DOWN" : "UP";
}

/**
 * Distance from the most recent close to its `lookback`-day Simple Moving
 * Average, expressed as a signed fraction of the SMA:
 *   (Close - SMA) / SMA.
 *
 * Expressing the distance relative to the SMA keeps the feature scale-invariant
 * across pairs and price levels. Positive means the close is above its SMA.
 *
 * Degenerate case: an SMA of exactly 0 yields 0 (a defined, non-error result).
 *
 * @returns the relative distance for the most recent guarded close, or null
 *          when the window has fewer than `lookback` candles.
 */
export function distanceToSma(
  window: readonly Candle[],
  decisionDate: TradingDate,
  lookback: number = SMA_LOOKBACK,
): number | null {
  const sorted = guardedSortedWindow(window, decisionDate);
  if (sorted.length < lookback) return null;

  const closes = sorted.slice(-lookback).map((c) => c.close);
  const sma = mean(closes);
  const close = closes[closes.length - 1]!;
  if (sma === 0) return 0;
  return (close - sma) / sma;
}

/**
 * Structural_Liquidity_SR (Requirement 13.6): the minimum absolute distance from
 * a reference price to the nearest of Previous Day High/Low, Previous Week
 * High/Low, and 20-Day High/Low.
 *
 * This overload accepts a pre-computed set of structural levels so the feature
 * is a pure function of `(price, levels)` (matching Property 27's shape). Use
 * `structuralLevelsFromWindow` to derive the levels look-ahead-safely from a
 * candle window.
 */
export function structuralLiquidityDistanceFromLevels(
  price: number,
  levels: StructuralLevels,
): number {
  const references = [
    levels.prevDayHigh,
    levels.prevDayLow,
    levels.prevWeekHigh,
    levels.prevWeekLow,
    levels.high20d,
    levels.low20d,
  ];
  let nearest = Number.POSITIVE_INFINITY;
  for (const level of references) {
    const distance = Math.abs(price - level);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

/**
 * Derive the six structural reference levels from a look-ahead-guarded candle
 * window as of a Decision_Date. All levels are computed only from candles dated
 * strictly before the Decision_Date (Requirement 4.1):
 *   - Previous Day High/Low : the single most recent guarded candle.
 *   - Previous Week High/Low: the most recent 5 guarded candles.
 *   - 20-Day High/Low       : the most recent 20 guarded candles.
 *
 * @returns the structural levels, or null when the window is empty.
 */
export function structuralLevelsFromWindow(
  window: readonly Candle[],
  decisionDate: TradingDate,
): StructuralLevels | null {
  const sorted = guardedSortedWindow(window, decisionDate);
  const n = sorted.length;
  if (n === 0) return null;

  const prevDay = sorted[n - 1]!;
  const prevWeek = sorted.slice(Math.max(0, n - 5));
  const last20 = sorted.slice(Math.max(0, n - 20));

  return {
    prevDayHigh: prevDay.high,
    prevDayLow: prevDay.low,
    prevWeekHigh: Math.max(...prevWeek.map((c) => c.high)),
    prevWeekLow: Math.min(...prevWeek.map((c) => c.low)),
    high20d: Math.max(...last20.map((c) => c.high)),
    low20d: Math.min(...last20.map((c) => c.low)),
  };
}

/**
 * Structural_Liquidity_SR distance computed directly from a candle window
 * (Requirements 13.6, 4.1). Derives the structural levels look-ahead-safely,
 * then returns the minimum absolute distance from the reference price (default:
 * the most recent guarded close) to the nearest level.
 *
 * @returns the nearest-level distance, or null when the window is empty.
 */
export function structuralLiquidityDistance(
  window: readonly Candle[],
  decisionDate: TradingDate,
  referencePrice?: number,
): number | null {
  const levels = structuralLevelsFromWindow(window, decisionDate);
  if (levels === null) return null;

  const sorted = guardedSortedWindow(window, decisionDate);
  const price = referencePrice ?? sorted[sorted.length - 1]!.close;
  return structuralLiquidityDistanceFromLevels(price, levels);
}

/**
 * Yield_Spread (Requirements 13.8, 4.1): the base-country 10Y yield minus the
 * quote-country 10Y yield for a Pair on a Decision_Date, using only yield rows
 * dated strictly before the Decision_Date.
 *
 * This is a pure computation over a supplied set of yield observations (so the
 * feature needs no storage dependency; the registry can feed it look-ahead-safe
 * rows loaded from the `yields` table). It applies the missing-yield fail-safe:
 * if either the base- or quote-country 10Y is unavailable for a strictly-earlier
 * date, the feature is UNAVAILABLE (null) — never fabricated, interpolated, or
 * sourced from a future value.
 *
 * @returns the spread (base 10Y - quote 10Y), or null when the feature is
 *          unavailable for the given date.
 */
export function yieldSpread10y(
  pair: Pair,
  decisionDate: TradingDate,
  observations: readonly YieldObservation[],
): number | null {
  const pairConfig = PAIR_YIELD_COUNTRIES[pair];
  if (!pairConfig) return null;

  const { baseCountry, quoteCountry } = pairConfig;

  const base = latestYieldStrictlyBefore(observations, baseCountry, decisionDate);
  const quote = latestYieldStrictlyBefore(
    observations,
    quoteCountry,
    decisionDate,
  );

  // Missing-yield fail-safe: the feature is unavailable, never fabricated.
  if (base === null || quote === null) return null;

  return base - quote;
}

/**
 * Return the most recent 10Y yield for `country` dated strictly before
 * `decisionDate` (look-ahead safe), or null when none exists. Never
 * interpolates and never uses a value dated on or after the Decision_Date.
 */
function latestYieldStrictlyBefore(
  observations: readonly YieldObservation[],
  country: CountryCode,
  decisionDate: TradingDate,
): number | null {
  let best: YieldObservation | null = null;
  for (const obs of observations) {
    if (obs.country !== country) continue;
    if (compareTradingDates(obs.date, decisionDate) >= 0) continue;
    if (best === null || compareTradingDates(obs.date, best.date) > 0) {
      best = obs;
    }
  }
  return best === null ? null : best.yield10y;
}
