import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { Horizon } from "../confidence/types.js";
import { evaluateGate2, type Gate2Input } from "./gate2.js";

// Feature: fx-daily-pattern-assistant, Property 22: For all configurations, Gate_2 is evaluated only after Gate_1 has passed, and Gate_2 passes if and only if the pattern-model's excursion-weighted hit metric over the selected Horizon is >= the baseline's after Friction_Penalty deduction (margin >= 0).
//
// Validates: Requirement 11.8

const DIRECTIONS: readonly DirectionClass[] = ["UP", "DOWN", "FLAT"] as const;

const pairArb: fc.Arbitrary<Pair> = fc.constantFrom(...PAIRS);
const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(1, 2, 3);
const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  ...DIRECTIONS,
);

/**
 * A single forward outcome with per-horizon MFE/MAE excursions. Excursion
 * magnitudes are non-negative pips within a bounded range so the friction
 * deduction stays meaningful. (Requirement 11.7)
 */
const forwardOutcomeArb: fc.Arbitrary<ForwardOutcome> = fc
  .record({
    h1: horizonOutcomeArb(),
    h2: horizonOutcomeArb(),
    h3: horizonOutcomeArb(),
  })
  .map(({ h1, h2, h3 }) => ({ perHorizon: { 1: h1, 2: h2, 3: h3 } }));

function horizonOutcomeArb(): fc.Arbitrary<{
  direction: DirectionClass;
  mfePips: number;
  maePips: number;
}> {
  return fc.record({
    direction: directionArb,
    mfePips: fc.double({ min: 0, max: 100, noNaN: true }),
    maePips: fc.double({ min: 0, max: 100, noNaN: true }),
  });
}

/** A set of forward outcomes (may be empty). */
const outcomeSetArb: fc.Arbitrary<readonly ForwardOutcome[]> = fc.array(
  forwardOutcomeArb,
  { minLength: 0, maxLength: 25 },
);

describe("Property 22: Gate 2 sequencing and risk-adjusted threshold", () => {
  // Part (1) — Sequencing: Gate 2 is evaluated only AFTER Gate 1 has passed.
  // For every input where gate1Passed === false, Gate 2 must NOT be evaluated
  // and must not pass, regardless of the excursions supplied. (Requirement 11.8)
  it("does NOT evaluate Gate 2 when Gate 1 has not passed (no comparison performed)", () => {
    fc.assert(
      fc.property(
        pairArb,
        horizonArb,
        outcomeSetArb,
        outcomeSetArb,
        (pair, horizon, modelOutcomes, baselineOutcomes) => {
          const input: Gate2Input = {
            pair,
            horizon,
            gate1Passed: false,
            modelOutcomes,
            baselineOutcomes,
          };

          const result = evaluateGate2(input);

          // Gate 2 is not evaluated and does not pass; no comparison is made,
          // so the risk-adjusted metrics remain neutral (0) irrespective of
          // the excursions.
          expect(result.evaluated).toBe(false);
          expect(result.passed).toBe(false);
          expect(result.modelRiskAdj).toBe(0);
          expect(result.baselineRiskAdj).toBe(0);
          expect(result.margin).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Part (2) — Threshold (iff): once Gate 1 has passed, Gate 2 passes IFF the
  // model's post-friction excursion-weighted hit metric is at least the
  // baseline's (margin = modelRiskAdj - baselineRiskAdj >= 0). (Requirement 11.8)
  it("evaluates Gate 2 and passes IFF margin >= 0 when Gate 1 has passed", () => {
    fc.assert(
      fc.property(
        pairArb,
        horizonArb,
        outcomeSetArb,
        outcomeSetArb,
        (pair, horizon, modelOutcomes, baselineOutcomes) => {
          const input: Gate2Input = {
            pair,
            horizon,
            gate1Passed: true,
            modelOutcomes,
            baselineOutcomes,
          };

          const result = evaluateGate2(input);

          // Gate 2 IS evaluated once Gate 1 has passed.
          expect(result.evaluated).toBe(true);

          // margin is exactly model minus baseline risk-adjusted metrics.
          expect(result.margin).toBe(
            result.modelRiskAdj - result.baselineRiskAdj,
          );

          // The iff: passed === true exactly when margin >= 0 (including the
          // boundary margin === 0).
          expect(result.passed).toBe(result.margin >= 0);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Boundary coverage: construct inputs that force margins strictly negative,
  // exactly zero, and strictly positive, and assert the iff holds at each —
  // in particular that the margin === 0 boundary PASSES. (Requirement 11.8)
  it("passes at the margin === 0 boundary and honors the iff for negative/zero/positive margins", () => {
    const single = (
      direction: DirectionClass,
      mfePips: number,
      maePips: number,
    ): ForwardOutcome => {
      const h = { direction, mfePips, maePips };
      return { perHorizon: { 1: h, 2: h, 3: h } };
    };

    fc.assert(
      fc.property(
        pairArb,
        horizonArb,
        // Keep the base MFE/MAE clear of the max Friction_Penalty (2.0 pips) so
        // that the +delta shift is never masked by the post-friction clamp at 0
        // — this isolates the sign of the margin to the delta we inject.
        fc.double({ min: 5, max: 100, noNaN: true }),
        fc.double({ min: 5, max: 100, noNaN: true }),
        fc.double({ min: 1, max: 50, noNaN: true }),
        (pair, horizon, mfe, mae, delta) => {
          const base = () => single("UP", mfe, mae);

          // Equal excursion sets => modelRiskAdj === baselineRiskAdj => margin 0.
          const zero = evaluateGate2({
            pair,
            horizon,
            gate1Passed: true,
            modelOutcomes: [base()],
            baselineOutcomes: [base()],
          });
          expect(zero.evaluated).toBe(true);
          expect(zero.margin).toBe(0);
          // Boundary: margin === 0 must PASS.
          expect(zero.passed).toBe(true);

          // Model has a strictly larger favorable excursion => positive margin.
          const positive = evaluateGate2({
            pair,
            horizon,
            gate1Passed: true,
            modelOutcomes: [single("UP", mfe + delta, mae)],
            baselineOutcomes: [base()],
          });
          expect(positive.evaluated).toBe(true);
          expect(positive.margin).toBeGreaterThan(0);
          expect(positive.passed).toBe(true);

          // Model has a strictly larger adverse excursion => negative margin.
          const negative = evaluateGate2({
            pair,
            horizon,
            gate1Passed: true,
            modelOutcomes: [single("UP", mfe, mae + delta)],
            baselineOutcomes: [base()],
          });
          expect(negative.evaluated).toBe(true);
          expect(negative.margin).toBeLessThan(0);
          expect(negative.passed).toBe(false);

          // The iff holds uniformly across all three cases.
          for (const r of [zero, positive, negative]) {
            expect(r.passed).toBe(r.margin >= 0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
