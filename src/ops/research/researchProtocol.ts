// Research programme protocol: "find and validate a conditional edge" (offline measurement only).
//
// Pure constants plus a holdout guard. Nothing here feeds firing, confidence or scoring.
//
// RELATION TO THE EXISTING PROTOCOL (src/walk-forward/evidenceProtocol.ts, left UNCHANGED):
//   - The existing untouched confirmation holdout is 2025-01-02..2026-09-15.
//   - This programme locks only its LAST 12 MONTHS (2025-09-16..2026-09-15) as the final holdout.
//     That is a strict subset of the existing holdout, so it is still untouched.
//   - 2025-01-02..2025-09-15 was never consulted and is released into this programme's
//     EXPLORATION window. Once looked at, it counts as seen.
//   - The existing DISCOVERY window (2013-06-01..2024-12-31) is already seen and stays so.
// The full written-down plan is docs/research/PRE-REGISTRATION.md; keep the two in step.
import {
  CONFIRMATION_HOLDOUT,
  DISCOVERY_WINDOW,
  windowsOverlap,
  type ProtocolWindow,
} from "../../walk-forward/evidenceProtocol.js";

/** Everything before the locked holdout. All slicing, pocket-hunting and variant work uses this only. */
export const RESEARCH_EXPLORATION_WINDOW: ProtocolWindow = {
  start: DISCOVERY_WINDOW.start,
  end: "2025-09-15",
};

/** The last 12 months of the vendor-consistent CSV history. Consulted once per frozen configuration. */
export const RESEARCH_HOLDOUT: ProtocolWindow = {
  start: "2025-09-16",
  end: CONFIRMATION_HOLDOUT.end,
};

/** A cell with fewer scored days than this is exploratory only and is never called significant. */
export const MIN_REPORTABLE_SCORED = 200;

/** False-discovery-rate level for Benjamini-Hochberg across each pre-registered family. */
export const FDR_Q = 0.1;

/** Block-bootstrap resamples (blocks are calendar weeks, which keeps the five pairs of a week together). */
export const BOOTSTRAP_ITERATIONS = 2000;

/** Fixed seed so the report is reproducible. */
export const BOOTSTRAP_SEED = 20261110;

/** Minimum years / pairs with data (>= MIN_STABILITY_SCORED scored days) for a stability count to mean anything. */
export const MIN_STABILITY_SCORED = 100;

/** Pre-registered hypotheses. Anything else examined is labelled exploratory in the report. */
export const RESEARCH_HYPOTHESES = [
  { id: "H1", family: "evidence-quality", statement: "Hit rate rises with analogue count n", test: "Spearman(n, hit) > 0" },
  { id: "H2", family: "evidence-quality", statement: "Hit rate falls as the nearest analogue gets farther", test: "Spearman(nearestDistance, hit) < 0" },
  { id: "H3", family: "evidence-quality", statement: "Hit rate falls as the mean analogue distance grows", test: "Spearman(meanDistance, hit) < 0" },
  { id: "H4", family: "calibration", statement: "Hit rate rises with Earned_Confidence", test: "Spearman(earnedConfidence, hit) > 0" },
  { id: "H5", family: "evidence-quality", statement: "Hit rate rises with raw analogue agreement", test: "Spearman(rawAgreement, hit) > 0" },
  { id: "H6", family: "evidence-quality", statement: "Hit rate rises with agreement among the closest 10 analogues (n >= 10)", test: "Spearman(closest10Agreement, hit) > 0" },
  { id: "H7", family: "confluence", statement: "Hit rate rises with the number of the four rule strategies that agree with the pattern call", test: "Spearman(agreeCount, hit) > 0" },
  { id: "H8", family: "confluence", statement: "Hit rate falls with the number of rule strategies that oppose the pattern call", test: "Spearman(opposeCount, hit) < 0" },
  { id: "H9", family: "regime", statement: "Hit rate differs with trend vs range (14-day efficiency ratio)", test: "Spearman(efficiencyRatio, hit) != 0" },
  { id: "H10", family: "regime", statement: "Hit rate differs with volatility regime (ATR percentile)", test: "Spearman(atrPercentile, hit) != 0" },
  { id: "H11", family: "intraday-4h", statement: "After a 4H SUPPORTS state, the move remaining after the 4H read agrees with the daily call more often than after CONTRADICTS", test: "difference in remaining-move hit rate > 0 (2021-2024 only)" },
] as const;

export type ResearchHypothesisId = (typeof RESEARCH_HYPOTHESES)[number]["id"];

/** The correlation hypotheses (H1-H10) form one Benjamini-Hochberg family; band cells form a second. */
export const CORRELATION_FAMILY_SIZE = 10;

export class HoldoutAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoldoutAccessError";
  }
}

/** Throw if a requested window reaches into the locked holdout. Returns the window when it does not. */
export function assertExplorationWindow(window: ProtocolWindow): ProtocolWindow {
  if (windowsOverlap(window, RESEARCH_HOLDOUT)) {
    throw new HoldoutAccessError(
      `window ${window.start}..${window.end} overlaps the locked holdout ${RESEARCH_HOLDOUT.start}..${RESEARCH_HOLDOUT.end}`,
    );
  }
  return window;
}

/** Throw if any dated row lies inside the locked holdout. Returns the rows when none does. */
export function assertNoHoldoutRows<T extends { readonly date: string }>(rows: readonly T[]): readonly T[] {
  const bad = rows.find((r) => r.date >= RESEARCH_HOLDOUT.start && r.date <= RESEARCH_HOLDOUT.end);
  if (bad !== undefined) {
    throw new HoldoutAccessError(`row dated ${bad.date} lies inside the locked holdout`);
  }
  return rows;
}
