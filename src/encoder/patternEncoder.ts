// Pattern Vector Encoder (Requirements 8.1, 8.2, 8.3, 8.5, 8.6, 4.1).
//
// Shape-only, multi-scale (10/20/40 trading days) encoder producing a fixed
// 70-dimensional embedding and 5-trading-day rolling ROC weeklyTrendSign metadata.
// Look-Ahead Guard enforced on all input windows.

import { lookAheadGuard } from "../guard/lookAheadGuard.js";
import type { Candle, TradingDate } from "../guard/types.js";
import { normalizeShapeSlice } from "./normalize.js";
import type { PatternVector, WeeklyTrendSign } from "./types.js";

/** Fixed embedding dimension = 10 + 20 + 40 = 70. */
export const EMBEDDING_DIM = 70;

export interface PatternVectorEncoder {
  encode(window: readonly Candle[], decisionDate: TradingDate): PatternVector;
  weeklyTrendSign(
    window: readonly Candle[],
    decisionDate: TradingDate,
  ): WeeklyTrendSign;
}

/**
 * Derives the macro-regime metadata: 5-trading-day rolling rate of change (ROC) sign.
 * Returns "UP" if Close_T - Close_{T-5} >= 0, else "DOWN". (Requirement 8.3)
 * Enforces the Look-Ahead Guard on the input window (Requirement 4.1).
 */
export function weeklyTrendSign(
  window: readonly Candle[],
  decisionDate: TradingDate,
): WeeklyTrendSign {
  // Enforce look-ahead safety on the window
  const guardResult = lookAheadGuard.assertPastOnly(window, decisionDate);
  if (!guardResult.ok) {
    throw new Error(guardResult.error.message);
  }

  const validCandles = guardResult.value;
  if (validCandles.length === 0) {
    return "UP";
  }

  // Sort chronologically
  const sorted = [...validCandles].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;

  const currentClose = sorted[n - 1]!.close;
  // Look back 5 trading days (index n - 6); if fewer available, compare to earliest in window
  const lookbackIndex = Math.max(0, n - 6);
  const lookbackClose = sorted[lookbackIndex]!.close;

  // Scale-invariant tie-break (Property 9 / Requirement 8.3).
  // A raw `diff >= 0` comparison is NOT scale-invariant when the two closes are
  // mathematically equal but differ only by floating-point noise: multiplying both
  // closes by a positive scalar can flip the sign of that ~1e-17 difference and
  // therefore flip UP<->DOWN. Mirroring normalize.ts, we treat a difference that is
  // negligible RELATIVE TO THE PRICE SCALE as a tie resolved to "UP" (preserving the
  // documented ">= 0 => UP" semantics). Because scaling multiplies both `diff` and
  // `scale` by the same positive factor, `diff / scale` is invariant, so the
  // classification is exactly scale-invariant while a genuine negative move
  // (well beyond fp noise) still yields "DOWN".
  const diff = currentClose - lookbackClose;
  const scale = Math.max(Math.abs(currentClose), Math.abs(lookbackClose), 1e-12);
  return diff < 0 && Math.abs(diff) / scale >= 1e-9 ? "DOWN" : "UP";
}

/**
 * Encodes a multi-scale window into a fixed 70-dimensional PatternVector.
 * Requirements 8.1, 8.2, 8.5, 8.6.
 *
 * 1. Validates look-ahead safety (rejects candles dated >= decisionDate).
 * 2. Extracts most recent 10, 20, and 40 candle closes.
 * 3. Normalizes each scale independently into scale10, scale20, scale40.
 * 4. Concatenates into a 70-dimensional embedding vector.
 * 5. Computes the rolling 5-trading-day weeklyTrendSign.
 */
export function encodePatternVector(
  window: readonly Candle[],
  decisionDate: TradingDate,
): PatternVector {
  // Enforce look-ahead safety (Requirement 4.1, 4.4)
  const guardResult = lookAheadGuard.assertPastOnly(window, decisionDate);
  if (!guardResult.ok) {
    throw new Error(guardResult.error.message);
  }

  const sorted = [...guardResult.value].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const closes = sorted.map((c) => c.close);
  const totalCloses = closes.length;

  // Extract slices for 10, 20, and 40 trading days
  const closes10 = closes.slice(Math.max(0, totalCloses - 10));
  const closes20 = closes.slice(Math.max(0, totalCloses - 20));
  const closes40 = closes.slice(Math.max(0, totalCloses - 40));

  // If fewer candles exist, pad left with zero/earliest close to maintain fixed dimension
  const padToLength = (arr: readonly number[], targetLen: number): number[] => {
    if (arr.length >= targetLen) {
      return [...arr.slice(arr.length - targetLen)];
    }
    const padVal = arr[0] ?? 0;
    const padding = new Array<number>(targetLen - arr.length).fill(padVal);
    return [...padding, ...arr];
  };

  const padded10 = padToLength(closes10, 10);
  const padded20 = padToLength(closes20, 20);
  const padded40 = padToLength(closes40, 40);

  // Per-scale independent normalization (Requirement 8.2, 8.6)
  const scale10 = normalizeShapeSlice(padded10);
  const scale20 = normalizeShapeSlice(padded20);
  const scale40 = normalizeShapeSlice(padded40);

  // Concatenate fixed dimension 70 vector (Requirement 8.4)
  const embedding = [...scale10, ...scale20, ...scale40];

  // Derive macro-regime metadata (Requirement 8.3)
  const trendSign = weeklyTrendSign(sorted, decisionDate);

  return {
    scale10,
    scale20,
    scale40,
    embedding,
    weeklyTrendSign: trendSign,
    dim: EMBEDDING_DIM,
  };
}

/** Default singleton PatternVectorEncoder. */
export const patternVectorEncoder: PatternVectorEncoder = {
  encode: encodePatternVector,
  weeklyTrendSign,
};
