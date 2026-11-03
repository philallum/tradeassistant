// Indicators — pure numeric helpers for the classical strategies.
// (Requirements 2.1, 2.5, 3.5, 4.4, 5.1)
//
// These are PURE functions over `readonly number[]`: no clock, randomness,
// environment, network, or I/O. Identical inputs always yield identical
// outputs. ATR is NOT re-implemented here — strategies call `computeAtr14`
// from `src/confidence/atr.ts` on the full prepared candle array, and use
// `atrUsable` below as the usability predicate.

/**
 * Simple moving average: the arithmetic mean of the most recent `n` values.
 *
 * Callers are responsible for ensuring there are at least `n` values and that
 * `n >= 1`; the strategies guard history length before calling this.
 *
 * @param values Numeric series (chronologically ascending by convention).
 * @param n      Window length (number of trailing values to average).
 */
export function sma(values: readonly number[], n: number): number {
  const window = values.slice(-n);
  let sum = 0;
  for (const v of window) sum += v;
  return sum / window.length;
}

/**
 * Population standard deviation — the standard Bollinger definition, dividing
 * by N (not N - 1).
 *
 * Returns 0 for a single value (all values equal). Callers guard against empty
 * input via the history checks.
 *
 * @param values Numeric series.
 */
export function populationStdDev(values: readonly number[]): number {
  const n = values.length;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= n;

  let variance = 0;
  for (const v of values) {
    const d = v - mean;
    variance += d * d;
  }
  variance /= n;

  return Math.sqrt(variance);
}

/**
 * Exponential moving average series, aligned to the input index.
 *
 * The EMA is seeded with the SMA of the first `period` values, so the series
 * is only defined from index `period - 1` onward. Indices `0 .. period - 2`
 * are `undefined`. The smoothing factor is `alpha = 2 / (period + 1)`.
 *
 * The returned array has the same length as `values`; callers read the last
 * defined index (and a lagged index for slope) after guarding history length.
 *
 * @param values Numeric series (chronologically ascending).
 * @param period EMA period (assumed a positive integer by callers).
 */
export function emaSeries(
  values: readonly number[],
  period: number,
): (number | undefined)[] {
  const out: (number | undefined)[] = values.map(() => undefined);
  if (values.length < period) return out;

  const alpha = 2 / (period + 1);

  // Seed at index period - 1 with the SMA of the first `period` values.
  let prev = sma(values.slice(0, period), period);
  out[period - 1] = prev;

  for (let i = period; i < values.length; i++) {
    const current = alpha * (values[i] as number) + (1 - alpha) * prev;
    out[i] = current;
    prev = current;
  }

  return out;
}

/**
 * Relative Strength Index using Wilder's smoothing.
 *
 * The first `period` price changes seed the average gain and average loss with
 * their simple averages; subsequent changes are folded in with Wilder's
 * recursive smoothing:
 *   avg = (avg * (period - 1) + current) / period.
 *
 * Edge cases follow the design:
 *   - average loss is 0 (and average gain is not) -> 100,
 *   - average gain and average loss are both 0    -> 50.
 *
 * Callers guarantee `closes.length >= period + 1` via the history guard.
 *
 * @param closes Closing prices (chronologically ascending).
 * @param period RSI period (assumed a positive integer by callers).
 */
export function rsiWilder(closes: readonly number[], period: number): number {
  // Price changes: closes[i] - closes[i - 1].
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push((closes[i] as number) - (closes[i - 1] as number));
  }

  // Seed with the simple average of the first `period` changes.
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const change = changes[i] as number;
    if (change > 0) avgGain += change;
    else if (change < 0) avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing over the remaining changes.
  for (let i = period; i < changes.length; i++) {
    const change = changes[i] as number;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Round `x` to `dp` decimal places via `Number(x.toFixed(dp))`, with negative
 * zero normalised to `0`. Used only to format rationale text, never for
 * decision logic.
 *
 * @param x  Value to round.
 * @param dp Number of decimal places.
 */
export function roundTo(x: number, dp: number): number {
  const rounded = Number(x.toFixed(dp));
  // Normalise -0 to 0 (Object.is(-0, 0) is false; -0 + 0 === 0).
  return rounded === 0 ? 0 : rounded;
}

/**
 * Clamp `x` into the closed interval [0, 1]. `NaN` maps to `0`.
 *
 * @param x Value to clamp.
 */
export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * Whether an ATR value is usable for scaling strength: finite and strictly
 * positive. A zero or non-finite ATR means volatility cannot scale strength,
 * so strategies fall back to strength 0.
 *
 * @param atr An ATR value (typically from `computeAtr14`).
 */
export function atrUsable(atr: number): boolean {
  return Number.isFinite(atr) && atr > 0;
}
