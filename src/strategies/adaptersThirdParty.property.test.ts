// Feature: multi-strategy-confluence-engine, Property 14: Third-party adapter maps and normalises deterministically
//
// adaptThirdParty maps a third-party External_Reference_Signal into the shared
// StrategySignal contract by a fixed, deterministic rule and reports every
// unmappable reference `unavailable` with a non-empty reason:
//   - BUY -> UP, SELL -> DOWN, HOLD -> FLAT (Requirement 7.3).
//   - UP/DOWN with a finite score: strength = clamp01(|score| / fullScaleAbs),
//     a linear clamped normalisation always in [0, 1] (Requirement 7.4), and
//     NON-DECREASING in |score| for a fixed scale.
//   - UP/DOWN with no score: strength 0.5 (Requirement 7.6).
//   - FLAT: strength 0 always (Requirement 7.5).
//   - Determinism: the same input yields the same output (Requirement 7.9).
//   - Unknown direction / NaN / infinite score: unavailable with a non-empty
//     reason (Requirement 7.8).
//   - The reference is never mutated (Requirement 7.9).
//
// Validates: Requirements 7.3, 7.4, 7.5, 7.6, 7.8, 7.9

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  adaptThirdParty,
  DEFAULT_THIRD_PARTY_SCALE,
  type AdapterOutcome,
  type ThirdPartyScoreScale,
} from "./adapters.js";
import { clamp01 } from "./indicators.js";
import { REFERENCE_DIRECTIONS } from "../external-signal/types.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";
import { tagLlmOutput } from "../llm/llmInterface.js";

// ---------------------------------------------------------------------------
// Expected mapping from reference direction to signal direction — an
// independent restatement of Requirement 7.3, written from scratch here.
// ---------------------------------------------------------------------------
const EXPECTED_SIGNAL_DIRECTION = {
  BUY: "UP",
  SELL: "DOWN",
  HOLD: "FLAT",
} as const;

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** A reference direction (BUY / SELL / HOLD). */
const arbReferenceDirection = (): fc.Arbitrary<"BUY" | "SELL" | "HOLD"> =>
  fc.constantFrom(...REFERENCE_DIRECTIONS);

/** A non-FLAT reference direction (BUY / SELL), i.e. one that maps to UP/DOWN. */
const arbNonFlatReferenceDirection = (): fc.Arbitrary<"BUY" | "SELL"> =>
  fc.constantFrom("BUY", "SELL");

/** A finite score on a realistic (and sometimes large) range. */
const arbFiniteScore = (): fc.Arbitrary<number> =>
  fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true });

/** A positive full-scale value for a non-default scale. */
const arbScale = (): fc.Arbitrary<ThirdPartyScoreScale> =>
  fc
    .double({ min: 0.01, max: 50, noNaN: true, noDefaultInfinity: true })
    .map((fullScaleAbs) => ({ fullScaleAbs }));

/** The fixed provenance fields every valid reference carries. */
const arbProvenance = (): fc.Arbitrary<{
  pair: ExternalReferenceSignal["pair"];
  decisionDate: ExternalReferenceSignal["decisionDate"];
  provider: string;
  fetchedAt: string;
}> =>
  fc.record({
    pair: fc.constantFrom<ExternalReferenceSignal["pair"]>(
      "EURUSD",
      "GBPUSD",
      "USDJPY",
      "USDCHF",
      "USDCAD",
    ),
    decisionDate: fc.constant<ExternalReferenceSignal["decisionDate"]>(
      "2020-06-01",
    ),
    provider: fc.constantFrom("fcs", "provider-x", "demo"),
    fetchedAt: fc.constant("2020-06-01T00:00:00.000Z"),
  });

/** A fully valid reference: a direction, provenance, and an optional score. */
const arbValidReference = (): fc.Arbitrary<ExternalReferenceSignal> =>
  fc
    .tuple(
      arbReferenceDirection(),
      arbProvenance(),
      fc.option(arbFiniteScore(), { nil: undefined }),
    )
    .map(([direction, prov, score]) => ({
      ...prov,
      direction,
      ...(score === undefined ? {} : { score }),
    }));

