import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dailyRun, type PairEvaluation } from "./dashboard.js";
import { type DashboardConfig, DEFAULT_MAX_CONCURRENT_ALIGNED } from "./types.js";
import { PAIRS } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { Confidence, Horizon } from "../confidence/types.js";
import type { TradingDate } from "../guard/types.js";

// Feature: fx-daily-pattern-assistant, Property 24: For all Pairs and Decision_Dates, a Pair is surfaced iff it has a Kill_Gate-passing pattern AND its Earned_Confidence crosses the configurable Confidence_Threshold AND the news filter permits trading; if none satisfy all three, the dashboard is empty, and nothing unpassed by the Kill_Gate is ever displayed. In addition, the Currency_Concentration_Guard is applied as a further suppression step, so a Pair satisfying all three conditions may still be suppressed when it is an aligned same-currency setup outranked beyond the top-N by Earned_Confidence.
//
// Validates: Requirements 1.1, 1.2, 12.3, 16.2, 16.5, 16.6, 22.1

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

const maxConcurrentArb = fc.integer({ min: 1, max: 5 });

/**
 * A smart PairEvaluation generator. Each of the five pairs appears at most once
 * on a Decision_Date. We pick a subset of pairs and give each independent
 * gate / news / direction / confidence values so that all combinations of the
 * three firing conditions arise. Excursion + risk + display fields are filled
 * with plausible, well-typed values; they never affect the firing decision.
 */
const evaluationsArb: fc.Arbitrary<PairEvaluation[]> = fc
  .subarray([...PAIRS], { minLength: 0, maxLength: PAIRS.length })
  .chain((pairs) =>
    fc.tuple(
      ...pairs.map((pair) =>
        fc.record({
          pair: fc.constant(pair),
          gatePassing: fc.boolean(),
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
          newsSuppressed: fc.boolean(),
          rationale: fc.string(),
          analogueLabels: fc.array(fc.string(), { maxLength: 3 }),
        }),
      ),
    ),
  );

const configArb: fc.Arbitrary<DashboardConfig | undefined> = fc.option(
  fc.record({
    confidenceThreshold: thresholdArb,
    maxConcurrentAligned: maxConcurrentArb,
  }),
  { nil: undefined },
);

/**
 * Independent reference for the three per-pair firing conditions
 * (Requirements 16.2, 16.5, 16.6, 1.1). Reimplemented here rather than reusing
 * the module's `fires` (which is not exported) so the property is a genuine
 * cross-check.
 */
function satisfiesAllThree(
  ev: PairEvaluation,
  confidenceThreshold: number,
): boolean {
  return (
    ev.gatePassing &&
    !ev.newsSuppressed &&
    ev.direction !== "FLAT" &&
    ev.earnedConfidence >= confidenceThreshold
  );
}

