/**
 * Pure shaper for the single Backtest_Edge_Pill on the Master_Card (Req 8.4, 8.5, 8.6).
 *
 * Pure: no fetch, DOM, clock, or core import. It recomputes nothing and fabricates nothing:
 * with no persisted report the pill is unavailable (`edgeText` is ""), otherwise the text is
 * the existing `formatDeltaPp` rendering of the stored `delta_vs_baseline`.
 *
 * Choosing the latest report stays in `tabs/Gate/selectReport.ts` (`selectLatestReport`).
 */
import type { EvaluationReportRow } from "../api/types";
import { formatDeltaPp } from "../tabs/Gate/format";

/** View model for the backtest-edge pill. */
export interface BacktestEdgePillVM {
  /** False if and only if there is no evaluation report. */
  readonly available: boolean;
  /** Formatted delta vs baseline, or "" when unavailable. */
  readonly edgeText: string;
}

/** Shape a (possibly absent) evaluation report into the pill view model. */
export function shapeBacktestEdge(
  report: EvaluationReportRow | null,
): BacktestEdgePillVM {
  if (report === null) {
    return { available: false, edgeText: "" };
  }
  return { available: true, edgeText: formatDeltaPp(report.delta_vs_baseline) };
}
