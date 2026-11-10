/**
 * Pure shaper for the non-blocking "data feed delayed" banner.
 *
 * Moves candle-freshness health from backend logs to the SPA. Source of truth is the
 * `provenance` slice for the displayed Decision_Date (its `dataComplete` / `staleReason` are
 * already judged against the most recent COMPLETED trading day, so a weekend never trips it).
 * A declared market holiday is informational, not a delay. When the slice is empty, the
 * snapshot's own age is the fallback signal.
 *
 * Pure: no fetch, DOM, or ambient clock — `nowMs` is injected. Never touches scoring.
 */
import type { ProvenanceRow, RunHealth } from "../api/types";

/** A snapshot older than this (5 days) is flagged when there is no provenance to judge by. */
export const SNAPSHOT_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export const DATA_DELAYED_MESSAGE =
  "Data feed delayed; evaluating on the latest available session close.";

/**
 * The daily run is scheduled for 17:30 America/New_York on weekdays, i.e. 21:30 UTC in summer
 * and 22:30 UTC in winter. 22:30 UTC is used so the check never fires early; the grace below
 * then allows the Job (which retries stale candles for several minutes) to finish and publish.
 */
const RUN_HOUR_UTC = 22.5;
const RUN_GRACE_HOURS = 2;

function isWeekdayUtc(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The Decision_Date the most recent DUE daily run should have published (weekday calendar;
 * exchange holidays are not modelled, the run still executes on them). A run on weekday W
 * labels itself the next weekday, so a Friday run is expected to publish Monday.
 */
export function expectedLatestDecisionDate(nowMs: number): string {
  const due = (day: Date): number =>
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) +
    (RUN_HOUR_UTC + RUN_GRACE_HOURS) * 3_600_000;
  const cursor = new Date(nowMs);
  cursor.setUTCHours(0, 0, 0, 0);
  // Walk back to the latest weekday whose run is already due.
  for (let i = 0; i < 8; i += 1) {
    if (isWeekdayUtc(cursor) && due(cursor) <= nowMs) break;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  const next = new Date(cursor);
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (!isWeekdayUtc(next));
  return isoDate(next);
}

export interface DataHealthVM {
  /** Headline shown in the banner. */
  readonly message: string;
  /** Plain-language detail line (affected pairs and why), or null when there is none. */
  readonly detail: string | null;
  /** Pairs behind, in input order (empty for the snapshot-age fallback). */
  readonly pairs: readonly string[];
  readonly source: "provenance" | "run_health" | "missed_run" | "snapshot_age";
}

export interface DataHealthInput {
  readonly provenance?: readonly ProvenanceRow[];
  readonly decisionDate: string;
  readonly generatedAt?: string;
  /** v9: pairs the freshness stage left behind on the latest run. */
  readonly runHealth?: RunHealth;
  /** The Decision_Date of the latest PUBLISHED run (not the date being browsed). */
  readonly latestDecisionDate?: string;
  readonly nowMs: number;
}

const REASON_TEXT: Readonly<Record<string, string>> = {
  missing_candle: "latest session candle missing",
  weekend_gap: "latest session candle missing after the weekend",
  stale: "more than one session behind",
};

function reasonText(reason: string | null): string {
  if (reason === null) return "data incomplete";
  return REASON_TEXT[reason] ?? "data incomplete";
}

/** Null when data is healthy; otherwise the banner view model. */
export function shapeDataHealth(input: DataHealthInput): DataHealthVM | null {
  const rows = (input.provenance ?? []).filter((r) => r.decision_date === input.decisionDate);

  if (rows.length > 0) {
    // A declared holiday means the market was closed: not a feed delay.
    const behind = rows.filter((r) => !r.dataComplete && r.staleReason !== "holiday");
    if (behind.length === 0) return null;
    return {
      message: DATA_DELAYED_MESSAGE,
      detail: behind.map((r) => `${r.pair}: ${reasonText(r.staleReason)}`).join("; "),
      pairs: behind.map((r) => r.pair),
      source: "provenance",
    };
  }
  const latest = input.latestDecisionDate;
  const viewingLatest = latest === undefined || latest === input.decisionDate;
  const degraded = viewingLatest ? (input.runHealth?.degradedPairs ?? []) : [];
  if (degraded.length > 0) {
    return {
      message: DATA_DELAYED_MESSAGE,
      detail: `${degraded.join(", ")}: latest session candle was still missing when this ran`,
      pairs: degraded,
      source: "run_health",
    };
  }
  if (latest !== undefined && latest !== "") {
    const expected = expectedLatestDecisionDate(input.nowMs);
    if (latest < expected) {
      return {
        message: "The daily run may not have published.",
        detail: `The latest published run is for ${latest}; the run for ${expected} was expected by now. A quiet dashboard may be a missed run, not a quiet market.`,
        pairs: [],
        source: "missed_run",
      };
    }
    return null;
  }

  const generated = input.generatedAt === undefined ? Number.NaN : Date.parse(input.generatedAt);
  if (Number.isNaN(generated)) return null;
  const ageMs = input.nowMs - generated;
  if (ageMs <= SNAPSHOT_MAX_AGE_MS) return null;
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return {
    message: "Dashboard data may be out of date.",
    detail: `The last published snapshot is ${days} days old.`,
    pairs: [],
    source: "snapshot_age",
  };
}
