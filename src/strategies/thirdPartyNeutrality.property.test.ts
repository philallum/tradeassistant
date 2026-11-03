// Feature: multi-strategy-confluence-engine, Property 21: A zero-weight third-party signal has no effect
//
// With the default Confluence_Engine configuration the `third_party` weight is
// 0 (display-only until validated; Requirement 8.4). A zero-weight signal
// contributes nothing to the total weight W, nothing to the weighted sum, and
// nothing to conflict detection or classification (which both skip
// non-positive-weight signals). So for an arbitrary set of the other five
// signals, the engine's observable verdict — `score`, `status`, and
// `opposingStrategyIds` — must be IDENTICAL whether a `third_party` signal is
//   - absent,
//   - present (any direction / strength), or
//   - present but changed to a different `third_party` signal.
//
// The `signals` array itself DOES differ between these cases (it carries the
// zero-weight signal when present), so this property compares only the three
// decision-bearing fields, never `signals`.
//
// Validates: Requirements 8.4, 13.6

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createConfluenceEngine,
  type ConfluenceEngine,
  type ConfluenceResult,
} from "./confluenceEngine.js";
import { arbSignal } from "./testing/arbitraries.js";
import { STRATEGY_IDS } from "./types.js";
import type { StrategySignal } from "./types.js";

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** Every Strategy_Id except `third_party`. */
const NON_THIRD_PARTY_IDS = STRATEGY_IDS.filter((id) => id !== "third_party");

/**
 * A set of valid signals drawn from the five non-`third_party` strategies, at
 * most one per id, length 0..5. This is the "base" set that must produce the
 * same verdict with or without a zero-weight `third_party` signal alongside it.
 */
const arbBaseSignalSet: fc.Arbitrary<StrategySignal[]> = fc
  .subarray([...NON_THIRD_PARTY_IDS], {
    minLength: 0,
    maxLength: NON_THIRD_PARTY_IDS.length,
  })
  .chain((ids) =>
    ids.length === 0
      ? fc.constant<StrategySignal[]>([])
      : fc.tuple(...ids.map((id) => arbSignal(id))),
  );

/** An arbitrary valid `third_party` signal (any direction / strength). */
const arbThirdPartySignal: fc.Arbitrary<StrategySignal> =
  arbSignal("third_party");

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** The default engine (so `third_party` weight is 0). Asserts the Result is ok. */
function makeDefaultEngine(): ConfluenceEngine {
  const result = createConfluenceEngine();
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`createConfluenceEngine failed: ${result.error.message}`);
  }
  // Guard: the property only holds because third_party is weight 0 by default.
  expect(result.value.config.weights.third_party).toBe(0);
  return result.value;
}

/** Aggregate and assert success, returning the three decision-bearing fields. */
function verdict(
  engine: ConfluenceEngine,
  signals: readonly StrategySignal[],
): Pick<ConfluenceResult, "score" | "status" | "opposingStrategyIds"> {
  const result = engine.aggregate(signals);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`aggregate failed: ${result.error.message}`);
  }
  const { score, status, opposingStrategyIds } = result.value;
  return { score, status, opposingStrategyIds };
}

// ---------------------------------------------------------------------------
// Property.
// ---------------------------------------------------------------------------

describe("Property 21: A zero-weight third-party signal has no effect", () => {
  it("adding, removing, or changing a zero-weight third_party signal leaves score, status, and opposingStrategyIds unchanged (Requirements 8.4, 13.6)", () => {
    fc.assert(
      fc.property(
        arbBaseSignalSet,
        arbThirdPartySignal,
        arbThirdPartySignal,
        (base, thirdParty, changedThirdParty) => {
          const engine = makeDefaultEngine();

          // Baseline: no third_party signal at all.
          const withoutVerdict = verdict(engine, base);

          // Adding a third_party signal must not change the verdict.
          const withVerdict = verdict(engine, [...base, thirdParty]);
          expect(withVerdict).toEqual(withoutVerdict);

          // Changing it to a different third_party signal must not either.
          const withChangedVerdict = verdict(engine, [
            ...base,
            changedThirdParty,
          ]);
          expect(withChangedVerdict).toEqual(withoutVerdict);

          // (Removing it is the baseline case above — the three verdicts all
          // agree, so add/remove/change are mutually interchangeable.)
          expect(withChangedVerdict).toEqual(withVerdict);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("the signals array DOES differ when a third_party signal is present (sanity check)", () => {
    fc.assert(
      fc.property(
        arbBaseSignalSet,
        arbThirdPartySignal,
        (base, thirdParty) => {
          const engine = makeDefaultEngine();

          const without = engine.aggregate(base);
          const withTp = engine.aggregate([...base, thirdParty]);
          expect(without.ok).toBe(true);
          expect(withTp.ok).toBe(true);
          if (!without.ok || !withTp.ok) return;

          // The zero-weight signal is still carried in `signals`, so the arrays
          // differ by exactly that one entry — confirming the verdict-equality
          // above is a real neutrality result, not an artefact of dropped input.
          expect(withTp.value.signals.length).toBe(
            without.value.signals.length + 1,
          );
          expect(
            withTp.value.signals.some((s) => s.strategyId === "third_party"),
          ).toBe(true);
          expect(
            without.value.signals.some((s) => s.strategyId === "third_party"),
          ).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
