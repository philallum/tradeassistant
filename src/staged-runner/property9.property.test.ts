// Property 9: A missing prerequisite aborts a stage without mutating stored data.
//
// Feature: operational-wiring, Property 9: A missing prerequisite aborts a stage without mutating stored data
// Validates: Requirements 2.7
//
// Requirement 2.7: IF a stage is invoked before its prerequisite stored data
// exists, THEN THE System SHALL abort that stage, SHALL report an error naming
// the missing prerequisite, SHALL leave prior stored data unchanged, and SHALL
// NOT emit a fabricated or empty result as if it were valid.
//
// This property drives the REAL `backtest` and `forwardLook` stages over
// in-memory stores and, for each stage, randomizes WHICH prerequisite is
// missing plus any pre-existing-but-insufficient stored data:
//
//   backtest aborts    — unless at least one pair has BOTH stored candles AND
//                        stored vectors. We seed only insufficient combinations
//                        (candles-only, vectors-only, split across pairs, or
//                        nothing) so the stage always aborts.
//   forwardLook aborts — when no vectors are stored, OR when vectors are stored
//                        but no matured analogue outcome dated before the
//                        Decision_Date exists. We randomize between those two
//                        abort shapes and over any pre-seeded insufficient data.
//
// For every case we snapshot every in-memory store (candles, pattern vectors,
// analogue outcomes, RESEARCH-LOG) BEFORE the call and deep-compare AFTER:
// nothing was written or mutated. We also assert the stage returned ok:false
// with a non-empty, named `missingPrerequisite` (never a fabricated ok result).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Candle } from "../guard/types.js";
import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import { backtest, forwardLook } from "./stagedRunner.js";
import {
  makeTestDeps,
  makeConfig,
  seedVector,
  seedMaturedOutcome,
  snapshotStores,
  type StoreSnapshot,
} from "./testHelpers.js";

// A date strictly before this is "prior" (matured before the Decision_Date).
const DECISION_DATE: TradingDate = "2020-06-01";
const PRIOR_DATE: TradingDate = "2020-05-01";
// A second prior date so insufficient seeding can span multiple dates.
const PRIOR_DATE_2: TradingDate = "2020-04-15";

/** Build a well-formed candle for a pair/date (seeded directly, no ingestion). */
function makeCandle(pair: Pair, date: TradingDate): Candle {
  return {
    asset: pair,
    date,
    open: 1.1,
    high: 1.12,
    low: 1.09,
    close: 1.105,
    source: "csv",
  };
}

// Arbitrary subset of pairs.
const pairsArb = fc.uniqueArray(fc.constantFrom<Pair>(...PAIRS), {
  minLength: 0,
  maxLength: PAIRS.length,
});

const probedDates: readonly TradingDate[] = [
  PRIOR_DATE,
  PRIOR_DATE_2,
  DECISION_DATE,
];

function expectUnchangedAbort(
  before: StoreSnapshot,
  after: StoreSnapshot,
  result: { readonly ok: boolean; readonly missingPrerequisite?: string },
): void {
  // (1) Aborted with a non-empty, NAMED missing prerequisite — never a
  // fabricated ok result.
  expect(result.ok).toBe(false);
  expect(typeof result.missingPrerequisite).toBe("string");
  expect((result.missingPrerequisite ?? "").length).toBeGreaterThan(0);

  // (2) Stored data is byte-for-byte unchanged across every store.
  expect(after).toEqual(before);
}

// Feature: operational-wiring, Property 9: A missing prerequisite aborts a stage without mutating stored data

describe("Property 9: A missing prerequisite aborts a stage without mutating stored data", () => {
  it(
    "the backtest stage aborts (ok:false, named prerequisite) and mutates no store when no pair has both candles and vectors",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Pairs seeded with candles ONLY (no vectors).
          pairsArb,
          // Pairs seeded with vectors ONLY (no candles).
          pairsArb,
          async (candleOnlyPairs, vectorOnlyPairs) => {
            // Ensure the two insufficient groups never overlap, so no single
            // pair ends up with BOTH candles and vectors (which would satisfy
            // the prerequisite and make the stage succeed).
            const candleSet = new Set(candleOnlyPairs);
            const vectorPairs = vectorOnlyPairs.filter((p) => !candleSet.has(p));

            const deps = makeTestDeps();

            // Seed candles-only pairs directly through the CandleStore PORT.
            for (const pair of candleOnlyPairs) {
              await deps.candleStore.upsertCandles([
                makeCandle(pair, PRIOR_DATE),
                makeCandle(pair, PRIOR_DATE_2),
              ]);
            }
            // Seed vectors-only pairs through the PatternVectorStore PORT.
            for (const pair of vectorPairs) {
              await seedVector(deps.vectorStore, pair, PRIOR_DATE);
            }

            const before = await snapshotStores(deps, {
              allOutcomeDates: probedDates,
              maturedBefore: DECISION_DATE,
            });

            // Feature: operational-wiring, Property 9: A missing prerequisite aborts a stage without mutating stored data
            const result = await backtest(deps);

            const after = await snapshotStores(deps, {
              allOutcomeDates: probedDates,
              maturedBefore: DECISION_DATE,
            });

            expectUnchangedAbort(before, after, result);
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    "the forwardLook stage aborts (ok:false, named prerequisite) and mutates no store when vectors or matured outcomes are missing",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Which prerequisite is deliberately missing:
          //   "no-vectors"       — no pattern vectors stored at all.
          //   "no-matured"       — vectors stored, but no matured outcome
          //                        dated before the Decision_Date.
          fc.constantFrom("no-vectors", "no-matured"),
          // Pairs that receive the (insufficient) stored data.
          fc.uniqueArray(fc.constantFrom<Pair>(...PAIRS), {
            minLength: 1,
            maxLength: PAIRS.length,
          }),
          // In the "no-vectors" case we may still seed candles and even a
          // matured outcome — neither satisfies the vectors prerequisite — so
          // the abort is genuinely driven by the missing vectors, not an empty
          // store.
          fc.boolean(),
          async (missing, pairs, seedExtra) => {
            const deps = {
              ...makeTestDeps(),
              config: makeConfig(DECISION_DATE),
            };

            if (missing === "no-vectors") {
              // No vectors anywhere. Optionally seed candles + a matured
              // outcome to prove the abort is caused by the absent vectors.
              for (const pair of pairs) {
                await deps.candleStore.upsertCandles([
                  makeCandle(pair, PRIOR_DATE),
                ]);
                if (seedExtra) {
                  await seedMaturedOutcome(deps.analogueStore, pair, PRIOR_DATE);
                }
              }
            } else {
              // "no-matured": seed vectors so the first prerequisite passes,
              // but store NO matured outcome dated before the Decision_Date.
              for (const pair of pairs) {
                await seedVector(deps.vectorStore, pair, PRIOR_DATE);
                // Optionally seed an outcome that is NOT a valid matured
                // prerequisite: dated AT/after the Decision_Date, so
                // getMaturedOutcomes(pair, decisionDate) still returns none.
                if (seedExtra) {
                  await seedMaturedOutcome(
                    deps.analogueStore,
                    pair,
                    DECISION_DATE,
                  );
                }
              }
            }

            const before = await snapshotStores(deps, {
              allOutcomeDates: probedDates,
              maturedBefore: DECISION_DATE,
            });

            // Feature: operational-wiring, Property 9: A missing prerequisite aborts a stage without mutating stored data
            const result = await forwardLook(deps);

            const after = await snapshotStores(deps, {
              allOutcomeDates: probedDates,
              maturedBefore: DECISION_DATE,
            });

            expectUnchangedAbort(before, after, result);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
