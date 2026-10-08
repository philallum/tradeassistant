// Unit test for the scheduled-run container entry (task 6.2;
// simplify-to-cloud-minimal Requirements 3.5, 3.6).
//
// FIRING PRECONDITION (Req 3.5, 3.6): the `fires()` predicate in
// `src/dashboard/dashboard.ts` is byte-for-byte
// `direction !== "FLAT" && earnedConfidence >= confidenceThreshold`. There is
// NO suppression step: the former Gate_Auto_Block (gatePassing) and the news
// suppressor (newsSuppressed) have both been removed, so a pair's observation
// is driven purely by its deterministic direction and Earned_Confidence. We
// assert that exact source text is present AND confirm the behaviour with a
// truth table over `dailyRun` (which fires a card ONLY when both conditions
// hold, and records an explicit "no trade" otherwise).
//
// (The gate-passing resolver and its wiring in `main.ts` were removed by the
// cloud-minimal simplification — the daily run no longer injects a `gatePassing`
// resolver — so the former wiring assertion no longer applies.)
//
// Importing `main.ts` must NOT start a run: its top-level `main()` is guarded by
// the `invokedDirectly()` entry-point check (mirroring `src/ops/seed-run/main.ts`),
// so under vitest (where `process.argv[1]` is the test runner) it stays dormant.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { dailyRun, type PairEvaluation } from "../dashboard/index.js";
import type { Confidence } from "../confidence/types.js";

// --- Firing precondition is byte-for-byte the two-condition predicate (Req 3.5) ---

const HERE = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SOURCE = readFileSync(
  join(HERE, "..", "dashboard", "dashboard.ts"),
  "utf8",
);

/**
 * The exact firing precondition the design freezes (Req 3.5, 3.6): a two-
 * condition predicate with NO suppression step. This string is compared against
 * the live `fires()` body source, so re-introducing a gate / news suppressor —
 * or otherwise relaxing / re-implementing the predicate — fails the test.
 */
const FROZEN_FIRING_PREDICATE = [
  'evaluation.direction !== "FLAT" &&',
  "    evaluation.earnedConfidence >= confidenceThreshold",
].join("\n");

describe("fires() firing precondition is the two-condition predicate (Req 3.5, 3.6)", () => {
  it("the fires() source contains the byte-for-byte two-condition predicate", () => {
    expect(DASHBOARD_SOURCE).toContain(FROZEN_FIRING_PREDICATE);
  });

  // No suppression fields remain on the firing path: the frozen predicate — and
  // the PairEvaluation shape it reads — carry neither a gate nor a news flag.
  it("the fires() source no longer references any suppression flag", () => {
    expect(DASHBOARD_SOURCE).not.toContain("gatePassing");
    expect(DASHBOARD_SOURCE).not.toContain("newsSuppressed");
  });

  // Behavioural truth table over dailyRun: a card renders iff BOTH conditions
  // hold, and NOT when either one fails. This confirms the predicate's meaning
  // end-to-end without re-implementing it.
  const DECISION_DATE = "2024-03-15";
  const THRESHOLD = 0.55 as Confidence; // DEFAULT_CONFIDENCE_THRESHOLD

  function evalWith(overrides: Partial<PairEvaluation>): PairEvaluation {
    return {
      pair: "EURUSD",
      direction: "UP",
      earnedConfidence: 0.9 as Confidence,
      horizon: 2,
      excursionProfile: { favorablePips: 40, adversePips: 15 },
      stopLossPips: 15,
      takeProfitPips: 40,
      choppiness: 0.8,
      rationale: "r",
      analogueLabels: ["a"],
      ...overrides,
    };
  }

  function firesViaDashboard(evaluation: PairEvaluation): boolean {
    return dailyRun(DECISION_DATE, [evaluation]).cards.length === 1;
  }

  it("fires when both conditions hold", () => {
    expect(firesViaDashboard(evalWith({}))).toBe(true);
  });

  it("does NOT fire when direction is FLAT — the pair is an explicit 'no trade' observation", () => {
    // The pair is not suppressed; it simply expresses no directional view, so
    // the dashboard renders no directional card for it (Req 3.5).
    expect(firesViaDashboard(evalWith({ direction: "FLAT" }))).toBe(false);
  });

  it("does NOT fire when confidence is below the threshold", () => {
    expect(
      firesViaDashboard(
        evalWith({ earnedConfidence: (THRESHOLD - 0.01) as Confidence }),
      ),
    ).toBe(false);
  });

  it("fires at exactly the threshold (>= boundary)", () => {
    expect(
      firesViaDashboard(
        evalWith({ earnedConfidence: THRESHOLD }),
      ),
    ).toBe(true);
  });
});
