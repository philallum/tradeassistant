// The snapshot `eventFlags` slice: scheduled high-impact events on the Decision_Date.
// Display-only and pure; it feeds nothing back into firing, confidence or scoring.
import type { TradingDate } from "../guard/types.js";
import { CALENDAR_COVERED_THROUGH, eventsOn, type EventBasis, type EventKind } from "./eventCalendar.js";

export interface SnapshotEventFlag {
  readonly kind: EventKind;
  readonly label: string;
  readonly basis: EventBasis;
}

export interface SnapshotEventFlagsSlice {
  /** The Decision_Date the flags are for. */
  readonly decisionDate: string;
  /** Events listed on that date (empty = none listed). */
  readonly events: readonly SnapshotEventFlag[];
  /** False when the date is beyond the maintained lists, so "no events" cannot be asserted. */
  readonly calendarCovers: boolean;
}

/** The empty/fail-safe default (older snapshots, failed builds). */
export const EMPTY_EVENT_FLAGS: SnapshotEventFlagsSlice = { decisionDate: "", events: [], calendarCovers: false };

export function buildEventFlags(decisionDate: TradingDate): SnapshotEventFlagsSlice {
  return {
    decisionDate,
    events: eventsOn(decisionDate).map((e) => ({ kind: e.kind, label: e.label, basis: e.basis })),
    calendarCovers: decisionDate <= CALENDAR_COVERED_THROUGH,
  };
}
