// Unit test: the Confidence_Threshold is configurable and tunable (Requirement 16.4).
//
// The dashboard fires a pair only when its Earned_Confidence is at or above the
// configurable Confidence_Threshold (Requirements 16.2, 16.4, 1.1). This test
// holds the gate / news / direction constant and varies ONLY the threshold on
// `DashboardConfig.confidenceThreshold`, showing that the same pair surfaces at
// a lower threshold and is silenced at a higher one — i.e. the threshold is a
// real, tunable knob rather than a hard-coded constant.

import { describe, expect, it } from "vitest";

import { dailyRun, type PairEvaluation } from "./index.js";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_DASHBOARD_CONFIG,
  type DashboardConfig,
} from "./index.js";
import type { Confidence } from "../confidence/types.js";

const DECISION_DATE = "2024-03-15";

/**
 * A single directional pair whose Earned_Confidence (0.6) sits between two
 * candidate thresholds. Everything except the threshold is held constant across
 * the assertions below. There is no suppression step, so surfacing turns purely
 * on the confidence vs. the threshold.
 */
function pairAtConfidence(earned: number): PairEvaluation {
  return {
    pair: "EURUSD",
    earnedConfidence: earned as Confidence,
    direction: "UP",
    horizon: 2,
    excursionProfile: { favorablePips: 40, adversePips: 15 },
    stopLossPips: 15,
    takeProfitPips: 40,
    choppiness: 0.8,
    rationale: "analogues resolved up",
    analogueLabels: ["trend-continuation"],
  };
}

function configWithThreshold(confidenceThreshold: number): DashboardConfig {
  return { ...DEFAULT_DASHBOARD_CONFIG, confidenceThreshold };
}

describe("Confidence_Threshold is configurable (Requirement 16.4)", () => {
  it("surfaces a 0.6-confidence pair at threshold 0.55 but not at 0.70", () => {
    const evaluations = [pairAtConfidence(0.6)];

    const lowered = dailyRun(DECISION_DATE, evaluations, configWithThreshold(0.55));
    const raised = dailyRun(DECISION_DATE, evaluations, configWithThreshold(0.7));

    // Lower threshold: the pair clears the bar and fires.
    expect(lowered.cards).toHaveLength(1);
    expect(lowered.cards[0]?.pair).toBe("EURUSD");

    // Higher threshold: the identical pair no longer clears the bar — silent.
    expect(raised.cards).toHaveLength(0);
  });

  it("fires exactly at the threshold boundary (>=) and stays silent just below", () => {
    const evaluations = [pairAtConfidence(0.6)];

    // Earned_Confidence == threshold ⇒ fires (inclusive lower bound).
    const atBoundary = dailyRun(DECISION_DATE, evaluations, configWithThreshold(0.6));
    expect(atBoundary.cards).toHaveLength(1);

    // Threshold a hair above the pair's confidence ⇒ silent.
    const justAbove = dailyRun(DECISION_DATE, evaluations, configWithThreshold(0.6001));
    expect(justAbove.cards).toHaveLength(0);
  });

  it("uses the shared default Confidence_Threshold when no override is given", () => {
    // A pair just under the default default threshold stays silent by default...
    const belowDefault = dailyRun(DECISION_DATE, [
      pairAtConfidence(DEFAULT_CONFIDENCE_THRESHOLD - 0.01),
    ]);
    expect(belowDefault.cards).toHaveLength(0);

    // ...but the same pair surfaces once the threshold is tuned down to it.
    const tunedDown = dailyRun(
      DECISION_DATE,
      [pairAtConfidence(DEFAULT_CONFIDENCE_THRESHOLD - 0.01)],
      configWithThreshold(DEFAULT_CONFIDENCE_THRESHOLD - 0.01),
    );
    expect(tunedDown.cards).toHaveLength(1);
  });
});
