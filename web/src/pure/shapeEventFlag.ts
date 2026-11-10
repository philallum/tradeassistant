/**
 * Pure shaper for the "scheduled event today" caution.
 *
 * Central-bank decisions and the US jobs report move FX sharply and fast. The backend's
 * `eventFlags` slice lists the scheduled events on the Decision_Date from a static calendar. This
 * states them plainly as a CAUTION: it is not a signal, it does not change any call, and it never
 * says the market is calm when the calendar has nothing listed (a quiet date beyond the
 * maintained calendar says nothing at all). The slice describes the latest run, so it is hidden
 * when an older date is being browsed.
 */
import type { EventFlags } from "../api/types";

export interface EventFlagVM {
  /** Headline, e.g. "High-impact event today: US Federal Reserve rate decision". */
  readonly headline: string;
  /** Caveat sentence(s): caution-not-signal, plus a note when a date is rule-derived. */
  readonly detail: string;
  /** True when at least one listed date comes from a publishing rule rather than an official list. */
  readonly includesRuleBasedDate: boolean;
}

export const EVENT_CAUTION =
  "Prices can move sharply around the release. This is a caution, not a signal, and it does not change any call.";
export const RULE_BASED_NOTE =
  "The jobs-report date follows the BLS publishing rule and can differ around holidays; confirm it before relying on it.";

/** Null when there is nothing to flag (no events, older date browsed, or nothing listed). */
export function shapeEventFlag(
  flags: EventFlags,
  decisionDate: string,
  viewingLatestRun: boolean,
): EventFlagVM | null {
  if (!viewingLatestRun || flags.decisionDate !== decisionDate || flags.events.length === 0) return null;
  const labels = flags.events.map((e) => e.label);
  const includesRuleBasedDate = flags.events.some((e) => e.basis === "rule");
  return {
    headline: `High-impact event today: ${labels.join("; ")}`,
    detail: includesRuleBasedDate ? `${EVENT_CAUTION} ${RULE_BASED_NOTE}` : EVENT_CAUTION,
    includesRuleBasedDate,
  };
}
