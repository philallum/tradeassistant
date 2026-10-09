/**
 * Pure run-completion summary shaper (property-testable — Req 19 spirit).
 *
 * This module is PURE: no `fetch`, no DOM, no clock (`Date.now()`), and it imports NOTHING
 * from the deterministic core (`src/`). It is a deterministic function of its inputs alone.
 *
 * It turns the snapshot's `pairEvaluations` slice (every pair the run evaluated on a
 * Decision_Date, fired or not — schema v2) into the view model the Setups tab's SILENT
 * (no-fire) state renders as a CREDIBLE RUN-COMPLETION SUMMARY: proof the run actually
 * executed and evaluated all five pairs, with each pair's deterministic direction, earned
 * confidence (and how far it sat from the firing threshold), and displayed choppiness. This
 * replaces the ambiguous bare "No setups fired" notice — which could not be told apart from
 * a broken or absent run — with an affirmative "run completed, nothing met the threshold"
 * readout. Every value is copied VERBATIM from the persisted row; nothing is recomputed
 * except the display-only `gapToThreshold` (a simple subtraction) and the counts.
 */

import type { PairEvaluationRow } from "../api/types.ts";

/** The firing Confidence_Threshold the SPA renders against. Mirrors the core default (0.55). */
export const CONFIDENCE_THRESHOLD = 0.55 as const;

/** The system's own deterministic Direction_Class. */
export type RunDirection = "UP" | "DOWN" | "FLAT";

/** One pair's row in the run-completion readout, all values verbatim from the snapshot. */
export interface RunSummaryPair {
  readonly pair: string;
  readonly direction: RunDirection;
  readonly horizon: number;
  readonly earnedConfidence: number;
  readonly fired: boolean;
  readonly choppiness: number;
  /**
   * Signed distance of `earnedConfidence` from {@link CONFIDENCE_THRESHOLD}
   * (`earnedConfidence - threshold`): negative is a near/far miss, ≥ 0 cleared the bar.
   * Display-only — it shows HOW CLOSE a non-firing pair came, nothing more.
   */
  readonly gapToThreshold: number;
}

/**
 * The run-completion summary for one Decision_Date.
 *
 * - `present` is false when the run supplied no `pairEvaluations` (an older v1 snapshot, or
 *   a run that could not compute any evaluation): the UI then falls back to the plain
 *   "no setups fired" message rather than an empty table.
 * - `evaluatedCount` / `firedCount` are the headline counts ("evaluated 5 pairs, 0 fired").
 * - `pairs` is one {@link RunSummaryPair} per evaluated pair, ordered by the input order.
 */
export interface RunSummaryViewModel {
  readonly present: boolean;
  readonly decisionDate: string | null;
  readonly evaluatedCount: number;
  readonly firedCount: number;
  readonly threshold: number;
  readonly pairs: readonly RunSummaryPair[];
}

const ABSENT: RunSummaryViewModel = {
  present: false,
  decisionDate: null,
  evaluatedCount: 0,
  firedCount: 0,
  threshold: CONFIDENCE_THRESHOLD,
  pairs: [],
};

/**
 * Shape the `pairEvaluations` rows for a Decision_Date into a {@link RunSummaryViewModel}.
 *
 * `rows` should already be the slice for the browsed Decision_Date (the caller filters by
 * `decision_date`, consistent with the other tabs). Returns an absent model when `rows` is
 * empty so the Setups tab keeps its plain silent message in that case. Otherwise projects
 * each row verbatim, computes the display-only `gapToThreshold`, and tallies the counts.
 * Pure and total over every input; order-preserving (the snapshot writer emits canonical
 * PAIRS order).
 *
 * @param rows      The `pairEvaluations` rows for the browsed Decision_Date.
 * @param threshold The firing Confidence_Threshold to measure the gap against. Defaults to
 *                  {@link CONFIDENCE_THRESHOLD}; injectable so a future configurable
 *                  threshold stays in lockstep with the writer.
 */
export function shapeRunSummary(
  rows: readonly PairEvaluationRow[],
  threshold: number = CONFIDENCE_THRESHOLD,
): RunSummaryViewModel {
  if (rows.length === 0) {
    return ABSENT;
  }

  const pairs: RunSummaryPair[] = rows.map((row) => ({
    pair: row.pair,
    direction: row.direction,
    horizon: row.horizon,
    earnedConfidence: row.earned_confidence,
    fired: row.fired,
    choppiness: row.choppiness,
    gapToThreshold: row.earned_confidence - threshold,
  }));

  return {
    present: true,
    decisionDate: rows[0]?.decision_date ?? null,
    evaluatedCount: pairs.length,
    firedCount: pairs.reduce((n, p) => (p.fired ? n + 1 : n), 0),
    threshold,
    pairs,
  };
}
