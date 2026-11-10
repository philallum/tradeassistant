// Static high-impact event calendar (FLAG ONLY).
//
// Retail traders get hurt on central-bank and jobs-report days. This module answers one
// question - "is a scheduled high-impact event on this date?" - from a hand-kept, source-noted
// list. It is a CAUTION flag, never a signal: nothing here is read by retrieval, confidence,
// firing or the Kill_Gate, and a guard test pins that firing output is byte-identical with and
// without it. News is still not an input to anything (LESSONS: event risk suppresses, never
// generates).
//
// Sources and confidence (dates are the day the decision/release is published):
//   FOMC   2021-2027: federalreserve.gov/monetarypolicy/fomccalendars.htm (decision = day 2). Official.
//   ECB    2026 (six meetings confirmed from the ECB's published meeting accounts) and
//          Dec 2026 - Dec 2028 (ecb.europa.eu meeting schedule; decision = day 2). Official.
//          Earlier ECB years are NOT listed (not verified), so ECB history is incomplete.
//   US_NFP derived from the BLS rule: the Employment Situation is released on the third Friday
//          after the end of the week containing the 12th. It reproduces every date we could
//          confirm (2026-02-06, 04-03, 05-08, 09-04, 10-02, 11-06) but BLS says "typically", so
//          holiday and shutdown exceptions exist: these dates carry `basis: "rule"`.
// Refresh the lists when the Fed/ECB publish new years; the test pins the verified dates.
import type { TradingDate } from "../guard/types.js";

export type EventKind = "FOMC" | "ECB" | "US_NFP";
export type EventBasis = "official" | "rule";

export interface CalendarEvent {
  readonly date: TradingDate;
  readonly kind: EventKind;
  /** Plain-language label shown to the user. */
  readonly label: string;
  readonly basis: EventBasis;
}

/** Currencies a kind of event moves, for context in the label. */
const LABELS: Readonly<Record<EventKind, string>> = {
  FOMC: "US Federal Reserve rate decision",
  ECB: "ECB rate decision",
  US_NFP: "US jobs report (non-farm payrolls)",
};

/** FOMC policy-decision days (the second day of each scheduled meeting). Official. */
export const FOMC_DECISION_DATES: readonly TradingDate[] = [
  "2021-01-27", "2021-03-17", "2021-04-28", "2021-06-16", "2021-07-28", "2021-09-22", "2021-11-03", "2021-12-15",
  "2022-01-26", "2022-03-16", "2022-05-04", "2022-06-15", "2022-07-27", "2022-09-21", "2022-11-02", "2022-12-14",
  "2023-02-01", "2023-03-22", "2023-05-03", "2023-06-14", "2023-07-26", "2023-09-20", "2023-11-01", "2023-12-13",
  "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27", "2027-12-08",
];

/** ECB monetary-policy decision days (day 2 of the meeting). Official; earlier years not verified. */
export const ECB_DECISION_DATES: readonly TradingDate[] = [
  "2026-02-05", "2026-03-19", "2026-04-30", "2026-06-11", "2026-07-23", "2026-09-10", "2026-12-17",
  "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10", "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16",
  "2028-02-03", "2028-03-23", "2028-05-04", "2028-06-08", "2028-07-20", "2028-09-07", "2028-10-12", "2028-12-07",
];

const DAY_MS = 86_400_000;

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(d: Date): TradingDate {
  return d.toISOString().slice(0, 10);
}

/**
 * The BLS rule for the Employment Situation release of a reference month: the third Friday after
 * the end (Saturday) of the week containing the 12th. Pure. `month` is 1..12.
 */
export function nfpReleaseDateByRule(year: number, month: number): TradingDate {
  const twelfth = utcDate(year, month, 12);
  const saturdayEnd = new Date(twelfth.getTime() + (6 - twelfth.getUTCDay()) * DAY_MS);
  // First Friday after that Saturday is +6 days; the third is +20 days.
  return iso(new Date(saturdayEnd.getTime() + 20 * DAY_MS));
}

/** Every rule-derived NFP release for reference months 2020-12 .. 2027-12. */
function buildNfpDates(): readonly TradingDate[] {
  const out: TradingDate[] = [];
  for (let year = 2020; year <= 2027; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      if (year === 2020 && month < 12) continue;
      out.push(nfpReleaseDateByRule(year, month));
    }
  }
  return out;
}

export const NFP_DATES_BY_RULE: readonly TradingDate[] = buildNfpDates();

function toEvents(dates: readonly TradingDate[], kind: EventKind, basis: EventBasis): readonly CalendarEvent[] {
  return dates.map((date) => ({ date, kind, label: LABELS[kind], basis }));
}

/** The full calendar, ascending by date then kind. */
export const EVENT_CALENDAR: readonly CalendarEvent[] = [
  ...toEvents(FOMC_DECISION_DATES, "FOMC", "official"),
  ...toEvents(ECB_DECISION_DATES, "ECB", "official"),
  ...toEvents(NFP_DATES_BY_RULE, "US_NFP", "rule"),
].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

const BY_DATE: ReadonlyMap<TradingDate, readonly CalendarEvent[]> = (() => {
  const m = new Map<TradingDate, CalendarEvent[]>();
  for (const e of EVENT_CALENDAR) {
    const list = m.get(e.date);
    if (list === undefined) m.set(e.date, [e]);
    else list.push(e);
  }
  return m;
})();

/** Scheduled high-impact events on a calendar date (empty when none are listed). */
export function eventsOn(date: TradingDate): readonly CalendarEvent[] {
  return BY_DATE.get(date) ?? [];
}

/** True when any listed event falls on `date`. */
export function isEventDay(date: TradingDate): boolean {
  return BY_DATE.has(date);
}

/** The last calendar date for which the lists are maintained; beyond it "no event" is unknown. */
export const CALENDAR_COVERED_THROUGH: TradingDate = "2027-12-31";
