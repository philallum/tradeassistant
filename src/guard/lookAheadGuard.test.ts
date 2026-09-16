import { describe, expect, it } from "vitest";
import {
  addTradingDays,
  assertPastOnly,
  compareTradingDates,
  formatTradingDate,
  isMatured,
  isTradingDay,
  lookAheadGuard,
  maturedPreDateOnly,
  parseTradingDate,
} from "./index.js";
import type { Analogue, Candle } from "./types.js";

function makeCandle(date: string, asset = "EURUSD"): Candle {
  return {
    asset,
    date,
    open: 1.1,
    high: 1.105,
    low: 1.095,
    close: 1.102,
    source: "test-feed",
  };
}

describe("LookAheadGuard: assertPastOnly (Requirements 4.1, 4.4)", () => {
  it("accepts candle arrays containing only dates strictly before decisionDate", () => {
    const candles = [
      makeCandle("2026-01-05"),
      makeCandle("2026-01-06"),
      makeCandle("2026-01-07"),
    ];
    const result = assertPastOnly(candles, "2026-01-08");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(candles);
    }
  });

  it("handles empty candle array gracefully", () => {
    const result = assertPastOnly([], "2026-01-08");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it("rejects input containing a candle dated exactly on decisionDate", () => {
    const candles = [
      makeCandle("2026-01-05"),
      makeCandle("2026-01-06"),
      makeCandle("2026-01-07"),
    ];
    const result = assertPastOnly(candles, "2026-01-07");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("look_ahead_violation");
      expect(result.error.decisionDate).toBe("2026-01-07");
      expect(result.error.violatingCandles).toHaveLength(1);
      expect(result.error.violatingCandles[0]?.date).toBe("2026-01-07");
    }
  });

  it("rejects input containing multiple future candles and reports all violations", () => {
    const candles = [
      makeCandle("2026-01-05"),
      makeCandle("2026-01-06"),
      makeCandle("2026-01-07"),
      makeCandle("2026-01-08"),
      makeCandle("2026-01-09"),
    ];
    const result = assertPastOnly(candles, "2026-01-07");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.violatingCandles).toHaveLength(3);
      expect(result.error.violatingCandles.map((c) => c.date)).toEqual([
        "2026-01-07",
        "2026-01-08",
        "2026-01-09",
      ]);
    }
  });

  it("works identically via the lookAheadGuard singleton instance", () => {
    const candles = [makeCandle("2026-01-05")];
    const resOk = lookAheadGuard.assertPastOnly(candles, "2026-01-06");
    expect(resOk.ok).toBe(true);

    const resErr = lookAheadGuard.assertPastOnly(candles, "2026-01-05");
    expect(resErr.ok).toBe(false);
  });
});

describe("LookAheadGuard: isMatured (Requirement 4.2)", () => {
  it("returns false if evalDate is on or before outcomeStart", () => {
    expect(isMatured("2026-01-05", 1, "2026-01-05")).toBe(false);
    expect(isMatured("2026-01-05", 1, "2026-01-04")).toBe(false);
  });

  describe("1-day horizon", () => {
    // Outcome start Monday 2026-01-05. Day 1 is Tuesday 2026-01-06.
    it("is not matured on Day 1 (Tuesday)", () => {
      expect(isMatured("2026-01-05", 1, "2026-01-06")).toBe(false);
    });

    it("is matured on Wednesday (2026-01-07)", () => {
      expect(isMatured("2026-01-05", 1, "2026-01-07")).toBe(true);
    });

    // Outcome start Friday 2026-01-09. Day 1 is Monday 2026-01-12 (skipping weekend).
    it("crosses weekend correctly for Friday outcome", () => {
      expect(isMatured("2026-01-09", 1, "2026-01-12")).toBe(false); // Mon
      expect(isMatured("2026-01-09", 1, "2026-01-13")).toBe(true); // Tue
    });
  });

  describe("2-day horizon", () => {
    // Outcome start Thursday 2026-01-08.
    // Day 1: Fri 2026-01-09
    // Day 2: Mon 2026-01-12
    it("is not matured before Day 2 has closed", () => {
      expect(isMatured("2026-01-08", 2, "2026-01-09")).toBe(false);
      expect(isMatured("2026-01-08", 2, "2026-01-12")).toBe(false);
    });

    it("is matured on Tuesday 2026-01-13", () => {
      expect(isMatured("2026-01-08", 2, "2026-01-13")).toBe(true);
    });
  });

  describe("3-day horizon", () => {
    // Outcome start Wednesday 2026-01-07.
    // Day 1: Thu 2026-01-08
    // Day 2: Fri 2026-01-09
    // Day 3: Mon 2026-01-12
    it("is not matured on or before Day 3 closes", () => {
      expect(isMatured("2026-01-07", 3, "2026-01-12")).toBe(false);
    });

    it("is matured on Tuesday 2026-01-13", () => {
      expect(isMatured("2026-01-07", 3, "2026-01-13")).toBe(true);
    });
  });
});

