import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { selectBrowseDate, selectLatestDecisionDate } from "./selectDates.js";

// Feature: dashboard-ui, Property 2: Historical browse selects a present date or a defined fallback.
// For any set of Decision_Dates and any requested date, `selectBrowseDate` returns the
// requested date when it is present in the set, and otherwise returns the defined fallback
// (the latest present date, or `null` for an empty set) — never a date absent from the set.
//
// **Validates: Requirements 7.1**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/**
 * Arbitrary over ISO calendar-date strings in the fixed `YYYY-MM-DD` form the module
 * assumes. Dates are drawn from a bounded span (2020–2030) so collisions and ordering
 * are frequently exercised; the span is intentionally small-ish to make membership hits
 * common.
 *
 * The string is built directly from bounded year/month/day integers rather than via
 * `fc.date().map(d => d.toISOString())`. Under fast-check 4 `fc.date()` can yield an
 * `Invalid Date`, whose `.toISOString()` throws `RangeError: Invalid time value`; building
 * the string ourselves avoids that entirely and works identically under fast-check 3 and 4.
 * Day is clamped to the number of days in the chosen month so every generated value is a
 * real calendar date.
 */
const pad = (n: number, width: number): string => String(n).padStart(width, "0");

const isoDateArb: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 2020, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 31 }),
  })
  .map(({ year, month, day }) => {
    // Clamp the day to the last valid day of the chosen month (handles 30-day
    // months and February, including leap years), so the result is always a
    // real YYYY-MM-DD calendar date.
    const daysInMonth = new Date(year, month, 0).getDate();
    const safeDay = Math.min(day, daysInMonth);
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(safeDay, 2)}`;
  });

/**
 * A set of available Decision_Dates. We allow duplicates and arbitrary order (including
 * the empty array) so the fallback/empty branches are all reachable.
 */
const datesArb: fc.Arbitrary<readonly string[]> = fc.array(isoDateArb, {
  minLength: 0,
  maxLength: 25,
});

/**
 * A requested date that is biased to SOMETIMES be a member of `dates` and sometimes not,
 * so both branches (present → requested; absent/null → fallback) are exercised. When
 * `dates` is non-empty we often pick one of its members verbatim; otherwise we draw a
 * fresh (likely-absent) date or `null`.
 */
function requestedArb(dates: readonly string[]): fc.Arbitrary<string | null> {
  const freshOrNull = fc.oneof(
    isoDateArb,
    fc.constant<string | null>(null),
  );
  if (dates.length === 0) {
    return freshOrNull;
  }
  return fc.oneof(
    { weight: 2, arbitrary: fc.constantFrom(...dates) },
    { weight: 1, arbitrary: freshOrNull },
  );
}

describe("Property 2: Historical browse selects a present date or a defined fallback", () => {
  it("returns requested when present, else the defined fallback, never an absent date", () => {
    fc.assert(
      fc.property(
        datesArb.chain((dates) =>
          requestedArb(dates).map((requested) => ({ dates, requested })),
        ),
        ({ dates, requested }) => {
          const result = selectBrowseDate(dates, requested);
          const latest = selectLatestDecisionDate(dates);

          if (requested !== null && dates.includes(requested)) {
            // (1) Requested is a member of the set → the result is exactly that date.
            expect(result).toBe(requested);
          } else if (dates.length === 0) {
            // (3) Empty set → null regardless of what was requested.
            expect(result).toBeNull();
          } else {
            // (2) Requested null or absent, non-empty set → the defined fallback,
            // which is the latest present date and is itself a member of the set.
            expect(result).toBe(latest);
            expect(dates).toContain(result as string);
          }

          // (4) Universal invariant: the result is always either null or a member of
          // the set — never a date absent from the set.
          if (result === null) {
            expect(dates.length).toBe(0);
          } else {
            expect(dates).toContain(result);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
