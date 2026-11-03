// Feature: multi-strategy-confluence-engine, Property 22: Invalid engine input or configuration is rejected
//
// The Confluence_Engine refuses bad configuration BEFORE an engine exists, and
// refuses bad aggregate input BEFORE any score is produced. This property pins
// down every rejection path with a typed error that names the offending thing:
//
//   - createConfluenceEngine rejects a weight that is negative, NaN, or
//     infinite with reason "invalid_config" naming that Strategy_Id (Req 8.6),
//     and rejects a conflictThreshold / alignmentThreshold that is non-finite
//     or outside [0, 1] with reason "invalid_config" naming that parameter
//     (Req 9.7). On failure no engine is returned.
//   - aggregate rejects an input array containing a value that fails
//     validateStrategySignal with reason "invalid_signal" naming the offending
//     index (Req 8.10) — including an LLM-tagged value (Req 13.8, lightly
//     covered here; task 13.1 is the dedicated guardrail).
//   - aggregate rejects an input array with two signals sharing a Strategy_Id
//     with reason "duplicate_strategy_id" naming the duplicate (Req 8.7).
//
// Validates: Requirements 8.6, 8.7, 8.10, 9.7

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  createConfluenceEngine,
  type ConfluenceEngine,
} from "./confluenceEngine.js";
import {
  arbInvalidSignal,
  arbLlmTagged,
  arbSignal,
} from "./testing/arbitraries.js";
import { STRATEGY_IDS } from "./types.js";
import type { StrategyId, StrategySignal } from "./types.js";

// ---------------------------------------------------------------------------
// Config-rejection generators.
//
// validateConfig checks weights FIRST (in canonical STRATEGY_IDS order), then
// conflictThreshold, then alignmentThreshold, and returns the FIRST failure.
// To make the named parameter deterministic, each generator below breaks
// EXACTLY ONE parameter and leaves everything else valid, so the first (and
// only) failing parameter is the one we broke.
// ---------------------------------------------------------------------------

/** A value that is a bad weight: negative, NaN, or infinite (Req 8.6). */
const arbBadWeightValue: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: -1000, max: -1e-9, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ),
);

/** A valid finite, non-negative weight. */
const arbGoodWeightValue: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 10,
  noNaN: true,
  noDefaultInfinity: true,
});

/** A valid threshold within [0, 1]. */
const arbGoodThreshold: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});

/** A bad threshold: non-finite, below 0, or above 1 (Req 9.7). */
const arbBadThresholdValue: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: 1.0000001, max: 1000, noNaN: true, noDefaultInfinity: true }),
  fc.double({ min: -1000, max: -1e-9, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ),
);

interface ConfigOverride {
  readonly weights: Record<StrategyId, number>;
  readonly conflictThreshold: number;
  readonly alignmentThreshold: number;
}

/** A fully-valid config override (used as the base to corrupt one field of). */
const arbValidConfig: fc.Arbitrary<ConfigOverride> = fc
  .record({
    weights: fc.tuple(...STRATEGY_IDS.map(() => arbGoodWeightValue)),
    conflictThreshold: arbGoodThreshold,
    alignmentThreshold: arbGoodThreshold,
  })
  .map(({ weights, conflictThreshold, alignmentThreshold }) => {
    const w = {} as Record<StrategyId, number>;
    STRATEGY_IDS.forEach((id, i) => {
      w[id] = weights[i]!;
    });
    return { weights: w, conflictThreshold, alignmentThreshold };
  });

/**
 * A config that breaks exactly ONE weight (naming which Strategy_Id). Only that
 * id is corrupted; the rest stay valid, so validateConfig names exactly it.
 */
const arbBadWeightConfig: fc.Arbitrary<{
  config: ConfigOverride;
  expectedParameter: StrategyId;
}> = fc
  .record({
    base: arbValidConfig,
    id: fc.constantFrom(...STRATEGY_IDS),
    badValue: arbBadWeightValue,
  })
  .map(({ base, id, badValue }) => {
    const weights = { ...base.weights, [id]: badValue };
    return {
      config: { ...base, weights },
      expectedParameter: id,
    };
  });

/**
 * A config that breaks exactly the conflictThreshold (both thresholds cannot be
 * broken at once here, so the named parameter is always "conflictThreshold").
 */
const arbBadConflictThresholdConfig: fc.Arbitrary<ConfigOverride> = fc
  .record({ base: arbValidConfig, bad: arbBadThresholdValue })
  .map(({ base, bad }) => ({ ...base, conflictThreshold: bad }));

/**
 * A config that breaks exactly the alignmentThreshold. The conflictThreshold is
 * kept valid so the FIRST failure (and the named parameter) is the alignment
 * one, matching validateConfig's weights -> conflict -> alignment order.
 */
