import { describe, expect, it } from "vitest";
import { LlmInterface, type LlmProvider } from "../llm/llmInterface.js";
import {
  InMemoryRoleRejectionRecorder,
  type RiskFlag,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "../llm/types.js";
import { riskFlag } from "./newsFilter.js";
import { InMemoryNewsRiskFlagStore } from "./types.js";

// Structured RiskFlag SHAPE smoke tests (Task 9.11; Requirement 14.2).
//
// NON-OVERLAPPING with newsFilter.test.ts (which asserts riskFlag() routes
// through the LLM_Interface and persists one row per pair). Here the focus is a
// narrow SHAPE contract on the value riskFlag() returns: it is exactly
// { level, reason }, `level` is one of {none, elevated, high}, and `reason` is
// a string. A fake LlmProvider returns a KNOWN flag so the shape is asserted
// deterministically without a real model.

const DECISION_DATE = "2026-03-16";
const fixedClock = { now: () => "2026-03-16T12:00:00.000Z" };

/** An LlmInterface backed by a fake provider that returns the given `flag`. */
function llmReturning(flag: RiskFlag): LlmInterface {
  const provider: LlmProvider = {
    complete<R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]> {
      void role;
      void input;
      return Promise.resolve(flag as RoleOutput[R]);
    },
  };
  return new LlmInterface({
    provider,
    rejectionRecorder: new InMemoryRoleRejectionRecorder(),
    clock: fixedClock,
  });
}

describe("riskFlag structured shape (Requirement 14.2)", () => {
  it.each<RiskFlag["level"]>(["none", "elevated", "high"])(
    "returns exactly { level, reason } for level %s",
    async (level) => {
      const known: RiskFlag = { level, reason: `reason for ${level}` };
      const flag = await riskFlag(DECISION_DATE, [], llmReturning(known), new InMemoryNewsRiskFlagStore());

      // Exactly two keys, no direction or any extra field leaked through.
      expect(Object.keys(flag).sort()).toEqual(["level", "reason"]);
      expect(flag.level).toBe(level);
      expect(typeof flag.reason).toBe("string");
      expect(flag.reason).toBe(`reason for ${level}`);
    },
  );

  it("returns a level within the {none, elevated, high} set", async () => {
    const flag = await riskFlag(
      DECISION_DATE,
      [],
      llmReturning({ level: "elevated", reason: "US CPI within window" }),
      new InMemoryNewsRiskFlagStore(),
    );

    expect(["none", "elevated", "high"]).toContain(flag.level);
  });
});
