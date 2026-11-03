// Feature: multi-strategy-confluence-engine, Property 23: LLM-tagged values never enter strategies, adapters, or the engine
//
// The AI / Deterministic boundary for the confluence feature is enforced at
// every door a value can reach the deterministic core through. This guardrail
// proves that a value carrying the GENUINE LLM provenance brand (produced by
// the real `tagLlmOutput` helper, not a hand-rolled fake) is refused on all
// three entry points, and — just as important — that refusing it does not
// perturb the result computed for the surrounding VALID inputs:
//
//   1. validateStrategySignal — the single signal contract guard. An
//      LLM-tagged value is rejected with field "llm_tagged" BEFORE any shape,
//      id, direction, strength, or rationale check runs (Requirements 1.7, 1.8).
//   2. ConfluenceEngine.aggregate — re-validates every input. An LLM-tagged
//      value anywhere in the array rejects the WHOLE aggregation with
//      "invalid_signal" naming its index and an "llm_tagged" violation, and the
//      otherwise-identical valid-only array still aggregates to the same result
//      (Requirements 8.10, 13.8).
//   3. adaptThirdParty — refuses an LLM-tagged reference as `unavailable` with
//      a non-empty reason, while an untagged reference still adapts to the same
//      `signal` outcome (Requirements 7.8, 13.8).
//
// The real brand is applied via `tagLlmOutput` and detected with the exported
// `isLlmTagged` semantics from `src/llm/types.ts`, so the test exercises the
// same unforgeable, non-enumerable symbol marker the production guard keys off.
//
// Validates: Requirements 1.7, 8.10, 13.8

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { validateStrategySignal, type StrategySignal } from "./types.js";
import {
  createConfluenceEngine,
  type ConfluenceEngine,
} from "./confluenceEngine.js";
import {
  adaptThirdParty,
  type AdapterOutcome,
} from "./adapters.js";
import { arbLlmTagged, arbSignalSet } from "./testing/arbitraries.js";
import { tagLlmOutput } from "../llm/index.js";
import { isLlmTagged } from "../llm/types.js";
import { REFERENCE_DIRECTIONS } from "../external-signal/types.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";

// Every property below runs at least 100 iterations (Design test conventions).
const NUM_RUNS = 200;

/** A default engine; the guardrail is configuration-independent. */
function makeEngine(): ConfluenceEngine {
  const result = createConfluenceEngine();
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`createConfluenceEngine failed: ${result.error.message}`);
  }
  return result.value;
}

/** A fully valid External_Reference_Signal, with an optional finite score. */
const arbValidReference: fc.Arbitrary<ExternalReferenceSignal> = fc
  .record({
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
    direction: fc.constantFrom(...REFERENCE_DIRECTIONS),
    provider: fc.constantFrom("fcs", "provider-x", "demo"),
    fetchedAt: fc.constant("2020-06-01T00:00:00.000Z"),
    score: fc.option(
      fc.double({ min: -100, max: 100, noNaN: true, noDefaultInfinity: true }),
      { nil: undefined },
    ),
  })
  .map(({ score, ...rest }) =>
    score === undefined ? rest : { ...rest, score },
  );

