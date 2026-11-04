/**
 * Pure per-pair AI note shaper.
 *
 * PURE: no `fetch`, no DOM, no clock, imports NOTHING from the deterministic core (`src/`).
 *
 * The snapshot carries one AI rationale per FIRING pair (`aiRationale`) next to the single
 * pair-independent whole-day note (`dailyCommentary`). The Master_Card is about ONE selected
 * pair, so it must lead with that pair's own rationale; the whole-day note is a separate,
 * clearly labelled overview. This shaper picks the selected pair's rationale for the
 * Decision_Date and copies its text VERBATIM; nothing is recomputed or synthesised.
 *
 * It reuses {@link DailyNoteViewModel} so the view renders both notes the same way:
 *   - a rationale exists with text         -> `"generated"`
 *   - a row exists but its text is blank   -> `"unavailable"`
 *   - no row for the pair on that date     -> `"absent"` (the pair did not fire, or the AI
 *     layer produced nothing for it)
 */

import type { SignalRationaleRow } from "../api/types.ts";
import type { DailyNoteViewModel } from "./shapeDailyNote.ts";

export function shapePairNote(
  rows: readonly SignalRationaleRow[] | undefined,
  pair: string,
  decisionDate: string,
): DailyNoteViewModel {
  const row = rows?.find((r) => r.pair === pair && r.decision_date === decisionDate);
  if (row === undefined) {
    return { status: "absent", text: null, decisionDate: null };
  }
  if (row.rationale_text.trim() === "") {
    return { status: "unavailable", text: null, decisionDate };
  }
  return { status: "generated", text: row.rationale_text, decisionDate };
}
