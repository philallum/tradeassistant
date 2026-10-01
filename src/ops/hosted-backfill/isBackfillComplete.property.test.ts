// Property-based test for the pure `isBackfillComplete` seeding-complete
// predicate (spec Req 7.5; task 10.2, design Property 25).
//
// Validates: Requirements 7.5 — the Hosted_Candle_Seeding completion verdict
// MUST hold IF AND ONLY IF every one of the five PAIRS has a non-zero stored
// candle count; a zero (or missing) count for any pair yields false.
//
// This is a TEST-ONLY task. It exercises the real pure `isBackfillComplete`
// function from hostedBackfill.ts (implemented in task 10.1). Rather than
// enumerate fixed cases, it GENERATES arbitrary per-pair coverage summaries via
// fast-check — varying each pair's count across zero and positive values, and
// also exercising the missing-pair case where a pair has no entry — and asserts
// the biconditional against an INDEPENDENTLY computed expectation. Style follows
// the property tests in src/ops/scheduler/ and src/ops/deploy-verify/
// (fast-check + Vitest, numRuns >= 100, a single tagged property).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { isBackfillComplete } from "./hostedBackfill.js";
import { PAIRS } from "../../ingestion/types.js";
import type { PerPairCoverage } from "../../ingestion/types.js";
import type { TradingDate } from "../../guard/types.js";

// Feature: operational-wiring, Property 25: Backfill coverage verification requires all pairs non-zero

/**
 * A well-shaped {@link TradingDate}-or-null arbitrary. The predicate ignores
 * these fields, but generated `PerPairCoverage` objects must still be
 * well-formed: a date string (`YYYY-MM-DD`-ish) or null.
 */
const dateArb: fc.Arbitrary<TradingDate | null> = fc.option(
  fc
    .tuple(
      fc.integer({ min: 2000, max: 2030 }),
      fc.integer({ min: 1, max: 12 }),
      fc.integer({ min: 1, max: 28 }),
    )
    .map(([y, m, d]) => {
      const mm = String(m).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      return `${y}-${mm}-${dd}` as TradingDate;
    }),
  { nil: null },
);

/**
 * A count arbitrary that deliberately straddles the zero boundary: it draws
 * zero (and small positives) often so BOTH outcomes of the IFF are reached
 * across the generated inputs.
 */
const countArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 1, max: 10 }),
  fc.integer({ min: 0, max: 5_000 }),
);

/**
 * Build a well-formed {@link PerPairCoverage} entry for a given pair with the
 * supplied count and arbitrary (well-shaped) date fields.
 */
const entryArb = (
  pair: (typeof PAIRS)[number],
): fc.Arbitrary<PerPairCoverage> =>
  fc.record({
    pair: fc.constant(pair),
    count: countArb,
    earliestDate: dateArb,
    latestDate: dateArb,
  });

/**
 * A coverage-summary arbitrary. For each of the five PAIRS it independently
 * decides whether that pair is PRESENT (with a possibly-zero count) or MISSING
 * entirely, then shuffles the surviving entries so order is not assumed. This
 * exercises every combination the predicate cares about: all-present-positive
 * (true), some zero (false), and some missing (false).
 */
const coverageArb: fc.Arbitrary<readonly PerPairCoverage[]> = fc
  .tuple(
    ...PAIRS.map((pair) =>
      fc.option(entryArb(pair), { nil: undefined, freq: 4 }),
    ),
  )
  .chain((maybeEntries) => {
    const present = maybeEntries.filter(
      (e): e is PerPairCoverage => e !== undefined,
    );
    return fc.shuffledSubarray(present, {
      minLength: present.length,
      maxLength: present.length,
    });
  });

/**
 * The independent oracle: seeding is complete IFF every PAIR has an entry whose
 * count is strictly positive. Computed WITHOUT reusing the implementation's
 * internals.
 */
function expectedComplete(coverage: readonly PerPairCoverage[]): boolean {
  const positivePairs = new Set(
    coverage.filter((c) => c.count > 0).map((c) => c.pair),
  );
  return PAIRS.every((pair) => positivePairs.has(pair));
}

describe("Property 25: backfill coverage verification requires all pairs non-zero (spec Req 7.5)", () => {
  it("isBackfillComplete returns true IFF every PAIR has an entry with count > 0", () => {
    // Track that both branches of the biconditional are actually reached so the
    // property is not vacuously testing only one outcome.
    let sawTrue = false;
    let sawFalse = false;

    fc.assert(
      fc.property(coverageArb, (coverage) => {
        const expected = expectedComplete(coverage);
        if (expected) {
          sawTrue = true;
        } else {
          sawFalse = true;
        }
        expect(isBackfillComplete(coverage)).toBe(expected);
      }),
      { numRuns: 300 },
    );

    expect(sawTrue).toBe(true);
    expect(sawFalse).toBe(true);
  });

  it("an all-positive summary is complete; zeroing or dropping any single pair makes it incomplete", () => {
    // A deterministic witness of each direction, independent of the generators.
    const allPositive: PerPairCoverage[] = PAIRS.map((pair) => ({
      pair,
      count: 1,
      earliestDate: "2024-01-01" as TradingDate,
      latestDate: "2024-06-01" as TradingDate,
    }));
    expect(isBackfillComplete(allPositive)).toBe(true);

    // Zeroing any one pair -> false.
    PAIRS.forEach((_, i) => {
      const zeroed = allPositive.map((e, j) =>
        j === i ? { ...e, count: 0 } : e,
      );
      expect(isBackfillComplete(zeroed)).toBe(false);
    });

    // Dropping any one pair -> false.
    PAIRS.forEach((_, i) => {
      const dropped = allPositive.filter((_e, j) => j !== i);
      expect(isBackfillComplete(dropped)).toBe(false);
    });
  });
});
