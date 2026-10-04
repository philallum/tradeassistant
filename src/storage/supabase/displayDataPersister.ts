// Supabase display-only persistence writer for the `persistView` seam
// (Dashboard_UI design "Core-side display-only persistence"; Requirement 20).
//
// This is the core-side companion to `makeSupabaseViewPersister`. Where that
// writer persists the deterministic firing cards + suppressions to
// `firing_setups`, THIS writer persists the two DISPLAY-ONLY tables the
// dashboard's AI and Third-party tabs read:
//
//   signal_rationale              — PK (decision_date, pair, strategy_id)
//     rationale_text, analogue_labels text[], proposals jsonb, provenance,
//     is_display_only, recorded_at
//   external_reference_comparison — PK (decision_date, pair)
//     own_direction, reference_direction, reference_score, provider,
//     comparison, provenance, is_display_only, fetched_at, recorded_at
//
// Both tables are written ONLY under the existing `pipeline_writer` write path
// (Req 20.3): the writer reuses the shared `SupabaseRestClient` and adds NO new
// dependency. `is_display_only` is always `true` and the producing-role
// `provenance` is always persisted (Req 20.3, 20.4).
//
// Compute/storage separation (Req 20.1, 20.2): this module performs ONLY the
// outward write. It never re-enters scoring and takes the already-produced
// rationale / comparison values as inputs — the `dailyRun` firing logic and the
// pipeline are untouched. The LLM-derived rationale / labels arrive as their
// `LlmTagged<…>` provenance markers and are unwrapped (`.value` extracted, the
// producing `role` recorded as provenance) at THIS write boundary exactly as the
// FiringCard render boundary unwraps them (src/dashboard/dashboard.ts); the
// branded display-only value never flows back onto a scoring path. The
// `SupabaseConfig.key` is a `Secret_Key`, carried only in request headers by the
// REST client and never logged.

import type { AnalogueLabels, SignalRationaleText } from "../../rationale/index.js";
import type { ResearchProposal } from "../../research-assistant/index.js";
import type {
  ExternalReferenceSignal,
  ReferenceComparison,
} from "../../external-signal/index.js";
import type { DirectionClass } from "../../retrieval/types.js";
import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";

const SIGNAL_RATIONALE = "signal_rationale";
const EXTERNAL_REFERENCE_COMPARISON = "external_reference_comparison";

/** The v1 deterministic system Strategy_Source (schema default 'system'). */
const SYSTEM_STRATEGY_ID = "system";

/**
 * A display-only rationale write for one (decision_date, pair, strategy_id). The
 * rationale text and analogue labels arrive as their `LlmTagged<…>` provenance
 * markers (`SignalRationaleText` / `AnalogueLabels` from `src/rationale`); they
 * are unwrapped at the write boundary — never re-entering scoring. Research
 * proposals, when present, contribute their LLM-tagged `proposalText` verbatim.
 */
export interface SignalRationaleWrite {
  readonly decisionDate: string;
  readonly pair: string;
  /** Defaults to the `system` Strategy_Source when omitted. */
  readonly strategyId?: string;
  /** LLM-produced rationale text (provenance-tagged, display-only). */
  readonly rationale: SignalRationaleText;
  /** LLM-produced qualitative analogue labels (provenance-tagged, display-only). */
  readonly analogueLabels: AnalogueLabels;
  /** Optional advisory research proposals shown on the AI tab. */
  readonly proposals?: readonly ResearchProposal[];
}

/**
 * A display-only own-vs-provider comparison write for one (decision_date, pair).
 * Carries the system's own Direction_Class, the fetched
 * {@link ExternalReferenceSignal} (or `null` when unavailable), and the
 * `comparison` tag produced by `compareToOwn` (`src/external-signal`). The
 * reference is research/display-only and never feeds a scoring path (Req 20.4).
 */
export interface ReferenceComparisonWrite {
  readonly decisionDate: string;
  readonly pair: string;
  /** The system's own Direction_Class for the pair, or `null` when none. */
  readonly ownDirection: DirectionClass | null;
  /** The fetched provider reference, or `null` when unavailable. */
  readonly reference: ExternalReferenceSignal | null;
  /** The agreement/divergence tag from `compareToOwn`. */
  readonly comparison: ReferenceComparison;
}

