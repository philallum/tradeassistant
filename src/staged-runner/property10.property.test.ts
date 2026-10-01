// Property 10: Forward-look is deterministic.
//
// Feature: operational-wiring, Property 10: Forward-look is deterministic
// Validates: Requirements 2.8, 5.5
//
// Requirement 2.8: invoking the Forward_Look_Stage with the same stored inputs
// and the same Decision_Date produces an identical set of setups.
// Requirement 5.5: a triggered unattended run produces a result equivalent to a
// local run executed against the same input candles.
//
// This test genuinely runs `forwardLook` (not a no-op): its two forwardLook
// prerequisites — stored pattern vectors AND matured analogue outcomes — are
// seeded so the stage does not abort, forwardLook delegates to the real
// `runScheduledDaily` → `dailyRun`, and the produced `DashboardView` is read
// back through a capturing `persistView`. The property runs forwardLook TWICE
// over identical seeded inputs + Decision_Date and deep-compares the two views.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Pair } from "../ingestion/types.js";
import { PAIRS } from "../ingestion/types.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { PairEvaluation } from "../dashboard/index.js";
import { forwardLook } from "./stagedRunner.js";
import { makeCapturingForwardLookDeps } from "./testHelpers.js";

// A deterministic ISO date generator over a bounded window, returned as
// YYYY-MM-DD so it is a valid TradingDate.
const tradingDateArb = fc
  .integer({ min: 0, max: 3650 })
  .map((d) => new Date(Date.UTC(2018, 0, 1) + d * 86_400_000).toISOString().slice(0, 10));

const directionArb = fc.constantFrom<DirectionClass>("UP", "DOWN", "FLAT");
const horizonArb = fc.constantFrom<Horizon>(1, 2, 3);

// A full PairEvaluation for a given pair. Covers the fields `dailyRun` reads for
// the firing decision (gatePassing, newsSuppressed, direction, earnedConfidence)
// as well as the display fields carried onto a rendered card.
function pairEvaluationArb(pair: Pair): fc.Arbitrary<PairEvaluation> {
  return fc.record({
    gatePassing: fc.boolean(),
    newsSuppressed: fc.boolean(),
    direction: directionArb,
    horizon: horizonArb,
    earnedConfidence: fc
      .double({ min: 0, max: 1, noNaN: true })
      .map((n) => n as Confidence),
    favorablePips: fc.double({ min: 0, max: 200, noNaN: true }),
    adversePips: fc.double({ min: 0, max: 200, noNaN: true }),
    stopLossPips: fc.option(fc.double({ min: 1, max: 200, noNaN: true }), { nil: null }),
    takeProfitPips: fc.option(fc.double({ min: 1, max: 200, noNaN: true }), { nil: null }),
    rationale: fc.string({ maxLength: 40 }),
    analogueLabels: fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }),
  }).map((r) => ({
    pair,
    gatePassing: r.gatePassing,
    newsSuppressed: r.newsSuppressed,
    direction: r.direction,
    horizon: r.horizon,
    earnedConfidence: r.earnedConfidence,
    excursionProfile: { favorablePips: r.favorablePips, adversePips: r.adversePips },
    stopLossPips: r.stopLossPips,
    takeProfitPips: r.takeProfitPips,
    rationale: r.rationale,
    analogueLabels: r.analogueLabels,
  } satisfies PairEvaluation));
}

// Feature: operational-wiring, Property 10: Forward-look is deterministic

describe("Property 10: Forward-look is deterministic", () => {
  it(
    "two forwardLook runs over identical stored inputs + Decision_Date produce identical DashboardViews",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // A distinct per-pair evaluation for a chosen subset of pairs.
          fc.uniqueArray(fc.constantFrom<Pair>(...PAIRS), {
            minLength: 1,
            maxLength: PAIRS.length,
          }).chain((chosen) =>
            fc.tuple(...chosen.map((p) => pairEvaluationArb(p))),
          ),
          // The Decision_Date, strictly after the seeded prior date so the
          // matured-outcome prerequisite (decisionDate < beforeDate) holds.
          tradingDateArb.filter((d) => d > "2017-01-01").map((d) =>
            d <= "2017-06-01" ? "2017-06-02" : d,
          ),
          async (evaluations, decisionDate) => {
            const seededPairs = evaluations.map((e) => e.pair);
            const priorDate = "2016-01-01"; // strictly before any decisionDate

            // Run 1: fresh deps, same seeded inputs.
            const deps1 = await makeCapturingForwardLookDeps({
              evaluations,
              decisionDate,
              seededPairs,
              priorDate,
            });
            // Feature: operational-wiring, Property 10: Forward-look is deterministic
            const result1 = await forwardLook(deps1);
            expect(result1.ok).toBe(true);
            const view1 = deps1.getView();
            expect(view1).toBeDefined();

            // Run 2: a SECOND, independent deps built from the identical inputs.
            const deps2 = await makeCapturingForwardLookDeps({
              evaluations,
              decisionDate,
              seededPairs,
              priorDate,
            });
            const result2 = await forwardLook(deps2);
            expect(result2.ok).toBe(true);
            const view2 = deps2.getView();
            expect(view2).toBeDefined();

            // Determinism (Req 2.8) / equivalent unattended run (Req 5.5):
            // the two produced views are deep-equal.
            expect(view2).toEqual(view1);
            // And both reflect the requested Decision_Date.
            expect(view1!.decisionDate).toBe(decisionDate);
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
