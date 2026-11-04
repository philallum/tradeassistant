/**
 * Pure shaper for the footer "System record": how often the pattern engine was right over the
 * latest out-of-sample evaluation, next to the naive weekly-trend baseline it is measured
 * against. It replaces the old single "Backtest edge" pill, which showed one difference in
 * percentage points with no context.
 *
 * Pure: no fetch, DOM, clock, or core import. Values are copied from the stored evaluation
 * report; it recomputes nothing and states plainly when there is no report.
 */
import type { EvaluationReportRow } from "../api/types";

export interface SystemRecordVM {
  readonly available: boolean;
  /** "System record: 50.0% right vs 48.7% naive over 28,470 forecasts." */
  readonly text: string;
  /** Extra caution line, e.g. when the lead over the naive baseline is under 3 points. */
  readonly caution: string | null;
}

/** The lead (in points) below which the record is described as essentially level. */
export const MEANINGFUL_LEAD_POINTS = 3;

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

export function shapeSystemRecord(report: EvaluationReportRow | null): SystemRecordVM {
  if (report === null) {
    return { available: false, text: "System record: not measured yet.", caution: null };
  }
  const forecasts = report.predictions_count.toLocaleString("en-US");
  const leadPoints = (report.model_accuracy - report.baseline_accuracy) * 100;
  const caution =
    Math.abs(leadPoints) < MEANINGFUL_LEAD_POINTS
      ? `Within ${MEANINGFUL_LEAD_POINTS} points of the naive baseline, so treat the system as roughly level with it.`
      : null;
  return {
    available: true,
    text: `System record: ${pct(report.model_accuracy)} right vs ${pct(report.baseline_accuracy)} naive over ${forecasts} forecasts.`,
    caution,
  };
}
