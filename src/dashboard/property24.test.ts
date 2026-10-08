import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dailyRun, type PairEvaluation } from "./dashboard.js";
import { type DashboardConfig } from "./types.js";
import { PAIRS } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import type { TradingDate } from "../guard/types.js";

// Feature: simplify-to-cloud-minimal, firing invariant (successor to the parent
// Property 24): For all Pairs and Decision_Dates, a Pair is surfaced iff it
// expresses a directional view (direction !== "FLAT") AND its Earned_Confidence
// crosses the configurable Confidence_Threshold. There is NO suppression step:
// the Gate_Auto_Block (gatePassing) and the news suppressor (newsSuppressed)
// have been removed (Requirements 3.4, 3.5), and the Currency_Concentration_Guard
// and Choppiness_Guard are gone too (Requirements 3.1, 3.3). A Pair satisfying
// both firing conditions is ALWAYS surfaced — never silently dropped — and a
// non-firing Pair is an explicit "no trade" observation.
//
// Validates: Requirements 1.1, 3.1, 3.3, 3.5, 3.6

const DECISION_DATE = "2020-06-15" as TradingDate;

const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  "UP",
  "DOWN",
  "FLAT",
);

const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(1, 2, 3);

/**
 * Confidence values drawn from a discrete set straddling the threshold space
 * (see thresholdArb). This makes the >= boundary a frequent, meaningful event
 * rather than a measure-zero coincidence on a dense interval — exercising both
 * "crosses the threshold" and "falls short" branches.
 */
const confidenceArb: fc.Arbitrary<Confidence> = fc
  .constantFrom(0.0, 0.3, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0)
  .map((v) => v as Confidence);

/**
 * Confidence_Threshold is varied across the same discrete grid so that the
 * threshold genuinely gates surfacing (some setups above, some below), directly
 * exercising Requirement 16.4's configurability.
 */
const thresholdArb = fc.constantFrom(0.3, 0.45, 0.5, 0.55, 0.6, 0.7, 0.9);

/**
 * A smart PairEvaluation generator. Each of the five pairs appears at most once
 * on a Decision_Date. We pick a subset of pairs and give each independent
 * direction / confidence values so both branches of each firing condition
 * arise. Excursion + risk + display fields (including the displayed choppiness
 * metric) are filled with plausible, well-typed values; they never affect the
 * firing decision — in particular choppiness is a displayed field, not a gate.
 */
const evaluationsArb: fc.Arbitrary<PairEvaluation[]> = fc
  .subarray([...PAIRS], { minLength: 0, maxLength: PAIRS.length })
  .chain((pairs) =>
    fc.tuple(
      ...pairs.map((pair) =>
        fc.record({
          pair: fc.constant(pair),
          earnedConfidence: confidenceArb,
          direction: directionArb,
          horizon: horizonArb,
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
          choppiness: fc.double({ min: 0, max: 1, noNaN: true }),
          rationale: fc.string(),
          analogueLabels: fc.array(fc.string(), { maxLength: 3 }),
        }),
      ),
    ),
  );

const configArb: fc.Arbitrary<DashboardConfig | undefined> = fc.option(
  fc.record({
    confidenceThreshold: thresholdArb,
  }),
  { nil: undefined },
);

/**
 * Independent reference for the two per-pair firing conditions
 * (Requirements 3.5, 3.6, 1.1). Reimplemented here rather than reusing the
 * module's `fires` (which is not exported) so the property is a genuine
 * cross-check. There is no suppression term: firing is a pure function of the
 * direction and the Earned_Confidence against the threshold.
 */
function satisfiesFiring(
  ev: PairEvaluation,
  confidenceThreshold: number,
): boolean {
  return ev.direction !== "FLAT" && ev.earnedConfidence >= confidenceThreshold;
}

