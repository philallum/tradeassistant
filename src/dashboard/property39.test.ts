import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyCurrencyConcentrationGuard } from "./currencyConcentrationGuard.js";
import {
  currencyStances,
  DEFAULT_MAX_CONCURRENT_ALIGNED,
  type FiringSetup,
} from "./types.js";
import { PAIRS } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import type { TradingDate } from "../guard/types.js";

// Feature: fx-daily-pattern-assistant, Property 39: For all sets of same-day setups aligned on the same base or quote currency, the Currency_Concentration_Guard retains only the N highest-Earned_Confidence aligned setups (default N=2) and suppresses the rest with a recorded currency-concentration reason and competing Pairs, computed deterministically with no LLM input.
//
// Validates: Requirements 22.1, 22.2, 22.3, 22.4

const DECISION_DATE = "2020-06-15" as TradingDate;

const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  "UP",
  "DOWN",
  "FLAT",
);

/**
 * Confidence values are drawn from a small discrete set so that ties are
 * reasonably frequent — this exercises the documented tie-break (pair symbol
 * ascending) instead of leaving it to chance across a dense real interval.
 */
const confidenceArb: fc.Arbitrary<Confidence> = fc
  .constantFrom(0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9)
  .map((v) => v as Confidence);

const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(1, 2, 3);

/**
 * A smart FiringSetup generator. Each of the five pairs appears at most once
 * (the guard operates on a same-day per-pair set, so pairs are unique). We
 * generate a subset of the pairs and assign each a random direction /
 * confidence / horizon. Excursion + risk fields are filled with plausible
 * values; they are irrelevant to the guard but must be well-typed.
 */
const firingSetupsArb: fc.Arbitrary<FiringSetup[]> = fc
  .subarray([...PAIRS], { minLength: 0, maxLength: PAIRS.length })
  .chain((pairs) =>
    fc.tuple(
      ...pairs.map((pair) =>
        fc.record({
          pair: fc.constant(pair),
          direction: directionArb,
          horizon: horizonArb,
          earnedConfidence: confidenceArb,
          excursionProfile: fc.record({
            favorablePips: fc.double({ min: 0, max: 200, noNaN: true }),
            adversePips: fc.double({ min: 0, max: 200, noNaN: true }),
          }),
          stopLossPips: fc.option(fc.double({ min: 1, max: 200, noNaN: true }), {
            nil: null,
          }),
          takeProfitPips: fc.option(
            fc.double({ min: 1, max: 200, noNaN: true }),
            { nil: null },
          ),
        }),
      ),
    ),
  );

// The concurrent-aligned cap is a configurable *positive* portfolio limit
// (default 2, Requirement 22.5). N=0 is a degenerate "suppress everything"
// setting that cannot record competing pairs for a lone aligned setup, so the
// meaningful configuration space starts at 1.
const maxConcurrentArb = fc.integer({ min: 1, max: 5 });

// --- Independent reference model -------------------------------------------

interface RefGroup {
  readonly key: string;
  readonly members: FiringSetup[];
}

/**
 * Independent grouping: bucket setups by (currency, stance) using the module's
 * `currencyStances` (the alignment semantics under test are the documented
 * pair-structure derivation, not something we want to reimplement — but the
 * grouping/ranking/suppression selection below is reimplemented independently).
 */
