import { describe, expect, it } from "vitest";

import type { DayRecord } from "./dayRecords.js";
import { MIN_CELL_SCORED, cellLabel, confirmPockets, sliceRecords } from "./slices.js";

function rec(over: Partial<DayRecord> = {}): DayRecord {
  return {
    pair: "EURUSD",
    date: "2024-03-04",
    weekday: 1,
    weeklyTrendSign: "DOWN",
    direction: "UP",
    horizon: 1,
    confidence: 0.6,
    fires: true,
    n: 80,
    meanCosineDistance: 0.12,
    atr14: 0.007,
    atrPercentile: 0.6,
    yesterdaySign: "UP",
    realizedAfter: { sign: "UP", pips: 20 },
    realizedOn: { sign: "DOWN", pips: -20 },
    ...over,
  };
}

describe("slices", () => {
  it("assigns each record to a cell for every pre-registered dimension", () => {
    const r = rec();
    expect(cellLabel(r, "pair")).toBe("EURUSD");
    expect(cellLabel(r, "direction")).toBe("UP");
    expect(cellLabel(r, "confidenceBand")).toBe("0.60-0.65");
    expect(cellLabel(r, "neighbourhoodSize")).toBe("n60-99");
    expect(cellLabel(r, "meanCosineDistance")).toBe("dist0.10-0.15");
    expect(cellLabel(r, "atrPercentileBucket")).toBe("atr-q3");
    expect(cellLabel(r, "weekday")).toBe("Mon");
    expect(cellLabel(rec({ meanCosineDistance: null }), "meanCosineDistance")).toBeNull();
    expect(cellLabel(rec({ atrPercentile: null }), "atrPercentileBucket")).toBeNull();
  });

  it("counts every cell examined and compares model with baseline on the same days", () => {
    const rows = [rec(), rec({ pair: "GBPUSD", realizedAfter: { sign: "DOWN", pips: -5 } })];
    const report = sliceRecords(rows, "directional", "after_decision_date");
    expect(report.slicesTested).toBe(report.cells.length);
    const eur = report.cells.find((c) => c.dimension === "pair" && c.label === "EURUSD")!;
    expect(eur.scored).toBe(1);
    expect(eur.model.rate).toBe(1);
    expect(eur.baseline.rate).toBe(0); // baseline said DOWN, session went UP
    expect(eur.delta).toBe(1);
    expect(eur.candidate).toBe(false); // far below MIN_CELL_SCORED
  });

  it("only cells with enough scored days and a positive edge are candidates", () => {
    const many = Array.from({ length: MIN_CELL_SCORED }, () => rec());
    const report = sliceRecords(many, "directional", "after_decision_date");
    expect(report.candidates.length).toBeGreaterThan(0);
    expect(report.candidates.every((c) => c.scored >= MIN_CELL_SCORED && c.delta > 0)).toBe(true);
  });

  it("confirmation re-evaluates a candidate on the holdout only", () => {
    const discovery = Array.from({ length: MIN_CELL_SCORED }, () => rec());
    const candidates = sliceRecords(discovery, "directional", "after_decision_date").candidates;
    const goodHoldout = Array.from({ length: MIN_CELL_SCORED }, () => rec({ date: "2025-03-03" }));
    const out = confirmPockets(candidates, goodHoldout, "directional", "after_decision_date");
    expect(out.length).toBe(candidates.length);
    expect(out.every((c) => c.holds && c.holdoutScored === MIN_CELL_SCORED)).toBe(true);
  });

  it("a candidate that reverses on the holdout does not hold", () => {
    const discovery = Array.from({ length: MIN_CELL_SCORED }, () => rec());
    const candidates = sliceRecords(discovery, "directional", "after_decision_date").candidates;
    const reversed = Array.from({ length: MIN_CELL_SCORED }, () =>
      rec({ date: "2025-03-03", weeklyTrendSign: "UP", realizedAfter: { sign: "DOWN", pips: -9 } }),
    );
    const out = confirmPockets(candidates, reversed, "directional", "after_decision_date");
    expect(out.length).toBe(candidates.length);
    expect(out.every((c) => !c.holds)).toBe(true);
  });
});
