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
import {
  generateDailyCommentary,
  toDailyCommentaryInput,
  type DailyCommentaryInput,
  type DailyCommentaryText,
} from "./dailyCommentary.js";
import type { Confidence } from "../confidence/types.js";

// Wiring unit tests for the daily-commentary generator (the LLM-path liveness
// note produced every trading day). They assert: it routes through the single
// LLM gateway using the SANCTIONED `signal_rationale` role (no new role), it
// projects ONLY deterministic numbers into the role input, and its output is a
// display-only `LlmTagged<string>` that is structurally excluded from scoring.

function fakeProvider(): { provider: LlmProvider; complete: ReturnType<typeof vi.fn> } {
  const canned: RoleOutput = {
    news_filter: { level: "none", reason: "" },
    signal_rationale: "No setups cleared the threshold today; conditions were choppy across the majors.",
    pattern_description: [],
    research_assistant: "",
  };
  const impl = <R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]> => {
    void input;
    return Promise.resolve(canned[role]);
  };
  const complete = vi.fn(impl);
  const provider: LlmProvider = { complete: complete as unknown as LlmProvider["complete"] };
  return { provider, complete };
}

const fixedClock: Clock = { now: () => "2026-10-09T00:00:00.000Z" };

function makeLlm(): { llm: LlmInterface; complete: ReturnType<typeof vi.fn> } {
  const { provider, complete } = fakeProvider();
  const llm = new LlmInterface({
    provider,
    rejectionRecorder: new InMemoryRoleRejectionRecorder(),
    clock: fixedClock,
  });
  return { llm, complete };
}

const input: DailyCommentaryInput = {
  decisionDate: "2026-10-09",
  confidenceThreshold: 0.55,
  pairs: [
    { pair: "EURUSD", direction: "DOWN", earnedConfidence: 0.40 as Confidence, choppiness: 0.3, fired: false },
    { pair: "GBPUSD", direction: "UP", earnedConfidence: 0.62 as Confidence, choppiness: 0.8, fired: true },
    { pair: "USDJPY", direction: "FLAT", earnedConfidence: 0.99 as Confidence, choppiness: 0.5, fired: false },
  ],
};

describe("generateDailyCommentary", () => {
  it("routes through the LLM gateway using the sanctioned signal_rationale role", async () => {
    const { llm, complete } = makeLlm();
    await generateDailyCommentary(llm, input);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toBe("signal_rationale");
  });

  it("projects only deterministic numbers + the display intent into the role input", () => {
    const sent = toDailyCommentaryInput(input) as Record<string, unknown>;
    expect(sent.decisionDate).toBe("2026-10-09");
    expect(sent.confidenceThreshold).toBe(0.55);
    expect(sent.evaluatedCount).toBe(3);
    expect(sent.firedCount).toBe(1); // only GBPUSD fired
    expect(sent.task).toBe("daily_commentary");
    // Per-pair facts are copied verbatim; nothing LLM-derived crosses in.
    expect(sent.pairs).toEqual([
      { pair: "EURUSD", direction: "DOWN", earnedConfidence: 0.40, choppiness: 0.3, fired: false },
      { pair: "GBPUSD", direction: "UP", earnedConfidence: 0.62, choppiness: 0.8, fired: true },
      { pair: "USDJPY", direction: "FLAT", earnedConfidence: 0.99, choppiness: 0.5, fired: false },
    ]);
  });

  it("returns a provenance-tagged, display-only note value", async () => {
    const { llm } = makeLlm();
    const note = await generateDailyCommentary(llm, input);

    expect(isLlmTagged(note)).toBe(true);
    expect(note.provenance.role).toBe("signal_rationale");
    expect(note.value).toContain("No setups cleared the threshold");
  });

  it("is excluded from scoring by construction (LlmTagged collapses to never on a Deterministic path)", async () => {
    const { llm } = makeLlm();
    const note = await generateDailyCommentary(llm, input);

    type NoteAsScoringInput = Deterministic<DailyCommentaryText>;
    const _never: NoteAsScoringInput = undefined as never;
    void _never;

    function scoreWithDeterministic<T>(value: Deterministic<T>): T {
      return value;
    }
    // @ts-expect-error the daily note is LlmTagged and rejected on a scoring path.
    scoreWithDeterministic(note);

    expect(isLlmTagged(note)).toBe(true);
  });

  it("produces a note on a NO-FIRE day (every trading day), not just when something fires", async () => {
    const { llm, complete } = makeLlm();
    const noFire: DailyCommentaryInput = {
      decisionDate: "2026-10-09",
      confidenceThreshold: 0.55,
      pairs: input.pairs.map((p) => ({ ...p, fired: false })),
    };
    const note = await generateDailyCommentary(llm, noFire);
    expect(complete).toHaveBeenCalledTimes(1);
    expect((toDailyCommentaryInput(noFire) as Record<string, unknown>).firedCount).toBe(0);
    expect(isLlmTagged(note)).toBe(true);
  });
});
