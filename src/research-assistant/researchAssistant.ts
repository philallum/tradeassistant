// Research Assistant — human-gated proposal flow (Requirement 2.8; Design
// Component 9 role `research_assistant`, and "The AI / Deterministic Boundary").
//
// The research-assistant role can only PROPOSE. This module makes that concrete:
//
//   proposeResearch(llm, store, …) → ResearchProposal
//     Routes through `LlmInterface.invoke("research_assistant", …)` (Req 2.4),
//     records the proposal, and returns it. Recording a proposal changes
//     NOTHING about the included feature set or recorded interpretations — it is
//     advisory only.
//
//   acceptIfApproved(proposal, approvalStore) → AcceptedProposal | null
//     The gate. It returns an `AcceptedProposal` (the only shape that authorizes
//     a change) IF AND ONLY IF the approval store holds a recorded human
//     approval for the proposal's id. Absent a recorded approval it returns
//     `null`, so the caller leaves the feature set and interpretations unchanged
//     (Requirement 2.8).
//
// "Withhold until recorded approval" is the ONLY path to acceptance: the module
// exposes no other way to construct an `AcceptedProposal`. The LLM proposal text
// is carried as `LlmTagged<string>`, so it can never reach a scoring / verdict
// path; the acceptance decision turns solely on the recorded human approval,
// never on the model output.

import type { LlmInterface } from "../llm/llmInterface.js";
import type { ResearchAssistantInput } from "../llm/types.js";
import type {
  AcceptedProposal,
  ApprovalStore,
  HumanApproval,
  ProposalKind,
  ProposalStore,
  ResearchProposal,
} from "./types.js";

/**
 * Clock PORT so proposal timestamps are injectable and tests stay deterministic.
 * Defaults to the system clock in production. Named `ResearchAssistantClock` to
 * avoid a barrel collision with other modules' `Clock`.
 */
export interface ResearchAssistantClock {
  now(): string;
}

const systemClock: ResearchAssistantClock = { now: () => new Date().toISOString() };

/** Arguments for {@link proposeResearch}. */
export interface ProposeResearchArgs {
  /** The single LLM gateway (Requirement 2.4). */
  readonly llm: LlmInterface;
  /** Store that records the (advisory) proposal (Requirement 2.8, 17.1). */
  readonly proposalStore: ProposalStore;
  /** Stable id for the proposal (the key an approval must reference). */
  readonly proposalId: string;
  /** What the proposal concerns (feature hypothesis | backtest interpretation). */
  readonly kind: ProposalKind;
  /** The prompt/context handed to the `research_assistant` role. */
  readonly input: ResearchAssistantInput;
  /** Injectable clock; defaults to the system clock. */
  readonly clock?: ResearchAssistantClock;
}

/**
 * Produce a research-assistant proposal and record it (Requirement 2.8).
 *
 * Routes through the single LLM gateway (Requirement 2.4); the model output is
 * `LlmTagged<string>`, so the proposal text can never leak onto a scoring /
 * verdict path. Recording the proposal is PURELY advisory — it does NOT change
 * the included feature set or any recorded interpretation. A change requires a
 * separate, recorded human approval consumed by {@link acceptIfApproved}.
 *
 * @returns the recorded {@link ResearchProposal}. Acceptance is withheld until a
 *          human approval is recorded.
 */
export async function proposeResearch(args: ProposeResearchArgs): Promise<ResearchProposal> {
  const clock = args.clock ?? systemClock;
  const proposalText = await args.llm.invoke("research_assistant", args.input);
  const proposal: ResearchProposal = {
    proposalId: args.proposalId,
    kind: args.kind,
    proposalText,
    at: clock.now(),
  };
  await args.proposalStore.record(proposal);
  return proposal;
}

/**
 * Record an explicit human approval for a proposal (Requirement 2.8). This is
 * the ONLY thing that unlocks acceptance. Persisting an approval is the recorded
 * human intent {@link acceptIfApproved} keys on; until it exists, the proposal
 * remains advisory and the feature set / interpretations stay unchanged.
 */
export async function recordApproval(
  approvalStore: ApprovalStore,
  approval: HumanApproval,
): Promise<void> {
  await approvalStore.record(approval);
}

/**
 * The human-approval GATE (Requirement 2.8).
 *
 * Returns an {@link AcceptedProposal} — the only shape that authorizes a change
 * to the included feature set or recorded interpretations — IF AND ONLY IF the
 * approval store holds a recorded human approval whose `proposalId` matches the
 * proposal. Otherwise it returns `null`, and the caller MUST leave the current
 * feature set and recorded interpretations unchanged.
 *
 * This is the single acceptance path: there is no other public way to obtain an
 * `AcceptedProposal`, so "withhold until recorded approval" is structurally the
 * only route to a change.
 *
 * @returns the authorizing {@link AcceptedProposal}, or `null` when no approval
 *          is recorded (nothing changes).
 */
export async function acceptIfApproved(
  proposal: ResearchProposal,
  approvalStore: ApprovalStore,
): Promise<AcceptedProposal | null> {
  const approval = await approvalStore.get(proposal.proposalId);
  if (approval === null) return null;
  return { proposal, approval };
}
