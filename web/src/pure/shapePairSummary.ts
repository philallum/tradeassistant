/**
 * Pure shaper for the pair summary line shown above the strategy cards: the conviction tier
 * and tally, the pattern engine's own call (when it fired), and the expected candle size.
 *
 * Pure: no fetch, DOM, clock, or core import. Every value is copied from the snapshot's
 * pair-evaluation row, firing row or track-record row; nothing is recomputed or invented.
 * The expected candle size says how big the move may be, never which way.
 */
import type {
  Direction,
  FiringSetupRow,
  Horizon,
  PairEvaluationRow,
  TrackRecord,
} from "../api/types";
import { formatConfidence, formatDirection } from "./format";

export const BUCKET_LABEL = { SMALL: "Small", MEDIUM: "Medium", LARGE: "Large" } as const;

/** A forecast with fewer scored forecasts than this is flagged as a small sample. */
export const SMALL_FORECAST_SAMPLE = 10;

export interface CandleSizeVM {
  /** False when the pair could not be forecast today. */
  readonly available: boolean;
  /** "Medium candle" or "Not forecast". */
  readonly headline: string;
  /** "about 60-95 pips over 1 day" or the reason it is absent. */
  readonly rangeText: string;
  /** "Forecast right 11 of 18 recent days" or "Forecast record not measured". */
  readonly recordText: string;
  readonly smallSample: boolean;
}

export interface PatternCallVM {
  /** True when the pattern engine fired for this pair on this date. */
  readonly fired: boolean;
  readonly direction: Direction | null;
  readonly directionLabel: string;
  readonly horizon: Horizon | null;
  readonly confidenceText: string;
  /** One line: "Pattern engine: Up, 57% confidence, 1 day horizon" or "did not fire". */
  readonly text: string;
}

export interface PairSummaryVM {
  readonly pair: string;
  readonly pattern: PatternCallVM;
  readonly candleSize: CandleSizeVM;
}

const dayWord = (h: number): string => `${h} day${h === 1 ? "" : "s"}`;

function shapeCandleSize(
  evaluation: PairEvaluationRow | undefined,
  pair: string,
  track: TrackRecord,
): CandleSizeVM {
  const r = evaluation?.expected_range;
  const rec = track.rangeForecast.find((x) => x.pair === pair);
  const recordText =
    rec === undefined || rec.forecasts === 0
      ? "Forecast record not measured."
      : `Forecast right ${rec.correct} of ${rec.forecasts} recent days.`;
  const smallSample = rec === undefined || rec.forecasts < SMALL_FORECAST_SAMPLE;
  if (r === undefined) {
    return {
      available: false,
      headline: "Not forecast",
      rangeText: "Too little history to size the next candle.",
      recordText,
      smallSample,
    };
  }
  return {
    available: true,
    headline: `${BUCKET_LABEL[r.bucket]} candle`,
    rangeText: `About ${r.low_pips}\u2013${r.high_pips} pips over ${dayWord(r.horizon)}.`,
    recordText,
    smallSample,
  };
}

function shapePattern(
  evaluation: PairEvaluationRow | undefined,
  firing: FiringSetupRow | undefined,
): PatternCallVM {
  if (firing !== undefined && firing.surfaced) {
    const directionLabel = formatDirection(firing.direction);
    const confidenceText = formatConfidence(firing.earned_confidence);
    return {
      fired: true,
      direction: firing.direction,
      directionLabel,
      horizon: firing.horizon,
      confidenceText,
      text: `Pattern engine fired: ${directionLabel}, ${confidenceText} confidence, ${dayWord(firing.horizon)} horizon.`,
    };
  }
  return {
    fired: false,
    direction: null,
    directionLabel: "",
    horizon: evaluation?.horizon ?? null,
    confidenceText: evaluation === undefined ? "" : formatConfidence(evaluation.earned_confidence),
    text: "Pattern engine did not fire for this pair.",
  };
}

export function shapePairSummary(
  pair: string,
  evaluations: readonly PairEvaluationRow[],
  firingSetups: readonly FiringSetupRow[],
  decisionDate: string,
  track: TrackRecord,
): PairSummaryVM {
  const evaluation = evaluations.find((e) => e.pair === pair && e.decision_date === decisionDate);
  const firing = firingSetups.find((f) => f.pair === pair && f.decision_date === decisionDate);
  return {
    pair,
    pattern: shapePattern(evaluation, firing),
    candleSize: shapeCandleSize(evaluation, pair, track),
  };
}
