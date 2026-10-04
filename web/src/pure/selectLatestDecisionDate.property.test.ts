import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { selectLatestDecisionDate } from "./selectDates";

// Feature: dashboard-ui, Property 1: Latest Decision_Date is the maximum present.
// For any set of Decision_Date strings, selectLatestDecisionDate returns the maximum date
// when the set is non-empty and null when it is empty, independent of input order or
// duplicates.
//
// **Validates: Requirements 6.1, 19.3**

const NUM_RUNS = 300; // >= 100 iterations required by the task.

/**
 * Arbitrary over ISO calendar-date strings in the fixed `YYYY-MM-DD` form the serving
 * layer uses. In this form chronological order coincides with lexicographic string order,
 * which is exactly what `selectLatestDecisionDate` relies on. The generator is constrained
 * to the valid Decision_Date input space (real year/month/day components) rather than
 * arbitrary strings, so the dates are shaped like the ones the function actually receives.
 */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({
    min: new Date("2000-01-01T00:00:00.000Z"),
    max: new Date("2099-12-31T00:00:00.000Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

/** A non-empty set of ISO dates (order and duplicates arbitrary). */
const nonEmptyDatesArb: fc.Arbitrary<readonly string[]> = fc.array(isoDateArb, {
  minLength: 1,
  maxLength: 50,
});

/**
 * Deterministically shuffle `xs` using a seed drawn by fast-check, so we can assert
 * order-independence without pulling in a shuffle arbitrary over the same values.
 */
function shuffle(xs: readonly string[], seed: number): string[] {
  const arr = [...xs];
  let state = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    // xorshift32 PRNG — pure and reproducible.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const j = (state >>> 0) % (i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

describe("Property 1: Latest Decision_Date is the maximum present", () => {
  it("returns a member of the set that is >= every element, and null only when empty", () => {
    fc.assert(
      fc.property(nonEmptyDatesArb, fc.integer({ min: 1, max: 0x7fffffff }), (dates, seed) => {
        const result = selectLatestDecisionDate(dates);

        // Non-empty input yields a value...
        expect(result).not.toBeNull();
        const latest = result as string;

        // ...that is a member of the input set...
        expect(dates).toContain(latest);

        // ...and that is >= every element present (the maximum).
        for (const d of dates) {
          expect(latest >= d).toBe(true);
        }

        // Order independence: shuffling the input does not change the result.
        const shuffled = shuffle(dates, seed);
        expect(selectLatestDecisionDate(shuffled)).toBe(latest);

        // Duplicate independence: duplicating every entry does not change the result.
        const duplicated = [...dates, ...dates];
        expect(selectLatestDecisionDate(duplicated)).toBe(latest);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("returns null for the empty set", () => {
    expect(selectLatestDecisionDate([])).toBeNull();
  });
});
