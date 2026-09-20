import { describe, expect, it, vi } from "vitest";
import { LlmInterface, type Clock, type LlmProvider } from "../llm/llmInterface.js";
import {
  InMemoryRoleRejectionRecorder,
  isLlmTagged,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "../llm/types.js";
import type { Deterministic } from "../llm/scoringInputGuard.js";
import { generatePatternDescription, generateSignalRationale } from "./rationale.js";
import type {
  AnalogueLabels,
  AnalogueSummary,
  SignalNumericInputs,
  SignalRationaleText,
} from "./types.js";
import { earnedConfidence } from "../confidence/confidenceSelector.js";
import type { Confidence } from "../confidence/types.js";

// Focused wiring unit tests for the rationale / pattern-description generators
// (Task 9.4; Requirement 15). These deliberately do NOT overlap with:
//   - Property 4 (9.5) — the AI-free-scoring guardrail PBT;
//   - Property 6 (9.7) — the research-proposal human-gate PBT;
//   - the 9.11 smoke tests for rationale/label generation.
//
// They assert only this subtask's wiring: the generators route through the
// single LLM gateway with the right role and numeric-only input projection, and
// the outputs are display-only `LlmTagged<…>` values (Requirements 15.1–15.4).

function fakeProvider(): { provider: LlmProvider; complete: ReturnType<typeof vi.fn> } {
  const canned: RoleOutput = {
    news_filter: { level: "none", reason: "" },
    signal_rationale: "Weekly trend up; strong analogue resolution over 2 days.",
    pattern_description: ["V-reversal", "range breakout"],
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
  const provider: LlmProvider = { complete: complete as unknown as LlmProvider["complete"] };
  return { provider, complete };
}

const fixedClock: Clock = { now: () => "2020-01-01T00:00:00.000Z" };

function makeLlm(): { llm: LlmInterface; complete: ReturnType<typeof vi.fn> } {
  const { provider, complete } = fakeProvider();
  const llm = new LlmInterface({
    provider,
    rejectionRecorder: new InMemoryRoleRejectionRecorder(),
    clock: fixedClock,
  });
  return { llm, complete };
}

const numericInputs: SignalNumericInputs = {
  pattern: "pattern-42",
  trendContext: "UP",
  structuralLiquidityDistancePips: 12.5,
  selectedHorizon: 2,
  direction: "UP",
  earnedConfidence: 0.71 as Confidence,
};

describe("generateSignalRationale (Requirements 15.1, 15.2)", () => {
  it("routes through the LLM gateway using the signal_rationale role", async () => {
    const { llm, complete } = makeLlm();
    await generateSignalRationale(llm, numericInputs);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toBe("signal_rationale");
  });

  it("projects only the deterministic numeric signal fields into the role input", async () => {
    const { llm, complete } = makeLlm();
    await generateSignalRationale(llm, numericInputs);

    const sentInput = complete.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sentInput).toEqual({
      pattern: "pattern-42",
      trendContext: "UP",
      structuralLiquidityDistancePips: 12.5,
      selectedHorizon: 2,
      direction: "UP",
      earnedConfidence: 0.71,
    });
  });

  it("returns a provenance-tagged, display-only rationale value", async () => {
    const { llm } = makeLlm();
    const rationale = await generateSignalRationale(llm, numericInputs);

    expect(isLlmTagged(rationale)).toBe(true);
    expect(rationale.provenance.role).toBe("signal_rationale");
    expect(rationale.value).toContain("Weekly trend up");
  });
});

describe("generatePatternDescription (Requirement 15.3)", () => {
  const analogues: readonly AnalogueSummary[] = [
    { decisionDate: "2019-06-01", direction: "UP", horizon: 2, mfePips: 40, maePips: 8 },
    { decisionDate: "2019-07-15", direction: "UP", horizon: 2, mfePips: 33, maePips: 12 },
  ];

  it("routes through the LLM gateway using the pattern_description role", async () => {
    const { llm, complete } = makeLlm();
    await generatePatternDescription(llm, analogues);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toBe("pattern_description");
  });

  it("returns provenance-tagged, display-only labels", async () => {
    const { llm } = makeLlm();
    const labels = await generatePatternDescription(llm, analogues);

    expect(isLlmTagged(labels)).toBe(true);
    expect(labels.provenance.role).toBe("pattern_description");
    expect(labels.value).toEqual(["V-reversal", "range breakout"]);
  });
});

describe("exclusion from scoring by construction (Requirement 15.4)", () => {
  it("keeps rationale/labels off the deterministic scoring path", async () => {
    const { llm } = makeLlm();
    const rationale = await generateSignalRationale(llm, numericInputs);
    const labels = await generatePatternDescription(llm, [
      { decisionDate: "2019-06-01", direction: "UP", horizon: 1, mfePips: 40, maePips: 8 },
    ]);

    // COMPILE-TIME guarantee: `Deterministic<T>` collapses an `LlmTagged<…>` to
    // `never`, so neither generated value is assignable to a scoring input.
    // These assignments type-check ONLY because the values are `never`-typed
    // when viewed as a Deterministic parameter; the @ts-expect-error lines below
    // prove a scoring function would reject them.
    type RationaleAsScoringInput = Deterministic<SignalRationaleText>;
    type LabelsAsScoringInput = Deterministic<AnalogueLabels>;
    const _rationaleNever: RationaleAsScoringInput = undefined as never;
    const _labelsNever: LabelsAsScoringInput = undefined as never;
    void _rationaleNever;
    void _labelsNever;

    function scoreWithDeterministic<T>(value: Deterministic<T>): T {
      return value;
    }
    // @ts-expect-error rationale is LlmTagged and rejected on a scoring path.
    scoreWithDeterministic(rationale);
    // @ts-expect-error labels are LlmTagged and rejected on a scoring path.
    scoreWithDeterministic(labels);

    // RUNTIME sanity: the deterministic scorer produces the same result whether
    // or not rationale/labels were generated — they are not inputs to it.
    const neighborhood = [
      { asset: "EURUSD" as const, decisionDate: "2019-06-01", horizon: 1 as const, direction: "UP" as const, mfePips: 40, maePips: 8, atr14: 20, matured: true },
      { asset: "EURUSD" as const, decisionDate: "2019-06-02", horizon: 1 as const, direction: "UP" as const, mfePips: 30, maePips: 10, atr14: 20, matured: true },
    ];
    const before = earnedConfidence(neighborhood, 1);
    // Regenerating display text changes nothing about the numeric signal.
    await generateSignalRationale(llm, numericInputs);
    const after = earnedConfidence(neighborhood, 1);
    expect(after).toBe(before);
    expect(isLlmTagged(rationale)).toBe(true);
  });
});
