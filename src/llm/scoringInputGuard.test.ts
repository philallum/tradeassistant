// Unit tests for the ScoringInputGuard — the runtime + compile-time
// AI/deterministic boundary (Requirements 2.1, 2.2, 2.6).
//
// These are FOCUSED unit tests for the guard's own behavior. The named
// guardrail property test (Property 4) is owned by task 9.5 and is NOT here.

import { describe, expect, expectTypeOf, it } from "vitest";
import { tagLlmOutput } from "./llmInterface.js";
import type { LlmTagged } from "./types.js";
import {
  assertDeterministic,
  InMemoryBlockedScoringInputRecorder,
  LlmOnScoringPathError,
  ScoringInputGuard,
  type Deterministic,
  type NotLlmTagged,
} from "./scoringInputGuard.js";

/** Fixed clock so recorded timestamps are deterministic. */
const fixedClock = { now: () => "2026-02-01T00:00:00.000Z" };

function makeGuard() {
  const recorder = new InMemoryBlockedScoringInputRecorder();
  const guard = new ScoringInputGuard({ recorder, clock: fixedClock });
  return { recorder, guard };
}

/** A representative pure scoring function, typed to reject LLM-derived input. */
function scoreDirection<T>(input: Deterministic<T>): number {
  // Trivial deterministic computation standing in for earnedConfidence/verdict.
  return typeof input === "number" ? Math.max(0, Math.min(1, input)) : 0.5;
}

describe("ScoringInputGuard.guard (Requirement 2.6)", () => {
  it("passes a clean (non-LLM) value through unchanged and records nothing", () => {
    const { recorder, guard } = makeGuard();
    const value = { close: 1.2345, atr14: 0.0021 };

    const result = guard.guard(value, "earnedConfidence");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(value);
    }
    expect(recorder.size).toBe(0);
  });

  it("rejects an LLM-tagged value and records the blocked attempt", () => {
    const { recorder, guard } = makeGuard();
    const tagged = tagLlmOutput("bullish tone", "signal_rationale", fixedClock.now());

    const result = guard.guard(tagged, "killGateVerdict");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.scoringPath).toBe("killGateVerdict");
      expect(result.error.producingRole).toBe("signal_rationale");
      expect(result.error.at).toBe("2026-02-01T00:00:00.000Z");
      expect(result.error.reason).toContain("killGateVerdict");
    }
    expect(recorder.size).toBe(1);
    expect(recorder.all()[0]?.scoringPath).toBe("killGateVerdict");
  });

  it("records the blocked attempt BEFORE surfacing the rejection", () => {
    const { recorder, guard } = makeGuard();
    const tagged = tagLlmOutput(["analogueLabel"], "pattern_description", fixedClock.now());

    // By the time guard() returns the error, the record is already persisted.
    const result = guard.guard(tagged, "earnedConfidence");
    expect(result.ok).toBe(false);
    expect(recorder.size).toBe(1);
  });
});

describe("ScoringInputGuard.assertClean (Requirement 2.6)", () => {
  it("returns a clean value unchanged", () => {
    const { recorder, guard } = makeGuard();
    const value = 0.73;

    expect(guard.assertClean(value, "earnedConfidence")).toBe(0.73);
    expect(recorder.size).toBe(0);
  });

  it("throws LlmOnScoringPathError and records when given an LLM-tagged value", () => {
    const { recorder, guard } = makeGuard();
    const tagged = tagLlmOutput(0.99, "news_filter", fixedClock.now());

    expect(() => guard.assertClean(tagged, "earnedConfidence")).toThrow(LlmOnScoringPathError);
    // The attempt was recorded before the throw.
    expect(recorder.size).toBe(1);
    expect(recorder.all()[0]?.producingRole).toBe("news_filter");
  });

  it("attaches the recorded attempt to the thrown error", () => {
    const { guard } = makeGuard();
    const tagged = tagLlmOutput("x", "research_assistant", fixedClock.now());

    try {
      guard.assertClean(tagged, "gate2");
      expect.unreachable("expected assertClean to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmOnScoringPathError);
      const err = error as LlmOnScoringPathError;
      expect(err.blocked.scoringPath).toBe("gate2");
      expect(err.blocked.producingRole).toBe("research_assistant");
    }
  });
});

describe("ScoringInputGuard: detection keys off the unforgeable brand", () => {
  it("does not treat a hand-forged provenance-shaped object as LLM-tagged", () => {
    const { recorder, guard } = makeGuard();
    // A plain object mimicking the readable fields but lacking the symbol brand
    // is NOT LLM output; the guard must let it through.
    const lookalike = { value: 0.5, provenance: { role: "signal_rationale", marker: "llm" } };

    const result = guard.guard(lookalike, "earnedConfidence");

    expect(result.ok).toBe(true);
    expect(recorder.size).toBe(0);
  });
});

describe("Deterministic<T> / assertDeterministic compile-time exclusion (Req 2.1, 2.2)", () => {
  it("lets a clean value flow into a deterministic scoring function", () => {
    // Runtime sanity: the compile-time-constrained scoring function still works.
    expect(scoreDirection(0.42)).toBeCloseTo(0.42);
    expect(assertDeterministic(0.42)).toBe(0.42);
  });

  it("rejects an LlmTagged value at COMPILE TIME (not assignable to a scoring param)", () => {
    const tagged = tagLlmOutput(0.9, "signal_rationale", fixedClock.now());

    // Deterministic<LlmTagged<number>> resolves to `never`, so a tagged value
    // is not assignable to a deterministic scoring parameter. The @ts-expect-error
    // asserts the compiler refuses this call; if it ever compiled, typecheck fails.
    // @ts-expect-error LLM-tagged values must not be assignable to a deterministic scoring parameter.
    scoreDirection(tagged);
    // @ts-expect-error assertDeterministic must reject an LLM-tagged argument.
    assertDeterministic(tagged);

    // A runtime guard is still the enforcement mechanism for untyped callers.
    expect(tagged).toBeDefined();
  });

  it("type-level: NotLlmTagged distinguishes tagged from clean types", () => {
    expectTypeOf<NotLlmTagged<number>>().toEqualTypeOf<true>();
    expectTypeOf<NotLlmTagged<LlmTagged<number>>>().toEqualTypeOf<false>();
    expectTypeOf<Deterministic<LlmTagged<number>>>().toEqualTypeOf<never>();
    expectTypeOf<Deterministic<number>>().toEqualTypeOf<number>();
  });
});
