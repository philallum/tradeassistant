// Display-only write-shape TYPES — the structural inputs the dashboard snapshot
// carries for its AI and Third-party tabs (Requirement 15, 23).
//
// These used to live beside the Supabase display-only WRITER
// (`makeDisplayDataPersister`), which upserted the `signal_rationale` /
// `external_reference_comparison` tables. Under simplify-to-cloud-minimal those
// tables are dropped (migration `...006`) and their display content moves into
// the `dashboard.json` snapshot (design C4), so the DB writer is gone. The
// types survive because they still describe the snapshot's display-input shape:
// `src/scheduled-run/displayOnly.ts` produces them and
// `src/scheduled-run/snapshot.ts` maps them into the wire-format snapshot rows.
//
// They are pure structural types with type-only dependencies — no secret, no
// REST client, no DB access.

import type {
  AnalogueLabels,
  DailyCommentaryText,
  SignalRationaleText,
} from "../../rationale/index.js";
import type {
  ExternalReferenceSignal,
  ReferenceComparison,
} from "../../external-signal/index.js";
import type { DirectionClass } from "../../retrieval/types.js";

/**
 * A display-only rationale for one (decision_date, pair). The rationale text and
 * analogue labels arrive as their `LlmTagged<…>` provenance markers
 * (`SignalRationaleText` / `AnalogueLabels` from `src/rationale`); they are
 * unwrapped at the snapshot boundary — never re-entering scoring.
 */
export interface SignalRationaleWrite {
  readonly decisionDate: string;
  readonly pair: string;
  /** LLM-produced rationale text (provenance-tagged, display-only). */
  readonly rationale: SignalRationaleText;
  /** LLM-produced qualitative analogue labels (provenance-tagged, display-only). */
  readonly analogueLabels: AnalogueLabels;
}

/**
 * A display-only own-vs-provider comparison for one (decision_date, pair).
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
 * A display-only whole-day AI commentary note for a Decision_Date — a short
 * plain-language summary of the day's scan, produced EVERY trading day (fired or
 * not) as an LLM-path liveness signal. The note arrives as its `LlmTagged<…>`
 * provenance marker (`DailyCommentaryText` from `src/rationale`); it is unwrapped
 * at the snapshot boundary and never re-enters scoring. Pair-INDEPENDENT (one
 * note per Decision_Date, not per pair).
 */
export interface DailyNoteWrite {
  readonly decisionDate: string;
  /** LLM-produced whole-day commentary (provenance-tagged, display-only). */
  readonly note: DailyCommentaryText;
}

/**
 * The display-only payload carried alongside a Decision_Date's firing view into
 * the snapshot. Every field is optional so a run with no rationale / no
 * reference / no note simply carries nothing for that slice.
 */
export interface DisplayOnlyWrite {
  readonly rationales?: readonly SignalRationaleWrite[];
  readonly comparisons?: readonly ReferenceComparisonWrite[];
  /** The pair-independent whole-day AI commentary note, when generated. */
  readonly dailyNote?: DailyNoteWrite;
}