describe("Property 24: silent-by-default firing invariant", () => {
  it("every surfaced card corresponds to a pair that satisfied all three firing conditions", () => {
    fc.assert(
      fc.property(evaluationsArb, configArb, (evaluations, config) => {
        const threshold = config?.confidenceThreshold ?? 0.55;
        const view = dailyRun(DECISION_DATE, evaluations, config);
        const byPair = new Map(evaluations.map((e) => [e.pair, e]));

        for (const card of view.cards) {
          const ev = byPair.get(card.pair);
          expect(ev).toBeDefined();
          if (!ev) continue;
          // Necessary conditions for surfacing (gate + news + non-FLAT + threshold).
          expect(satisfiesAllThree(ev, threshold)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("no pair failing any of the three conditions is ever surfaced (gate/threshold/news), and non-gate-passing pairs are never displayed", () => {
    fc.assert(
      fc.property(evaluationsArb, configArb, (evaluations, config) => {
        const threshold = config?.confidenceThreshold ?? 0.55;
        const view = dailyRun(DECISION_DATE, evaluations, config);
        const surfaced = new Set(view.cards.map((c) => c.pair));

        for (const ev of evaluations) {
          if (!satisfiesAllThree(ev, threshold)) {
            // Fails at least one firing condition ⇒ never a card (Req 16.5, 12.3, 16.6, 1.1).
            expect(surfaced.has(ev.pair)).toBe(false);
          }
          // In particular: a non-gate-passing pair is NEVER displayed (Req 16.5, 12.3).
          if (!ev.gatePassing) {
            expect(surfaced.has(ev.pair)).toBe(false);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("is silent (cards empty) whenever no pair satisfies all three firing conditions", () => {
    fc.assert(
      fc.property(evaluationsArb, configArb, (evaluations, config) => {
        const threshold = config?.confidenceThreshold ?? 0.55;
        const anyFires = evaluations.some((ev) =>
          satisfiesAllThree(ev, threshold),
        );
        const view = dailyRun(DECISION_DATE, evaluations, config);

        if (!anyFires) {
          // Silent by default (Requirement 16.2).
          expect(view.cards).toHaveLength(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("a pair satisfying all three is either surfaced or suppressed for currency_concentration — never silently dropped", () => {
    fc.assert(
      fc.property(evaluationsArb, configArb, (evaluations, config) => {
        const threshold = config?.confidenceThreshold ?? 0.55;
        const view = dailyRun(DECISION_DATE, evaluations, config);

        const surfaced = new Set(view.cards.map((c) => c.pair));
        const suppressed = new Set(view.suppressed.map((s) => s.pair));

        // The only suppression reason at this stage is the guard's.
        for (const s of view.suppressed) {
          expect(s.reason).toBe("currency_concentration");
        }

        const firingPairs = evaluations
          .filter((ev) => satisfiesAllThree(ev, threshold))
          .map((ev) => ev.pair);

        for (const pair of firingPairs) {
          const inCards = surfaced.has(pair);
          const inSuppressed = suppressed.has(pair);
          // EITHER surfaced OR suppressed (currency_concentration) — never both,
          // never neither (Requirement 22.1, no silent drop of a valid setup).
          expect(inCards || inSuppressed).toBe(true);
          expect(inCards && inSuppressed).toBe(false);
        }

        // Conversely, cards ∪ suppressed is exactly the set of firing pairs:
        // nothing that failed the three conditions leaked into either bucket.
        const outputPairs = [...surfaced, ...suppressed].sort();
        expect(outputPairs).toEqual([...firingPairs].sort());

        // Every suppressed pair did satisfy all three firing conditions first
        // (the guard only ever runs on firing setups, Requirement 22.1).
        const byPair = new Map(evaluations.map((e) => [e.pair, e]));
        for (const s of view.suppressed) {
          const ev = byPair.get(s.pair);
          expect(ev).toBeDefined();
          if (!ev) continue;
          expect(satisfiesAllThree(ev, threshold)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("the Confidence_Threshold gates surfacing: at/below the confidence a lone setup fires, strictly above it goes silent", () => {
    fc.assert(
      fc.property(
        // A single gate-passing, news-permitted, non-FLAT setup so the guard
        // never interferes: its surfacing is governed purely by the threshold.
        fc.constantFrom(...PAIRS),
        fc.constantFrom("UP", "DOWN") as fc.Arbitrary<DirectionClass>,
        confidenceArb,
        // A strictly-positive gap so the "above" threshold is genuinely higher.
        fc.constantFrom(0.05, 0.1, 0.2),
        (pair, direction, conf, gap) => {
          const evaluation: PairEvaluation = {
            pair,
            gatePassing: true,
            earnedConfidence: conf,
            direction,
            horizon: 2,
            excursionProfile: { favorablePips: 10, adversePips: 5 },
            stopLossPips: 5,
            takeProfitPips: 10,
            newsSuppressed: false,
            rationale: "",
            analogueLabels: [],
          };

          // At-the-confidence threshold ⇒ fires (>= boundary, Requirement 1.1).
          const atThreshold: DashboardConfig = {
            confidenceThreshold: conf,
            maxConcurrentAligned: DEFAULT_MAX_CONCURRENT_ALIGNED,
          };
          const surfacedView = dailyRun(DECISION_DATE, [evaluation], atThreshold);
          expect(surfacedView.cards.map((c) => c.pair)).toEqual([pair]);

          // A threshold strictly above the confidence ⇒ silent (Req 16.2, 16.4).
          // Only meaningful when a strictly-greater threshold exists in [0,1].
          const higher = conf + gap;
          if (higher <= 1) {
            const above: DashboardConfig = {
              confidenceThreshold: higher,
              maxConcurrentAligned: DEFAULT_MAX_CONCURRENT_ALIGNED,
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
