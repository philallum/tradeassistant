import { describe, expect, it } from "vitest";

import type { DayRecord } from "./dayRecords.js";
import { realizedBalance, scoreAccuracy, subsetOf } from "./scoring.js";

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
    yesterdaySign: "UP",
    realizedAfter: { sign: "UP", pips: 20 },
    realizedOn: { sign: "DOWN", pips: -20 },
    ...over,
  };
}

describe("scoring", () => {
  it("scores model and baseline on the same matched days against the chosen session", () => {
    const rows = [
      rec({ direction: "UP", weeklyTrendSign: "DOWN" }), // model right, baseline wrong (after=UP)
      rec({ direction: "DOWN", weeklyTrendSign: "DOWN" }), // model wrong, baseline wrong
      rec({ direction: "UP", weeklyTrendSign: "UP" }), // both right
      rec({ direction: "FLAT", fires: false }), // no view: excluded
    ];
    const r = scoreAccuracy(rows, "directional", "after_decision_date");
    expect(r.days).toBe(3);
    expect(r.scored).toBe(3);
    expect(r.model.successes).toBe(2);
    expect(r.baseline.successes).toBe(1);
    expect(r.delta).toBeCloseTo(1 / 3, 10);
    // The other session flips the realised sign, so the same calls score differently.
    expect(scoreAccuracy(rows, "directional", "on_decision_date").model.successes).toBe(1);
  });

  it("excludes realised FLAT or missing sessions from the denominator", () => {
    const rows = [
      rec({ realizedAfter: { sign: "FLAT", pips: 0 } }),
      rec({ realizedAfter: null }),
      rec(),
    ];
    const r = scoreAccuracy(rows, "directional", "after_decision_date");
    expect(r.days).toBe(3);
    expect(r.scored).toBe(1);
  });

  it("the firing subset needs the firing rule, the directional subset does not", () => {
    const rows = [rec({ fires: false, confidence: 0.52 }), rec()];
    expect(subsetOf(rows, "directional")).toHaveLength(2);
    expect(subsetOf(rows, "firing")).toHaveLength(1);
  });

  it("the discounted interval is wider than the raw one", () => {
    const rows = Array.from({ length: 200 }, (_, i) => rec({ realizedAfter: { sign: i % 2 ? "UP" : "DOWN", pips: 1 } }));
    const r = scoreAccuracy(rows, "directional", "after_decision_date");
    expect(r.deltaCiDiscounted.hi - r.deltaCiDiscounted.lo).toBeGreaterThan(r.deltaCiRaw.hi - r.deltaCiRaw.lo);
  });

  it("reports realised class balance", () => {
    const b = realizedBalance(
      [rec(), rec({ realizedAfter: { sign: "DOWN", pips: -3 } }), rec({ realizedAfter: null })],
      "after_decision_date",
    );
    expect(b).toMatchObject({ n: 2, UP: 0.5, DOWN: 0.5, FLAT: 0 });
  });
});
