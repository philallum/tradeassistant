/**
 * Pure selection helper for the Gate tab.
 *
 * The `/gate-verdicts` endpoint returns a bounded set of persisted gate verdict rows
 * (cross-config, not pair-scoped — design Category_Tab mapping). The Gate tab surfaces the
 * MOST RECENT verdict as its headline PASS/CUT visual. This helper selects that row purely
 * (deterministic over its argument, order- and duplicate-independent) by the persisted
 * `created_at` timestamp — it SELECTS an existing row, it never derives or fabricates one
 * (Req 9.10, 20.1).
 *
 * Pure: no `fetch`, no DOM, no clock. Property-testable in spirit (Req 19).
 */

import type { GateVerdictRow } from "../../api/endpoints";

/**
 * Return the gate verdict row with the latest persisted `created_at`, or `null` when the
 * input is empty. On a tie (equal `created_at`) the first such row encountered is kept, so
 * the result is a verbatim element of the input and never a synthesized value. The input is
 * not mutated.
 */
export function selectLatestVerdict(
  rows: readonly GateVerdictRow[],
): GateVerdictRow | null {
  let latest: GateVerdictRow | null = null;
  for (const row of rows) {
    if (latest === null || row.created_at > latest.created_at) {
      latest = row;
    }
  }
  return latest;
}
