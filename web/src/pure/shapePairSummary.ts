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
  /** "about 60-95 pips over the session after 2026-11-11" or the reason it is absent. */
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
  /** One line: "Pattern engine fired: Up for the session after 2026-11-11. Historically, 57 of 100 similar setups moved this way (shrunk toward 50)." or "did not fire". */
  readonly text: string;
  /**
   * How many similar past days the call rests on, e.g. "Based on 5 similar past days (a small
   * sample; 30 or more is more reliable)." Null when the pair did not fire or n was not recorded.
   * Shown, not enforced: whether firing should require a minimum n is still an open decision.
   */
  readonly basisText: string | null;
}

export interface PairSummaryVM {
  readonly pair: string;
  readonly pattern: PatternCallVM;
  readonly candleSize: CandleSizeVM;
}

/**
 * Horizon wording. The engine is horizon-1 in practice (R1), and the stored outcome measures the
 * first session strictly AFTER the Decision_Date (the date's own session is in neither the
 * features nor the label), so the copy names that date instead of saying "the next session".
 */
const sessionWord = (h: number, decisionDate: string): string =>
  h === 1 ? `the session after ${decisionDate}` : `the ${h} sessions after ${decisionDate}`;

/**
 * Plain-language confidence: Earned_Confidence is a shrunk historical rate, NOT a win
 * probability, so it is phrased as "N of 100 similar setups moved this way".
 */
/** Below this many similar past days a call is flagged as a small sample (mirrors the engine's 30). */
export const SMALL_NEIGHBOURHOOD = 30;

/** Neighbourhood size n in plain words; flags a small sample below the reliability mark. */
export function basisText(n: number | null): string | null {
  if (n === null || !Number.isFinite(n) || n < 0) return null;
  const days = `${n} similar past ${n === 1 ? "day" : "days"}`;
  return n < SMALL_NEIGHBOURHOOD
    ? `Based on ${days} (a small sample; ${SMALL_NEIGHBOURHOOD} or more is more reliable).`
    : `Based on ${days}.`;
}

export function historicalRateText(confidence: number): string {
  return `Historically, ${Math.round(confidence * 100)} of 100 similar setups moved this way (shrunk toward 50).`;
}

function shapeCandleSize(
  evaluation: PairEvaluationRow | undefined,
  pair: string,
  track: TrackRecord,
  decisionDate: string,
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
    rangeText: `About ${r.low_pips}\u2013${r.high_pips} pips over ${sessionWord(r.horizon, decisionDate)}.`,
    recordText,
    smallSample,
  };
}

function shapePattern(
  evaluation: PairEvaluationRow | undefined,
  firing: FiringSetupRow | undefined,
  decisionDate: string,
  analogueCount: number | null,
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
      text: `Pattern engine fired: ${directionLabel} for ${sessionWord(firing.horizon, decisionDate)}. ${historicalRateText(firing.earned_confidence)}`,
      basisText: basisText(analogueCount),
    };
  }
  return {
    fired: false,
    direction: null,
    directionLabel: "",
    horizon: evaluation?.horizon ?? null,
    confidenceText: evaluation === undefined ? "" : formatConfidence(evaluation.earned_confidence),
    text: "Pattern engine did not fire for this pair.",
    basisText: null,
  };
}

export function shapePairSummary(
  pair: string,
  evaluations: readonly PairEvaluationRow[],
  firingSetups: readonly FiringSetupRow[],
  decisionDate: string,
  track: TrackRecord,
  analogueCount: number | null = null,
): PairSummaryVM {
  const evaluation = evaluations.find((e) => e.pair === pair && e.decision_date === decisionDate);
  const firing = firingSetups.find((f) => f.pair === pair && f.decision_date === decisionDate);
  return {
    pair,
    pattern: shapePattern(evaluation, firing, decisionDate, analogueCount),
    candleSize: shapeCandleSize(evaluation, pair, track, decisionDate),
  };
}
