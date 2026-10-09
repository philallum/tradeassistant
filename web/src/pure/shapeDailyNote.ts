/**
 * Pure daily-commentary (AI note) shaper (property-testable — Req 19 spirit).
 *
 * PURE: no `fetch`, no DOM, no clock, imports NOTHING from the deterministic core (`src/`).
 * Deterministic over its input alone.
 *
 * It turns the snapshot's pair-independent `dailyCommentary` object (schema v3) into the
 * small view model the Setups tab renders as the daily AI note — a short plain-language
 * summary of the day's scan that also serves as an LLM-path liveness signal. The note text
 * is copied VERBATIM; nothing is recomputed or synthesised. The three states the UI must
 * distinguish are made explicit:
 *   - a real note was generated (`status: "generated"`, `text` non-empty),
 *   - the run completed but the AI layer was unavailable / errored
 *     (`status: "unavailable"` — `generated` false), shown as an explicit non-error marker
 *     rather than a fabricated note, and
 *   - no commentary slice at all (older snapshot) → `status: "absent"`, so the caller omits
 *     the note entirely.
 */

import type { DailyCommentary } from "../api/types.ts";

/** The display state of the daily AI note. */
export type DailyNoteStatus = "generated" | "unavailable" | "absent";

/** The daily-note view model the Setups panel renders. */
export interface DailyNoteViewModel {
  readonly status: DailyNoteStatus;
  /** The verbatim note text, or `null` when not generated. */
  readonly text: string | null;
  /** The Decision_Date the note is for, or `null` when absent. */
  readonly decisionDate: string | null;
}

/**
 * Shape the `dailyCommentary` object into a {@link DailyNoteViewModel}.
 *
 * - `generated: true` with non-empty `note_text` → `"generated"` (render the note).
 * - a record present (a Decision_Date is set) but not generated, or generated with empty
 *   text → `"unavailable"` (render the explicit "AI commentary unavailable" marker).
 * - no record / empty Decision_Date (older v1/v2 snapshot) → `"absent"` (omit the note).
 *
 * Verbatim: when generated, `text` is exactly `note_text`; never recomputed or fabricated.
 */
export function shapeDailyNote(commentary: DailyCommentary | undefined): DailyNoteViewModel {
  if (commentary === undefined || commentary.decision_date === "") {
    return { status: "absent", text: null, decisionDate: null };
  }
  const text = commentary.note_text.trim();
  if (commentary.generated && text !== "") {
    return {
      status: "generated",
      text: commentary.note_text,
      decisionDate: commentary.decision_date,
    };
  }
  return { status: "unavailable", text: null, decisionDate: commentary.decision_date };
}
