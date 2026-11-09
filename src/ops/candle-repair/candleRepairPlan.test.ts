import { describe, expect, it } from "vitest";
import type { Candle } from "../../guard/types.js";
import type { RawCandle } from "../../ingestion/types.js";
import { changes, pipSize, planRepair } from "./candleRepairPlan.js";

const stored = (date: string, o: number, h: number, l: number, c: number): Candle => ({
  asset: "EURUSD",
  date,
  open: o,
  high: h,
  low: l,
  close: c,
});
const canon = (date: string, o: number, h: number, l: number, c: number): RawCandle => ({
  asset: "EURUSD",
  pair: "EURUSD",
  date,
  open: o,
  high: h,
  low: l,
  close: c,
  source: "TwelveData",
});

describe("planRepair", () => {
  it("marks an identical candle as same and does not list it as a change", () => {
    const plan = planRepair("EURUSD", [stored("2026-11-05", 1.1, 1.12, 1.09, 1.11)], [canon("2026-11-05", 1.1, 1.12, 1.09, 1.11)]);
    expect(plan.entries[0]?.action).toBe("same");
    expect(changes(plan)).toHaveLength(0);
  });

  it("flags a part-formed candle (tiny range, shifted close) as a material replace", () => {
    // 2026-11-04 shape: stored range 2.4 pips vs canonical 86.7
    const plan = planRepair("EURUSD", [stored("2026-11-04", 1.1, 1.10012, 1.09988, 1.1)], [canon("2026-11-04", 1.1, 1.1043, 1.09563, 1.1)]);
    const e = plan.entries[0]!;
    expect(e.action).toBe("replace");
    expect(e.material).toBe(true);
    expect(e.rangeRatio).toBeLessThan(0.05);
  });

  it("treats a small provider disagreement as a non-material replace", () => {
    const plan = planRepair("EURUSD", [stored("2026-10-01", 1.1, 1.12, 1.09, 1.1101)], [canon("2026-10-01", 1.1, 1.12, 1.09, 1.11)]);
    const e = plan.entries[0]!;
    expect(e.action).toBe("replace");
    expect(e.material).toBe(false);
    expect(e.maxDiffPips).toBeCloseTo(1, 6);
  });

  it("inserts a date that was never stored (the missing Friday)", () => {
    const plan = planRepair("EURUSD", [], [canon("2026-11-06", 1.1, 1.12, 1.09, 1.11)]);
    expect(plan.entries[0]?.action).toBe("insert");
    expect(changes(plan)).toHaveLength(1);
  });

  it("lists stored dates with no canonical candle but never plans to delete them", () => {
    const plan = planRepair("EURUSD", [stored("2026-11-03", 1, 1, 1, 1)], [canon("2026-11-05", 1.1, 1.12, 1.09, 1.11)]);
    expect(plan.unverifiedStoredDates).toEqual(["2026-11-03"]);
    expect(plan.entries.map((e) => e.date)).toEqual(["2026-11-05"]);
  });

  it("uses a 0.01 pip size for JPY pairs", () => {
    expect(pipSize("USDJPY")).toBe(0.01);
    expect(pipSize("EURUSD")).toBe(0.0001);
  });
});