const arbBadAlignmentThresholdConfig: fc.Arbitrary<ConfigOverride> = fc
  .record({ base: arbValidConfig, bad: arbBadThresholdValue })
  .map(({ base, bad }) => ({ ...base, alignmentThreshold: bad }));

// ---------------------------------------------------------------------------
// Aggregate-input generators.
// ---------------------------------------------------------------------------

/** A default engine; the aggregate-rejection cases are config-independent. */
function makeEngine(): ConfluenceEngine {
  const result = createConfluenceEngine();
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`createConfluenceEngine failed: ${result.error.message}`);
  }
  return result.value;
}

/** A set of valid signals, at most one per id, length 0..6 (distinct ids). */
const arbValidSignalSet: fc.Arbitrary<StrategySignal[]> = fc
  .subarray([...STRATEGY_IDS], { minLength: 0, maxLength: STRATEGY_IDS.length })
  .chain((ids) =>
    ids.length === 0
      ? fc.constant<StrategySignal[]>([])
      : fc.tuple(...ids.map((id) => arbSignal(id))),
  );

// ---------------------------------------------------------------------------
// Property 22.
// ---------------------------------------------------------------------------

describe("Property 22: Invalid engine input or configuration is rejected", () => {
  it("rejects a negative / NaN / infinite weight with invalid_config naming the Strategy_Id (Req 8.6)", () => {
    fc.assert(
      fc.property(arbBadWeightConfig, ({ config, expectedParameter }) => {
        const result = createConfluenceEngine(config);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.reason).toBe("invalid_config");
        expect(result.error.parameter).toBe(expectedParameter);
        // Naming is specific enough to identify the offending id in the message.
        expect(result.error.message).toContain(expectedParameter);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects a non-finite / out-of-range conflictThreshold with invalid_config naming it (Req 9.7)", () => {
    fc.assert(
      fc.property(arbBadConflictThresholdConfig, (config) => {
        const result = createConfluenceEngine(config);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.reason).toBe("invalid_config");
        expect(result.error.parameter).toBe("conflictThreshold");
      }),
      { numRuns: 200 },
    );
  });

  it("rejects a non-finite / out-of-range alignmentThreshold with invalid_config naming it (Req 9.7)", () => {
    fc.assert(
      fc.property(arbBadAlignmentThresholdConfig, (config) => {
        const result = createConfluenceEngine(config);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.reason).toBe("invalid_config");
        expect(result.error.parameter).toBe("alignmentThreshold");
      }),
      { numRuns: 200 },
    );
  });

  it("rejects an input array containing an invalid signal with invalid_signal at the offending index (Req 8.10)", () => {
    fc.assert(
      fc.property(
        arbValidSignalSet,
        arbInvalidSignal,
        fc.nat(),
        (valid, invalid, insertSeed) => {
          const engine = makeEngine();
          // Place the invalid value at an arbitrary index among valid signals.
          const index = valid.length === 0 ? 0 : insertSeed % (valid.length + 1);
          const signals = [...valid];
          signals.splice(index, 0, invalid as StrategySignal);

          const result = engine.aggregate(signals);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.reason).toBe("invalid_signal");
          // aggregate validates left-to-right, so the first failure is the one
          // we injected (every other entry is a known-valid signal).
          if (result.error.reason === "invalid_signal") {
            expect(result.error.index).toBe(index);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects duplicate Strategy_Ids with duplicate_strategy_id naming the duplicate (Req 8.7)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STRATEGY_IDS),
        arbSignal(),
        arbSignal(),
        (id, a, b) => {
          const engine = makeEngine();
          // Two signals that share one Strategy_Id. aggregate validates every
          // signal first (both are valid), then detects the duplicate.
          const first: StrategySignal = { ...a, strategyId: id };
          const second: StrategySignal = { ...b, strategyId: id };

          const result = engine.aggregate([first, second]);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.reason).toBe("duplicate_strategy_id");
          if (result.error.reason === "duplicate_strategy_id") {
            expect(result.error.strategyId).toBe(id);
            expect(result.error.message).toContain(id);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects an LLM-tagged value in the signals array with invalid_signal (Req 13.8, light touch)", () => {
    fc.assert(
      fc.property(
        arbValidSignalSet,
        arbLlmTagged,
        fc.nat(),
        (valid, tagged, insertSeed) => {
          const engine = makeEngine();
          const index = valid.length === 0 ? 0 : insertSeed % (valid.length + 1);
          const signals = [...valid];
          // The LLM-tagged value masquerades as a signal; the provenance brand
          // must still reject it before any score is produced.
          signals.splice(index, 0, tagged as unknown as StrategySignal);

          const result = engine.aggregate(signals);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.reason).toBe("invalid_signal");
          if (result.error.reason === "invalid_signal") {
            expect(result.error.index).toBe(index);
            expect(result.error.violation.field).toBe("llm_tagged");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
