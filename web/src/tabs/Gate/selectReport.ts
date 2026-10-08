/**
 * Pure selection helper for the Evaluation (Gate) tab.
 *
 * Under the de-scope the former PASS/CUT gate verdict is gone (R1): the tab now surfaces the
 * most recent human-read EVALUATION REPORT — the Measurement_Engine's metrics over an
 * out-of-sample split, carrying NO verdict (R1.3). The snapshot's `evaluationReports` slice
 * holds a bounded set of such rows (cross-config, not pair-scoped); this helper SELECTS the
 * latest by its test-window end, verbatim — it never derives or fabricates one.
 *
 * Pure: no `fetch`, no DOM, no clock. Property-testable in spirit (Req 19).
 */

import type { EvaluationReportRow } from "../../api/types";

/**
 * Return the evaluation-report row with the latest `split_test_end`, or `null` when the
 * input is empty. On a tie the first such row encountered is kept, so the result is a
 * verbatim element of the input and never a synthesized value. The input is not mutated.
 */
export function selectLatestReport(
  rows: readonly EvaluationReportRow[],
): EvaluationReportRow | null {
  let latest: EvaluationReportRow | null = null;
  for (const row of rows) {
    if (latest === null || row.split_test_end > latest.split_test_end) {
      latest = row;
    }
  }
  return latest;
}
