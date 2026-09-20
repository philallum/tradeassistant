import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import {
  LlmInterface,
  RoleRejectedError,
  type Clock,
  type LlmProvider,
} from "./llmInterface.js";
import {
  InMemoryRoleRejectionRecorder,
  isLlmTagged,
  isSanctionedRole,
  SANCTIONED_ROLES,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 5: For all role identifiers passed to the LLM_Interface, the call is accepted if and only if the role is one of the four sanctioned roles; any other role is rejected before invocation and the rejected role is recorded.
//
// Validates: Requirements 2.3, 2.5.

/** A deterministic fake provider that echoes a canned output per role. */
function fakeProvider(): { provider: LlmProvider; complete: ReturnType<typeof vi.fn> } {
  const canned: RoleOutput = {
    news_filter: { level: "elevated", reason: "FOMC" },
    signal_rationale: "Weekly trend up; strong analogue resolution.",
    pattern_description: ["V-reversal", "range breakout"],
    research_assistant: "Consider adding RSI as a candidate.",
  };
  const complete = vi.fn(
    <R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]> => {
      void input;
      return Promise.resolve(canned[role]);
    },
  );
  return { provider: { complete }, complete };
}

const fixedClock: Clock = { now: () => "2020-01-01T00:00:00.000Z" };

/**
 * A role-string arbitrary that mixes:
 *   - the four sanctioned roles verbatim (so acceptance is exercised),
 *   - deliberate near-miss edge cases (case variants, empty string, plausible
 *     but unsanctioned role names),
 *   - fully arbitrary strings.
 * fast-check biases toward the constants so both branches see coverage.
 */
const roleArbitrary: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...SANCTIONED_ROLES),
  fc.constantFrom(
    "",
    "NEWS_FILTER",
    "News_Filter",
    "news",
    "signal",
    "rationale",
    "scorer",
    "kill_gate",
    "directional_probability",
    " news_filter",
    "news_filter ",
    "research_assistant\n",
  ),
  fc.string(),
);

describe("Property 5: LLM_Interface role gating — accepted iff sanctioned, else rejected+recorded", () => {
  it(
    "accepts iff the role is sanctioned; otherwise rejects before invocation and records the role verbatim",
    async () => {
      await fc.assert(
        fc.asyncProperty(roleArbitrary, async (role) => {
          const { provider, complete } = fakeProvider();
          const recorder = new InMemoryRoleRejectionRecorder();
          const llm = new LlmInterface({
            provider,
            rejectionRecorder: recorder,
            clock: fixedClock,
          });

          // Cast through unknown to exercise the RUNTIME guard: invoke() is typed
          // to `R extends SanctionedRole`, but an untyped caller can pass any
          // string — exactly the case Requirement 2.5 defends.
          const invocation = llm.invoke(role as unknown as SanctionedRole, {});

          if (isSanctionedRole(role)) {
            // (1) Sanctioned role → accepted: resolves, provider WAS called,
            //     and the tagged output carries matching provenance (Req 2.3).
            const tagged = await invocation;
            expect(complete).toHaveBeenCalledTimes(1);
            expect(isLlmTagged(tagged)).toBe(true);
            expect(tagged.provenance.role).toBe(role);
            expect(tagged.provenance.marker).toBe("llm");
            expect(recorder.size).toBe(0);
          } else {
            // (2) Unsanctioned role → rejected BEFORE invocation with
            //     RoleRejectedError, provider NEVER called, and the role string
            //     recorded verbatim (Req 2.5).
            await expect(invocation).rejects.toBeInstanceOf(RoleRejectedError);
            expect(complete).not.toHaveBeenCalled();
            expect(recorder.size).toBe(1);
            const [rec] = recorder.all();
            expect(rec?.requestedRole).toBe(role);
          }
        }),
        { numRuns: 200 },
      );
    },
  );
});
