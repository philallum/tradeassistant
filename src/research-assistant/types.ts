// Research Assistant Types — human-gated proposal vocabulary (Requirement 2.8;
// Design Component 9 role `research_assistant`, and "The AI / Deterministic
// Boundary": "The research-assistant role can only propose; proposals require
// recorded human approval before the feature set changes").
//
// The research-assistant role produces PROPOSALS ONLY. A proposal is advisory:
// it changes the included feature set or the recorded interpretations ONLY when
// a recorded human approval exists for that specific proposal. Absent approval,
// the current feature set and recorded interpretations are left UNCHANGED
// (Requirement 2.8).
//
// This file defines the typed vocabulary that makes "withhold until recorded
// approval" the ONLY path to acceptance:
//   - `ResearchProposal`   — a provenance-tagged advisory proposal.
//   - `HumanApproval`      — a recorded, explicit human approval of a proposal.
//   - `AcceptedProposal`   — the ONLY shape that authorizes a change; it can be
//                            constructed solely from a proposal + a matching
//                            recorded approval (see researchAssistant.ts).
//   - two storage PORTs (`ProposalStore`, `ApprovalStore`) + in-memory
//     reference implementations, mirroring the storage-port pattern used across
//     the codebase (e.g. `FeatureRegistryStore`, `RoleRejectionRecorder`).
//
// The proposal text itself originates from the LLM and is therefore carried as
// `LlmTagged<string>` — it never reaches a scoring / verdict path (the brand
// keeps it off deterministic math; Requirement 2.6). Acceptance is a
// deterministic gate keyed on a recorded approval, not on the LLM output.

import type { LlmTagged } from "../llm/types.js";

/**
 * The kind of thing a research-assistant proposal concerns (Requirement 2.8):
 *   - `feature_hypothesis`      — a proposed candidate feature to investigate.
 *   - `backtest_interpretation` — a proposed interpretation of backtest results.
 */
export const PROPOSAL_KINDS = ["feature_hypothesis", "backtest_interpretation"] as const;

/** A research-assistant proposal kind (Requirement 2.8). */
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** Type guard for {@link ProposalKind}. */
export function isProposalKind(value: string): value is ProposalKind {
  return (PROPOSAL_KINDS as readonly string[]).includes(value);
}

/**
 * A research-assistant proposal (Requirement 2.8). ADVISORY ONLY: recording a
 * proposal changes nothing on its own. It carries a stable `proposalId` (the key
 * an approval must reference), the `kind`, and the LLM-produced `proposalText`
 * as an `LlmTagged<string>` provenance marker so the text can never leak onto a
 * scoring / verdict path.
 */
export interface ResearchProposal {
  /** Stable id an approval must reference to authorize acceptance. */
  readonly proposalId: string;
  /** What the proposal concerns (feature hypothesis | backtest interpretation). */
  readonly kind: ProposalKind;
  /** The LLM-produced proposal text, provenance-tagged and display/advisory only. */
  readonly proposalText: LlmTagged<string>;
  /** When the proposal was produced (ISO-8601); injectable for deterministic tests. */
  readonly at: string;
}

/**
 * A recorded, EXPLICIT human approval of a specific proposal (Requirement 2.8).
 * This is the ONLY thing that unlocks acceptance: without a recorded approval
 * referencing the proposal's id, the feature set and recorded interpretations
 * stay unchanged. Deliberately a small deterministic record with NO LLM type on
 * it — the gate turns on recorded human intent, not on model output.
 */
export interface HumanApproval {
  /** The {@link ResearchProposal.proposalId} this approval authorizes. */
  readonly proposalId: string;
  /** Identifier of the human who approved (for audit). */
  readonly approvedBy: string;
  /** When the approval was recorded (ISO-8601). */
  readonly approvedAt: string;
  /** Optional free-text note recorded with the approval. */
  readonly note?: string;
}

