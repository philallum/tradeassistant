// Unit tests for the Confluence_Engine (Requirements 8, 9; Design
// "6. Confluence engine: src/strategies/confluenceEngine.ts").
//
// These deterministic, example-based tests pin:
//   - the default weights and thresholds (Requirements 8.4, 8.5, 9.6);
//   - hand-checked score computations and status classification
//     (Requirements 8.1, 8.2, 9.3, 9.4, 9.5);
//   - the empty-list -> INSUFFICIENT_DATA path (Requirement 8.3);
//   - all-FLAT (positive weight) -> NEUTRAL (Requirement 9.10);
//   - single contributor -> NEUTRAL regardless of strength (Requirement 9.10);
//   - a non-zero `third_party` weight contributing to the score (Requirement 8.4).
//
// Property-level coverage lives in the companion property tests (tasks 12.4-12.8);
// this file nails down exact numbers and the explicit edge cases.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFLUENCE_CONFIG,
  createConfluenceEngine,
  type ConfluenceEngine,
  type ConfluenceResult,
} from "./confluenceEngine.js";
import { buildSignal, type StrategySignal } from "./types.js";

// --- Helpers ----------------------------------------------------------------

/** Create an engine, failing the test loudly if the config is rejected. */
function makeEngine(partial?: Parameters<typeof createConfluenceEngine>[0]): ConfluenceEngine {
  const result = createConfluenceEngine(partial);
  if (!result.ok) {
    throw new Error(`expected an engine, got config error: ${result.error.message}`);
  }
  return result.value;
}

/** Build a valid signal, failing the test loudly if the inputs are invalid. */
function signal(
  ...args: Parameters<typeof buildSignal>
): StrategySignal {
  const result = buildSignal(...args);
  if (!result.ok) {
    throw new Error(`expected a signal, got violation: ${result.error.message}`);
  }
  return result.value;
}

/** Aggregate, failing the test loudly if the engine rejects the input. */
function aggregate(engine: ConfluenceEngine, signals: StrategySignal[]): ConfluenceResult {
  const result = engine.aggregate(signals);
  if (!result.ok) {
    throw new Error(`expected a result, got error: ${result.error.message}`);
  }
  return result.value;
}

// --- Defaults ---------------------------------------------------------------

describe("DEFAULT_CONFLUENCE_CONFIG", () => {
  it("carries the specified default weights and thresholds", () => {
    expect(DEFAULT_CONFLUENCE_CONFIG.weights).toEqual({
      trend: 1,
      breakout: 1,
      range: 1,
      reversal: 1,
      custom_pattern: 1,
      third_party: 0,
    });
    expect(DEFAULT_CONFLUENCE_CONFIG.conflictThreshold).toBe(0.6);
    expect(DEFAULT_CONFLUENCE_CONFIG.alignmentThreshold).toBe(0.4);
  });

  it("is reflected in a default engine's frozen config", () => {
    const engine = makeEngine();
    expect(engine.config.weights).toEqual(DEFAULT_CONFLUENCE_CONFIG.weights);
    expect(engine.config.conflictThreshold).toBe(0.6);
    expect(engine.config.alignmentThreshold).toBe(0.4);
    expect(Object.isFrozen(engine.config)).toBe(true);
    expect(Object.isFrozen(engine.config.weights)).toBe(true);
  });
});

// --- Hand-checked score computations ----------------------------------------

describe("aggregate - hand-checked scores and status", () => {
  it("averages two aligned UP signals at equal weight", () => {
    // weights trend=1, breakout=1; W = 2.
    // weightedSum = 1*(+1)*0.8 + 1*(+1)*0.6 = 1.4; score = 1.4 / 2 = 0.7.
    // two contributors, 0.7 >= 0.4 => ALIGNED_UP.
    const engine = makeEngine();
    const result = aggregate(engine, [
      signal("trend", "UP", 0.8, "trend up"),
      signal("breakout", "UP", 0.6, "breakout up"),
    ]);
    expect(result.score).toBe(0.7);
    expect(result.status).toBe("ALIGNED_UP");
    expect(result.opposingStrategyIds).toEqual([]);
  });

  it("averages two aligned DOWN signals into a negative score", () => {
    // weightedSum = 1*(-1)*0.8 + 1*(-1)*0.6 = -1.4; score = -0.7 <= -0.4 => ALIGNED_DOWN.
    const engine = makeEngine();
    const result = aggregate(engine, [
      signal("trend", "DOWN", 0.8, "trend down"),
      signal("breakout", "DOWN", 0.6, "breakout down"),
    ]);
    expect(result.score).toBe(-0.7);
    expect(result.status).toBe("ALIGNED_DOWN");
    expect(result.opposingStrategyIds).toEqual([]);
  });

  it("classifies a weak disagreement below the alignment threshold as NEUTRAL", () => {
    // trend UP 0.5, breakout DOWN 0.3; W = 2.
    // weightedSum = 0.5 - 0.3 = 0.2; score = 0.2 / 2 = 0.1; |0.1| < 0.4 => NEUTRAL.
    // Neither strength reaches 0.6, so no conflict.
    const engine = makeEngine();
    const result = aggregate(engine, [
      signal("trend", "UP", 0.5, "trend up weak"),
      signal("breakout", "DOWN", 0.3, "breakout down weak"),
    ]);
    expect(result.score).toBe(0.1);
    expect(result.status).toBe("NEUTRAL");
    expect(result.opposingStrategyIds).toEqual([]);
  });

  it("forces CONFLICT_FLAT when a strong UP opposes a strong DOWN", () => {
    // trend UP 0.9 and breakout DOWN 0.8 both clear the 0.6 conflict threshold.
    // weightedSum = 0.9 - 0.8 = 0.1; score = 0.05; status CONFLICT_FLAT overrides.
    // opposing ids in canonical order: trend before breakout.
    const engine = makeEngine();
    const result = aggregate(engine, [
      signal("breakout", "DOWN", 0.8, "breakout strong down"),
      signal("trend", "UP", 0.9, "trend strong up"),
    ]);
    expect(result.score).toBeCloseTo(0.05, 12);
    expect(result.status).toBe("CONFLICT_FLAT");
    expect(result.opposingStrategyIds).toEqual(["trend", "breakout"]);
  });

  it("clamps a weighted mean to 1 and returns the signals in canonical order", () => {
    // Four full-strength UP signals; score = 1. Supplied out of canonical order.
    const engine = makeEngine();
    const result = aggregate(engine, [
      signal("reversal", "UP", 1, "reversal up"),
      signal("trend", "UP", 1, "trend up"),
      signal("range", "UP", 1, "range up"),
      signal("breakout", "UP", 1, "breakout up"),
    ]);
    expect(result.score).toBe(1);
    expect(result.status).toBe("ALIGNED_UP");
    expect(result.signals.map((s) => s.strategyId)).toEqual([
      "trend",
      "breakout",
      "range",
      "reversal",
    ]);
  });
});

