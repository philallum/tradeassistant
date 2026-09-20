import { describe, expect, it, vi } from "vitest";
import {
  LlmInterface,
  RoleRejectedError,
  tagLlmOutput,
  type Clock,
  type LlmProvider,
} from "./llmInterface.js";
import {
  InMemoryRoleRejectionRecorder,
  isLlmTagged,
  isSanctionedRole,
  PROVENANCE_BRAND,
  SANCTIONED_ROLES,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "./types.js";

// Unit tests for the LLM_Interface role gating + provenance tagging (Task 9.1).
//
// Covers, with concrete examples (not property-based — Property 5 role-gating
// PBT belongs to subtask 9.6):
//   1. Role gating: each of the four sanctioned roles reaches the provider and
//      returns a provenance-tagged output (Requirements 2.3, 2.4).
//   2. Non-sanctioned roles are REJECTED BEFORE the provider is invoked and the
//      rejected role is RECORDED (Requirement 2.5).
//   3. Provenance tagging: outputs carry the non-enumerable brand + provenance
//      record and are detectable by isLlmTagged (Requirement 2.6).

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

describe("LlmInterface role gating (Requirements 2.3, 2.4)", () => {
  it("routes each sanctioned role to the provider and tags the output", async () => {
    const { provider, complete } = fakeProvider();
    const recorder = new InMemoryRoleRejectionRecorder();
    const llm = new LlmInterface({ provider, rejectionRecorder: recorder, clock: fixedClock });

    const inputs: RoleInput = {
      news_filter: { decisionDate: "2020-01-02", events: [] },
      signal_rationale: { trend: "up" },
      pattern_description: { analogues: [] },
      research_assistant: { hypothesis: "add RSI" },
    };

    for (const role of SANCTIONED_ROLES) {
      const tagged = await llm.invoke(role, inputs[role]);
      expect(isLlmTagged(tagged)).toBe(true);
      expect(tagged.provenance.role).toBe(role);
      expect(tagged.provenance.marker).toBe("llm");
      expect(tagged.provenance.at).toBe("2020-01-01T00:00:00.000Z");
    }

    expect(complete).toHaveBeenCalledTimes(SANCTIONED_ROLES.length);
    expect(recorder.size).toBe(0);
  });

  it("returns the provider's value verbatim under the tag", async () => {
    const { provider } = fakeProvider();
    const llm = new LlmInterface({
      provider,
      rejectionRecorder: new InMemoryRoleRejectionRecorder(),
      clock: fixedClock,
    });

    const tagged = await llm.invoke("news_filter", { decisionDate: "2020-01-02", events: [] });
    expect(tagged.value).toEqual({ level: "elevated", reason: "FOMC" });
  });
});

describe("LlmInterface non-sanctioned role rejection (Requirement 2.5)", () => {
  it("rejects an unknown role BEFORE invoking the provider and records it", async () => {
    const { provider, complete } = fakeProvider();
    const recorder = new InMemoryRoleRejectionRecorder();
    const llm = new LlmInterface({ provider, rejectionRecorder: recorder, clock: fixedClock });

    await expect(
      // Cast through unknown: exercises the runtime guard for untyped callers,
      // which is exactly where Requirement 2.5 bites.
      llm.invoke("directional_probability" as unknown as SanctionedRole, {}),
    ).rejects.toBeInstanceOf(RoleRejectedError);

    // Provider must NOT have been touched (rejected before invocation).
    expect(complete).not.toHaveBeenCalled();

    // The rejected role must be recorded (Requirement 2.5).
    expect(recorder.size).toBe(1);
    const [rec] = recorder.all();
    expect(rec?.requestedRole).toBe("directional_probability");
    expect(rec?.at).toBe("2020-01-01T00:00:00.000Z");
  });

  it("records each rejected role distinctly", async () => {
    const { provider } = fakeProvider();
    const recorder = new InMemoryRoleRejectionRecorder();
    const llm = new LlmInterface({ provider, rejectionRecorder: recorder, clock: fixedClock });

    for (const bad of ["kill_gate", "scorer", ""]) {
      await expect(
        llm.invoke(bad as unknown as SanctionedRole, {}),
      ).rejects.toBeInstanceOf(RoleRejectedError);
    }

    expect(recorder.all().map((r) => r.requestedRole)).toEqual(["kill_gate", "scorer", ""]);
  });

  it("isSanctionedRole recognizes exactly the four roles", () => {
    for (const role of SANCTIONED_ROLES) expect(isSanctionedRole(role)).toBe(true);
    for (const bad of ["news", "rationale", "scorer", "", "NEWS_FILTER"]) {
      expect(isSanctionedRole(bad)).toBe(false);
    }
  });
});

describe("provenance tagging (Requirement 2.6)", () => {
  it("brands the value with a non-enumerable symbol that isLlmTagged detects", () => {
    const tagged = tagLlmOutput("hello", "signal_rationale", "2020-01-01T00:00:00.000Z");

    expect(isLlmTagged(tagged)).toBe(true);
    expect((tagged as Record<PropertyKey, unknown>)[PROVENANCE_BRAND]).toBe(true);

    // The brand must be non-enumerable: it must not leak into keys or JSON.
    expect(Object.keys(tagged)).toEqual(["value", "provenance"]);
    expect(Object.getOwnPropertySymbols(tagged)).toContain(PROVENANCE_BRAND);
    expect(JSON.parse(JSON.stringify(tagged))).toEqual({
      value: "hello",
      provenance: { role: "signal_rationale", marker: "llm", at: "2020-01-01T00:00:00.000Z" },
    });
  });

  it("isLlmTagged rejects plain values and look-alikes without the symbol brand", () => {
    expect(isLlmTagged(null)).toBe(false);
    expect(isLlmTagged("hello")).toBe(false);
    expect(isLlmTagged(42)).toBe(false);
    // A forged object with the same fields but no symbol brand is NOT tagged.
    expect(
      isLlmTagged({ value: 1, provenance: { role: "news_filter", marker: "llm", at: "x" } }),
    ).toBe(false);
  });
});
