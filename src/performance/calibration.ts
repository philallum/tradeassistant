// Calibration with the overlap adjustment — trader-edge-validation Stage D
// (task 11; design R6). Buckets OOS forecasts by Earned_Confidence band and, per
// band, reports the realized correct rate, the raw forecast count, and an
// effective sample size DISCOUNTED for analogue OVERLAP (R6.4). `monotonic`
// (R6.2) and `wellCalibrated` (R6.1) are reported SEPARATELY so the presentation
// layer can decide whether confidence is shown as a probability or only as a
// ranking (R6.3, R10.3).
//
// Measured out-of-sample from ledger rows (R6.1, R6.5). Deterministic, LLM-free;
// a read-only consumer that touches no live decision path.

import type { TradeLedgerRow } from "../trade-ledger/types.js";

/** A single Earned_Confidence band and its realized behaviour. */
export interface CalibrationBand {
  /** Band half-open interval `[lo, hi)` (e.g. `[0.55, 0.60)`). */
  readonly lo: number;
  readonly hi: number;
  /** Count of DECIDED forecasts in the band (resolved to a win or a loss). */
  readonly forecastCount: number;
  /** Fraction of decided forecasts that resolved in the PREDICTED direction. */
  readonly realizedCorrectRate: number;
  /** Overlap-adjusted effective sample size (≤ forecastCount) — R6.4. */
  readonly effectiveSampleSize: number;
}

/** The full calibration report across all populated bands. */
export interface CalibrationReport {
  /** Populated bands in ascending confidence order. */
  readonly bands: readonly CalibrationBand[];
  /** Do higher bands resolve at least as well as lower ones? (R6.2) */
  readonly monotonic: boolean;
  /**
   * Is every populated band's realized rate within `tolerance` of the band
   * midpoint? (R6.1) A band with no decided forecasts is vacuously calibrated.
   */
  readonly wellCalibrated: boolean;
}

/** Band width = 0.05, matching the metrics `summarizeBySlice` confidence buckets. */
const BAND_WIDTH = 0.05;

/** Default |realized − midpoint| tolerance for `wellCalibrated` (R6.1). */
export const DEFAULT_CALIBRATION_TOLERANCE = 0.1;

/**
 * The number of trailing trading days whose analogue windows are treated as
 * OVERLAPPING. Forecasts on Decision_Dates within this span of each other share
 * substantial trailing-window / neighborhood history, so they are not fully
 * independent observations (R6.4). Defaults to the live trailing window
 * (`DEFAULT_PIPELINE_WINDOW_SIZE` = 60) so the discount reflects the actual
 * window the encoder/ATR consume. Configurable for tests and sensitivity checks;
 * this is a MEASUREMENT input, not a signal knob (R12.2).
 */
export const DEFAULT_OVERLAP_WINDOW_DAYS = 60;

