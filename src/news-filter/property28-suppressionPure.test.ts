import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { suppress } from "./newsFilter.js";
import type { RiskFlag, SuppressionDecision } from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 28: For all structured risk flags, the suppression decision is a pure function of the flag and produces only a suppress/permit outcome (with a reason), never a Direction_Class.
//
// Validates: Requirements 14.3, 14.5
//
// The News Filter is a SUPPRESSOR ONLY (Design "The AI / Deterministic
// Boundary"). `suppress()` consumes the structured `{ level, reason }` RiskFlag
// DATA and yields a small `{ suppressed, reason }` decision. It is a PURE
// function of the flag (Requirement 14.3) and structurally cannot emit a
// Direction_Class (Requirement 14.5).
//
// This property drives ≥100 arbitrary RiskFlags — an arbitrary level from
// {none, elevated, high} paired with an arbitrary reason string — and asserts
// three clauses on the decision:
//
//   1. PURITY / determinism — calling suppress(flag) twice on the same flag
//      yields deeply-equal results (Requirement 14.3).
//   2. OUTCOME SHAPE — the decision has EXACTLY the keys { suppressed, reason },
//      `suppressed` is a boolean, and there is NO direction field. The decision
//      never ORIGINATES a direction token ("UP" | "DOWN" | "FLAT"): `reason` is
//      either the flag's own reason passed through verbatim (on suppression) or
//      the fixed permit note (on permit) — the function synthesises no direction
//      of its own. We therefore assert the reason is exactly one of those two
//      function-originated/pass-through strings rather than scanning the
//      caller-supplied reason (which may itself coincidentally equal a token)
//      (Requirement 14.5).
//   3. POLICY — suppressed === true iff the level is "elevated" or "high"; on
//      suppression the reason is the flag's reason; on permit suppressed is
//      false (Requirement 14.3).

/** The three risk levels the flag may carry (Requirement 14.2). */
const LEVELS: ReadonlyArray<RiskFlag["level"]> = ["none", "elevated", "high"];

/** Direction tokens the suppression decision must NEVER ORIGINATE as a value. */
const DIRECTION_TOKENS: ReadonlySet<string> = new Set(["UP", "DOWN", "FLAT"]);

/** The fixed reason `suppress()` originates when the flag permits trading. */
const PERMIT_REASON = "news filter permits trading (risk level none)";

/** Arbitrary structured RiskFlag: arbitrary level + arbitrary reason string. */
const riskFlagArb: fc.Arbitrary<RiskFlag> = fc.record({
  level: fc.constantFrom(...LEVELS),
  reason: fc.string(),
});

describe("Property 28: suppression is a pure function of the flag, never a direction", () => {
  it("is pure/deterministic, shaped { suppressed, reason }, never a direction, and follows the policy", () => {
    fc.assert(
      fc.property(riskFlagArb, (flag) => {
        const decision: SuppressionDecision = suppress(flag);

        // 1. PURITY / determinism — same flag, deeply-equal results (Req 14.3).
        const again = suppress(flag);
        expect(again).toEqual(decision);
        // A distinct-but-equal flag object must also produce an equal decision.
        const twin = suppress({ level: flag.level, reason: flag.reason });
        expect(twin).toEqual(decision);

        // 2. OUTCOME SHAPE — exactly { reason, suppressed }, boolean flag, no
        //    Direction_Class field, and the decision ORIGINATES no direction
        //    (Req 14.5). `reason` is the flag's reason passed through verbatim
        //    (on suppression) or the fixed permit note (on permit); the function
        //    never substitutes a direction token of its own. We check the
        //    function-originated value — the permit note — can never be a
        //    direction token, and that the suppress reason is a pure pass-through
        //    (so any token there came from the caller, not from suppress()).
        expect(Object.keys(decision).sort()).toEqual(["reason", "suppressed"]);
        expect(typeof decision.suppressed).toBe("boolean");
        expect(typeof decision.reason).toBe("string");
        expect(decision.reason).toBe(decision.suppressed ? flag.reason : PERMIT_REASON);
        if (!decision.suppressed) {
          // The permit note is the only reason suppress() originates itself; it
          // must never be a direction token.
          expect(DIRECTION_TOKENS.has(decision.reason)).toBe(false);
        }

        // 3. POLICY — suppress iff elevated/high; reason mapping (Req 14.3).
        const shouldSuppress = flag.level === "elevated" || flag.level === "high";
        expect(decision.suppressed).toBe(shouldSuppress);
        if (shouldSuppress) {
          expect(decision.reason).toBe(flag.reason);
        } else {
          expect(decision.suppressed).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
