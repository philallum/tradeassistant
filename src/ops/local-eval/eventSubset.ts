// Event-day vs ordinary-day split (offline measurement).
//
// Question: does the pattern call behave differently on days with a scheduled high-impact event
// (central-bank decision, US jobs report)? The calendar is a caution flag only; this measures
// whether that caution is earned. Only dates from the first maintained year (2021) are used,
// because earlier FOMC/ECB/NFP dates are not in the list; the ECB list is incomplete before 2026,
// so "event day" here means FOMC decisions and US jobs reports (rule-derived).
import { eventsOn } from "../../event-calendar/eventCalendar.js";
import type { DayRecord, TargetSession } from "./dayRecords.js";
import { compareStrategies } from "./baselines.js";
import { scoreAccuracy, type SubsetName } from "./scoring.js";

/** First date the maintained calendar can be relied on for the event-day split. */
export const EVENT_SPLIT_START = "2021-01-01" as const;

export interface EventSplitRow {
  readonly group: "event days" | "ordinary days";
  readonly days: number;
  readonly scored: number;
  readonly modelRate: number;
  readonly baselineRate: number;
  readonly delta: number;
  readonly meanNetPips: number;
}

/** Evaluate the model on event days and ordinary days from 2021 onward. */
export function splitByEventDay(
  records: readonly DayRecord[],
  subset: SubsetName,
  session: TargetSession,
): readonly EventSplitRow[] {
  const usable = records.filter((r) => r.date >= EVENT_SPLIT_START);
  const isEvent = (r: DayRecord): boolean => eventsOn(r.date).some((e) => e.kind === "FOMC" || e.kind === "US_NFP");
  const groups: readonly { group: EventSplitRow["group"]; rows: readonly DayRecord[] }[] = [
    { group: "event days", rows: usable.filter(isEvent) },
    { group: "ordinary days", rows: usable.filter((r) => !isEvent(r)) },
  ];
  return groups.map(({ group, rows }) => {
    const acc = scoreAccuracy(rows, subset, session);
    const model = compareStrategies(rows, subset, session).find((s) => s.id === "model");
    return {
      group,
      days: acc.days,
      scored: acc.scored,
      modelRate: acc.model.rate,
      baselineRate: acc.baseline.rate,
      delta: acc.delta,
      meanNetPips: model?.meanNetPips ?? 0,
    };
  });
}

const pct = (x: number): string => (x * 100).toFixed(2);

export function renderEventSplitLines(rows: readonly EventSplitRow[], subset: SubsetName): readonly string[] {
  return [
    `Event-day split [${subset}, from ${EVENT_SPLIT_START}; event = FOMC decision or US jobs report (rule-derived; ECB excluded, its history is not listed)]:`,
    ...rows.map(
      (r) =>
        `    ${r.group}: days=${r.days} scored=${r.scored} model ${pct(r.modelRate)}% vs weekly-trend ${pct(r.baselineRate)}% (delta ${r.delta >= 0 ? "+" : ""}${pct(r.delta)}pp) net ${r.meanNetPips >= 0 ? "+" : ""}${r.meanNetPips.toFixed(2)} pips/trade`,
    ),
  ];
}
