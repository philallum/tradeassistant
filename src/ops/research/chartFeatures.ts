// Price-only "trader's eye" chart features (pure; no I/O).
//
// Definitions are fixed in docs/research/PRE-REGISTRATION-2.md. Every feature is computed from the
// candles passed in, which the caller must restrict to dates strictly BEFORE the decision date.
// A pivot (swing high/low) needs two later candles to confirm, so the newest two candles can never
// be a pivot: no feature depends on information the live signal does not have.
import { computeAtr14 } from "../../confidence/atr.js";
import type { Candle } from "../../guard/types.js";

export interface ChartFeatures {
  readonly rangePos20: number | null;
  readonly rangePos60: number | null;
  readonly rangePos120: number | null;
  readonly distSma20Atr: number | null;
  readonly distSma50Atr: number | null;
  readonly trend20Atr: number | null;
  /** Swing structure in {-1, -0.5, 0, 0.5, 1}; +1 = higher highs and higher lows. */
  readonly swing: number | null;
  readonly body: number;
  readonly upperWick: number;
  readonly lowerWick: number;
  readonly closePos: number;
  readonly compression: number | null;
  readonly channelExcursion: number | null;
}

/** Candles needed for every feature to be defined. */
export const MIN_FEATURE_HISTORY = 121;

const ATR_WINDOW = 60;
const PIVOT_STRENGTH = 2;
const SWING_LOOKBACK = 60;

function rangePosition(candles: readonly Candle[], n: number): number | null {
  if (candles.length < n) return null;
  const w = candles.slice(candles.length - n);
  let hi = -Infinity;
  let lo = Infinity;
  for (const c of w) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  const last = candles[candles.length - 1] as Candle;
  return hi === lo ? 0.5 : (last.close - lo) / (hi - lo);
}

function sma(candles: readonly Candle[], n: number): number | null {
  if (candles.length < n) return null;
  let s = 0;
  for (let i = candles.length - n; i < candles.length; i += 1) s += (candles[i] as Candle).close;
  return s / n;
}

/** Indexes (into `candles`) of confirmed pivot highs or lows within the lookback. */
export function confirmedPivots(candles: readonly Candle[], kind: "high" | "low"): number[] {
  const out: number[] = [];
  const first = Math.max(PIVOT_STRENGTH, candles.length - SWING_LOOKBACK);
  // k must have PIVOT_STRENGTH candles after it, so the newest two candles are never pivots.
  for (let k = first; k <= candles.length - 1 - PIVOT_STRENGTH; k += 1) {
    const v = (candles[k] as Candle)[kind];
    let isPivot = true;
    for (let d = 1; d <= PIVOT_STRENGTH; d += 1) {
      const a = (candles[k - d] as Candle)[kind];
      const b = (candles[k + d] as Candle)[kind];
      if (kind === "high" ? !(v > a && v > b) : !(v < a && v < b)) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) out.push(k);
  }
  return out;
}

function swingStructure(candles: readonly Candle[]): number | null {
  const highs = confirmedPivots(candles, "high");
  const lows = confirmedPivots(candles, "low");
  if (highs.length < 2 || lows.length < 2) return null;
  const h1 = (candles[highs[highs.length - 2] as number] as Candle).high;
  const h2 = (candles[highs[highs.length - 1] as number] as Candle).high;
  const l1 = (candles[lows[lows.length - 2] as number] as Candle).low;
  const l2 = (candles[lows[lows.length - 1] as number] as Candle).low;
  const sH = h2 > h1 ? 1 : h2 < h1 ? -1 : 0;
  const sL = l2 > l1 ? 1 : l2 < l1 ? -1 : 0;
  return (sH + sL) / 2;
}

