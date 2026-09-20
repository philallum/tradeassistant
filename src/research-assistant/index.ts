// Research Assistant module public API — Component 9 role `research_assistant`
// (Requirement 2.8).
//
// Human-gated proposals: the role can only PROPOSE (via the single
// `LlmInterface.invoke()` gateway, Requirement 2.4). A proposal changes the
// included feature set or recorded interpretations ONLY when a recorded human
// approval exists for it (`acceptIfApproved` returns an `AcceptedProposal` iff
// the `ApprovalStore` holds a matching approval); absent approval, nothing
// changes. The proposal text is `LlmTagged<string>`, so it never reaches a
// scoring / verdict path (the AI / Deterministic boundary).

export {
  PROPOSAL_KINDS,
  isProposalKind,
  InMemoryProposalStore,
  InMemoryApprovalStore,
  type ProposalKind,
  type ResearchProposal,
  type HumanApproval,
  type AcceptedProposal,
  type ProposalStore,
  type ApprovalStore,
} from "./types.js";
export {
  proposeResearch,
  recordApproval,
  acceptIfApproved,
  type ResearchAssistantClock,
  type ProposeResearchArgs,
} from "./researchAssistant.js";
