import { describe, expect, it } from "vitest";

import type { PairEvaluationRow, RunHealth } from "../api/types";
import { shapeSilence } from "./shapeSilence";

const DATE = "2026-11-11";
function evalRow(over: Partial<PairEvaluationRow> = {}): PairEvaluationRow {
  return {
    decision_date: DATE,
    pair: "EURUSD",
    direction: "UP",
    horizon: 1,
    earned_confidence: 0.52,
    fired: false,
    choppiness: 0.4,
    ...over,
  };
}
const health = (rows: RunHealth["rows"]): RunHealth => ({ rows, degradedPairs: [], confidenceThreshold: 0.55 });

describe("shapeSilence", () => {
  it("a pair that fired has no silence line", () => {
    expect(shapeSilence("EURUSD", DATE, [evalRow({ fired: true })], health([]))).toBeNull();
  });

  it("explains each backend reason in plain words", () => {
    const run = (reason: RunHealth["rows"][number]["silence_reason"], n: number | null) =>
      shapeSilence("EURUSD", DATE, [evalRow()], health([{ pair: "EURUSD", analogue_count: n, data_behind: false, silence_reason: reason }]));
    expect(run("THIN_NEIGHBOURHOOD", 12)?.text).toBe("Few similar past setups were found (12; 30 or more is more reliable).");
    expect(run("BELOW_THRESHOLD", 90)?.text).toBe("Confidence is 52%, below the 55% line needed to show a call.");
    expect(run("NO_DIRECTIONAL_VIEW", 90)?.text).toContain("no directional view");
    expect(run("DATA_BEHIND", 90)?.text).toContain("behind");
  });

  it("falls back to what a pre-v9 snapshot can support", () => {
    const empty = health([]);
    expect(shapeSilence("EURUSD", DATE, [evalRow({ direction: "FLAT", earned_confidence: 0.5 })], empty)?.reason).toBe("NO_DIRECTIONAL_VIEW");
    expect(shapeSilence("EURUSD", DATE, [evalRow()], empty)?.reason).toBe("BELOW_THRESHOLD");
    expect(shapeSilence("EURUSD", DATE, [], empty)).toBeNull();
  });

  it("never claims a thin neighbourhood when the old snapshot cannot say so", () => {
    expect(shapeSilence("EURUSD", DATE, [evalRow()], health([]))?.reason).not.toBe("THIN_NEIGHBOURHOOD");
  });
});