/** Compute the features from candles sorted ascending and all dated before the decision date. */
export function computeChartFeatures(past: readonly Candle[]): ChartFeatures | null {
  if (past.length < 20) return null;
  const last = past[past.length - 1] as Candle;
  const atr = computeAtr14(past.slice(Math.max(0, past.length - ATR_WINDOW)));
  const range = last.high - last.low;
  const upperWick = range === 0 ? 0 : (last.high - Math.max(last.open, last.close)) / range;
  const lowerWick = range === 0 ? 0 : (Math.min(last.open, last.close) - last.low) / range;

  const sma20 = sma(past, 20);
  const sma50 = sma(past, 50);
  const ago20 = past.length > 20 ? (past[past.length - 21] as Candle).close : null;

  let compression: number | null = null;
  if (past.length >= 40) {
    const mean = (n: number): number => {
      let s = 0;
      for (let i = past.length - n; i < past.length; i += 1) s += (past[i] as Candle).high - (past[i] as Candle).low;
      return s / n;
    };
    const long = mean(40);
    compression = long === 0 ? null : mean(5) / long;
  }

  let channelExcursion: number | null = null;
  if (past.length >= 21 && atr > 0) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = past.length - 21; i < past.length - 1; i += 1) {
      const c = past[i] as Candle;
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    channelExcursion = last.close > hi ? (last.close - hi) / atr : last.close < lo ? (last.close - lo) / atr : 0;
  }

  const positive = atr > 0;
  return {
    rangePos20: rangePosition(past, 20),
    rangePos60: rangePosition(past, 60),
    rangePos120: rangePosition(past, 120),
    distSma20Atr: positive && sma20 !== null ? (last.close - sma20) / atr : null,
    distSma50Atr: positive && sma50 !== null ? (last.close - sma50) / atr : null,
    trend20Atr: positive && ago20 !== null ? (last.close - ago20) / atr : null,
    swing: swingStructure(past),
    body: range === 0 ? 0 : (last.close - last.open) / range,
    upperWick,
    lowerWick,
    closePos: range === 0 ? 0.5 : (last.close - last.low) / range,
    compression,
    channelExcursion,
  };
}

const clip = (x: number, lim: number): number => Math.max(-lim, Math.min(lim, x));

/**
 * The fixed-scaling 13-number feature vector used by the encoding variants. Nothing is fitted:
 * every number is mapped to roughly [-1, 1] by a constant chosen in advance. Null when any
 * required feature is unavailable.
 */
export function featureVector(f: ChartFeatures): number[] | null {
  if (
    f.rangePos20 === null ||
    f.rangePos60 === null ||
    f.rangePos120 === null ||
    f.distSma20Atr === null ||
    f.distSma50Atr === null ||
    f.trend20Atr === null ||
    f.swing === null ||
    f.compression === null ||
    f.channelExcursion === null
  ) {
    return null;
  }
  return [
    2 * f.rangePos20 - 1,
    2 * f.rangePos60 - 1,
    2 * f.rangePos120 - 1,
    clip(f.distSma20Atr, 4) / 4,
    clip(f.distSma50Atr, 6) / 6,
    clip(f.trend20Atr, 8) / 8,
    f.swing,
    f.body,
    2 * f.upperWick - 1,
    2 * f.lowerWick - 1,
    2 * f.closePos - 1,
    clip(Math.log(Math.max(f.compression, 1e-6)), 1),
    clip(f.channelExcursion, 3) / 3,
  ];
}

/** Features oriented to a setup direction: positive always means "in the setup's favour". */
export interface OrientedFeatures {
  readonly rangePosDir: number | null;
  readonly distDir: number | null;
  readonly swingDir: number | null;
  readonly bodyDir: number;
  readonly closePosDir: number;
  readonly wickRejection: number;
  readonly trendDir: number | null;
  readonly excursionDir: number | null;
  readonly compression: number | null;
}

export function orient(f: ChartFeatures, side: "UP" | "DOWN"): OrientedFeatures {
  const d = side === "UP" ? 1 : -1;
  return {
    rangePosDir: f.rangePos60 === null ? null : side === "UP" ? f.rangePos60 : 1 - f.rangePos60,
    distDir: f.distSma20Atr === null ? null : d * f.distSma20Atr,
    swingDir: f.swing === null ? null : d * f.swing,
    bodyDir: d * f.body,
    closePosDir: side === "UP" ? f.closePos : 1 - f.closePos,
    wickRejection: side === "UP" ? f.lowerWick : f.upperWick,
    trendDir: f.trend20Atr === null ? null : d * f.trend20Atr,
    excursionDir: f.channelExcursion === null ? null : d * f.channelExcursion,
    compression: f.compression,
  };
}
