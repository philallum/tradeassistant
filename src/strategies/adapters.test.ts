// Unit tests for the existing-producer adapters (Requirement 7; Design
// "5. Adapters: src/strategies/adapters.ts").
//
// These pin hand-checked mappings and edge cases for both adapters:
//   - adaptCustomPattern: UP/DOWN carry Earned_Confidence as strength; FLAT is
//     strength 0 whatever the confidence (Requirements 7.1, 7.2).
//   - adaptThirdParty: BUY/SELL/HOLD -> UP/DOWN/FLAT, linear clamped score
//     normalisation, the 0.5 no-score default, FLAT always 0, and every
//     `unavailable` reason (Requirements 7.3, 7.5, 7.6, 7.7, 7.8).
//   - Both adapters leave their input untouched (Requirement 7.9).
//
// Property-level coverage lives in the companion property tests (tasks 10.3,
// 10.4); this file nails down exact numbers and the explicit unavailable paths.

import { describe, expect, it } from "vitest";
import { tagLlmOutput } from "../llm/llmInterface.js";
import { isLlmTagged } from "../llm/types.js";
import {
  DEFAULT_THIRD_PARTY_SCALE,
  adaptCustomPattern,
  adaptThirdParty,
  type AdapterOutcome,
} from "./adapters.js";
import type { StrategySignal } from "./types.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import type { Confidence } from "../confidence/types.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";

// --- Helpers ----------------------------------------------------------------

/** Unwrap a `signal` outcome, failing the test loudly otherwise. */
function expectSignal(outcome: AdapterOutcome): StrategySignal {
  if (outcome.kind !== "signal") {
    throw new Error(`expected a signal, got unavailable: ${outcome.reason}`);
  }
  return outcome.signal;
}

/** Unwrap an `unavailable` outcome, failing the test loudly otherwise. */
function expectUnavailable(outcome: AdapterOutcome): string {
  if (outcome.kind !== "unavailable") {
    throw new Error(`expected unavailable, got a signal: ${JSON.stringify(outcome.signal)}`);
  }
  return outcome.reason;
}

/** A `custom_pattern` evaluation fixture (only the two read fields matter). */
function evaluation(
  direction: PairEvaluation["direction"],
  earnedConfidence: number,
): Pick<PairEvaluation, "direction" | "earnedConfidence"> {
  return { direction, earnedConfidence: earnedConfidence as Confidence };
}

