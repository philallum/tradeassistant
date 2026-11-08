// Boundary tests for the single firing predicate (codebase-housekeeping Task 2).
//
// `fires` is the ONE definition of the firing rule. These tests pin its boundary behaviour
// (exact threshold, FLAT, custom threshold) and prove that every consumer that decides "did
// this pair fire?" agrees with it: the dashboard view, the persisted rows, the snapshot's
// per-pair rows and the daily-note input.

import { describe, expect, it } from "vitest";

import type { Confidence } from "../confidence/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import { pairEvaluationRows } from "../scheduled-run/snapshot.js";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  dailyRun,
  fires,
  InMemoryFiringSetupStore,
  persistFiringSetups,
  type PairEvaluation,
} from "./index.js";

const DECISION_DATE = "2024-03-15";

function evaluation(
  direction: DirectionClass,
  confidence: number,
  pair: PairEvaluation["pair"] = "EURUSD",
): PairEvaluation {
  return {
    pair,
    earnedConfidence: confidence as Confidence,
    direction,
    horizon: 1,
    excursionProfile: { favorablePips: 30, adversePips: 10 },
    stopLossPips: 10,
    takeProfitPips: 30,
    choppiness: 0.5,
    rationale: "",
    analogueLabels: [],
  };
}

describe("fires: the single firing predicate", () => {
  it("uses 0.55 as the default threshold", () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.55);
  });

  it("fires at exactly the threshold (inclusive) and not just below it", () => {
    expect(fires(evaluation("UP", 0.55), 0.55)).toBe(true);
    expect(fires(evaluation("UP", 0.5499999), 0.55)).toBe(false);
  });

  it("never fires a FLAT pair, however high its confidence", () => {
    expect(fires(evaluation("FLAT", 0.99), 0.55)).toBe(false);
  });

  it("fires both directions symmetrically", () => {
    expect(fires(evaluation("UP", 0.6), 0.55)).toBe(true);
    expect(fires(evaluation("DOWN", 0.6), 0.55)).toBe(true);
  });

  it("honours a custom threshold", () => {
    const ev = evaluation("DOWN", 0.6);
    expect(fires(ev, 0.55)).toBe(true);
    expect(fires(ev, 0.6)).toBe(true);
    expect(fires(ev, 0.61)).toBe(false);
  });
});

describe("every consumer agrees with fires()", () => {
  // A spread of cases straddling the default threshold, in the canonical pair order.
  const evaluations: readonly PairEvaluation[] = [
    evaluation("UP", 0.55, "EURUSD"), // exactly at threshold -> fires
    evaluation("DOWN", 0.54, "GBPUSD"), // just below -> silent
    evaluation("FLAT", 0.9, "USDJPY"), // FLAT -> silent
    evaluation("DOWN", 0.7, "USDCHF"), // above -> fires
    evaluation("UP", 0.5, "USDCAD"), // neutral prior -> silent
  ];

  for (const threshold of [DEFAULT_CONFIDENCE_THRESHOLD, 0.6, 0.7]) {
    it(`dashboard view, persisted rows and snapshot rows match at threshold ${threshold}`, async () => {
      const expected = evaluations.filter((ev) => fires(ev, threshold)).map((ev) => ev.pair);

      const view = dailyRun(DECISION_DATE, evaluations, { confidenceThreshold: threshold });
      expect(view.cards.map((c) => c.pair)).toEqual(expected);

      const snapshotFired = pairEvaluationRows(DECISION_DATE, evaluations, threshold)
        .filter((row) => row.fired)
        .map((row) => row.pair);
      expect(snapshotFired).toEqual(expected);

      const rows = await persistFiringSetups(new InMemoryFiringSetupStore(), view, evaluations, {
        config: { confidenceThreshold: threshold },
      });
      const notFired = rows.filter((r) => r.suppressionReason === "not_fired").map((r) => r.pair);
      expect(notFired.sort()).toEqual(
        evaluations
          .filter((ev) => !fires(ev, threshold))
          .map((ev) => ev.pair)
          .sort(),
      );
    });
  }
});
