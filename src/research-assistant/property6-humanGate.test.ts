import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { LlmInterface, type Clock, type LlmProvider } from "../llm/llmInterface.js";
import {
  InMemoryRoleRejectionRecorder,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "../llm/types.js";
import {
  CANDIDATE_FEATURES,
  FeatureRegistry,
  InMemoryFeatureRegistryStore,
  type FeatureId,
  type FeatureRegistryRow,
} from "../feature-registry/index.js";
import { LivingDocs, InMemoryDocStore } from "../living-docs/livingDocs.js";
import { acceptIfApproved, proposeResearch } from "./researchAssistant.js";
import {
  InMemoryApprovalStore,
  InMemoryProposalStore,
  PROPOSAL_KINDS,
  type AcceptedProposal,
  type HumanApproval,
  type ProposalKind,
} from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 6: For all research-assistant proposals lacking a recorded human approval, the included feature set and recorded interpretations are identical before and after the proposal.
//
// Validates: Requirement 2.8
//
// The research-assistant role is advisory: WHERE it proposes a feature
// hypothesis or backtest interpretation, acceptance is withheld until an
// explicit human approval is recorded; absent that approval the current feature
// set and recorded interpretations stay unchanged (Requirement 2.8).
//
// This property drives arbitrary proposals (arbitrary ids / kinds / inputs)
// through the real advisory flow WITHOUT ever recording a matching human
// approval, and asserts the state-invariance guarantee end to end:
//
//   1. An initial "included feature set" is modeled as a FeatureRegistry backed
//      by an InMemoryFeatureRegistryStore seeded with an arbitrary-but-fixed
//      `included` set, and "recorded interpretations" as a plain collection the
//      caller only mutates on a non-null AcceptedProposal.
//   2. proposeResearch(...) runs for the generated proposal (advisory), then
//      acceptIfApproved(proposal, approvalStore) is attempted against an
//      approval store that holds NO approval for that proposal.
//   3. acceptIfApproved returns null (acceptance withheld). Because the caller
//      applies changes ONLY on a non-null AcceptedProposal, the included
//      feature set AND the recorded interpretations are deep-equal before and
//      after the proposal.
//   4. A second case records a human approval for a DIFFERENT proposal id to
//      show a non-matching recorded approval still leaves everything unchanged.
//
// The LLM proposal text is produced by a deterministic, offline fake provider so
// proposeResearch is fully deterministic (no network, fixed clocks).

const fixedClock: Clock = { now: () => "2020-01-01T00:00:00.000Z" };
const proposalClock = { now: () => "2020-02-02T00:00:00.000Z" };

/**
 * A deterministic, offline {@link LlmProvider}: it echoes a canned advisory
 * string for the research_assistant role (and empty defaults for the others),
 * so proposeResearch never touches a network and is reproducible.
 */
function fakeProvider(): LlmProvider {
  const canned: RoleOutput = {
    news_filter: { level: "none", reason: "" },
    signal_rationale: "",
    pattern_description: [],
    research_assistant: "Advisory: consider investigating this hypothesis.",
  };
  return {
    complete<R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]> {
      void input;
      return Promise.resolve(canned[role]);
    },
  };
}

function makeLlm(): LlmInterface {
  return new LlmInterface({
    provider: fakeProvider(),
    rejectionRecorder: new InMemoryRoleRejectionRecorder(),
    clock: fixedClock,
  });
}

/**
 * The "included feature set" model: a FeatureRegistry backed by a store seeded
 * with `included` rows for the given features. The registry's `included()` is
 * the single source of truth for the included set (Requirement 12.3), so
 * comparing its output before/after is comparing the real included set.
 */
function makeRegistry(includedFeatures: readonly FeatureId[]): FeatureRegistry {
  const rows: FeatureRegistryRow[] = includedFeatures.map((featureId) => ({
    featureId,
    status: "included",
    verdictId: `verdict-${featureId}`,
  }));
  return new FeatureRegistry({
    // The advisory path never evaluates candidates, so a throwing computer
    // proves no gate re-run happens as a side effect of proposing.
    computer: {
      gateInputsFor() {
        throw new Error("FeatureComputer must not run on the advisory proposal path");
      },
    },
    store: new InMemoryFeatureRegistryStore(rows),
    docs: new LivingDocs(new InMemoryDocStore()),
  });
}

/** An arbitrary, deduplicated subset of the candidate features to seed as included. */
const includedSetArb: fc.Arbitrary<FeatureId[]> = fc
  .subarray([...CANDIDATE_FEATURES], { minLength: 0, maxLength: CANDIDATE_FEATURES.length })
  .map((ids) => [...ids]);

