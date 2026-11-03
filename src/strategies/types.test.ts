// Unit tests for the Strategy Signal Contract (Requirement 1).
//
// Covers `buildSignal` (Requirements 1.5, 1.9) and `validateStrategySignal`
// (Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8), plus compile-time proof
// that unknown `strategyId` / `direction` literals are rejected by the type
// system (Requirements 1.2, 1.3). Property-level coverage lives in the
// companion property test (task 1.3); this file pins specific examples and
// edge cases.

import { describe, expect, it } from "vitest";
import { tagLlmOutput } from "../llm/llmInterface.js";
import {
  RATIONALE_MAX_LENGTH,
  type SignalDirection,
  type StrategyId,
  type StrategySignal,
  buildSignal,
  validateStrategySignal,
} from "./types.js";

// --- Helpers ----------------------------------------------------------------

/** Unwrap a successful Result, failing the test loudly otherwise. */
function expectOk<T, E>(
  result: { ok: true; value: T } | { ok: false; error: E },
): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Unwrap a failing Result, failing the test loudly otherwise. */
function expectErr<T, E>(
  result: { ok: true; value: T } | { ok: false; error: E },
): E {
  if (result.ok) {
    throw new Error(`expected error, got ok: ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

/** A well-formed base signal, overridable per test. */
function signal(overrides: Partial<StrategySignal> = {}): StrategySignal {
  return {
    strategyId: "trend",
    direction: "UP",
    strength: 0.5,
    rationale: "upward momentum confirmed",
    ...overrides,
  };
}

// --- buildSignal (Requirements 1.5, 1.9, 1.8) -------------------------------

describe("buildSignal — the only signal constructor", () => {
  it("returns valid UP/DOWN signals unchanged (Req 1.1, 1.4)", () => {
    const up = expectOk(buildSignal("trend", "UP", 0.7, "trend up"));
    expect(up).toEqual({
      strategyId: "trend",
      direction: "UP",
      strength: 0.7,
      rationale: "trend up",
    });

    const down = expectOk(buildSignal("reversal", "DOWN", 0.42, "reversal down"));
    expect(down).toEqual({
      strategyId: "reversal",
      direction: "DOWN",
      strength: 0.42,
      rationale: "reversal down",
    });
  });

  it("forces strength to exactly 0 for FLAT even when a non-zero strength is passed (Req 1.5)", () => {
    const flat = expectOk(buildSignal("range", "FLAT", 0.9, "no edge, staying flat"));
    expect(flat.direction).toBe("FLAT");
    expect(flat.strength).toBe(0);
  });

  it("forces strength to 0 for FLAT even at the upper bound 1 (Req 1.5)", () => {
    const flat = expectOk(buildSignal("range", "FLAT", 1, "flat at full strength input"));
    expect(flat.strength).toBe(0);
  });

  it("accepts UP with strength 0 and does NOT re-classify it as FLAT (Req 1.9)", () => {
    const up = expectOk(buildSignal("breakout", "UP", 0, "weak but still up"));
    expect(up.direction).toBe("UP");
    expect(up.strength).toBe(0);
  });

  it("accepts DOWN with strength 0 and does NOT re-classify it as FLAT (Req 1.9)", () => {
    const down = expectOk(buildSignal("breakout", "DOWN", 0, "weak but still down"));
    expect(down.direction).toBe("DOWN");
    expect(down.strength).toBe(0);
  });

  it("rejects an out-of-range strength on UP/DOWN with field 'strength' (Req 1.4, 1.8)", () => {
    const tooHigh = expectErr(buildSignal("trend", "UP", 1.5, "overdriven"));
    expect(tooHigh.reason).toBe("invalid_signal");
    expect(tooHigh.field).toBe("strength");

    const negative = expectErr(buildSignal("trend", "DOWN", -0.1, "below floor"));
    expect(negative.field).toBe("strength");
  });

  it("rejects a non-finite strength with field 'strength' (Req 1.4, 1.8)", () => {
    expect(expectErr(buildSignal("trend", "UP", Number.NaN, "nan")).field).toBe("strength");
    expect(expectErr(buildSignal("trend", "UP", Number.POSITIVE_INFINITY, "inf")).field).toBe(
      "strength",
    );
  });

  it("rejects an empty rationale with field 'rationale' (Req 1.6, 1.8)", () => {
    const e = expectErr(buildSignal("trend", "UP", 0.5, ""));
    expect(e.field).toBe("rationale");
  });

  it("rejects a whitespace-only rationale with field 'rationale' (Req 1.6, 1.8)", () => {
    const e = expectErr(buildSignal("trend", "UP", 0.5, "   \t\n  "));
    expect(e.field).toBe("rationale");
  });

  it("rejects a rationale longer than the max with field 'rationale' (Req 1.6, 1.8)", () => {
    const e = expectErr(
      buildSignal("trend", "UP", 0.5, "a".repeat(RATIONALE_MAX_LENGTH + 1)),
    );
    expect(e.field).toBe("rationale");
  });

  it("accepts a rationale at the exact maximum length (Req 1.6)", () => {
    const ok = expectOk(buildSignal("trend", "UP", 0.5, "a".repeat(RATIONALE_MAX_LENGTH)));
    expect(ok.rationale.length).toBe(RATIONALE_MAX_LENGTH);
  });
});

// --- validateStrategySignal (Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8) -

describe("validateStrategySignal — the single runtime guard", () => {
  it("accepts a well-formed signal and echoes exactly the four fields (Req 1.1)", () => {
    const value = expectOk(validateStrategySignal(signal()));
    expect(value).toEqual(signal());
  });

  it("accepts a well-formed FLAT signal with strength 0 (Req 1.5)", () => {
    const value = expectOk(
      validateStrategySignal(signal({ direction: "FLAT", strength: 0, rationale: "flat" })),
    );
    expect(value.direction).toBe("FLAT");
    expect(value.strength).toBe(0);
  });

  it("accepts UP/DOWN with strength 0 without reclassification (Req 1.9)", () => {
    expect(expectOk(validateStrategySignal(signal({ direction: "UP", strength: 0 }))).direction).toBe(
      "UP",
    );
    expect(
      expectOk(validateStrategySignal(signal({ direction: "DOWN", strength: 0 }))).direction,
    ).toBe("DOWN");
  });

  // Ordering: llm_tagged is refused before any other check (Req 1.7, 1.8).
  it("rejects an LLM-tagged value with field 'llm_tagged' before any other check (Req 1.7, 1.8)", () => {
    // Use the real, unforgeable brand via the same helper the LLM_Interface uses.
    const tagged = tagLlmOutput(signal(), "signal_rationale", "2020-01-01T00:00:00.000Z");
    const e = expectErr(validateStrategySignal(tagged));
    expect(e.field).toBe("llm_tagged");
  });

  it("refuses an LLM-tagged value even when its wrapped payload is otherwise malformed (Req 1.7)", () => {
    // The payload has a bad direction, but the llm brand wins the ordering race.
    const tagged = tagLlmOutput(
      { strategyId: "nope", direction: "SIDEWAYS", strength: 2, rationale: "" },
      "news_filter",
      "2020-01-01T00:00:00.000Z",
    );
    expect(expectErr(validateStrategySignal(tagged)).field).toBe("llm_tagged");
  });

  // Shape (Req 1.8).
  it("rejects non-object primitives with field 'shape'", () => {
    for (const v of [null, undefined, 42, "str", true]) {
      expect(expectErr(validateStrategySignal(v)).field).toBe("shape");
    }
  });

  it("rejects an array with field 'shape'", () => {
    expect(expectErr(validateStrategySignal(["trend", "UP", 0.5, "x"])).field).toBe("shape");
  });

  it("rejects an object with a missing key with field 'shape'", () => {
    const missing = { strategyId: "trend", direction: "UP", strength: 0.5 };
    expect(expectErr(validateStrategySignal(missing)).field).toBe("shape");
  });

  it("rejects an object with an extra key with field 'shape'", () => {
    const extra = { ...signal(), extra: true };
    expect(expectErr(validateStrategySignal(extra)).field).toBe("shape");
  });

  // Membership (Req 1.2, 1.3, 1.8).
  it("rejects an unknown strategyId with field 'strategyId' (Req 1.2)", () => {
    const e = expectErr(validateStrategySignal({ ...signal(), strategyId: "momentum" }));
    expect(e.field).toBe("strategyId");
  });

  it("rejects an unknown direction with field 'direction' (Req 1.3)", () => {
    const e = expectErr(validateStrategySignal({ ...signal(), direction: "SIDEWAYS" }));
    expect(e.field).toBe("direction");
  });

  // strength (Req 1.4, 1.5, 1.8).
  it("rejects FLAT with a non-zero strength with field 'strength' (Req 1.5)", () => {
    const e = expectErr(
      validateStrategySignal({ ...signal(), direction: "FLAT", strength: 0.3 }),
    );
    expect(e.field).toBe("strength");
  });

  it("rejects a strength below 0 with field 'strength' (Req 1.4)", () => {
    expect(expectErr(validateStrategySignal({ ...signal(), strength: -0.01 })).field).toBe(
      "strength",
    );
  });

  it("rejects a strength above 1 with field 'strength' (Req 1.4)", () => {
    expect(expectErr(validateStrategySignal({ ...signal(), strength: 1.01 })).field).toBe(
      "strength",
    );
  });

  it("rejects a non-finite / non-number strength with field 'strength' (Req 1.4)", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "0.5"]) {
      expect(expectErr(validateStrategySignal({ ...signal(), strength: bad })).field).toBe(
        "strength",
      );
    }
  });

  it("accepts the strength boundaries 0 and 1 on a directional signal (Req 1.4)", () => {
    expect(expectOk(validateStrategySignal(signal({ strength: 0 }))).strength).toBe(0);
    expect(expectOk(validateStrategySignal(signal({ strength: 1 }))).strength).toBe(1);
  });

  // rationale (Req 1.6, 1.8).
  it("rejects a non-string rationale with field 'rationale' (Req 1.6)", () => {
    expect(expectErr(validateStrategySignal({ ...signal(), rationale: 123 })).field).toBe(
      "rationale",
    );
  });

  it("rejects an empty rationale with field 'rationale' (Req 1.6)", () => {
    expect(expectErr(validateStrategySignal({ ...signal(), rationale: "" })).field).toBe(
      "rationale",
    );
  });

  it("rejects a whitespace-only rationale with field 'rationale' (Req 1.6)", () => {
    expect(expectErr(validateStrategySignal({ ...signal(), rationale: "  \t " })).field).toBe(
      "rationale",
    );
  });

  it("rejects a rationale over the max length with field 'rationale' (Req 1.6)", () => {
    expect(
      expectErr(
        validateStrategySignal({ ...signal(), rationale: "a".repeat(RATIONALE_MAX_LENGTH + 1) }),
      ).field,
    ).toBe("rationale");
  });

  it("accepts a single-character rationale at the lower bound (Req 1.6)", () => {
    expect(expectOk(validateStrategySignal(signal({ rationale: "x" }))).rationale).toBe("x");
  });
});

// --- Compile-time contract (Requirements 1.2, 1.3) --------------------------

describe("compile-time field unions reject illegal literals", () => {
  it("rejects an unknown strategyId literal at compile time (Req 1.2)", () => {
    // @ts-expect-error — "momentum" is not one of the six Strategy_Ids.
    const bad: StrategyId = "momentum";
    // A legal value still assigns (keeps the binding used and the test meaningful).
    const good: StrategyId = "trend";
    expect(good).toBe("trend");
    void bad;
  });

  it("rejects an unknown direction literal at compile time (Req 1.3)", () => {
    // @ts-expect-error — "SIDEWAYS" is not one of the three Signal_Directions.
    const bad: SignalDirection = "SIDEWAYS";
    const good: SignalDirection = "FLAT";
    expect(good).toBe("FLAT");
    void bad;
  });

  it("rejects an illegal strategyId passed to buildSignal at compile time (Req 1.2)", () => {
    // @ts-expect-error — buildSignal's first parameter is a StrategyId union.
    buildSignal("momentum", "UP", 0.5, "x");
    expect(true).toBe(true);
  });

  it("rejects an illegal direction passed to buildSignal at compile time (Req 1.3)", () => {
    // @ts-expect-error — buildSignal's second parameter is a SignalDirection union.
    buildSignal("trend", "SIDEWAYS", 0.5, "x");
    expect(true).toBe(true);
  });
});
