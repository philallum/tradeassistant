import { describe, expect, it } from "vitest";

import type { Candle } from "../../guard/types.js";
import type { HourlyBarRow } from "../../hourly-store/types.js";
import { sessionWindowUtcMs } from "../../ingestion/sessionAggregation.js";
import type { DayRecord } from "./dayRecords.js";
import { renderHourlySimLines, runHourlySim } from "./hourlySim.js";

const H = 3_600_000;
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
    stopLossPips: 20,
    takeProfitPips: 20,
    n: 60,
    meanCosineDistance: 0.1,
    atr14: 0.007,
    atrPercentile: 0.5,
    yesterdaySign: "UP",
    realizedAfter: { sign: "FLAT", pips: 0 },
    realizedOn: null,
    ...over,
  };
}
const candles: Candle[] = [
  { asset: "EURUSD", date: "2024-03-04", open: 1.1, high: 1.101, low: 1.099, close: 1.1 },
  // Entry session touches BOTH the +20 target (1.102) and the -20 stop (1.098).
  { asset: "EURUSD", date: "2024-03-05", open: 1.1, high: 1.1025, low: 1.0975, close: 1.1 },
];
const { startMs } = sessionWindowUtcMs("2024-03-05");
const bar = (hour: number, high: number, low: number): HourlyBarRow => ({ pair: "EURUSD", openMs: startMs + hour * H, open: 1.1, high, low, close: 1.1, source: "t" });

describe("runHourlySim", () => {
  it("leaves a both-touched candle ambiguous on daily bars and decides it from hourly bars", () => {
    const report = runHourlySim({
      records: [rec()],
      candlesByPair: new Map([["EURUSD", candles]]),
      barsByPair: new Map([["EURUSD", [bar(2, 1.1025, 1.1), bar(6, 1.1, 1.0975)]]]), // target first
    });
    expect(report.simulated).toBe(1);
    expect(report.dailyOnly.counts.ambiguous).toBe(1);
    expect(report.hourlyResolved.counts.target_first).toBe(1);
    expect(report.ambiguousResolved).toBe(1);
    expect(report.hourlyResolved.ambiguousShare).toBe(0);
    // target_first = +20 gross, minus exec-v1 EURUSD friction of 1.0 pip
    expect(report.hourlyResolved.meanNetPips).toBeCloseTo(19, 10);
    // ambiguous carries 0 gross, so it only pays the cost
    expect(report.dailyOnly.meanNetPips).toBeCloseTo(-1, 10);
  });

  it("stays ambiguous when a single hour touched both levels", () => {
    const report = runHourlySim({
      records: [rec()],
      candlesByPair: new Map([["EURUSD", candles]]),
      barsByPair: new Map([["EURUSD", [bar(3, 1.1025, 1.0975)]]]),
    });
    expect(report.hourlyResolved.counts.ambiguous).toBe(1);
    expect(report.ambiguousStillOpen).toBe(1);
  });

  it("counts why days were skipped and never invents a trade", () => {
    const report = runHourlySim({
      records: [
        rec({ stopLossPips: null, takeProfitPips: null }), // fewer than 30 analogues
        rec({ date: "2024-06-03" }), // no later candle
        rec({ fires: false }), // not a firing day
      ],
      candlesByPair: new Map([["EURUSD", candles]]),
      barsByPair: new Map([["EURUSD", []]]),
    });
    expect(report.eligibleFiringDays).toBe(2);
    expect(report.skippedNoBoundaries).toBe(1);
    expect(report.skippedNoEntry).toBe(1);
    expect(report.simulated).toBe(0);
  });

  it("flags missing hourly coverage instead of simulating blind", () => {
    const report = runHourlySim({ records: [rec()], candlesByPair: new Map([["EURUSD", candles]]), barsByPair: new Map() });
    expect(report.skippedNoHourlyCoverage).toBe(1);
    expect(report.simulated).toBe(0);
  });

  it("renders verdict-free lines", () => {
    const report = runHourlySim({ records: [rec()], candlesByPair: new Map([["EURUSD", candles]]), barsByPair: new Map([["EURUSD", [bar(2, 1.1025, 1.1)]]]) });
    expect(renderHourlySimLines(report, { start: "2021-01-01", end: "2024-12-31" }).join("\n")).not.toMatch(/PASS|CUT|KILL/);
  });
});