describe("Property 23: LLM-tagged values never enter strategies, adapters, or the engine", () => {
  // -------------------------------------------------------------------------
  // Precondition: the real brand is detectable. If this ever regresses the
  // other assertions would be vacuously true, so pin it down explicitly.
  // -------------------------------------------------------------------------
  it("tags produced by tagLlmOutput are detected by isLlmTagged (real brand)", () => {
    fc.assert(
      fc.property(arbLlmTagged, (tagged) => {
        expect(isLlmTagged(tagged)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // -------------------------------------------------------------------------
  // 1. validateStrategySignal — the signal contract guard (Req 1.7, 1.8).
  // -------------------------------------------------------------------------
  it("validateStrategySignal rejects an LLM-tagged value with field llm_tagged (Req 1.7)", () => {
    fc.assert(
      fc.property(arbLlmTagged, (tagged) => {
        const result = validateStrategySignal(tagged);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        // The brand is checked FIRST, so the named field is always llm_tagged —
        // never a downstream shape / id / strength / rationale failure.
        expect(result.error.reason).toBe("invalid_signal");
        expect(result.error.field).toBe("llm_tagged");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // -------------------------------------------------------------------------
  // 2. ConfluenceEngine.aggregate — rejection AND non-perturbation (Req 8.10,
  //    13.8). The tagged value rejects the whole aggregation at its index, and
  //    the valid-only array (same signals, tag removed) aggregates unchanged.
  // -------------------------------------------------------------------------
  it("aggregate rejects an LLM-tagged value at its index with an llm_tagged violation (Req 8.10, 13.8)", () => {
    fc.assert(
      fc.property(
        arbSignalSet,
        arbLlmTagged,
        fc.nat(),
        (valid, tagged, insertSeed) => {
          const engine = makeEngine();
          const index =
            valid.length === 0 ? 0 : insertSeed % (valid.length + 1);
          const signals = [...valid];
          // The tagged value masquerades as a signal at an arbitrary position.
          signals.splice(index, 0, tagged as unknown as StrategySignal);

          const result = engine.aggregate(signals);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.reason).toBe("invalid_signal");
          if (result.error.reason === "invalid_signal") {
            // Every other entry is a known-valid signal, so the first (and
            // only) failure is the tagged value at the index we injected.
            expect(result.error.index).toBe(index);
            expect(result.error.violation.field).toBe("llm_tagged");
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("the valid-only aggregation is unchanged by the removed LLM-tagged value (Property 23 non-perturbation)", () => {
    fc.assert(
      fc.property(
        arbSignalSet,
        arbLlmTagged,
        fc.nat(),
        (valid, tagged, insertSeed) => {
          const engine = makeEngine();

          // Baseline: aggregate the valid signals on their own. This is the
          // output that MUST NOT be altered by the presence of a tagged value.
          const baseline = engine.aggregate(valid);
          expect(baseline.ok).toBe(true);

          // Now splice the tagged value in and confirm it is rejected (so it
          // never contributed to any score), leaving the baseline the authority.
          const index =
            valid.length === 0 ? 0 : insertSeed % (valid.length + 1);
          const withTagged = [...valid];
          withTagged.splice(index, 0, tagged as unknown as StrategySignal);
          const rejected = engine.aggregate(withTagged);
          expect(rejected.ok).toBe(false);

          // Re-running the valid-only aggregation yields byte-for-byte the same
          // result: the engine is pure and the tagged attempt had no residue.
          const afterRejection = engine.aggregate(valid);
          expect(afterRejection).toEqual(baseline);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // -------------------------------------------------------------------------
  // 3. adaptThirdParty — rejection AND non-perturbation (Req 7.8, 13.8). A
  //    tagged reference is unavailable; the same reference untagged still
  //    adapts to a signal, and tagging never changes that signal's value.
  // -------------------------------------------------------------------------
  it("adaptThirdParty refuses an LLM-tagged reference as unavailable (Req 7.8, 13.8)", () => {
    fc.assert(
      fc.property(arbLlmTagged, (tagged) => {
        const outcome: AdapterOutcome = adaptThirdParty(tagged);
        expect(outcome.kind).toBe("unavailable");
        if (outcome.kind === "unavailable") {
          expect(outcome.reason.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("tagging a valid reference does not alter the signal the untagged reference adapts to (Property 23 non-perturbation)", () => {
    fc.assert(
      fc.property(arbValidReference, (reference) => {
        // The untagged reference is the authority for the adapted outcome.
        const baseline = adaptThirdParty(reference);

        // The SAME reference, carrying the real LLM brand, is refused outright.
        const tagged = tagLlmOutput(
          reference,
          "signal_rationale",
          "2020-01-01T00:00:00.000Z",
        );
        const taggedOutcome = adaptThirdParty(tagged);
        expect(taggedOutcome.kind).toBe("unavailable");

        // Re-adapting the untagged reference yields the identical outcome: the
        // tagged attempt produced no signal and left nothing behind.
        const afterRejection = adaptThirdParty(reference);
        expect(afterRejection).toEqual(baseline);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
