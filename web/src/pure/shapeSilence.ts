/**
 * Pure shaper for the "why is this pair silent?" line.
 *
 * Silence is information, not a broken system. The backend's v9 `runHealth` slice names ONE
 * reason per silent pair; for a pre-v9 snapshot the same reasons that are knowable from
 * `pairEvaluations` (no directional view, below the firing line) are derived here. A pair that
 * fired has no silence line. Display only: nothing here re-enters any decision.
 */
import type { PairEvaluationRow, RunHealth, SilenceReason } from "../api/types";

export interface SilenceVM {
  readonly reason: SilenceReason;
  /** One plain sentence, e.g. "Few similar past setups were found (12; 30 or more is more reliable)." */
  readonly text: string;
}

/** The neighbourhood size from which a reading is considered reasonably reliable (mirrors SAMPLE_SIZE_FLOOR; not a firing gate). */
export const NEIGHBOURHOOD_FLOOR = 30;

function thresholdPct(threshold: number): string {
  return `${Math.round(threshold * 100)}%`;
}

function describe(
  reason: SilenceReason,
  n: number | null,
  confidence: number | null,
  threshold: number,
): string {
  switch (reason) {
    case "DATA_BEHIND":
      return "Recent price data was behind when this ran, so no call is made for this pair today.";
    case "THIN_NEIGHBOURHOOD":
      return n === null
        ? "Few similar past setups were found, so any reading would be unreliable."
        : `Few similar past setups were found (${n}; ${NEIGHBOURHOOD_FLOOR} or more is more reliable).`;
    case "NO_DIRECTIONAL_VIEW":
      return "Similar past setups split evenly or went nowhere, so there is no directional view.";
    case "BELOW_THRESHOLD":
      return confidence === null
        ? `Confidence is below the ${thresholdPct(threshold)} line needed to show a call.`
        : `Confidence is ${thresholdPct(confidence)}, below the ${thresholdPct(threshold)} line needed to show a call.`;
  }
}

/** Null when the pair fired or no reason can be determined. */
export function shapeSilence(
  pair: string,
  decisionDate: string,
  evaluations: readonly PairEvaluationRow[],
  runHealth: RunHealth,
): SilenceVM | null {
  const evaluation = evaluations.find((e) => e.pair === pair && e.decision_date === decisionDate);
  if (evaluation?.fired === true) return null;

  const row = runHealth.rows.find((r) => r.pair === pair);
  const confidence = evaluation?.earned_confidence ?? null;
  if (row !== undefined) {
    if (row.silence_reason === null) return null;
    return {
      reason: row.silence_reason,
      text: describe(row.silence_reason, row.analogue_count, confidence, runHealth.confidenceThreshold),
    };
  }
  // Pre-v9 snapshot: derive only what the older slices can support.
  if (evaluation === undefined) return null;
  const reason: SilenceReason = evaluation.direction === "FLAT" ? "NO_DIRECTIONAL_VIEW" : "BELOW_THRESHOLD";
  return { reason, text: describe(reason, null, confidence, runHealth.confidenceThreshold) };
}
