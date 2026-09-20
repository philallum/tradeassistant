import { describe, expect, it, vi } from "vitest";
import { LlmInterface, type Clock, type LlmProvider } from "../llm/llmInterface.js";
import {
  InMemoryRoleRejectionRecorder,
  isLlmTagged,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "../llm/types.js";
import {
  acceptIfApproved,
  proposeResearch,
  recordApproval,
  type ResearchAssistantClock,
} from "./researchAssistant.js";
import {
  InMemoryApprovalStore,
  InMemoryProposalStore,
  type HumanApproval,
} from "./types.js";

// Focused wiring unit tests for the human-gated research-assistant flow
// (Task 9.4; Requirement 2.8). These deliberately do NOT overlap with:
//   - Property 6 (9.7) — the PBT asserting the included feature set and
//     recorded interpretations are identical for proposals lacking approval;
//   - the 9.11 smoke tests.
//
// They assert only this subtask's wiring: proposing routes through the LLM
// gateway and is advisory; acceptance is withheld until a recorded human
// approval exists, and is the only path to an AcceptedProposal.

function fakeProvider(): { provider: LlmProvider; complete: ReturnType<typeof vi.fn> } {
  const canned: RoleOutput = {
    news_filter: { level: "none", reason: "" },
    signal_rationale: "",
    pattern_description: [],
    research_assistant: "Consider adding RSI as a candidate feature.",
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
const proposalClock: ResearchAssistantClock = { now: () => "2020-02-02T00:00:00.000Z" };

function makeLlm(): { llm: LlmInterface; complete: ReturnType<typeof vi.fn> } {
  const { provider, complete } = fakeProvider();
  const llm = new LlmInterface({
    provider,
    rejectionRecorder: new InMemoryRoleRejectionRecorder(),
    clock: fixedClock,
  });
  return { llm, complete };
}

describe("proposeResearch (Requirement 2.8)", () => {
  it("routes through the research_assistant role and records an advisory proposal", async () => {
    const { llm, complete } = makeLlm();
    const proposalStore = new InMemoryProposalStore();

    const proposal = await proposeResearch({
      llm,
      proposalStore,
      proposalId: "p-1",
      kind: "feature_hypothesis",
      input: { hypothesis: "add RSI" },
      clock: proposalClock,
    });

    expect(complete.mock.calls[0]?.[0]).toBe("research_assistant");
    expect(proposal.proposalId).toBe("p-1");
    expect(proposal.kind).toBe("feature_hypothesis");
    expect(proposal.at).toBe("2020-02-02T00:00:00.000Z");
    // The proposal text is provenance-tagged (never reaches a scoring path).
    expect(isLlmTagged(proposal.proposalText)).toBe(true);
    // It is recorded, but recording is purely advisory.
    expect(proposalStore.size).toBe(1);
    expect(await proposalStore.get("p-1")).not.toBeNull();
  });
});

describe("acceptIfApproved gate (Requirement 2.8)", () => {
  it("withholds acceptance when no human approval is recorded", async () => {
    const { llm } = makeLlm();
    const proposalStore = new InMemoryProposalStore();
    const approvalStore = new InMemoryApprovalStore();

    const proposal = await proposeResearch({
      llm,
      proposalStore,
      proposalId: "p-2",
      kind: "backtest_interpretation",
      input: { note: "regime shift" },
      clock: proposalClock,
    });

    const accepted = await acceptIfApproved(proposal, approvalStore);
    expect(accepted).toBeNull();
  });

  it("accepts only after a matching human approval is recorded", async () => {
    const { llm } = makeLlm();
    const proposalStore = new InMemoryProposalStore();
    const approvalStore = new InMemoryApprovalStore();

    const proposal = await proposeResearch({
      llm,
      proposalStore,
      proposalId: "p-3",
      kind: "feature_hypothesis",
      input: { hypothesis: "add RSI" },
      clock: proposalClock,
    });

    // Before approval: withheld.
    expect(await acceptIfApproved(proposal, approvalStore)).toBeNull();

    const approval: HumanApproval = {
      proposalId: "p-3",
      approvedBy: "owner",
      approvedAt: "2020-02-03T00:00:00.000Z",
      note: "worth testing",
    };
    await recordApproval(approvalStore, approval);

    // After a recorded approval: accepted, carrying both proposal and approval.
    const accepted = await acceptIfApproved(proposal, approvalStore);
    expect(accepted).not.toBeNull();
    expect(accepted?.proposal.proposalId).toBe("p-3");
    expect(accepted?.approval.approvedBy).toBe("owner");
  });

  it("does not accept when the recorded approval is for a different proposal", async () => {
    const approvalStore = new InMemoryApprovalStore();
    await recordApproval(approvalStore, {
      proposalId: "other",
      approvedBy: "owner",
      approvedAt: "2020-02-03T00:00:00.000Z",
    });

    const { llm } = makeLlm();
    const proposalStore = new InMemoryProposalStore();
    const proposal = await proposeResearch({
      llm,
      proposalStore,
      proposalId: "p-4",
      kind: "feature_hypothesis",
      input: {},
      clock: proposalClock,
    });

    expect(await acceptIfApproved(proposal, approvalStore)).toBeNull();
  });
});