// A tiny deep-freeze so a mutation of the reference (or any nested value) would
// throw in strict mode, proving the adapter never writes back (Requirement 7.9).
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Properties.
// ---------------------------------------------------------------------------

describe("Property 14: Third-party adapter maps and normalises deterministically", () => {
  it("maps BUY->UP, SELL->DOWN, HOLD->FLAT for any valid reference (Requirement 7.3)", () => {
    fc.assert(
      fc.property(arbValidReference(), arbScale(), (reference, scale) => {
        const outcome = adaptThirdParty(reference, scale);
        expect(outcome.kind).toBe("signal");
        if (outcome.kind === "signal") {
          expect(outcome.signal.strategyId).toBe("third_party");
          expect(outcome.signal.direction).toBe(
            EXPECTED_SIGNAL_DIRECTION[reference.direction],
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it("normalises UP/DOWN with a finite score to clamp01(|score| / fullScaleAbs), always in [0, 1] (Requirement 7.4)", () => {
    fc.assert(
      fc.property(
        arbNonFlatReferenceDirection(),
        arbFiniteScore(),
        arbScale(),
        arbProvenance(),
        (direction, score, scale, prov) => {
          const reference: ExternalReferenceSignal = {
            ...prov,
            direction,
            score,
          };
          const outcome = adaptThirdParty(reference, scale);
          expect(outcome.kind).toBe("signal");
          if (outcome.kind === "signal") {
            const expected = clamp01(Math.abs(score) / scale.fullScaleAbs);
            expect(outcome.signal.strength).toBe(expected);
            expect(outcome.signal.strength).toBeGreaterThanOrEqual(0);
            expect(outcome.signal.strength).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is non-decreasing in |score| for a fixed direction and scale (monotonicity, Requirement 7.4)", () => {
    const strengthFor = (
      direction: "BUY" | "SELL",
      score: number,
      scale: ThirdPartyScoreScale,
      prov: Omit<ExternalReferenceSignal, "direction" | "score">,
    ): number => {
      const reference: ExternalReferenceSignal = { ...prov, direction, score };
      const outcome = adaptThirdParty(reference, scale);
      if (outcome.kind !== "signal") {
        throw new Error("expected a signal for a finite-score reference");
      }
      return outcome.signal.strength;
    };

    fc.assert(
      fc.property(
        arbNonFlatReferenceDirection(),
        arbFiniteScore(),
        arbFiniteScore(),
        arbScale(),
        arbProvenance(),
        (direction, scoreA, scoreB, scale, prov) => {
          // Order the two scores by magnitude: |small| <= |large|.
          const [small, large] =
            Math.abs(scoreA) <= Math.abs(scoreB)
              ? [scoreA, scoreB]
              : [scoreB, scoreA];
          const strengthSmall = strengthFor(direction, small, scale, prov);
          const strengthLarge = strengthFor(direction, large, scale, prov);
          // A larger |score| never yields a smaller strength.
          expect(strengthLarge).toBeGreaterThanOrEqual(strengthSmall);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("uses strength 0.5 for UP/DOWN with no score (Requirement 7.6)", () => {
    fc.assert(
      fc.property(
        arbNonFlatReferenceDirection(),
        arbScale(),
        arbProvenance(),
        (direction, scale, prov) => {
          const reference: ExternalReferenceSignal = { ...prov, direction };
          const outcome = adaptThirdParty(reference, scale);
          expect(outcome.kind).toBe("signal");
          if (outcome.kind === "signal") {
            expect(outcome.signal.direction).toBe(
              EXPECTED_SIGNAL_DIRECTION[direction],
            );
            expect(outcome.signal.strength).toBe(0.5);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("maps HOLD to FLAT with strength 0 regardless of score or scale (Requirement 7.5)", () => {
    fc.assert(
      fc.property(
        fc.option(arbFiniteScore(), { nil: undefined }),
        arbScale(),
        arbProvenance(),
        (score, scale, prov) => {
          const reference: ExternalReferenceSignal = {
            ...prov,
            direction: "HOLD",
            ...(score === undefined ? {} : { score }),
          };
          const outcome = adaptThirdParty(reference, scale);
          expect(outcome.kind).toBe("signal");
          if (outcome.kind === "signal") {
            expect(outcome.signal.direction).toBe("FLAT");
            expect(outcome.signal.strength).toBe(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is deterministic: the same input yields the same output (Requirement 7.9)", () => {
    fc.assert(
      fc.property(arbValidReference(), arbScale(), (reference, scale) => {
        const first = adaptThirdParty(reference, scale);
        const second = adaptThirdParty(reference, scale);
        expect(second).toEqual(first);
      }),
      { numRuns: 200 },
    );
  });

  it("reports unavailable with a non-empty reason for an unknown direction (Requirement 7.8)", () => {
    const arbUnknownDirection = fc
      .oneof(
        fc.string(),
        fc.constantFrom("buy", "sell", "hold", "LONG", "SHORT", "NONE"),
        fc.integer(),
        fc.constant(null),
      )
      .filter(
        (v) => !(REFERENCE_DIRECTIONS as readonly unknown[]).includes(v),
      );

    fc.assert(
      fc.property(
        arbUnknownDirection,
        fc.option(arbFiniteScore(), { nil: undefined }),
        arbProvenance(),
        (direction, score, prov) => {
          const reference = {
            ...prov,
            direction,
            ...(score === undefined ? {} : { score }),
          };
          const outcome = adaptThirdParty(reference);
          expect(outcome.kind).toBe("unavailable");
          if (outcome.kind === "unavailable") {
            expect(outcome.reason.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("reports unavailable with a non-empty reason for a NaN or infinite score (Requirement 7.8)", () => {
    const arbNonFiniteScore = fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    );

    fc.assert(
      fc.property(
        arbReferenceDirection(),
        arbNonFiniteScore,
        arbScale(),
        arbProvenance(),
        (direction, score, scale, prov) => {
          const reference: ExternalReferenceSignal = {
            ...prov,
            direction,
            score,
          };
          const outcome = adaptThirdParty(reference, scale);
          expect(outcome.kind).toBe("unavailable");
          if (outcome.kind === "unavailable") {
            expect(outcome.reason.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("refuses an LLM-tagged reference as unavailable with a non-empty reason (Requirement 7.8)", () => {
    fc.assert(
      fc.property(arbValidReference(), (reference) => {
        const tagged = tagLlmOutput(
          reference,
          "signal_rationale",
          "2020-01-01T00:00:00.000Z",
        );
        const outcome: AdapterOutcome = adaptThirdParty(tagged);
        expect(outcome.kind).toBe("unavailable");
        if (outcome.kind === "unavailable") {
          expect(outcome.reason.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("never mutates the reference (Requirement 7.9)", () => {
    fc.assert(
      fc.property(arbValidReference(), arbScale(), (reference, scale) => {
        // Capture each field by identity (Object.is distinguishes -0 from 0,
        // which a JSON snapshot would silently normalise away).
        const before = Object.entries(reference) as [string, unknown][];
        const frozen = deepFreeze(reference);
        // A write-back would throw against the frozen object; none should occur.
        expect(() => adaptThirdParty(frozen, scale)).not.toThrow();
        const after = Object.entries(frozen) as [string, unknown][];
        expect(after.length).toBe(before.length);
        for (let i = 0; i < before.length; i++) {
          expect(after[i]![0]).toBe(before[i]![0]);
          expect(Object.is(after[i]![1], before[i]![1])).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("uses DEFAULT_THIRD_PARTY_SCALE when no scale is supplied (Requirements 7.4, 7.6)", () => {
    fc.assert(
      fc.property(
        arbNonFlatReferenceDirection(),
        arbFiniteScore(),
        arbProvenance(),
        (direction, score, prov) => {
          const reference: ExternalReferenceSignal = {
            ...prov,
            direction,
            score,
          };
          const withDefault = adaptThirdParty(reference);
          const withExplicit = adaptThirdParty(
            reference,
            DEFAULT_THIRD_PARTY_SCALE,
          );
          expect(withDefault).toEqual(withExplicit);
        },
      ),
      { numRuns: 100 },
    );
  });
});