/** The 0.05-wide band key an earned-confidence value falls into. */
function bandBounds(confidence: number): { lo: number; hi: number } {
  const lo = Math.floor(confidence / BAND_WIDTH) * BAND_WIDTH;
  return { lo: round2(lo), hi: round2(lo + BAND_WIDTH) };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * A ledger row counts for calibration iff it is a DECIDED directional trade:
 * it fired, took a position (entry resolved), and resolved to a win or a loss.
 * `ambiguous` and `expired` are undecided — they cannot confirm or refute the
 * predicted direction, so they are excluded from the correct-rate denominator
 * (R6 / R4.4) rather than silently counted as misses.
 */
function isDecided(row: TradeLedgerRow): boolean {
  return (
    row.fired &&
    row.direction !== "FLAT" &&
    row.entryDate !== row.decisionDate &&
    (row.outcome === "target_first" || row.outcome === "stop_first")
  );
}

/**
 * A decided row "resolved in the predicted direction" iff Take_Profit was hit
 * first (`target_first`): the forecast's directional move played out before the
 * stop. `stop_first` is the predicted direction failing. (R6)
 */
function resolvedCorrect(row: TradeLedgerRow): boolean {
  return row.outcome === "target_first";
}

/**
 * The overlap-adjusted effective sample size for a band's decided rows (R6.4).
 *
 * Independent observations each contribute 1. Observations whose Decision_Dates
 * fall within {@link DEFAULT_OVERLAP_WINDOW_DAYS} of an already-counted
 * observation on the SAME pair share trailing-window history, so each additional
 * near-neighbour contributes a FRACTION of an observation that decays with how
 * much of the window it shares. Concretely, per pair we sweep Decision_Dates in
 * ascending order and credit each row `min(1, gapDays / overlapWindow)` of an
 * observation relative to the previous counted row on that pair (the first row
 * on a pair always contributes a full 1). The result is ≤ the raw count and
 * strictly LOWER when neighbourhoods share windows — never overstated.
 */
function effectiveSampleSize(
  rows: readonly TradeLedgerRow[],
  overlapWindowDays: number,
): number {
  // Group decided rows by pair; within a pair, order by Decision_Date.
  const byPair = new Map<string, TradeLedgerRow[]>();
  for (const row of rows) {
    const bucket = byPair.get(row.pair);
    if (bucket) bucket.push(row);
    else byPair.set(row.pair, [row]);
  }

  let effective = 0;
  for (const bucket of byPair.values()) {
    const sorted = [...bucket].sort((a, b) => a.decisionDate.localeCompare(b.decisionDate));
    let prevDate: string | null = null;
    for (const row of sorted) {
      if (prevDate === null) {
        effective += 1; // first observation on the pair is fully independent
      } else {
        const gap = tradingDayGap(prevDate, row.decisionDate);
        // Fully overlapping (gap 0) ⇒ ~0 new information; gap ≥ window ⇒ a full 1.
        effective += Math.min(1, gap / overlapWindowDays);
      }
      prevDate = row.decisionDate;
    }
  }
  return effective;
}

/** Calendar-day gap between two ISO dates (a proxy for the trading-day gap). */
function tradingDayGap(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.abs(b - a) / 86_400_000;
}

/**
 * Build the calibration report from OOS ledger rows (R6.1, R6.5). Only decided
 * directional trades populate the bands; a band with no decided rows is omitted.
 *
 * @param rows             OOS ledger rows (any strategy; typically the system).
 * @param options.tolerance        |realized − midpoint| tolerance for
 *                                  `wellCalibrated` (default 0.1).
 * @param options.overlapWindowDays Window span treated as overlapping for the
 *                                  effective-sample discount (default 60).
 */
export function calibrate(
  rows: readonly TradeLedgerRow[],
  options?: {
    readonly tolerance?: number;
    readonly overlapWindowDays?: number;
  },
): CalibrationReport {
  const tolerance = options?.tolerance ?? DEFAULT_CALIBRATION_TOLERANCE;
  const overlapWindowDays = options?.overlapWindowDays ?? DEFAULT_OVERLAP_WINDOW_DAYS;

  const decided = rows.filter(isDecided);

  // Bucket by band lo-bound.
  const buckets = new Map<number, TradeLedgerRow[]>();
  for (const row of decided) {
    const { lo } = bandBounds(row.earnedConfidence);
    const bucket = buckets.get(lo);
    if (bucket) bucket.push(row);
    else buckets.set(lo, [row]);
  }

  const bands: CalibrationBand[] = [];
  for (const lo of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(lo)!;
    const correct = bucket.filter(resolvedCorrect).length;
    bands.push({
      lo: round2(lo),
      hi: round2(lo + BAND_WIDTH),
      forecastCount: bucket.length,
      realizedCorrectRate: bucket.length > 0 ? correct / bucket.length : 0,
      effectiveSampleSize: effectiveSampleSize(bucket, overlapWindowDays),
    });
  }

  return {
    bands,
    monotonic: isMonotonic(bands),
    wellCalibrated: isWellCalibrated(bands, tolerance),
  };
}

/** Higher bands resolve at least as well as lower bands (non-decreasing rate). */
function isMonotonic(bands: readonly CalibrationBand[]): boolean {
  for (let i = 1; i < bands.length; i += 1) {
    if (bands[i]!.realizedCorrectRate < bands[i - 1]!.realizedCorrectRate) {
      return false;
    }
  }
  return true;
}

/** Every band's realized rate is within `tolerance` of its midpoint. */
function isWellCalibrated(bands: readonly CalibrationBand[], tolerance: number): boolean {
  for (const band of bands) {
    const midpoint = (band.lo + band.hi) / 2;
    if (Math.abs(band.realizedCorrectRate - midpoint) > tolerance) {
      return false;
    }
  }
  return true;
}
