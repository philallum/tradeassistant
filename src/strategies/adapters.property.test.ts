// Feature: multi-strategy-confluence-engine, Property 13: Custom-pattern adapter preserves direction and confidence
//
// The custom-pattern adapter bridges the deterministic pattern matcher's
// `PairEvaluation` into the shared `StrategySignal` contract. For every valid
// evaluation — any `direction` (UP/DOWN/FLAT) and any `earnedConfidence` in
// [0, 1] — `adaptCustomPattern` must:
//   - UP/DOWN: emit a signal with the SAME direction and `strength` exactly
//     equal to `earnedConfidence` (Requirements 7.1, 7.2).
//   - FLAT: emit a signal with direction FLAT and `strength` exactly 0,
//     regardless of the confidence value (Requirement 7.2).
//   - Never mutate the input `evaluation` (Requirement 7.9): the input is
//     deep-frozen before the call, so any write would throw, and its fields are
//     asserted unchanged afterwards.
//
// A valid earnedConfidence always lies in [0, 1], so buildSignal never rejects
// it and the outcome is always a `signal` here.
//
// Validates: Requirements 7.1, 7.2, 7.9

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { adaptCustomPattern } from "./adapters.js";
import type { SignalDirection } from "./types.js";
import type { Confidence } from "../confidence/types.js";

/**
 * The read-only slice of `PairEvaluation` the adapter actually consumes: just
 * the deterministic `direction` and `earnedConfidence`. Building only this slice
 * keeps the generator focused on the input space the property constrains.
 * `earnedConfidence` carries the branded `Confidence` type, matching the real
 * `PairEvaluation` field the adapter reads.
 */
interface EvaluationSlice {
  readonly direction: SignalDirection;
  readonly earnedConfidence: Confidence;
}

/** A Signal_Direction drawn from the three canonical values. */
const arbDirection: fc.Arbitrary<SignalDirection> = fc.constantFrom(
  "UP",
  "DOWN",
  "FLAT",
);

/**
 * A valid Earned_Confidence: a finite number in [0, 1]. The brand is applied at
 * the type level — the generated value is a genuine `[0, 1]` number, exactly
 * what the real selector guarantees for the `Confidence` brand.
 */
const arbEarnedConfidence: fc.Arbitrary<Confidence> = fc
  .double({
    min: 0,
    max: 1,
    noNaN: true,
    noDefaultInfinity: true,
  })
  .map((n) => n as Confidence);

/** A valid evaluation slice: any direction paired with a valid confidence. */
const arbEvaluationSlice: fc.Arbitrary<EvaluationSlice> = fc.record({
  direction: arbDirection,
  earnedConfidence: arbEarnedConfidence,
});

describe("Property 13: Custom-pattern adapter preserves direction and confidence", () => {
  it("preserves direction and confidence (FLAT forces strength 0) without mutating input", () => {
    fc.assert(
      fc.property(arbEvaluationSlice, ({ direction, earnedConfidence }) => {
        // Deep-freeze the input so any write attempt during adaptation throws
        // (Requirement 7.9). Object.freeze on this flat record is sufficient.
        const evaluation: EvaluationSlice = Object.freeze({
          direction,
          earnedConfidence,
        });

        const outcome = adaptCustomPattern(evaluation);

        // A valid [0, 1] confidence never fails buildSignal, so the adapter
        // always returns a signal here.
        expect(outcome.kind).toBe("signal");
        if (outcome.kind !== "signal") return;

        const { signal } = outcome;
        expect(signal.strategyId).toBe("custom_pattern");

        if (direction === "FLAT") {
          // Req 7.2: FLAT yields FLAT with strength exactly 0, whatever the
          // confidence value was.
          expect(signal.direction).toBe("FLAT");
          expect(signal.strength).toBe(0);
        } else {
          // Reqs 7.1, 7.2: UP/DOWN preserve the direction and set strength
          // exactly equal to earnedConfidence.
          expect(signal.direction).toBe(direction);
          expect(signal.strength).toBe(earnedConfidence);
        }

        // Req 7.9: the input evaluation is unchanged (frozen above, re-checked
        // here) — the adapter only reads it.
        expect(evaluation.direction).toBe(direction);
        expect(evaluation.earnedConfidence).toBe(earnedConfidence);
      }),
      { numRuns: 200 },
    );
  });
});
