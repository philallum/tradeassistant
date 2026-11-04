// Feature: mobile-dashboard-single-window — resolveWindowSelection properties.
// A valid field is always retained, an invalid field always defaults (EURUSD / the latest
// available date via selectBrowseDate semantics), the resulting pair is always supported,
// and the rejected* flags are derived from the raw URL params.
//
// **Validates: Requirements 2.6, 10.3**

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_WINDOW_PAIR,
  resolveWindowSelection,
} from "./resolveWindowSelection.ts";
import { selectLatestDecisionDate } from "./selectDates.ts";
import { isPair, PAIRS } from "../api/types.ts";

const NUM_RUNS = 200; // >= 100 iterations required by the task.

const validPairArb = fc.constantFrom(...PAIRS);

/** A string that is NOT a supported pair (includes the "ALL" sentinel and the empty string). */
const invalidPairArb = fc.oneof(
  fc.constant("ALL"),
  fc.constant(""),
  fc.string({ maxLength: 10 }),
).filter((s) => !isPair(s));

/** Any pair-ish input: supported pair, sentinel, or arbitrary junk. */
const anyPairArb = fc.oneof(validPairArb, invalidPairArb);

/** ISO-form dates; the availability set is a (possibly empty) list, duplicates allowed. */
const isoDateArb = fc
  .date({ min: new Date("2020-01-01T00:00:00Z"), max: new Date("2035-12-31T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));
const datesArb = fc.array(isoDateArb, { maxLength: 12 });

/** A date string guaranteed absent from `dates` (non-ISO junk or an unlisted date). */
function absentDateArb(dates: readonly string[]): fc.Arbitrary<string> {
  return fc
    .oneof(isoDateArb, fc.string({ maxLength: 12 }))
    .filter((d) => !dates.includes(d));
}


describe("resolveWindowSelection (properties)", () => {
  it("the resulting pair is always a supported pair", () => {
    fc.assert(
      fc.property(
        anyPairArb,
        fc.option(fc.string({ maxLength: 12 }), { nil: null }),
        datesArb,
        fc.option(fc.string({ maxLength: 10 }), { nil: null }),
        fc.option(fc.string({ maxLength: 12 }), { nil: null }),
        (pair, date, dates, rawPair, rawDate) => {
          const r = resolveWindowSelection(pair, date, dates, rawPair, rawDate);
          expect(isPair(r.pair)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("a valid pair is retained; an invalid pair (incl. ALL) defaults to EURUSD", () => {
    fc.assert(
      fc.property(validPairArb, datesArb, (pair, dates) => {
        expect(resolveWindowSelection(pair, null, dates, null, null).pair).toBe(pair);
      }),
      { numRuns: NUM_RUNS },
    );
    fc.assert(
      fc.property(invalidPairArb, datesArb, (pair, dates) => {
        expect(resolveWindowSelection(pair, null, dates, null, null).pair).toBe(
          DEFAULT_WINDOW_PAIR,
        );
        expect(DEFAULT_WINDOW_PAIR).toBe("EURUSD");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("a date in the available set is retained", () => {
    fc.assert(
      fc.property(
        anyPairArb,
        datesArb.filter((d) => d.length > 0),
        fc.nat(),
        (pair, dates, idx) => {
          const date = dates[idx % dates.length]!;
          expect(resolveWindowSelection(pair, date, dates, null, null).date).toBe(date);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("an invalid or absent date defaults to the latest available date (null when empty)", () => {
    fc.assert(
      fc.property(
        anyPairArb,
        datesArb.chain((dates) =>
          fc.tuple(
            fc.constant(dates),
            fc.option(absentDateArb(dates), { nil: null }),
          ),
        ),
        (pair, [dates, date]) => {
          const r = resolveWindowSelection(pair, date, dates, null, null);
          expect(r.date).toBe(selectLatestDecisionDate(dates));
          if (dates.length > 0) expect(dates).toContain(r.date);
          else expect(r.date).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("fields resolve independently: a valid field survives an invalid sibling", () => {
    fc.assert(
      fc.property(
        validPairArb,
        invalidPairArb,
        datesArb.filter((d) => d.length > 0),
        fc.nat(),
        (validPair, invalidPair, dates, idx) => {
          const validDate = dates[idx % dates.length]!;
          const bad = "not-a-date";
          const a = resolveWindowSelection(validPair, bad, dates, null, null);
          expect(a.pair).toBe(validPair);
          expect(a.date).toBe(selectLatestDecisionDate(dates));
          const b = resolveWindowSelection(invalidPair, validDate, dates, null, null);
          expect(b.pair).toBe(DEFAULT_WINDOW_PAIR);
          expect(b.date).toBe(validDate);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejected flags: set only when a raw param is present and unsupported/unavailable", () => {
    fc.assert(
      fc.property(
        anyPairArb,
        datesArb,
        fc.option(fc.oneof(validPairArb, fc.string({ maxLength: 10 })), { nil: null }),
        fc.option(fc.oneof(isoDateArb, fc.string({ maxLength: 12 })), { nil: null }),
        (pair, dates, rawPair, rawDate) => {
          const r = resolveWindowSelection(pair, null, dates, rawPair, rawDate);
          expect(r.rejectedPair).toBe(rawPair !== null && !isPair(rawPair));
          expect(r.rejectedDate).toBe(rawDate !== null && !dates.includes(rawDate));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("absent raw params are never reported as rejected", () => {
    fc.assert(
      fc.property(anyPairArb, datesArb, (pair, dates) => {
        const r = resolveWindowSelection(pair, null, dates, null, null);
        expect(r.rejectedPair).toBe(false);
        expect(r.rejectedDate).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("valid raw params are never reported as rejected", () => {
    fc.assert(
      fc.property(
        validPairArb,
        datesArb.filter((d) => d.length > 0),
        fc.nat(),
        (pair, dates, idx) => {
          const date = dates[idx % dates.length]!;
          const r = resolveWindowSelection(pair, date, dates, pair, date);
          expect(r.rejectedPair).toBe(false);
          expect(r.rejectedDate).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
