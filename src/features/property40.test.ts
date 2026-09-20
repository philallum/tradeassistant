import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { yieldSpread10y } from "./candidateFeatures.js";
import type { YieldObservation } from "./types.js";
import { PAIR_YIELD_COUNTRIES, COUNTRIES } from "../yields/types.js";
import type { CountryCode } from "../yields/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";

// Feature: fx-daily-pattern-assistant, Property 40: For all Pairs and Decision_Dates, the Yield_Spread feature equals the base-country 10Y yield minus the quote-country 10Y yield, using only yield data dated strictly before the Decision_Date.
//
// Validates: Requirement 13.8

/** ISO YYYY-MM-DD from a Date. */
const toIsoDate = (d: Date): TradingDate => d.toISOString().slice(0, 10);

const dateArb = fc
  .date({
    min: new Date("2000-01-01T00:00:00Z"),
    max: new Date("2025-01-01T00:00:00Z"),
    noInvalidDate: true,
  })
  .map(toIsoDate);

const yieldObservationArb: fc.Arbitrary<YieldObservation> = fc.record({
  country: fc.constantFrom(...(COUNTRIES as readonly CountryCode[])),
  date: dateArb,
  yield10y: fc.double({ min: -5, max: 20, noNaN: true }),
});

const observationsArb: fc.Arbitrary<YieldObservation[]> = fc.array(
  yieldObservationArb,
  { minLength: 0, maxLength: 60 },
);

/**
 * Independent reference: the most recent yield10y for `country` dated strictly
 * before `decisionDate`, or null when none exists. Mirrors the intended
 * look-ahead-safe semantics without reusing the module's private helper.
 */
function refLatestStrictlyBefore(
  observations: readonly YieldObservation[],
  country: CountryCode,
  decisionDate: TradingDate,
): number | null {
  let best: YieldObservation | null = null;
  for (const obs of observations) {
    if (obs.country !== country) continue;
    // Strictly before: dates >= decisionDate are excluded.
    if (obs.date >= decisionDate) continue;
    if (best === null || obs.date > best.date) {
      best = obs;
    }
  }
  return best === null ? null : best.yield10y;
}

describe("Property 40: yield spread = base 10Y - quote 10Y, strictly-before only", () => {
  it("equals the strictly-earlier base-minus-quote 10Y spread (or null when unavailable)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        dateArb,
        observationsArb,
        (pair: Pair, decisionDate, observations) => {
          const { baseCountry, quoteCountry } = PAIR_YIELD_COUNTRIES[pair];

          const base = refLatestStrictlyBefore(
            observations,
            baseCountry,
            decisionDate,
          );
          const quote = refLatestStrictlyBefore(
            observations,
            quoteCountry,
            decisionDate,
          );

          const actual = yieldSpread10y(pair, decisionDate, observations);

          if (base === null || quote === null) {
            // Missing-yield fail-safe: unavailable side => null.
            expect(actual).toBeNull();
          } else {
            expect(actual).not.toBeNull();
            expect(actual).toBeCloseTo(base - quote, 10);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("returns null when either side has no strictly-earlier observation", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        dateArb,
        observationsArb,
        (pair: Pair, decisionDate, observations) => {
          const { baseCountry, quoteCountry } = PAIR_YIELD_COUNTRIES[pair];
          const base = refLatestStrictlyBefore(
            observations,
            baseCountry,
            decisionDate,
          );
          const quote = refLatestStrictlyBefore(
            observations,
            quoteCountry,
            decisionDate,
          );

          if (base === null || quote === null) {
            expect(yieldSpread10y(pair, decisionDate, observations)).toBeNull();
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("ignores any observation dated on or after the Decision_Date (look-ahead safety)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        dateArb,
        observationsArb,
        // Extra observations that are all dated on/after the decision date.
        fc.array(
          fc.record({
            country: fc.constantFrom(...(COUNTRIES as readonly CountryCode[])),
            // Non-negative day offset from the decision date => date >= decisionDate.
            offsetDays: fc.integer({ min: 0, max: 3650 }),
            yield10y: fc.double({ min: -5, max: 20, noNaN: true }),
          }),
          { minLength: 0, maxLength: 40 },
        ),
        (pair: Pair, decisionDate, pastObs, futureSpecs) => {
          const decisionMs = Date.parse(`${decisionDate}T00:00:00Z`);
          const futureObs: YieldObservation[] = futureSpecs.map((s) => ({
            country: s.country,
            date: toIsoDate(
              new Date(decisionMs + s.offsetDays * 86_400_000),
            ),
            yield10y: s.yield10y,
          }));

          const baseline = yieldSpread10y(pair, decisionDate, pastObs);
          const withFuture = yieldSpread10y(pair, decisionDate, [
            ...pastObs,
            ...futureObs,
          ]);

          // Adding only >= decisionDate observations must not change the result.
          if (baseline === null) {
            expect(withFuture).toBeNull();
          } else {
            expect(withFuture).not.toBeNull();
            expect(withFuture).toBeCloseTo(baseline, 10);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
