import { describe, expect, it, vi } from "vitest";
import { LlmInterface, type Clock, type LlmProvider } from "../llm/llmInterface.js";
import {
  InMemoryRoleRejectionRecorder,
  isLlmTagged,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "../llm/types.js";
import { generatePatternDescription, generateSignalRationale } from "./rationale.js";
import type { AnalogueSummary, SignalNumericInputs } from "./types.js";
import type { Confidence } from "../confidence/types.js";

// Rationale / label GENERATION smoke tests from NUMERIC inputs
// (Task 9.11; Requirements 15.1, 15.3).
//
// NON-OVERLAPPING with rationale.test.ts (which covers the happy-path wiring:
// role routing, one canned projection, and the compile-time scoring exclusion).
// Here the focus is the NUMERIC-ONLY projection contract across a couple of
// edge inputs: generateSignalRationale must project ONLY the numeric
// SignalNumericInputs fields into the role input (no extra/LLM-derived keys),
// generatePatternDescription must project each AnalogueSummary's numeric fields,
// and both outputs are display-only LlmTagged<...> values.

const fixedClock: Clock = { now: () => "2020-01-01T00:00:00.000Z" };

/** Capture the role + input each generator sends, and return canned outputs. */
function makeLlm(): { llm: LlmInterface; complete: ReturnType<typeof vi.fn> } {
  const canned: RoleOutput = {
    news_filter: { level: "none", reason: "" },
    signal_rationale: "rationale text",
    pattern_description: ["label-a", "label-b"],
    research_assistant: "",
  };
  // The generic implementation is declared separately so `vi.fn` does not have
  // to infer (and collapse) the generic call signature — under Vitest 5's
  // typings a `Mock` wrapping a generic function is no longer assignable back to
  // the generic `LlmProvider["complete"]`. We spy on the concrete impl and cast
  // the spy to the provider's signature at the boundary; behavior is unchanged.
  const impl = <R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]> => {
    void input;
    return Promise.resolve(canned[role]);
  };
  const complete = vi.fn(impl);
  const llm = new LlmInterface({
    provider: { complete: complete as unknown as LlmProvider["complete"] } satisfies LlmProvider,
    rejectionRecorder: new InMemoryRoleRejectionRecorder(),
    clock: fixedClock,
  });
  return { llm, complete };
}

describe("generateSignalRationale numeric-only projection (Requirement 15.1)", () => {
  it.each<SignalNumericInputs>([
    {
      pattern: "pattern-1",
      trendContext: "UP",
      structuralLiquidityDistancePips: 0,
      selectedHorizon: 1,
      direction: "UP",
      earnedConfidence: 0 as Confidence,
    },
    {
      pattern: "pattern-99",
      trendContext: "DOWN",
      structuralLiquidityDistancePips: 128.75,
      selectedHorizon: 3,
      direction: "FLAT",
      earnedConfidence: 1 as Confidence,
    },
  ])("projects exactly the numeric signal fields into the role input", async (numericInputs) => {
    const { llm, complete } = makeLlm();
    await generateSignalRationale(llm, numericInputs);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toBe("signal_rationale");
    const sent = complete.mock.calls[0]?.[1] as Record<string, unknown>;
    // The projection is lossless AND adds nothing derived: exact key/value set.
    expect(sent).toEqual({
      pattern: numericInputs.pattern,
      trendContext: numericInputs.trendContext,
      structuralLiquidityDistancePips: numericInputs.structuralLiquidityDistancePips,
      selectedHorizon: numericInputs.selectedHorizon,
      direction: numericInputs.direction,
      earnedConfidence: numericInputs.earnedConfidence,
    });
    expect(Object.keys(sent).sort()).toEqual([
      "direction",
      "earnedConfidence",
      "pattern",
      "selectedHorizon",
      "structuralLiquidityDistancePips",
      "trendContext",
    ]);
  });

  it("returns a display-only, provenance-tagged rationale value", async () => {
    const { llm } = makeLlm();
    const rationale = await generateSignalRationale(llm, {
      pattern: "p",
      trendContext: "UP",
      structuralLiquidityDistancePips: 5,
      selectedHorizon: 2,
      direction: "UP",
      earnedConfidence: 0.5 as Confidence,
    });

    expect(isLlmTagged(rationale)).toBe(true);
    expect(rationale.provenance.role).toBe("signal_rationale");
    expect(typeof rationale.value).toBe("string");
  });
});

describe("generatePatternDescription numeric-only projection (Requirement 15.3)", () => {
  it("projects each analogue's numeric fields and returns display-only labels", async () => {
    const analogues: readonly AnalogueSummary[] = [
      { decisionDate: "2019-06-01", direction: "UP", horizon: 2, mfePips: 40, maePips: 8 },
      { decisionDate: "2019-07-15", direction: "DOWN", horizon: 1, mfePips: 12, maePips: 30 },
    ];
    const { llm, complete } = makeLlm();
    const labels = await generatePatternDescription(llm, analogues);

    expect(complete.mock.calls[0]?.[0]).toBe("pattern_description");
    const sent = complete.mock.calls[0]?.[1] as { analogues: Record<string, unknown>[] };
    expect(sent.analogues).toEqual([
      { decisionDate: "2019-06-01", direction: "UP", horizon: 2, mfePips: 40, maePips: 8 },
      { decisionDate: "2019-07-15", direction: "DOWN", horizon: 1, mfePips: 12, maePips: 30 },
    ]);

    expect(isLlmTagged(labels)).toBe(true);
    expect(labels.provenance.role).toBe("pattern_description");
    expect(labels.value).toEqual(["label-a", "label-b"]);
  });

  it("handles an empty analogue set as an empty projection", async () => {
    const { llm, complete } = makeLlm();
    await generatePatternDescription(llm, []);

    const sent = complete.mock.calls[0]?.[1] as { analogues: unknown[] };
    expect(sent.analogues).toEqual([]);
  });
});
