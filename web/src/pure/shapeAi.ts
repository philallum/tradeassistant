/**
 * Pure display-only AI-rationale shaper (property-testable — Req 19).
 *
 * This module is PURE: no `fetch`, no DOM, no clock (`Date.now()`), and it imports NOTHING
 * from the deterministic core (`src/`). It is a deterministic function of its `rows`
 * argument alone.
 *
 * It turns a pair's persisted `v_signal_rationale` rows into the inert, clearly-labeled
 * view model the AI tab renders. All text, labels, and proposals are copied VERBATIM from
 * the persisted row — the shaper NEVER synthesizes advisory text (Req 11.1, 11.4, 20.1).
 * When no rationale, no labels, and no proposals are present, the section is OMITTED
 * (`present: false`) rather than filled with fabricated content (Req 11.4).
 *
 * The rendering layer is responsible for the AI-generated / advisory / non-scoring labeling
 * (Req 11.2, 11.3) and for rendering this text as auto-escaped React children.
 */

import type { SignalProposal, SignalRationaleRow } from "../api/endpoints.ts";

/** A single advisory proposal, copied verbatim from `signal_rationale.proposals`. */
export type AiProposalVM = SignalProposal;

/**
 * Display-only AI view model for a single pair + Decision_Date.
 *
 * - `present` is false when no row exists, or when the row carries no rationale text, no
 *   labels, and no proposals: the AI section is then omitted entirely (Req 11.4).
 * - `rationaleText` is `null` when the persisted text is empty/absent — never a fabricated
 *   narrative.
 * - `analogueLabels` and `proposals` are copied verbatim and are empty arrays when absent.
 */
export interface AiViewModel {
  readonly present: boolean;
  readonly rationaleText: string | null;
  readonly analogueLabels: readonly string[];
  readonly proposals: readonly AiProposalVM[];
}

const ABSENT: AiViewModel = {
  present: false,
  rationaleText: null,
  analogueLabels: [],
  proposals: [],
};

/**
 * Pick the row with the maximum Decision_Date (ISO `YYYY-MM-DD` → lexicographic max).
 * The AI endpoint is scoped to a single pair + Decision_Date, so in practice there is at
 * most one row; selecting the latest keeps the shaper total and order-independent.
 */
function latestRow(
  rows: readonly SignalRationaleRow[],
): SignalRationaleRow | null {
  let chosen: SignalRationaleRow | null = null;
  for (const row of rows) {
    if (chosen === null || row.decision_date > chosen.decision_date) {
      chosen = row;
    }
  }
  return chosen;
}

/**
 * Shape a pair's `signal_rationale` rows into an {@link AiViewModel}.
 *
 * Returns an omitted (`present: false`) model when the input is empty or when the selected
 * row has no rationale text, no analogue labels, and no proposals (Req 11.4). Otherwise it
 * copies the rationale text, analogue labels, and proposals verbatim (Req 11.1, 20.1).
 */
export function shapeAi(rows: readonly SignalRationaleRow[]): AiViewModel {
  const row = latestRow(rows);
  if (row === null) {
    return ABSENT;
  }

  const rationaleText =
    row.rationale_text.length > 0 ? row.rationale_text : null;
  const analogueLabels = row.analogue_labels;
  const proposals = row.proposals;

  const hasContent =
    rationaleText !== null || analogueLabels.length > 0 || proposals.length > 0;

  if (!hasContent) {
    return ABSENT;
  }

  return {
    present: true,
    rationaleText,
    analogueLabels,
    proposals,
  };
}
