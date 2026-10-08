import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  compareTradingDates,
  formatTradingDate,
  isTradingDay,
} from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";
import { mostRecentCompletedTradingDay } from "./completedTradingDay.js";

// Feature: daily-candle-freshness-and-cleanup, Property 2: look-ahead safety —
// most-recent completed trading day is strictly before the decision date
//
// Validates: Requirements 2.2, 3.1
//
// For random Decision_Dates (Mondays, weekends, mid-week), the most recent
// Completed_Trading_Day is always a weekday, is strictly before the Decision_
// Date, and is never a weekend. This is the Completed_Trading_Day half of the
// look-ahead-safety guarantee: the stage only ever TARGETS dates strictly before
// the Decision_Date, so no at/after-dated candle can be requested.

/**
 * A random valid Decision_Date in a wide range. `fc.date` yields any calendar
 * day — Mondays, weekends, and mid-week alike — so the property exercises the
 * weekend-skipping behaviour directly.
 */
const decisionDateArb: fc.Arbitrary<TradingDate> = fc
  .date({
    min: new Date(Date.UTC(2000, 0, 1)),
    max: new Date(Date.UTC(2035, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => formatTradingDate(d));

describe("mostRecentCompletedTradingDay", () => {
  it("is always a weekday strictly before the decision date, never a weekend", () => {
    fc.assert(
      fc.property(decisionDateArb, (decisionDate) => {
        const result = mostRecentCompletedTradingDay(decisionDate);

        // Strictly before the Decision_Date (look-ahead safe).
        expect(compareTradingDates(result, decisionDate)).toBeLessThan(0);

        // Always a weekday — never Saturday or Sunday.
        expect(isTradingDay(result)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
