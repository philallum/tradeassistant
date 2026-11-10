// Evidence protocol — the pre-registered, committed rules for how results are judged.
//
// Pure constants only (no clock, network or randomness). Nothing here feeds firing,
// confidence or scoring; it exists so that (a) the live forward evaluation has a declared
// start and frozen parameters, (b) there is an untouched confirmation period, and (c) the
// slice dimensions and questions tested are written down BEFORE any slicing is run, so a
// spurious pocket cannot be presented as a discovery.
import type { ParameterSet } from "./parameterSet.js";

/**
 * Date on which live forward evaluation begins with {@link FORWARD_TEST_PARAMETERS} frozen.
 * Any later change to a pinned parameter must reset this date (and the guard test that
 * pins the parameters must be edited in the same change, which makes the reset visible).
 * Proposed and CONFIRMED by the operator on 2026-11-10. It may move later, never earlier than a
 * run that used the pinned parameters.
 */
export const FORWARD_TEST_START = "2026-11-11" as const;

/** The parameter set frozen for the forward test (a verbatim copy of the live constants). */
export const FORWARD_TEST_PARAMETERS: ParameterSet = {
  patternScales: [10, 20, 40],
  similarityEpsilon: 0.2,
  retrievalK: 200,
  windowSize: 60,
  analogueFloor: 30,
  weeklyTrendFilter: false,
  shrinkageWeight: 10,
  confidenceThreshold: 0.55,
  horizonSelection: "best_resolution",
  stopLossPercentile: 75,
  takeProfitPercentile: 50,
} as const;

/** An inclusive calendar-date span (YYYY-MM-DD). */
export interface ProtocolWindow {
  readonly start: string;
  readonly end: string;
}

/**
 * Discovery period: any slicing, pocket-hunting or parameter study may use dates up to and
 * including this window's end. It starts where the first walk-forward test window can begin
 * (3 years of history after the 2010 CSV start) and ends with 2024. The recorded evaluation
 * pools walk-forward test windows over this whole span (its "2024 split" label is a tag only),
 * so all of it counts as seen.
 */
export const DISCOVERY_WINDOW: ProtocolWindow = { start: "2013-06-01", end: "2024-12-31" };

/**
 * Confirmation holdout: UNTOUCHED. A pocket found in the discovery period is only reported
 * as confirmed if it also holds here. It starts after the seen 2024 year and ends with the
 * vendor-consistent CSV history (data/*_D1.csv ends 2026-09-15), before the partial-bar
 * period of live ingestion. Consult it once per hypothesis, after the hypothesis is written.
 */
export const CONFIRMATION_HOLDOUT: ProtocolWindow = { start: "2025-01-02", end: "2026-09-15" };

/** Slice dimensions registered in advance. Adding a dimension later must be logged as exploratory. */
export const PRE_REGISTERED_SLICE_DIMENSIONS = [
  "pair",
  "direction",
  "confidenceBand",
  "neighbourhoodSize",
  "meanCosineDistance",
  "atrPercentileBucket",
  "weekday",
] as const;

export type PreRegisteredSliceDimension = (typeof PRE_REGISTERED_SLICE_DIMENSIONS)[number];

/** Questions registered in advance; each is answered once by the named measurement. */
export const PRE_REGISTERED_QUESTIONS = [
  {
    id: "confluence-adds-information",
    question:
      "Does an ALIGNED_* confluence status together with a firing pattern signal resolve better than the firing pattern signal alone?",
    measuredBy: "signal_predictions + realized_outcomes (read-only join)",
  },
  {
    id: "intraday-delta-adds-information",
    question:
      "Do STRONGLY_SUPPORTS days resolve better than CONTRADICTS days for the daily direction?",
    measuredBy: "intraday_validations joined to realized outcomes (read-only)",
  },
  {
    id: "flat-definition",
    question:
      "Does the ATR-band FLAT definition beat the sign-based definition against the same baseline on the same windows?",
    measuredBy: "edge-eval offline A/B (Task 5); live behaviour unchanged until the operator decides",
  },
] as const;

/** True when `date` lies inside the (inclusive) window. ISO dates compare lexicographically. */
export function inWindow(date: string, window: ProtocolWindow): boolean {
  return date >= window.start && date <= window.end;
}

/** True when two inclusive windows share at least one date. */
export function windowsOverlap(a: ProtocolWindow, b: ProtocolWindow): boolean {
  return a.start <= b.end && b.start <= a.end;
}