describe("LookAheadGuard: maturedPreDateOnly (Requirements 9.3, 9.5)", () => {
  it("filters analogues to strictly-pre-date AND matured entries", () => {
    const analogues: Analogue[] = [
      // Case 1: Strictly pre-date and matured (start: Mon Jan 5, H=1, closes Tue Jan 6 -> matured as of Wed Jan 7)
      { asset: "EURUSD", decisionDate: "2026-01-05", horizon: 1, id: "a1" },
      // Case 2: Immature outcome (start: Wed Jan 7, H=2, closes Fri Jan 9 -> not matured as of Fri Jan 9)
      { asset: "EURUSD", decisionDate: "2026-01-07", horizon: 2, id: "a2" },
      // Case 3: On or after decisionDate (start: Fri Jan 09 >= Jan 09)
      { asset: "EURUSD", decisionDate: "2026-01-09", horizon: 1, id: "a3" },
      // Case 4: Future date
      { asset: "EURUSD", decisionDate: "2026-01-15", horizon: 1, id: "a4" },
      // Case 5: Strictly pre-date and matured (start: Mon Jan 5, H=2, closes Wed Jan 7 -> matured as of Fri Jan 9)
      { asset: "EURUSD", decisionDate: "2026-01-05", horizon: 2, id: "a5" },
    ];

    const decisionDate = "2026-01-09"; // Friday
    const evalDate = "2026-01-09";

    const filtered = maturedPreDateOnly(analogues, decisionDate, evalDate);
    expect(filtered.map((a) => a.id)).toEqual(["a1", "a5"]);
  });

  it("supports date property alias as fallback for decisionDate", () => {
    const analogues: Analogue[] = [
      { asset: "EURUSD", date: "2026-01-05", horizon: 1, id: "d1" },
    ];
    const filtered = maturedPreDateOnly(analogues, "2026-01-09", "2026-01-09");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("d1");
  });
});

describe("Trading Date Utilities", () => {
  it("identifies trading days vs weekends", () => {
    expect(isTradingDay("2026-01-05")).toBe(true); // Monday
    expect(isTradingDay("2026-01-09")).toBe(true); // Friday
    expect(isTradingDay("2026-01-10")).toBe(false); // Saturday
    expect(isTradingDay("2026-01-11")).toBe(false); // Sunday
  });

  it("adds trading days correctly across weekends", () => {
    expect(addTradingDays("2026-01-05", 1)).toBe("2026-01-06"); // Mon + 1 = Tue
    expect(addTradingDays("2026-01-05", 5)).toBe("2026-01-12"); // Mon + 5 = next Mon
    expect(addTradingDays("2026-01-09", 1)).toBe("2026-01-12"); // Fri + 1 = Mon
    expect(addTradingDays("2026-01-09", 2)).toBe("2026-01-13"); // Fri + 2 = Tue
  });

  it("parses and formats round-trip", () => {
    const dateStr = "2026-03-15";
    const dt = parseTradingDate(dateStr);
    expect(formatTradingDate(dt)).toBe(dateStr);
  });

  it("compares trading dates lexicographically", () => {
    expect(compareTradingDates("2026-01-01", "2026-01-02")).toBeLessThan(0);
    expect(compareTradingDates("2026-01-02", "2026-01-02")).toBe(0);
    expect(compareTradingDates("2026-01-05", "2026-01-02")).toBeGreaterThan(0);
  });
});
