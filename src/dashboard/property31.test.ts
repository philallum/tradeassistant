import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RISK_BOUNDARY_NOT_ACTIONABLE, renderFiringCard } from "./renderFiringCard.js";
import type { ExcursionProfile, FiringCard } from "./types.js";
import { PAIRS } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { Horizon } from "../confidence/types.js";

// Feature: fx-daily-pattern-assistant, Property 31: For all firing setups, the rendered card includes the Pair, Direction_Class, selected Horizon, Earned_Confidence, the favorable-versus-adverse excursion profile, the empirical Stop_Loss and Take_Profit, and the AI rationale.
//
// Validates: Requirements 1.3, 1.5, 16.3, 21.4

const pairArb = fc.constantFrom(...PAIRS);

const directionArb: fc.Arbitrary<DirectionClass> = fc.constantFrom(
  "UP",
  "DOWN",
  "FLAT",
);

const horizonArb: fc.Arbitrary<Horizon> = fc.constantFrom(1, 2, 3);

const excursionArb: fc.Arbitrary<ExcursionProfile> = fc.record({
  favorablePips: fc.double({ min: 0, max: 500, noNaN: true }),
  adversePips: fc.double({ min: 0, max: 500, noNaN: true }),
});

/**
 * Risk boundaries are `number | null`: `null` models a below-floor,
 * non-actionable boundary (Requirement 21.5). `fc.option` gives both branches
 * frequent coverage so the not-actionable render path is exercised often.
 */
const riskBoundaryArb: fc.Arbitrary<number | null> = fc.option(
  fc.double({ min: 0, max: 500, noNaN: true }),
  { nil: null },
);

/**
 * A smart FiringCard generator: pair from the five supported PAIRS, an
 * enumerated Direction_Class, a 1|2|3 Horizon, Earned_Confidence constrained to
 * [0,1], a favorable/adverse excursion profile, `number | null` risk
 * boundaries, a non-empty rationale, and qualitative analogue labels.
 */
const firingCardArb: fc.Arbitrary<FiringCard> = fc.record({
  pair: pairArb,
  direction: directionArb,
  horizon: horizonArb,
  earnedConfidence: fc.double({ min: 0, max: 1, noNaN: true }),
  excursionProfile: excursionArb,
  stopLossPips: riskBoundaryArb,
  takeProfitPips: riskBoundaryArb,
  rationale: fc
    .string({ minLength: 1, maxLength: 120 })
    .filter((s) => s.trim().length > 0),
  analogueLabels: fc.array(fc.string({ maxLength: 30 }), { maxLength: 5 }),
});

describe("Property 31: the rendered firing card carries every required field", () => {
  it("faithfully preserves every required structured field from the input card", () => {
    fc.assert(
      fc.property(firingCardArb, (card) => {
        const rendered = renderFiringCard(card);

        // Pair, Direction_Class, selected Horizon, Earned_Confidence.
        expect(rendered.pair).toBe(card.pair);
        expect(rendered.direction).toBe(card.direction);
        expect(rendered.horizon).toBe(card.horizon);
        expect(rendered.earnedConfidence).toBe(card.earnedConfidence);

        // Favorable-versus-adverse excursion profile — both components.
        expect(rendered.excursionProfile.favorablePips).toBe(
          card.excursionProfile.favorablePips,
        );
        expect(rendered.excursionProfile.adversePips).toBe(
          card.excursionProfile.adversePips,
        );

        // Empirical Stop_Loss / Take_Profit preserve number | null exactly.
        expect(rendered.stopLossPips).toBe(card.stopLossPips);
        expect(rendered.takeProfitPips).toBe(card.takeProfitPips);

        // The AI rationale, verbatim.
        expect(rendered.rationale).toBe(card.rationale);
      }),
      { numRuns: 300 },
    );
  });

  it("renders a labelled line for every required field in the combined text", () => {
    fc.assert(
      fc.property(firingCardArb, (card) => {
        const { text } = renderFiringCard(card);

        // A marker/line for each required field is present.
        expect(text).toContain("Pair:");
        expect(text).toContain("Direction:");
        expect(text).toContain("Horizon:");
        expect(text).toContain("Earned Confidence:");
        expect(text).toContain("Excursion:");
        expect(text).toContain("Stop Loss:");
        expect(text).toContain("Take Profit:");
        expect(text).toContain("Rationale:");

        // The excursion line surfaces BOTH the favorable and adverse sides.
        expect(text).toContain("favorable");
        expect(text).toContain("adverse");

        // The concrete field values are surfaced in the text.
        expect(text).toContain(card.pair);
        expect(text).toContain(String(card.horizon));
        expect(text).toContain(card.rationale);
      }),
      { numRuns: 300 },
    );
  });

  it("surfaces the not-actionable marker for null boundaries and the pip value otherwise", () => {
    fc.assert(
      fc.property(firingCardArb, (card) => {
        const rendered = renderFiringCard(card);

        if (card.stopLossPips === null) {
          expect(rendered.stopLossDisplay).toBe(RISK_BOUNDARY_NOT_ACTIONABLE);
        } else {
          // A concrete pip magnitude is present rather than a fabricated one.
          expect(rendered.stopLossDisplay).toContain("pips");
          expect(rendered.stopLossDisplay).not.toBe(
            RISK_BOUNDARY_NOT_ACTIONABLE,
          );
          expect(rendered.stopLossDisplay).toContain(
            card.stopLossPips.toFixed(1),
          );
        }

        if (card.takeProfitPips === null) {
          expect(rendered.takeProfitDisplay).toBe(RISK_BOUNDARY_NOT_ACTIONABLE);
        } else {
          expect(rendered.takeProfitDisplay).toContain("pips");
          expect(rendered.takeProfitDisplay).not.toBe(
            RISK_BOUNDARY_NOT_ACTIONABLE,
          );
          expect(rendered.takeProfitDisplay).toContain(
            card.takeProfitPips.toFixed(1),
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  it("is deterministic: rendering the same card twice yields identical output", () => {
    fc.assert(
      fc.property(firingCardArb, (card) => {
        const a = renderFiringCard(card);
        const b = renderFiringCard(card);
        expect(b).toEqual(a);
      }),
      { numRuns: 300 },
    );
  });
});
