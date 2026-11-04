// Expected candle size — pure, deterministic core (analogue-based, pair-relative).
//
// span(analogue)  = mfePips + maePips
//   MFE and MAE are measured from the entry price over the horizon (see
//   `src/retrieval/resolver.ts`). For an UP/FLAT analogue MFE is the highest
//   high above entry and MAE the lowest low below it (swapped for DOWN), so
//   mfe + mae is the high-low envelope of the horizon relative to entry
//   regardless of direction. No analogue schema change is needed.
//
// ratio(analogue) = span / ATR_14-in-pips at the analogue date
//   (`AnalogueRecord.atr14` is stored in PRICE units; `toPips` converts it).
//   Dividing by ATR makes spans from different volatility regimes comparable.
//
// bucket   = the neighbourhood's MEDIAN ratio read against the TERCILES of the
//   pair's OWN history ratio distribution at the same horizon, so "Large" always
//   means large FOR THAT PAIR (EURUSD and USDJPY are never compared raw).
//
// range    = P25..P75 of the neighbourhood ratios x today's ATR_14 in pips.
//
// Returns null below the 30-analogue floor, or when the pair has too little
// history to form terciles, or ATR is unusable: the forecast is then simply
// absent, never fabricated. Pure: no clock, no I/O, no hidden state, no LLM.

import type { Pair } from "../ingestion/types.js";
import type { AnalogueRecord } from "../retrieval/types.js";
import { percentile } from "../risk-boundaries/empiricalRiskBoundaries.js";
import { RISK_BOUNDARY_FLOOR } from "../risk-boundaries/types.js";
import { toPips } from "../trade-sim/pip.js";
import type {
  ExpectedRange,
  RangeBucket,
  RangeCutoffs,
  RangeHorizon,
} from "./types.js";

/** Minimum neighbourhood size at the horizon (the shared 30-analogue floor). */
export const RANGE_NEIGHBOURHOOD_FLOOR = RISK_BOUNDARY_FLOOR;

/** Minimum pair-history rows at the horizon needed to form stable terciles. */
export const RANGE_HISTORY_FLOOR = 90 as const;

/** Round to one decimal place (pips display precision, matches `toPips`). */
const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * The span/ATR ratio of one analogue, or null when its ATR is unusable.
 * `atr14` on the record is in price units, so it is converted with `toPips`.
 */
export function spanRatio(record: AnalogueRecord, pair: Pair): number | null {
  const atrPips = toPips(record.atr14, pair);
  if (!(atrPips > 0)) return null;
  const span = record.mfePips + record.maePips;
  if (!Number.isFinite(span) || span < 0) return null;
  return span / atrPips;
}

/** Ratios of every usable analogue at a horizon. */
function ratiosAt(
  records: readonly AnalogueRecord[],
  horizon: RangeHorizon,
  pair: Pair,
): number[] {
  const out: number[] = [];
  for (const r of records) {
    if (r.horizon !== horizon) continue;
    const ratio = spanRatio(r, pair);
    if (ratio !== null) out.push(ratio);
  }
  return out;
}

/** Tercile cut-offs (P33.33 / P66.67) of a ratio sample. Non-empty input only. */
export function tercileCutoffs(ratios: readonly number[]): RangeCutoffs {
  return {
    smallMax: percentile(ratios, 100 / 3),
    mediumMax: percentile(ratios, 200 / 3),
  };
}

/** Read a ratio against cut-offs: <= smallMax SMALL, <= mediumMax MEDIUM, else LARGE. */
export function bucketOf(ratio: number, cutoffs: RangeCutoffs): RangeBucket {
  if (ratio <= cutoffs.smallMax) return "SMALL";
  if (ratio <= cutoffs.mediumMax) return "MEDIUM";
  return "LARGE";
}

/**
 * Derive the expected candle size for a pair at a horizon.
 *
 * @param neighbourhood The firing Analogue_Neighborhood (retrieval output).
 * @param history       ALL matured analogue rows of the pair known AS OF the
 *                      decision date (the caller guarantees look-ahead safety);
 *                      used only to form the pair-relative terciles.
 * @param horizon       The selected horizon.
 * @param pair          The pair (for pip conversion).
 * @param atr14         Today's ATR_14 in PRICE units (window strictly before the
 *                      decision date).
 */
export function deriveExpectedRange(
  neighbourhood: readonly AnalogueRecord[],
  history: readonly AnalogueRecord[],
  horizon: RangeHorizon,
  pair: Pair,
  atr14: number,
): ExpectedRange | null {
  const atrPips = toPips(atr14, pair);
  if (!(atrPips > 0)) return null;

  const neighbourRatios = ratiosAt(neighbourhood, horizon, pair);
  if (neighbourRatios.length < RANGE_NEIGHBOURHOOD_FLOOR) return null;

  const historyRatios = ratiosAt(history, horizon, pair);
  if (historyRatios.length < RANGE_HISTORY_FLOOR) return null;

  const cutoffs = tercileCutoffs(historyRatios);
  const bucket = bucketOf(percentile(neighbourRatios, 50), cutoffs);

  return {
    bucket,
    horizon,
    lowPips: round1(percentile(neighbourRatios, 25) * atrPips),
    highPips: round1(percentile(neighbourRatios, 75) * atrPips),
    sampleSize: neighbourRatios.length,
    cutoffs,
    atrPips,
  };
}
