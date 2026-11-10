// Forward-Outcome Resolver — Task 4.2.
// Requirements 9.6, 4.2.
//
// Captures terminal Direction_Class and MFE/MAE at each of the 1/2/3-day
// horizons using only candles dated strictly after the analogue date.
// Persists results to AnalogueStore with matured flag set via LookAheadGuard.

import { isMatured } from "../guard/lookAheadGuard.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import { pipSize, toPips } from "../trade-sim/pip.js";
import type { AnalogueRecord, AnalogueStore, DirectionClass, ForwardOutcome } from "./types.js";

/**
 * The FLAT dead-band threshold: a move is FLAT if |netMove| < ATR_14 * FLAT_BAND_FACTOR.
 * This is a placeholder factor consistent with Requirement 10.4 (ATR_14-scaled, not pip-fixed).
 * The final calibrated value is set in task 5.2.
 */
const FLAT_BAND_FACTOR = 0.5;

/**
 * How the FLAT dead-band is applied.
 *
 * - `"legacy"` (the DEFAULT, and what is live and stored): compares the net move in PIPS with
 *   `atr14 * FLAT_BAND_FACTOR`, where callers pass `atr14` in PRICE units. The band is therefore
 *   about 1/10,000th of intended, so stored directions are effectively always UP/DOWN by sign
 *   (RISKS finding 1). Kept byte-identical so nothing live changes.
 * - `"atr_pips"` (OFFLINE MEASUREMENT ONLY): converts the ATR to pips first, giving the
 *   originally intended 0.5 x ATR band (~60% of sessions FLAT). Never used by the daily Job.
 */
export type FlatBandMode = "legacy" | "atr_pips";

/**
 * Which session an analogue date's forward outcome measures.
 *
 * - `"after_decision_date"` (the DEFAULT, live and stored): the first candle STRICTLY AFTER the
 *   analogue date. The date's own vector encodes candles strictly BEFORE it, so the session
 *   labelled with the date itself is in neither the features nor the label (one skipped session;
 *   RISKS "possible one-session gap").
 * - `"on_decision_date"` (OFFLINE MEASUREMENT ONLY): the session labelled with the analogue date
 *   itself, i.e. features end the day before and the label is the very next session. Still
 *   look-ahead safe (the vector excludes that candle). Never used by the daily Job.
 */
export type LabelAlignment = "after_decision_date" | "on_decision_date";

/** Optional resolver behaviour. Omitted = exactly the historical behaviour. */
export interface ResolveOptions {
  readonly flatBandMode?: FlatBandMode;
  readonly labelAlignment?: LabelAlignment;
}

/**
 * Derive the Direction_Class from a net pip move relative to ATR-14.
 * (Requirement 10.5)
 */
function classifyDirection(
  netMovePips: number,
  atr14: number,
  pair: Pair,
  mode: FlatBandMode,
): DirectionClass {
  const band =
    mode === "atr_pips" ? (atr14 * FLAT_BAND_FACTOR) / pipSize(pair) : atr14 * FLAT_BAND_FACTOR;
  if (Math.abs(netMovePips) < band) return "FLAT";
  return netMovePips >= 0 ? "UP" : "DOWN";
}

// `toPips` (JPY pip 0.01 / others 0.0001, abs magnitude rounded to one decimal)
// is now the shared helper in `../trade-sim/pip.js`, imported above. Its behavior
// is byte-identical to the previous private copy (trader-edge-validation R1.1),
// so the stored MFE/MAE that feed live scoring are unchanged.

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
 * @param options        Optional behaviour; omitted = the historical (legacy) FLAT band.
 */
export async function resolve(
  analogueDate: TradingDate,
  pair: Pair,
  forwardCandles: readonly Candle[],
  atr14: number,
  evalDate: TradingDate,
  analogueStore: AnalogueStore,
  options: ResolveOptions = {},
): Promise<ForwardOutcome> {
  const flatBandMode = options.flatBandMode ?? "legacy";
  const labelAlignment = options.labelAlignment ?? "after_decision_date";
  // Filter to strictly-forward candles and sort chronologically (Req 9.6, 4.2).
  const forward = [...forwardCandles]
    .filter((c) => (labelAlignment === "on_decision_date" ? c.date >= analogueDate : c.date > analogueDate))
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

    const direction = classifyDirection(netMovePips, atr14, pair, flatBandMode);
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