/**
 * An ACCEPTED proposal — the ONLY shape that authorizes a change to the included
 * feature set or the recorded interpretations (Requirement 2.8). It can be
 * produced solely by pairing a {@link ResearchProposal} with a matching recorded
 * {@link HumanApproval} (see `acceptIfApproved` in researchAssistant.ts). There
 * is no other constructor for it in the module's public API, so "withhold until
 * recorded approval" is the only path to acceptance.
 */
export interface AcceptedProposal {
  /** The proposal that was accepted. */
  readonly proposal: ResearchProposal;
  /** The recorded human approval that authorized acceptance. */
  readonly approval: HumanApproval;
}

// --- research_proposals storage PORT --------------------------------------

/**
 * Storage PORT for recorded research-assistant proposals (Requirement 2.8,
 * 17.1). The research-assistant flow depends only on this port, never on
 * storage directly — mirroring the storage-port pattern used across the
 * codebase (e.g. `FeatureRegistryStore`, `CalendarEventStore`). Implementations
 * upsert by `proposalId`.
 */
export interface ProposalStore {
  /** Persist a proposal, keyed by `proposalId`. */
  record(proposal: ResearchProposal): Promise<void>;
  /** Read a single proposal by id, or null when absent. */
  get(proposalId: string): Promise<ResearchProposal | null>;
  /** Read all recorded proposals (order unspecified). */
  all(): Promise<readonly ResearchProposal[]>;
}

/**
 * In-memory reference implementation of {@link ProposalStore}. Upserts by
 * `proposalId`, deterministic and dependency-free; the reference behaviour for
 * any persistent adapter and the store used to exercise the flow offline.
 */
export class InMemoryProposalStore implements ProposalStore {
  readonly #proposals = new Map<string, ResearchProposal>();

  record(proposal: ResearchProposal): Promise<void> {
    this.#proposals.set(proposal.proposalId, proposal);
    return Promise.resolve();
  }

  get(proposalId: string): Promise<ResearchProposal | null> {
    return Promise.resolve(this.#proposals.get(proposalId) ?? null);
  }

  all(): Promise<readonly ResearchProposal[]> {
    return Promise.resolve([...this.#proposals.values()]);
  }

  /** Test/inspection helper: number of recorded proposals. */
  get size(): number {
    return this.#proposals.size;
  }

  clear(): void {
    this.#proposals.clear();
  }
}

// --- human_approvals storage PORT -----------------------------------------

/**
 * Storage PORT for recorded human approvals (Requirement 2.8, 17.1). This is the
 * gate's source of truth: a proposal is accepted ONLY when this store holds an
 * approval for its id. The flow depends only on this port, never on storage
 * directly. Implementations upsert by `proposalId` (one approval per proposal).
 */
export interface ApprovalStore {
  /** Persist an explicit human approval, keyed by `proposalId`. */
  record(approval: HumanApproval): Promise<void>;
  /** Read the recorded approval for a proposal id, or null when none exists. */
  get(proposalId: string): Promise<HumanApproval | null>;
  /** Read all recorded approvals (order unspecified). */
  all(): Promise<readonly HumanApproval[]>;
}

/**
 * In-memory reference implementation of {@link ApprovalStore}. Upserts by
 * `proposalId`, deterministic and dependency-free; the reference behaviour for
 * any persistent adapter and the store used to exercise the gate offline.
 */
export class InMemoryApprovalStore implements ApprovalStore {
  readonly #approvals = new Map<string, HumanApproval>();

  record(approval: HumanApproval): Promise<void> {
    this.#approvals.set(approval.proposalId, approval);
    return Promise.resolve();
  }

  get(proposalId: string): Promise<HumanApproval | null> {
    return Promise.resolve(this.#approvals.get(proposalId) ?? null);
  }

  all(): Promise<readonly HumanApproval[]> {
    return Promise.resolve([...this.#approvals.values()]);
  }

  /** Test/inspection helper: number of recorded approvals. */
  get size(): number {
    return this.#approvals.size;
  }

  clear(): void {
    this.#approvals.clear();
  }
}