// --- Edge cases -------------------------------------------------------------

describe("aggregate - edge cases", () => {
  it("returns score 0 / INSUFFICIENT_DATA for an empty signal list", () => {
    const engine = makeEngine();
    const result = aggregate(engine, []);
    expect(result.score).toBe(0);
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.opposingStrategyIds).toEqual([]);
    expect(result.signals).toEqual([]);
  });

  it("returns INSUFFICIENT_DATA when the only signal has zero weight", () => {
    // third_party default weight is 0 => total weight 0.
    const engine = makeEngine();
    const result = aggregate(engine, [signal("third_party", "UP", 0.9, "ref up")]);
    expect(result.score).toBe(0);
    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(result.opposingStrategyIds).toEqual([]);
  });

  it("classifies all-FLAT positive-weight signals as NEUTRAL with score 0", () => {
    const engine = makeEngine();
    const result = aggregate(engine, [
      signal("trend", "FLAT", 0, "trend flat"),
      signal("breakout", "FLAT", 0, "breakout flat"),
      signal("range", "FLAT", 0, "range flat"),
    ]);
    // W = 3, weightedSum = 0 => score 0, normalised from -0 if applicable.
    expect(result.score).toBe(0);
    expect(Object.is(result.score, -0)).toBe(false);
    expect(result.status).toBe("NEUTRAL");
    expect(result.opposingStrategyIds).toEqual([]);
  });

  it("classifies a single contributor as NEUTRAL regardless of strength", () => {
    // One positive-weight, non-FLAT signal => 1 contributor => NEUTRAL even at
    // full strength and a score above the alignment threshold.
    const engine = makeEngine();
    const result = aggregate(engine, [signal("trend", "UP", 1, "trend up alone")]);
    expect(result.score).toBe(1);
    expect(result.status).toBe("NEUTRAL");
    expect(result.opposingStrategyIds).toEqual([]);
  });

  it("stays NEUTRAL for one contributor even alongside FLAT positive-weight signals", () => {
    const engine = makeEngine();
    const result = aggregate(engine, [
      signal("trend", "UP", 1, "trend up"),
      signal("breakout", "FLAT", 0, "breakout flat"),
      signal("range", "FLAT", 0, "range flat"),
    ]);
    // W = 3, weightedSum = 1 => score = 1/3 ≈ 0.333..., still only 1 contributor.
    expect(result.score).toBeCloseTo(1 / 3, 12);
    expect(result.status).toBe("NEUTRAL");
  });
});

// --- Configured third_party weight ------------------------------------------

describe("aggregate - non-zero third_party weight", () => {
  it("includes a configured third_party weight in the score", () => {
    // Configure third_party weight to 1 so it contributes.
    // trend UP 0.4 (w=1), third_party DOWN 0.4 (w=1); W = 2.
    // weightedSum = 0.4 - 0.4 = 0; score 0 => NEUTRAL, 2 contributors.
    const engine = makeEngine({ weights: { third_party: 1 } });
    const result = aggregate(engine, [
      signal("trend", "UP", 0.4, "trend up"),
      signal("third_party", "DOWN", 0.4, "ref down"),
    ]);
    expect(engine.config.weights.third_party).toBe(1);
    expect(result.score).toBe(0);
    expect(result.status).toBe("NEUTRAL");
  });

  it("lets a weighted third_party signal change the score vs. its zero-weight default", () => {
    // With default weight 0 the third_party signal does not move the score.
    const defaultEngine = makeEngine();
    const defaultResult = aggregate(defaultEngine, [
      signal("trend", "UP", 0.8, "trend up"),
      signal("breakout", "UP", 0.8, "breakout up"),
      signal("third_party", "DOWN", 1, "ref strong down"),
    ]);
    // W = 2 (third_party weight 0); weightedSum = 0.8 + 0.8 = 1.6; score = 0.8.
    expect(defaultResult.score).toBe(0.8);

    // With weight 1 the DOWN reference drags the score down.
    const weightedEngine = makeEngine({ weights: { third_party: 1 } });
    const weightedResult = aggregate(weightedEngine, [
      signal("trend", "UP", 0.8, "trend up"),
      signal("breakout", "UP", 0.8, "breakout up"),
      signal("third_party", "DOWN", 1, "ref strong down"),
    ]);
    // W = 3; weightedSum = 0.8 + 0.8 - 1 = 0.6; score = 0.6 / 3 = 0.2.
    expect(weightedResult.score).toBeCloseTo(0.2, 12);
    expect(weightedResult.score).not.toBe(defaultResult.score);
  });
});
