import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addTradingDays,
  compareTradingDates,
  formatTradingDate,
} from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";
import { backfillRangeStart, classifyGap } from "./candleGap.js";
import { mostRecentCompletedTradingDay } from "./completedTradingDay.js";

// Feature: daily-candle-freshness-and-cleanup, Property 4: bounded backfill lookback
//
// Validates: Requirements 3.2, 4.4
//
// For random (possibly ancient or null) last-stored dates and Decision_Dates,
// the computed Gap_Backfill range start is NEVER earlier than
// `addTradingDays(mostRecentCompletedTradingDay(decisionDate), -maxLookback)`.
// This bounds the request so a very old (or absent) last-stored date cannot
// trigger an unbounded fetch.

const dateArb: fc.Arbitrary<TradingDate> = fc
  .date({
    min: new Date(Date.UTC(2005, 0, 1)),
    max: new Date(Date.UTC(2035, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => formatTradingDate(d));

/** Last-stored date: an ancient/recent date OR `null` (a pair with no history). */
const latestDateArb: fc.Arbitrary<TradingDate | null> = fc.option(dateArb, {
  nil: null,
  freq: 4,
});

const maxLookbackArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 365 });

describe("backfillRangeStart", () => {
  it("never starts earlier than maxLookback trading days before the target", () => {
    fc.assert(
      fc.property(
        latestDateArb,
        dateArb,
        maxLookbackArb,
        (latestDate, decisionDate, maxLookback) => {
          const target = mostRecentCompletedTradingDay(decisionDate);

          // `backfillRangeStart` is only ever consulted when the gap classifies
          // as a backfill (null history, or `latestDate` strictly before the
          // target). An `up_to_date` pair never reaches a range fetch, so
          // restrict the domain to the backfill case the stage actually drives.
          fc.pre(classifyGap(latestDate, target) === "backfill");

          const from = backfillRangeStart(latestDate, target, maxLookback);

          const lowerBound = addTradingDays(target, -maxLookback);

          // The range start is bounded below (Requirement 3.2 / 4.4): never
          // earlier than `maxLookback` trading days before the target.
          expect(compareTradingDates(from, lowerBound)).toBeGreaterThanOrEqual(0);

          // And it never runs past the target.
          expect(compareTradingDates(from, target)).toBeLessThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});