describe("firing invariant: no suppression, directional + threshold only", () => {
  it("every surfaced card corresponds to a pair that satisfied both firing conditions", () => {
    fc.assert(
      fc.property(evaluationsArb, configArb, (evaluations, config) => {
        const threshold = config?.confidenceThreshold ?? 0.55;
        const view = dailyRun(DECISION_DATE, evaluations, config);
        const byPair = new Map(evaluations.map((e) => [e.pair, e]));

        for (const card of view.cards) {
          const ev = byPair.get(card.pair);
          expect(ev).toBeDefined();
          if (!ev) continue;
          // Necessary conditions for surfacing (non-FLAT + threshold).
          expect(satisfiesFiring(ev, threshold)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("a pair that does not satisfy both conditions is never surfaced (it is an explicit 'no trade')", () => {
    fc.assert(
      fc.property(evaluationsArb, configArb, (evaluations, config) => {
        const threshold = config?.confidenceThreshold ?? 0.55;
        const view = dailyRun(DECISION_DATE, evaluations, config);
        const surfaced = new Set(view.cards.map((c) => c.pair));

        for (const ev of evaluations) {
          if (!satisfiesFiring(ev, threshold)) {
            // Fails at least one firing condition ⇒ never a card (Req 3.5).
            expect(surfaced.has(ev.pair)).toBe(false);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("renders no directional cards whenever no pair satisfies both firing conditions", () => {
    fc.assert(
      fc.property(evaluationsArb, configArb, (evaluations, config) => {
        const threshold = config?.confidenceThreshold ?? 0.55;
        const anyFires = evaluations.some((ev) =>
          satisfiesFiring(ev, threshold),
        );
        const view = dailyRun(DECISION_DATE, evaluations, config);

        if (!anyFires) {
          // No directional cards for the date (Requirement 3.5).
          expect(view.cards).toHaveLength(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("every pair satisfying both conditions is surfaced — no suppressor drops any setup (Req 3.1, 3.3)", () => {
    fc.assert(
      fc.property(evaluationsArb, configArb, (evaluations, config) => {
        const threshold = config?.confidenceThreshold ?? 0.55;
        const view = dailyRun(DECISION_DATE, evaluations, config);

        const surfaced = new Set(view.cards.map((c) => c.pair));

        const firingPairs = evaluations
          .filter((ev) => satisfiesFiring(ev, threshold))
          .map((ev) => ev.pair);

        // With no suppressor remaining, the surfaced set is EXACTLY the set of
        // pairs that satisfied both firing conditions — nothing silently
        // dropped (Req 3.1, 3.3) and nothing extra leaked in.
        for (const pair of firingPairs) {
          expect(surfaced.has(pair)).toBe(true);
        }
        expect([...surfaced].sort()).toEqual([...firingPairs].sort());
      }),
      { numRuns: 300 },
    );
  });

  it("choppiness is a displayed field, not a gate: an extreme-chop pair still fires on direction + confidence", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PAIRS),
        fc.constantFrom("UP", "DOWN") as fc.Arbitrary<DirectionClass>,
        // Choppiness spanning the full [0,1] range, including ~0 (maximal chop).
        fc.constantFrom(0.0, 0.01, 0.1, 0.5, 0.99, 1.0),
        (pair, direction, choppiness) => {
          const evaluation: PairEvaluation = {
            pair,
            earnedConfidence: 0.9 as Confidence,
            direction,
            horizon: 2,
            excursionProfile: { favorablePips: 10, adversePips: 5 },
            stopLossPips: 5,
            takeProfitPips: 10,
            choppiness,
            rationale: "",
            analogueLabels: [],
          };
          // Regardless of choppiness, a directional high-confidence pair fires —
          // the former Choppiness_Guard no longer suppresses (Req 3.1).
          const view = dailyRun(DECISION_DATE, [evaluation], {
            confidenceThreshold: 0.55,
          });
          expect(view.cards.map((c) => c.pair)).toEqual([pair]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("the Confidence_Threshold gates surfacing: at/below the confidence a lone setup fires, strictly above it renders no card", () => {
    fc.assert(
      fc.property(
        // A single non-FLAT setup so its surfacing is governed purely by the
        // threshold (no suppressor can interfere — there are none).
        fc.constantFrom(...PAIRS),
        fc.constantFrom("UP", "DOWN") as fc.Arbitrary<DirectionClass>,
        confidenceArb,
        // A strictly-positive gap so the "above" threshold is genuinely higher.
        fc.constantFrom(0.05, 0.1, 0.2),
        (pair, direction, conf, gap) => {
          const evaluation: PairEvaluation = {
            pair,
            earnedConfidence: conf,
            direction,
            horizon: 2,
            excursionProfile: { favorablePips: 10, adversePips: 5 },
            stopLossPips: 5,
            takeProfitPips: 10,
            choppiness: 0.8,
            rationale: "",
            analogueLabels: [],
          };

          // At-the-confidence threshold ⇒ fires (>= boundary, Requirement 1.1).
          const atThreshold: DashboardConfig = {
            confidenceThreshold: conf,
          };
          const surfacedView = dailyRun(DECISION_DATE, [evaluation], atThreshold);
          expect(surfacedView.cards.map((c) => c.pair)).toEqual([pair]);

          // A threshold strictly above the confidence ⇒ no card (Req 3.5, 16.4).
          // Only meaningful when a strictly-greater threshold exists in [0,1].
          const higher = conf + gap;
          if (higher <= 1) {
            const above: DashboardConfig = {
              confidenceThreshold: higher,
            };
            const silentView = dailyRun(DECISION_DATE, [evaluation], above);
            expect(silentView.cards).toHaveLength(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
