import { describe, expect, it } from "vitest";

import type { DayRecord } from "./dayRecords.js";
import { EVENT_SPLIT_START, renderEventSplitLines, splitByEventDay } from "./eventSubset.js";

function rec(date: string, over: Partial<DayRecord> = {}): DayRecord {
  return {
    pair: "EURUSD", date, weekday: 3, weeklyTrendSign: "DOWN", direction: "UP", horizon: 1, confidence: 0.6, fires: true,
    n: 60, meanCosineDistance: 0.1, atr14: 0.007, atrPercentile: 0.5, yesterdaySign: "UP",
    realizedAfter: { sign: "UP", pips: 10 }, realizedOn: null, ...over,
  };
}

describe("splitByEventDay", () => {
  it("separates FOMC and jobs-report days from ordinary days, from 2021 only", () => {
    const rows = splitByEventDay(
      [
        rec("2024-01-31"), // FOMC decision
        rec("2024-02-02"), // US jobs report (rule)
        rec("2024-02-06"),
        rec("2024-02-07"),
        rec("2019-05-01", { realizedAfter: { sign: "DOWN", pips: -10 } }), // before the maintained calendar: excluded
      ],
      "directional",
      "after_decision_date",
    );
    expect(rows.map((r) => [r.group, r.days])).toEqual([["event days", 2], ["ordinary days", 2]]);
    expect(EVENT_SPLIT_START).toBe("2021-01-01");
  });

  it("does not treat an ECB-only day as an event (its history is not listed)", () => {
    const rows = splitByEventDay([rec("2026-03-19")], "directional", "after_decision_date");
    expect(rows.find((r) => r.group === "event days")?.days).toBe(0);
  });

  it("renders verdict-free lines", () => {
    const rows = splitByEventDay([rec("2024-01-31"), rec("2024-02-06")], "directional", "after_decision_date");
    expect(renderEventSplitLines(rows, "directional").join("\n")).not.toMatch(/PASS|CUT|KILL/);
  });
});
