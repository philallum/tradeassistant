import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Horizon } from "../confidence/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type {
  DirectionClass,
  ForwardOutcome,
  HorizonOutcome,
} from "../retrieval/types.js";
import { evaluateGate2, frictionPenaltyPips } from "./gate2.js";

// Feature: fx-daily-pattern-assistant, Property 21: For all excursion sets and Pairs, the pair-specific Friction_Penalty (1.5 pips EURUSD/GBPUSD; 2.0 pips USDJPY/USDCHF/USDCAD) is deducted from the MFE/MAE excursions of both the pattern-model outcomes and the baseline outcomes before comparison, so the same penalty applied to both sides never advantages one side over the other.
//
// Validates: Requirement 11.7

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;
const HORIZONS: readonly Horizon[] = [1, 2, 3] as const;

/** Expected pair-specific Friction_Penalty (pips): 1.5 majors, 2.0 yen/CHF/CAD. */
const EXPECTED_FRICTION: Readonly<Record<Pair, number>> = {
  EURUSD: 1.5,
  GBPUSD: 1.5,
  USDJPY: 2.0,
  USDCHF: 2.0,
  USDCAD: 2.0,
};

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);
const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(...HORIZONS);
const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  ...DIRECTIONS,
);

/** A single-horizon excursion with non-negative MFE/MAE magnitudes (pips). */
const horizonOutcomeArb: fc.Arbitrary<HorizonOutcome> = fc.record({
  direction: directionArb,
  mfePips: fc.double({ min: 0, max: 200, noNaN: true }),
  maePips: fc.double({ min: 0, max: 200, noNaN: true }),
});

/** A full forward outcome across all three horizons. */
const forwardOutcomeArb: fc.Arbitrary<ForwardOutcome> = fc
  .tuple(horizonOutcomeArb, horizonOutcomeArb, horizonOutcomeArb)
  .map(([h1, h2, h3]) => ({ perHorizon: { 1: h1, 2: h2, 3: h3 } }));

/** An arbitrary excursion set (possibly empty). */
const excursionSetArb: fc.Arbitrary<readonly ForwardOutcome[]> = fc.array(
  forwardOutcomeArb,
  { minLength: 0, maxLength: 25 },
);

describe("Property 21: symmetric Friction_Penalty never advantages one side", () => {
  it("(a) frictionPenaltyPips returns the pair-specific penalty (1.5 majors, 2.0 yen/CHF/CAD)", () => {
    fc.assert(
      fc.property(pairArb, (pair) => {
        expect(frictionPenaltyPips(pair)).toBe(EXPECTED_FRICTION[pair]);
      }),
      { numRuns: 100 },
    );
  });

  it("(b) identical model and baseline excursions => Gate 2 margin is exactly 0 (friction on both cancels)", () => {
    fc.assert(
      fc.property(
        pairArb,
        horizonArb,
        excursionSetArb,
        (pair, horizon, outcomes) => {
          // The SAME pair-specific friction is deducted from both sides. When
          // the two excursion sets are identical, the post-friction metrics are
          // identical too, so the comparison margin is exactly 0 — the penalty
          // never tips the comparison toward either side. (Requirement 11.7)
          const result = evaluateGate2({
            pair,
            horizon,
            gate1Passed: true,
            modelOutcomes: outcomes,
            baselineOutcomes: outcomes,
          });

          expect(result.evaluated).toBe(true);
          expect(result.modelRiskAdj).toBe(result.baselineRiskAdj);
          expect(result.margin).toBe(0);
          // A zero margin still passes (>= 0), i.e. never disadvantages either.
          expect(result.passed).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("(c) friction is applied symmetrically: swapping model and baseline negates the margin (no side is privileged)", () => {
    fc.assert(
      fc.property(
        pairArb,
        horizonArb,
        excursionSetArb,
        excursionSetArb,
        (pair, horizon, modelOutcomes, baselineOutcomes) => {
          const forward = evaluateGate2({
            pair,
            horizon,
            gate1Passed: true,
            modelOutcomes,
            baselineOutcomes,
          });
          const swapped = evaluateGate2({
            pair,
            horizon,
            gate1Passed: true,
            modelOutcomes: baselineOutcomes,
            baselineOutcomes: modelOutcomes,
          });

          // The identical penalty is deducted from whichever set plays the
          // "model" role, so swapping the two sides simply negates the margin.
          // If friction favored one *role* over the other, this antisymmetry
          // would break. (Requirement 11.7)
          expect(swapped.margin).toBeCloseTo(-forward.margin, 9);
          // Each side's post-friction metric is intrinsic to its own
          // excursions, independent of which role it occupies.
          expect(swapped.modelRiskAdj).toBeCloseTo(forward.baselineRiskAdj, 9);
          expect(swapped.baselineRiskAdj).toBeCloseTo(forward.modelRiskAdj, 9);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("(c') the friction never flips which side is larger purely by being applied: with identical excursions the sign is neutral under any pair's penalty", () => {
    fc.assert(
      fc.property(
        horizonArb,
        excursionSetArb,
        (horizon, outcomes) => {
          // For the same underlying excursions on both sides, computing the
          // margin under every pair's friction must yield exactly 0 for all of
          // them — the penalty applied symmetrically cannot advantage a side,
          // regardless of the pair-specific magnitude (1.5 vs 2.0). This
          // contrasts the friction magnitudes against a friction-free (0)
          // comparison, which is likewise 0 for identical sets.
          for (const pair of PAIRS) {
            const withFriction = evaluateGate2({
              pair,
              horizon,
              gate1Passed: true,
              modelOutcomes: outcomes,
              baselineOutcomes: outcomes,
            });
            expect(withFriction.margin).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
