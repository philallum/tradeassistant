import { describe, expect, it } from "vitest";

import { compareStrategies } from "./baselines.js";
import type { DayRecord } from "./dayRecords.js";

function rec(over: Partial<DayRecord> = {}): DayRecord {
  return {
    pair: "EURUSD",
    date: "2024-03-04",
    weekday: 1,
    weeklyTrendSign: "UP",
    direction: "UP",
    horizon: 1,
    confidence: 0.6,
    fires: true,
    n: 80,
    meanCosineDistance: 0.1,
    atr14: 0.007,
    atrPercentile: 0.5,
    yesterdaySign: "DOWN",
    realizedAfter: { sign: "UP", pips: 30 },
    realizedOn: { sign: "DOWN", pips: -10 },
    ...over,
  };
}
const byId = (rows: ReturnType<typeof compareStrategies>, id: string) => rows.find((r) => r.id === id)!;

describe("compareStrategies", () => {
  it("computes net expectancy as signed session pips minus the per-pair cost", () => {
    const rows = compareStrategies([rec(), rec({ direction: "DOWN", realizedAfter: { sign: "UP", pips: 10 } })], "directional", "after_decision_date");
    const model = byId(rows, "model");
    // EURUSD cost = 0.6 + 0.2 + 0.2 = 1.0 pips. Trades: +30-1 = 29 and -10-1 = -11 -> mean 9.
    expect(model.trades).toBe(2);
    expect(model.meanGrossPips).toBeCloseTo(10, 10);
    expect(model.meanNetPips).toBeCloseTo(9, 10);
    expect(model.hitRate.rate).toBe(0.5);
  });

  it("uses the same matched days and the same target for every strategy", () => {
    const rows = compareStrategies([rec(), rec({ direction: "FLAT", fires: false })], "directional", "after_decision_date");
    expect(byId(rows, "model").trades).toBe(1);
    expect(byId(rows, "weekly_trend").trades).toBe(1);
    expect(byId(rows, "random_direction").trades).toBe(1);
  });

  it("follow-yesterday repeats the previous session and skips a flat or missing one", () => {
    const rows = compareStrategies(
      [rec({ yesterdaySign: "DOWN" }), rec({ yesterdaySign: "FLAT" }), rec({ yesterdaySign: null })],
      "directional",
      "after_decision_date",
    );
    const fy = byId(rows, "follow_yesterday");
    expect(fy.trades).toBe(1);
    expect(fy.meanGrossPips).toBe(-30); // went DOWN, session was +30 pips
    expect(fy.hitRate.rate).toBe(0);
  });

  it("the random control has zero gross expectancy and loses exactly the cost", () => {
    const random = byId(compareStrategies([rec(), rec()], "directional", "after_decision_date"), "random_direction");
    expect(random.meanGrossPips).toBe(0);
    expect(random.meanNetPips).toBeCloseTo(-1.0, 10);
    expect(random.hitRate.rate).toBe(0.5);
  });

  it("always long and always short are mirror images before costs", () => {
    const rows = compareStrategies([rec(), rec({ realizedAfter: { sign: "DOWN", pips: -12 } })], "directional", "after_decision_date");
    expect(byId(rows, "always_long").meanGrossPips).toBeCloseTo(-byId(rows, "always_short").meanGrossPips, 10);
  });

  it("reports hit rate by direction and excludes realised-FLAT days from hit rates only", () => {
    const rows = compareStrategies(
      [rec(), rec({ realizedAfter: { sign: "FLAT", pips: 0 } })],
      "directional",
      "after_decision_date",
    );
    const model = byId(rows, "model");
    expect(model.trades).toBe(2);
    expect(model.hitRate.n).toBe(1);
    expect(model.hitRateByDirection.UP.n).toBe(1);
    expect(model.hitRateByDirection.DOWN.n).toBe(0);
  });
});
