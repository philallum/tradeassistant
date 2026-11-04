// Expected candle size (range forecast) types.
//
// A deterministic, LLM-free, display-only forecast of how BIG the next 1-3 day
// move envelope is expected to be, expressed as a Small / Medium / Large bucket
// RELATIVE TO THE PAIR'S OWN HISTORY (pair-relative terciles), plus a pips range.
// It says nothing about direction and never feeds firing, confidence or scoring.

/** Pair-relative size bucket of the expected move envelope. */
export type RangeBucket = "SMALL" | "MEDIUM" | "LARGE";

/** Forward horizon in trading days (mirrors the confidence module's Horizon). */
export type RangeHorizon = 1 | 2 | 3;

/**
 * Tercile cut-offs of the pair's own historical span/ATR_14 ratio at a horizon:
 * a ratio <= `smallMax` is SMALL, <= `mediumMax` is MEDIUM, otherwise LARGE.
 */
export interface RangeCutoffs {
  readonly smallMax: number;
  readonly mediumMax: number;
}

/** The expected candle size for one pair at one horizon. */
export interface ExpectedRange {
  readonly bucket: RangeBucket;
  readonly horizon: RangeHorizon;
  /** P25 of the neighbourhood's span, scaled to today's ATR_14, in pips. */
  readonly lowPips: number;
  /** P75 of the neighbourhood's span, scaled to today's ATR_14, in pips. */
  readonly highPips: number;
  /** Number of analogues behind the forecast (>= the 30-analogue floor). */
  readonly sampleSize: number;
  /** The pair-relative tercile cut-offs the bucket was read against. */
  readonly cutoffs: RangeCutoffs;
  /** ATR_14 in pips the range was scaled with (also the realized-ratio divisor). */
  readonly atrPips: number;
}