/** A well-formed third-party reference fixture, overridable per test. */
function reference(
  overrides: Partial<ExternalReferenceSignal> = {},
): ExternalReferenceSignal {
  return {
    pair: "EURUSD",
    decisionDate: "2015-01-01",
    direction: "BUY",
    provider: "test-provider",
    fetchedAt: "2015-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// --- adaptCustomPattern: hand-checked mappings (Requirements 7.1, 7.2) -------

describe("adaptCustomPattern — direction and Earned_Confidence mapping (Req 7.1, 7.2)", () => {
  it("maps UP to strength = earnedConfidence", () => {
    const signal = expectSignal(adaptCustomPattern(evaluation("UP", 0.73)));
    expect(signal.strategyId).toBe("custom_pattern");
    expect(signal.direction).toBe("UP");
    expect(signal.strength).toBe(0.73);
  });

  it("maps DOWN to strength = earnedConfidence", () => {
    const signal = expectSignal(adaptCustomPattern(evaluation("DOWN", 0.42)));
    expect(signal.direction).toBe("DOWN");
    expect(signal.strength).toBe(0.42);
  });

  it("accepts an UP signal at the boundary confidences 0 and 1", () => {
    expect(expectSignal(adaptCustomPattern(evaluation("UP", 0))).strength).toBe(0);
    expect(expectSignal(adaptCustomPattern(evaluation("UP", 1))).strength).toBe(1);
  });

  it("maps FLAT to strength 0 regardless of a non-zero confidence (Req 7.2)", () => {
    // A high confidence on a FLAT evaluation is ignored, not an error.
    const signal = expectSignal(adaptCustomPattern(evaluation("FLAT", 0.9)));
    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
  });

  it("maps FLAT to strength 0 even at full confidence 1 (Req 7.2)", () => {
    const signal = expectSignal(adaptCustomPattern(evaluation("FLAT", 1)));
    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
  });
});

// --- adaptThirdParty: direction mapping (Requirement 7.3) --------------------

describe("adaptThirdParty — BUY/SELL/HOLD direction mapping (Req 7.3)", () => {
  it("maps BUY to UP", () => {
    const signal = expectSignal(adaptThirdParty(reference({ direction: "BUY" })));
    expect(signal.strategyId).toBe("third_party");
    expect(signal.direction).toBe("UP");
  });

  it("maps SELL to DOWN", () => {
    const signal = expectSignal(adaptThirdParty(reference({ direction: "SELL" })));
    expect(signal.direction).toBe("DOWN");
  });

  it("maps HOLD to FLAT", () => {
    const signal = expectSignal(adaptThirdParty(reference({ direction: "HOLD" })));
    expect(signal.direction).toBe("FLAT");
  });
});

// --- adaptThirdParty: linear score normalisation (Requirement 7.4) -----------

describe("adaptThirdParty — linear clamped score normalisation (Req 7.4)", () => {
  it("maps a mid-range score to a proportional strength under the default scale", () => {
    // Default fullScaleAbs = 1.0, so strength = clamp01(|0.5| / 1.0) = 0.5.
    const signal = expectSignal(adaptThirdParty(reference({ direction: "BUY", score: 0.5 })));
    expect(signal.direction).toBe("UP");
    expect(signal.strength).toBeCloseTo(0.5, 10);
  });

  it("uses |score| so a negative SELL score still scales linearly", () => {
    // strength = clamp01(|-0.25| / 1.0) = 0.25.
    const signal = expectSignal(adaptThirdParty(reference({ direction: "SELL", score: -0.25 })));
    expect(signal.direction).toBe("DOWN");
    expect(signal.strength).toBeCloseTo(0.25, 10);
  });

  it("clamps a score above fullScaleAbs to strength 1.0", () => {
    const signal = expectSignal(adaptThirdParty(reference({ direction: "BUY", score: 2.5 })));
    expect(signal.strength).toBe(1);
  });

  it("honours a custom scale when normalising", () => {
    // fullScaleAbs = 4.0, so strength = clamp01(|2.0| / 4.0) = 0.5.
    const signal = expectSignal(
      adaptThirdParty(reference({ direction: "BUY", score: 2.0 }), { fullScaleAbs: 4.0 }),
    );
    expect(signal.strength).toBeCloseTo(0.5, 10);
  });

  it("exposes DEFAULT_THIRD_PARTY_SCALE as fullScaleAbs 1.0", () => {
    expect(DEFAULT_THIRD_PARTY_SCALE.fullScaleAbs).toBe(1.0);
  });
});

// --- adaptThirdParty: no-score default (Requirement 7.6) ---------------------

describe("adaptThirdParty — 0.5 default strength for UP/DOWN with no score (Req 7.6)", () => {
  it("defaults an UP read with no score to strength 0.5", () => {
    const signal = expectSignal(adaptThirdParty(reference({ direction: "BUY" })));
    expect(signal.direction).toBe("UP");
    expect(signal.strength).toBe(0.5);
  });

  it("defaults a DOWN read with no score to strength 0.5", () => {
    const signal = expectSignal(adaptThirdParty(reference({ direction: "SELL" })));
    expect(signal.direction).toBe("DOWN");
    expect(signal.strength).toBe(0.5);
  });
});

// --- adaptThirdParty: FLAT is always strength 0 (Requirement 7.5) ------------

describe("adaptThirdParty — FLAT always strength 0 (Req 7.5)", () => {
  it("maps HOLD with no score to FLAT strength 0", () => {
    const signal = expectSignal(adaptThirdParty(reference({ direction: "HOLD" })));
    expect(signal.strength).toBe(0);
  });

  it("maps HOLD to FLAT strength 0 even when a non-zero score is present", () => {
    // A HOLD reference carrying a score never earns a non-zero strength.
    const signal = expectSignal(adaptThirdParty(reference({ direction: "HOLD", score: 0.8 })));
    expect(signal.direction).toBe("FLAT");
    expect(signal.strength).toBe(0);
  });
});

// --- adaptThirdParty: unavailable reasons (Requirements 7.7, 7.8) ------------

describe("adaptThirdParty — unavailable outcomes carry a non-empty reason (Req 7.7, 7.8)", () => {
  it("reports unavailable for a null reference", () => {
    const reason = expectUnavailable(adaptThirdParty(null));
    expect(reason.length).toBeGreaterThan(0);
  });

  it("reports unavailable for an undefined reference", () => {
    const reason = expectUnavailable(adaptThirdParty(undefined));
    expect(reason.length).toBeGreaterThan(0);
  });

  it("reports unavailable (and never a signal) for an LLM-tagged reference (Req 7.8)", () => {
    // Tag a real, otherwise-valid reference with the unforgeable LLM brand via
    // the same helper the LLM_Interface uses. The adapter must refuse it before
    // it can ever become a third_party signal.
    const tagged = tagLlmOutput(reference({ direction: "BUY", score: 0.5 }), "signal_rationale", "2015-01-01T00:00:00.000Z");
    expect(isLlmTagged(tagged)).toBe(true);

    const outcome = adaptThirdParty(tagged);
    const reason = expectUnavailable(outcome);
    expect(reason.length).toBeGreaterThan(0);
  });

  it("reports unavailable for an unknown / invalid direction (Req 7.7)", () => {
    const reason = expectUnavailable(adaptThirdParty({ ...reference(), direction: "SIDEWAYS" }));
    expect(reason.length).toBeGreaterThan(0);
  });

  it("reports unavailable for a NaN score (Req 7.7)", () => {
    const reason = expectUnavailable(
      adaptThirdParty({ ...reference(), direction: "BUY", score: Number.NaN }),
    );
    expect(reason.length).toBeGreaterThan(0);
  });

  it("reports unavailable for an infinite score (Req 7.7)", () => {
    expect(
      expectUnavailable(
        adaptThirdParty({ ...reference(), direction: "BUY", score: Number.POSITIVE_INFINITY }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      expectUnavailable(
        adaptThirdParty({ ...reference(), direction: "BUY", score: Number.NEGATIVE_INFINITY }),
      ).length,
    ).toBeGreaterThan(0);
  });
});

// --- Input unchanged (Requirement 7.9) --------------------------------------

describe("adapters never mutate their input (Req 7.9)", () => {
  it("adaptCustomPattern does not mutate its evaluation input", () => {
    const input = evaluation("UP", 0.6);
    // Deep-freeze so any write attempt would throw; snapshot for a value compare.
    const snapshot = { ...input };
    Object.freeze(input);

    expect(() => adaptCustomPattern(input)).not.toThrow();
    expect(input).toEqual(snapshot);
  });

  it("adaptCustomPattern does not mutate a FLAT evaluation input", () => {
    const input = evaluation("FLAT", 0.9);
    const snapshot = { ...input };
    Object.freeze(input);

    expect(() => adaptCustomPattern(input)).not.toThrow();
    expect(input).toEqual(snapshot);
  });

  it("adaptThirdParty does not mutate its reference input", () => {
    const input = reference({ direction: "BUY", score: 0.5 });
    const snapshot = { ...input };
    Object.freeze(input);

    expect(() => adaptThirdParty(input)).not.toThrow();
    expect(input).toEqual(snapshot);
  });

  it("adaptThirdParty does not mutate a no-score reference input", () => {
    const input = reference({ direction: "SELL" });
    const snapshot = { ...input };
    Object.freeze(input);

    expect(() => adaptThirdParty(input)).not.toThrow();
    expect(input).toEqual(snapshot);
  });
});