/** An arbitrary recorded-interpretations collection (order-independent set of strings). */
const interpretationsArb: fc.Arbitrary<string[]> = fc.uniqueArray(
  fc.string({ maxLength: 24 }),
  { maxLength: 8 },
);

/** An arbitrary proposal kind from the sanctioned proposal vocabulary. */
const kindArb: fc.Arbitrary<ProposalKind> = fc.constantFrom(...PROPOSAL_KINDS);

/** An arbitrary research-assistant input payload (advisory prompt/context). */
const inputArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  fc.string({ maxLength: 12 }),
  fc.oneof(fc.string({ maxLength: 24 }), fc.integer(), fc.boolean()),
  { maxKeys: 4 },
);

/**
 * The single caller-side rule under test: a change to the included feature set /
 * recorded interpretations is applied ONLY when acceptIfApproved returns a
 * non-null AcceptedProposal. This mirrors how a real caller consumes the gate.
 */
function applyIfAccepted(
  accepted: AcceptedProposal | null,
  interpretations: string[],
): void {
  if (accepted !== null) {
    interpretations.push(`accepted:${accepted.proposal.proposalId}`);
  }
}

describe("Property 6: research-assistant proposals are advisory absent recorded approval (Requirement 2.8)", () => {
  it("leaves the included feature set and recorded interpretations identical when no matching approval is recorded", async () => {
    await fc.assert(
      fc.asyncProperty(
        includedSetArb,
        interpretationsArb,
        fc.string({ minLength: 1, maxLength: 16 }),
        kindArb,
        inputArb,
        async (includedFeatures, interpretationSeed, proposalId, kind, input) => {
          const llm = makeLlm();
          const registry = makeRegistry(includedFeatures);
          const proposalStore = new InMemoryProposalStore();
          const approvalStore = new InMemoryApprovalStore();
          const interpretations = [...interpretationSeed];

          // Snapshot BEFORE: the real included set and the recorded interpretations.
          const includedBefore = await registry.included();
          const interpretationsBefore = [...interpretations];

          // Produce the advisory proposal (routes through the LLM gateway) and
          // attempt acceptance against an EMPTY approval store.
          const proposal = await proposeResearch({
            llm,
            proposalStore,
            proposalId,
            kind,
            input,
            clock: proposalClock,
          });
          const accepted = await acceptIfApproved(proposal, approvalStore);

          // Acceptance is withheld: no recorded approval => null.
          expect(accepted).toBeNull();

          // The caller only mutates state on a non-null AcceptedProposal.
          applyIfAccepted(accepted, interpretations);

          // Snapshot AFTER and assert deep equality on both pieces of state.
          const includedAfter = await registry.included();
          expect(includedAfter).toEqual(includedBefore);
          expect(interpretations).toEqual(interpretationsBefore);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("leaves everything unchanged even when a human approval is recorded for a DIFFERENT proposal", async () => {
    await fc.assert(
      fc.asyncProperty(
        includedSetArb,
        interpretationsArb,
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.string({ minLength: 1, maxLength: 16 }),
        kindArb,
        inputArb,
        fc.string({ maxLength: 12 }),
        async (
          includedFeatures,
          interpretationSeed,
          proposalId,
          otherProposalId,
          kind,
          input,
          approver,
        ) => {
          // Ensure the recorded approval is for a genuinely DIFFERENT proposal.
          fc.pre(otherProposalId !== proposalId);

          const llm = makeLlm();
          const registry = makeRegistry(includedFeatures);
          const proposalStore = new InMemoryProposalStore();
          const approvalStore = new InMemoryApprovalStore();
          const interpretations = [...interpretationSeed];

          // A recorded approval exists, but for a different proposal id.
          const foreignApproval: HumanApproval = {
            proposalId: otherProposalId,
            approvedBy: approver.length > 0 ? approver : "owner",
            approvedAt: "2020-02-03T00:00:00.000Z",
          };
          await approvalStore.record(foreignApproval);

          const includedBefore = await registry.included();
          const interpretationsBefore = [...interpretations];

          const proposal = await proposeResearch({
            llm,
            proposalStore,
            proposalId,
            kind,
            input,
            clock: proposalClock,
          });
          const accepted = await acceptIfApproved(proposal, approvalStore);

          // A non-matching recorded approval does not unlock acceptance.
          expect(accepted).toBeNull();
          applyIfAccepted(accepted, interpretations);

          const includedAfter = await registry.included();
          expect(includedAfter).toEqual(includedBefore);
          expect(interpretations).toEqual(interpretationsBefore);
        },
      ),
      { numRuns: 200 },
    );
  });
});
