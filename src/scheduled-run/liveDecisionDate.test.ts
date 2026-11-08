import { describe, expect, it } from "vitest";
import { isLiveDecisionDate, resolveDecisionDate } from "./config.js";

// `isLiveDecisionDate` says whether a Decision_Date is the one an un-overridden run would use
// right now. The scheduled run (17:30 America/New_York) labels itself with the NEXT trading day;
// a replay names any other date.

/** 2026-11-06 is a Friday. 17:30 New York (EST, UTC-5) on that day is 22:30 UTC. */
const FRIDAY_1730_NY = new Date("2026-11-06T22:30:00Z");
/** The same Friday at 09:00 New York (14:00 UTC): before the close. */
const FRIDAY_0900_NY = new Date("2026-11-06T14:00:00Z");

describe("isLiveDecisionDate", () => {
  it("is true for the label a normal scheduled run uses (after the close: the NEXT trading day)", () => {
    // Friday 17:30 NY rolls to Monday 2026-11-09.
    expect(resolveDecisionDate({}, FRIDAY_1730_NY)).toBe("2026-11-09");
    expect(isLiveDecisionDate("2026-11-09", FRIDAY_1730_NY)).toBe(true);
  });

  it("is true for the current NY date before the close", () => {
    expect(isLiveDecisionDate("2026-11-06", FRIDAY_0900_NY)).toBe(true);
  });

  it("is false for a replayed past date", () => {
    expect(isLiveDecisionDate("2026-10-01", FRIDAY_1730_NY)).toBe(false);
    expect(isLiveDecisionDate("2026-11-06", FRIDAY_1730_NY)).toBe(false); // today's *candle* date, not the run label
  });

  it("is false for a future date", () => {
    expect(isLiveDecisionDate("2026-12-01", FRIDAY_1730_NY)).toBe(false);
  });

  it("ignores any RUN_DECISION_DATE in the real environment (it asks about the LIVE date)", () => {
    const before = process.env.RUN_DECISION_DATE;
    process.env.RUN_DECISION_DATE = "2020-01-01";
    try {
      expect(isLiveDecisionDate("2026-11-09", FRIDAY_1730_NY)).toBe(true);
      expect(isLiveDecisionDate("2020-01-01", FRIDAY_1730_NY)).toBe(false);
    } finally {
      if (before === undefined) delete process.env.RUN_DECISION_DATE;
      else process.env.RUN_DECISION_DATE = before;
    }
  });
});
