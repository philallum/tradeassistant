// Shared candle → PatternVector encode helper — Design Component 4
// (Requirements 2.1, 6.3).
//
// Factored out of `stagedRunner.ts` `backfill()` so the Candle_Freshness_Stage
// and the staged-runner backfill share ONE look-ahead-safe encode path rather
// than copying it. For a target date, the trailing window is the stored candles
// dated STRICTLY BEFORE that date (the decision date itself is excluded), so a
// vector encodes no future information. A date whose encode throws (e.g. the
// look-ahead guard fires on an edge-case window) is skipped exactly as backfill
// does; subsequent dates still succeed.

import { encodePatternVector } from "./patternEncoder.js";
import type { PatternVectorStore } from "./types.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { CandleStore, Pair } from "../ingestion/types.js";

/** Default trailing window size fed to the encoder (≥40 for the widest scale). */
export const DEFAULT_WINDOW_SIZE = 60;

/** Called for each date whose vector was NOT stored, with the encode/write error. */
export type EncodeSkipHandler = (date: TradingDate, err: unknown) => void;

/**
 * Encode a specific set of target `dates` for a pair into pattern vectors,
 * reading the trailing window of stored candles STRICTLY BEFORE each date and
 * upserting the resulting vector. Returns the dates for which a vector was
 * stored (failures are skipped). The candles are read once from the store and
 * the window is sliced per date.
 *
 * A skipped date lowers the analogue pool for that pair, so it must not be
 * invisible: each skip (an encode error OR a vector-store write error) is
 * reported through the optional `onSkip` callback. Skipping itself is unchanged -
 * the callback only observes; subsequent dates still succeed.
 */
export async function encodeDatesIntoVectors(
  candleStore: CandleStore,
  vectorStore: PatternVectorStore,
  pair: Pair,
  dates: readonly TradingDate[],
  windowSize: number = DEFAULT_WINDOW_SIZE,
  onSkip?: EncodeSkipHandler,
): Promise<readonly TradingDate[]> {
  if (dates.length === 0) {
    return [];
  }
  const candles = await candleStore.getCandles(pair);
  if (candles.length === 0) {
    return [];
  }

  const sorted = sortByDate(candles);
  const encoded: TradingDate[] = [];

  for (const date of dates) {
    const window = trailingWindowBefore(sorted, date, windowSize);
    try {
      const vector = encodePatternVector(window, date);
      await vectorStore.upsertVector(pair, date, vector);
      encoded.push(date);
    } catch (err) {
      // Skip dates where encoding fails (e.g. the look-ahead guard fires for an
      // edge-case window) or the vector write fails; subsequent dates still
      // succeed. The skip is reported, never silent.
      onSkip?.(date, err);
      continue;
    }
  }
  return encoded;
}

/**
 * Encode EVERY stored candle date for a pair into a pattern vector — the exact
 * flow the staged-runner backfill performed inline. The vector for a candle
 * date encodes the trailing window of candles dated strictly before that date
 * (look-ahead safe); the earliest date's prior window is empty (the encoder pads
 * it to the fixed dimension), so every stored candle still yields a vector
 * unless its encode throws.
 */
export async function encodeAllForPair(
  candleStore: CandleStore,
  vectorStore: PatternVectorStore,
  pair: Pair,
  windowSize: number = DEFAULT_WINDOW_SIZE,
  onSkip?: EncodeSkipHandler,
): Promise<readonly TradingDate[]> {
  const candles = await candleStore.getCandles(pair);
  if (candles.length === 0) {
    return [];
  }
  const sorted = sortByDate(candles);
  return encodeDatesIntoVectors(
    candleStore,
    vectorStore,
    pair,
    sorted.map((c) => c.date),
    windowSize,
    onSkip,
  );
}

/** Sort candles chronologically (CandleStore already does, but be explicit). */
function sortByDate(candles: readonly Candle[]): readonly Candle[] {
  return [...candles].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The trailing window for `date`: up to `windowSize` candles dated STRICTLY
 * BEFORE `date`. `candles` must be sorted chronologically.
 */
function trailingWindowBefore(
  candles: readonly Candle[],
  date: TradingDate,
  windowSize: number,
): readonly Candle[] {
  // Index of the first candle dated >= `date`; everything before it is the
  // strictly-before set.
  let beforeCount = 0;
  for (const candle of candles) {
    if (candle.date < date) {
      beforeCount += 1;
    } else {
      break;
    }
  }
  return candles.slice(Math.max(0, beforeCount - windowSize), beforeCount);
}
