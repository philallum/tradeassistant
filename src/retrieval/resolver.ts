// Forward-Outcome Resolver — Task 4.2.
// Requirements 9.6, 4.2.
//
// Captures terminal Direction_Class and MFE/MAE at each of the 1/2/3-day
// horizons using only candles dated strictly after the analogue date.
// Persists results to AnalogueStore with matured flag set via LookAheadGuard.

import { isMatured } from "../guard/lookAheadGuard.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { AnalogueRecord, AnalogueStore, DirectionClass, ForwardOutcome } from "./types.js";

/**
 * The FLAT dead-band threshold: a move is FLAT if |netMove| < ATR_14 * FLAT_BAND_FACTOR.
 * This is a placeholder factor consistent with Requirement 10.4 (ATR_14-scaled, not pip-fixed).
 * The final calibrated value is set in task 5.2.
 */
const FLAT_BAND_FACTOR = 0.5;

/**
 * Derive the Direction_Class from a net pip move relative to ATR-14.
 * (Requirement 10.5)
 */
function classifyDirection(netMovePips: number, atr14: number): DirectionClass {
  const band = atr14 * FLAT_BAND_FACTOR;
  if (Math.abs(netMovePips) < band) return "FLAT";
  return netMovePips >= 0 ? "UP" : "DOWN";
}

/**
 * Convert a price difference to approximate pips.
 * For JPY pairs, pip = 0.01; for all others, pip = 0.0001.
 */
function toPips(priceDiff: number, pair: Pair): number {
  const isJpy = pair.includes("JPY");
  const pipSize = isJpy ? 0.01 : 0.0001;
  return Math.round((Math.abs(priceDiff) / pipSize) * 10) / 10;
}

/**
 * Compute MFE (maximum favorable excursion) and MAE (maximum adverse excursion)
 * in pips over a slice of candles relative to the entry close.
 *
 * - MFE: the highest close above (UP direction) or below (DOWN direction) the entry close.
 * - MAE: the lowest close below (UP direction) or above (DOWN direction) the entry close.
 *
 * For FLAT direction, MFE and MAE are both computed as in the UP direction
 * (the caller should interpret them symmetrically).
 */
function computeExcursions(
  sliceCandles: readonly Candle[],
  entryClose: number,
  direction: DirectionClass,
  pair: Pair,
): { mfePips: number; maePips: number } {
  if (sliceCandles.length === 0) return { mfePips: 0, maePips: 0 };

  let mfe = 0;
  let mae = 0;

  for (const candle of sliceCandles) {
    const highDiff = candle.high - entryClose;
    const lowDiff = candle.low - entryClose;

    if (direction === "DOWN") {
      // Favorable is downward movement
      mfe = Math.max(mfe, -lowDiff);
      mae = Math.max(mae, highDiff);
    } else {
      // Favorable is upward movement (also used for FLAT)
      mfe = Math.max(mfe, highDiff);
      mae = Math.max(mae, -lowDiff);
    }
  }

  return {
    mfePips: toPips(Math.max(0, mfe), pair),
    maePips: toPips(Math.max(0, mae), pair),
  };
}

/**
 * Resolves forward outcomes for an analogue at a given trading date.
 *
 * Uses only candles dated strictly after `analogueDate` (Requirement 9.6, 4.2).
 * Computes terminal Direction_Class + MFE/MAE for horizons 1, 2, and 3 trading days.
 * Persists each horizon row to `analogueStore` with the correct `matured` flag
 * based on `isMatured(analogueDate, h, evalDate)` (Requirement 4.2).
 *
 * @param analogueDate   The analogue's own decision date.
 * @param pair           The currency pair.
 * @param forwardCandles Candles dated strictly after analogueDate, sorted chronologically.
 * @param atr14          ATR-14 volatility at analogueDate (for FLAT band classification).
 * @param evalDate       Current evaluation date — determines maturity of each horizon.
 * @param analogueStore  Store to persist resolved outcomes.
 */
export async function resolve(
  analogueDate: TradingDate,
  pair: Pair,
  forwardCandles: readonly Candle[],
  atr14: number,
  evalDate: TradingDate,
  analogueStore: AnalogueStore,
): Promise<ForwardOutcome> {
  // Filter to strictly-forward candles and sort chronologically (Req 9.6, 4.2).
  const forward = [...forwardCandles]
    .filter((c) => c.date > analogueDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Entry price is the close of the analogue candle itself.
  // Callers must supply forwardCandles that are already strictly after analogueDate;
  // we use the first forward candle's open as a proxy entry (or 0 if none).
  const entryClose = forward[0]?.open ?? 0;

  const horizons = [1, 2, 3] as const;
  const perHorizon = {} as {
    1: { direction: DirectionClass; mfePips: number; maePips: number };
    2: { direction: DirectionClass; mfePips: number; maePips: number };
    3: { direction: DirectionClass; mfePips: number; maePips: number };
  };

  for (const h of horizons) {
    // Take the first h candles after the analogue date.
    const slice = forward.slice(0, h);
    const terminalClose = slice[slice.length - 1]?.close ?? entryClose;
    const netMovePips = toPips(terminalClose - entryClose, pair) * (terminalClose >= entryClose ? 1 : -1);

    const direction = classifyDirection(netMovePips, atr14);
    const { mfePips, maePips } = computeExcursions(slice, entryClose, direction, pair);

    const matured = isMatured(analogueDate, h, evalDate);

    const record: AnalogueRecord = {
      asset: pair,
      decisionDate: analogueDate,
      horizon: h,
      direction,
      mfePips,
      maePips,
      atr14,
      matured,
    };

    // Persist to store (Req 9.6)
    await analogueStore.upsertOutcome(record);

    perHorizon[h] = { direction, mfePips, maePips };
  }

  return { perHorizon };
}