/**
 * The display-only payload persisted alongside a Decision_Date's firing view.
 * Both collections are optional so a run with no rationale / no reference simply
 * writes nothing for that table.
 */
export interface DisplayOnlyWrite {
  readonly rationales?: readonly SignalRationaleWrite[];
  readonly comparisons?: readonly ReferenceComparisonWrite[];
}

/** The display-only persister bound to a resolved Supabase connection. */
export type DisplayDataPersister = (data: DisplayOnlyWrite) => Promise<void>;

/**
 * Build the `signal_rationale` row for one write, unwrapping the LLM provenance
 * markers at the write boundary. `is_display_only` is forced to `true`; the
 * producing `role` of the rationale is recorded as `provenance` so an audit can
 * attribute the row back to its sanctioned LLM role (Req 20.3, 20.4).
 */
function rationaleRow(write: SignalRationaleWrite): Record<string, unknown> {
  return {
    decision_date: write.decisionDate,
    pair: write.pair,
    strategy_id: write.strategyId ?? SYSTEM_STRATEGY_ID,
    // Unwrap the `LlmTagged<…>` display values at the write boundary (mirrors
    // the FiringCard render boundary): extract `.value`, never the brand.
    rationale_text: write.rationale.value,
    analogue_labels: [...write.analogueLabels.value],
    proposals: (write.proposals ?? []).map((p) => ({
      proposalId: p.proposalId,
      kind: p.kind,
      proposalText: p.proposalText.value,
      at: p.at,
    })),
    // Producing-role provenance (recorded for audit; the key is never logged).
    provenance: write.rationale.provenance.role,
    is_display_only: true,
  };
}

/**
 * Build the `external_reference_comparison` row for one write. `is_display_only`
 * is forced to `true`; `provenance` records the fetching provider (or the
 * `external_provider` default when the reference is unavailable) (Req 20.4).
 */
function comparisonRow(write: ReferenceComparisonWrite): Record<string, unknown> {
  const ref = write.reference;
  return {
    decision_date: write.decisionDate,
    pair: write.pair,
    own_direction: write.ownDirection,
    reference_direction: ref === null ? null : ref.direction,
    reference_score: ref?.score ?? null,
    provider: ref === null ? null : ref.provider,
    comparison: write.comparison,
    provenance: ref === null ? "external_provider" : ref.provider,
    is_display_only: true,
    fetched_at: ref === null ? null : ref.fetchedAt,
  };
}

/**
 * Build a {@link DisplayDataPersister} bound to a resolved {@link SupabaseConfig}.
 * Upserts the display-only `signal_rationale` and `external_reference_comparison`
 * rows under the `pipeline_writer` write path, idempotent on each table's
 * primary key so re-running the same Decision_Date rewrites its rows rather than
 * duplicating them. Mirrors `makeSupabaseViewPersister`: it reuses the shared
 * `SupabaseRestClient`, adds NO new dependency, and never logs the secret key.
 *
 * @param supabase  The resolved connection (IPv4 pooler/REST URL + key).
 * @param fetchImpl Injectable fetch (defaults to the global); tests inject a
 *                  stub so no network is required.
 */
export function makeDisplayDataPersister(
  supabase: SupabaseConfig,
  fetchImpl?: typeof fetch,
): DisplayDataPersister {
  const client =
    fetchImpl === undefined
      ? new SupabaseRestClient(supabase)
      : new SupabaseRestClient(supabase, fetchImpl);
  return async (data: DisplayOnlyWrite): Promise<void> => {
    const rationaleRows = (data.rationales ?? []).map(rationaleRow);
    const comparisonRows = (data.comparisons ?? []).map(comparisonRow);
    // `upsert` is a no-op for an empty row set, so each table is written only
    // when the run produced display values for it.
    await client.upsert(
      SIGNAL_RATIONALE,
      rationaleRows,
      "decision_date,pair,strategy_id",
    );
    await client.upsert(
      EXTERNAL_REFERENCE_COMPARISON,
      comparisonRows,
      "decision_date,pair",
    );
  };
}
