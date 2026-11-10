import { describe, expect, it } from "vitest";

import type { AnalogueRecord } from "../../retrieval/types.js";
import { atrSimilarityFilter, renderAtrLines, runAtrFilterExperiment } from "./atrFilterExperiment.js";

function analogue(atr14: number, date = "2020-01-02"): AnalogueRecord {
  return { asset: "EURUSD", decisionDate: date, horizon: 1, direction: "UP", mfePips: 5, maePips: 3, atr14, matured: true };
}
const ctx = (atr14: number) => ({ pair: "EURUSD" as const, date: "2024-03-04", atr14 });

describe("atrSimilarityFilter", () => {
  it("keeps neighbours within the ratio band in either direction and drops the rest", () => {
    const filter = atrSimilarityFilter(1.5);
    const kept = filter([analogue(0.006), analogue(0.0045), analogue(0.009), analogue(0.0039), analogue(0.0091)], ctx(0.006));
    expect(kept.map((a) => a.atr14)).toEqual([0.006, 0.0045, 0.009]);
  });

  it("only ever removes neighbours (never adds or reorders)", () => {
    const input = [analogue(0.001, "2019-01-01"), analogue(0.006, "2019-01-02"), analogue(0.006, "2019-01-03")];
    const out = atrSimilarityFilter(2)(input, ctx(0.006));
    expect(out.every((a) => input.includes(a))).toBe(true);
    expect(out.map((a) => a.decisionDate)).toEqual(["2019-01-02", "2019-01-03"]);
  });

  it("leaves the neighbourhood untouched when today's ATR is unknown", () => {
    const input = [analogue(0.006)];
    expect(atrSimilarityFilter(1.25)(input, ctx(0))).toBe(input);
  });

  it("rejects a ratio below 1", () => {
    expect(() => atrSimilarityFilter(0.9)).toThrow();
  });
});

describe("experiment guards", () => {
  it("refuses a window that overlaps the confirmation holdout", async () => {
    await expect(
      runAtrFilterExperiment({ dataDir: "x", window: { start: "2024-01-01", end: "2025-06-30" }, log: () => undefined }),
    ).rejects.toThrow(/holdout/);
  });

  it("renders verdict-free lines", () => {
    const lines = renderAtrLines(
      [{ id: "off", maxRatio: null, records: 1, directionalDays: 1, firingDays: 1, meanNeighbourhood: 80, directionalDelta: 0.01, directionalModelRate: 0.5, directionalScored: 1, firingDelta: 0, firingModelRate: 0.5, firingScored: 1, netPipsDirectional: -1, netPipsFiring: -1 }],
      { start: "2013-06-01", end: "2024-12-31" },
    );
    expect(lines.join("\n")).not.toMatch(/PASS|CUT|KILL/);
  });
});