function refGroups(firing: readonly FiringSetup[]): RefGroup[] {
  const groups = new Map<string, FiringSetup[]>();
  for (const setup of firing) {
    for (const [currency, stance] of currencyStances(
      setup.pair,
      setup.direction,
    )) {
      const key = `${currency}:${stance}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(setup);
      else groups.set(key, [setup]);
    }
  }
  return [...groups.entries()].map(([key, members]) => ({ key, members }));
}

/** Rank: highest confidence first, ties broken by pair symbol ascending. */
function refRank(members: readonly FiringSetup[]): FiringSetup[] {
  return [...members].sort((a, b) => {
    if (b.earnedConfidence !== a.earnedConfidence) {
      return b.earnedConfidence - a.earnedConfidence;
    }
    return a.pair.localeCompare(b.pair);
  });
}

/**
 * Do two setups share an aligned (currency, stance)? i.e. is `a` genuinely a
 * competitor to `b` under the guard's alignment rule?
 */
function areAligned(a: FiringSetup, b: FiringSetup): boolean {
  const sa = currencyStances(a.pair, a.direction);
  const sb = currencyStances(b.pair, b.direction);
  for (const [currency, stance] of sa) {
    if (sb.get(currency) === stance) return true;
  }
  return false;
}

describe("Property 39: currency-concentration guard keeps top-N aligned, suppresses the rest", () => {
  it("retains at most N per aligned group and suppresses exactly the lowest-confidence surplus", () => {
    fc.assert(
      fc.property(
        firingSetupsArb,
        fc.option(maxConcurrentArb, { nil: undefined }),
        (firing, maybeMax) => {
          const n = maybeMax ?? DEFAULT_MAX_CONCURRENT_ALIGNED;
          const result = applyCurrencyConcentrationGuard(
            firing,
            DECISION_DATE,
            maybeMax === undefined ? undefined : { maxConcurrentAligned: n },
          );

          const suppressedPairs = new Set(
            result.suppressed.map((s) => s.pair),
          );
          const keptPairs = new Set(result.kept.map((s) => s.pair));

          for (const group of refGroups(firing)) {
            const ranked = refRank(group.members);
            const keptInGroup = ranked.filter((s) => !suppressedPairs.has(s.pair));
            // At most N kept within any aligned group.
            expect(keptInGroup.length).toBeLessThanOrEqual(Math.max(0, n));

            if (group.members.length > Math.max(0, n)) {
              // The surplus that this group *demands* be suppressed are the
              // lowest-ranked (size - N). Every one of them must indeed be
              // suppressed somewhere in the final result.
              const surplus = ranked.slice(Math.max(0, n));
              for (const loser of surplus) {
                expect(suppressedPairs.has(loser.pair)).toBe(true);
              }
            }
          }

          // A suppressed pair is never also kept, and vice versa.
          for (const p of suppressedPairs) {
            expect(keptPairs.has(p)).toBe(false);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("every suppressed setup carries the currency_concentration reason and genuine, outranking competing pairs", () => {
    fc.assert(
      fc.property(
        firingSetupsArb,
        fc.option(maxConcurrentArb, { nil: undefined }),
        (firing, maybeMax) => {
          const config =
            maybeMax === undefined
              ? undefined
              : { maxConcurrentAligned: maybeMax };
          const result = applyCurrencyConcentrationGuard(
            firing,
            DECISION_DATE,
            config,
          );

          const byPair = new Map(firing.map((s) => [s.pair, s]));

          for (const s of result.suppressed) {
            expect(s.reason).toBe("currency_concentration");
            expect(s.competingPairs.length).toBeGreaterThan(0);

            const self = byPair.get(s.pair);
            expect(self).toBeDefined();
            if (!self) continue;

            // competingPairs is sorted ascending and free of the setup itself.
            const sorted = [...s.competingPairs].sort((a, b) =>
              a.localeCompare(b),
            );
            expect(s.competingPairs).toEqual(sorted);
            expect(s.competingPairs).not.toContain(s.pair);

            for (const competitorPair of s.competingPairs) {
              const competitor = byPair.get(competitorPair);
              expect(competitor).toBeDefined();
              if (!competitor) continue;

              // Genuinely aligned (shares a currency+stance).
              expect(areAligned(self, competitor)).toBe(true);

              // Outranks the suppressed setup by the documented order:
              // higher confidence, or equal confidence with a smaller pair.
              const outranks =
                competitor.earnedConfidence > self.earnedConfidence ||
                (competitor.earnedConfidence === self.earnedConfidence &&
                  competitor.pair.localeCompare(self.pair) < 0);
              expect(outranks).toBe(true);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("kept + suppressed partition the input with no drops or duplicates, and FLAT setups are never suppressed", () => {
    fc.assert(
      fc.property(
        firingSetupsArb,
        fc.option(maxConcurrentArb, { nil: undefined }),
        (firing, maybeMax) => {
          const config =
            maybeMax === undefined
              ? undefined
              : { maxConcurrentAligned: maybeMax };
          const result = applyCurrencyConcentrationGuard(
            firing,
            DECISION_DATE,
            config,
          );

          const inputPairs = firing.map((s) => s.pair).sort();
          const outputPairs = [
            ...result.kept.map((s) => s.pair),
            ...result.suppressed.map((s) => s.pair),
          ].sort();

          // Exact partition: same multiset of pairs, no dropped or duplicated.
          expect(outputPairs).toEqual(inputPairs);
          expect(new Set(outputPairs).size).toBe(outputPairs.length);

          // FLAT setups express no stance ⇒ never suppressed by the guard.
          const suppressedPairs = new Set(result.suppressed.map((s) => s.pair));
          for (const s of firing) {
            if (s.direction === "FLAT") {
              expect(suppressedPairs.has(s.pair)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is deterministic: identical inputs yield identical kept/suppressed results", () => {
    fc.assert(
      fc.property(
        firingSetupsArb,
        fc.option(maxConcurrentArb, { nil: undefined }),
        (firing, maybeMax) => {
          const config =
            maybeMax === undefined
              ? undefined
              : { maxConcurrentAligned: maybeMax };
          const a = applyCurrencyConcentrationGuard(firing, DECISION_DATE, config);
          const b = applyCurrencyConcentrationGuard(firing, DECISION_DATE, config);
          expect(b).toEqual(a);
        },
      ),
      { numRuns: 300 },
    );
  });
});
