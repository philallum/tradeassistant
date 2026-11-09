// Canonical daily candles built from HOURLY bars on the 17:00 America/New_York close.
//
// WHY THIS EXISTS (see docs/state/RISKS.md, "DAILY CANDLE DATA INTEGRITY"):
// the system's daily candle for date D is the session [D-1 17:00 NY, D 17:00 NY) - Monday's
// session opens Sunday 17:00 NY. Provider "daily" endpoints do NOT share that definition:
//   - FCS `latest` is the still-FORMING bar, stamped with its OPEN time (the previous calendar
//     day), so a bar minutes or hours old was stored as a completed candle;
//   - Twelve Data's daily bars roll at 20:00 UTC, publish Saturday/Sunday bars, and "latest"
//     after the roll is the brand-new empty next-day bar;
//   - Massive's `prev` is the previous UTC calendar day.
// Each provider's `date` was trusted verbatim, so the NY session normalisation never ran.
//
// This module removes the trust: it takes HOURLY bars (a granularity every provider labels
// unambiguously by the bar's start instant) and builds each session itself. A session is emitted
// ONLY when it is
//   - a weekday session (Saturday-labelled sessions never exist: Friday 17:00 NY is the weekly close),
//   - CLOSED (its 17:00 NY end is not after `now`), so a forming bar can never be stored as final,
//   - COMPLETE (enough bars, the first near the session start, and the FINAL hour present).
// Anything else is reported with a reason and NOT emitted. Pure and deterministic: `now` is injected.
//
// Time zones: 17:00 NY is 22:00 UTC in winter (EST) and 21:00 UTC in summer (EDT). It is computed
// with Intl, never with a fixed offset, so DST needs no special case.

import { previousCalendarDate } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";

/** One hourly bar, stamped with the instant it OPENED (epoch ms, UTC). */
export interface HourlyBar {
  readonly openMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export const HOUR_MS = 60 * 60 * 1000;

/** Fewest hourly bars a session may have and still be called complete (DST day has 23). */
export const DEFAULT_MIN_BARS_PER_SESSION = 18 as const;

/** The session's first bar may open at most this long after the session start. */
const MAX_START_SLACK_MS = 2 * HOUR_MS;

const NY_ZONE = "America/New_York";
const SESSION_CLOSE_HOUR_NY = 17;

const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

interface NyWallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
}

/** The America/New_York wall-clock fields of a UTC instant. */
function nyWallClock(utcMs: number): NyWallClock {
  const parts = nyFormatter.formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

/** NY offset from UTC (NY local minus UTC) in ms, at the given instant. */
function nyOffsetMs(utcMs: number): number {
  const w = nyWallClock(utcMs);
  const minute = Number(
    nyFormatter.formatToParts(new Date(utcMs)).find((p) => p.type === "minute")?.value,
  );
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, minute) - utcMs;
}

/** The UTC instant of `hour:00` New York wall-clock time on a calendar date. */
function nyWallToUtcMs(date: TradingDate, hour: number): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour);
  // Two passes: the offset is evaluated at the corrected instant, which is right even when the
  // guess and the true instant fall either side of a DST change (not at 17:00, but cheap).
  const first = guess - nyOffsetMs(guess);
  return guess - nyOffsetMs(first);
}

/** The UTC instant at which the session labelled `date` closes (`date` 17:00 NY). */
export function sessionCloseUtcMs(date: TradingDate): number {
  return nyWallToUtcMs(date, SESSION_CLOSE_HOUR_NY);
}

/** `[start, end)` of the session labelled `date`: previous calendar day 17:00 NY to `date` 17:00 NY. */
export function sessionWindowUtcMs(date: TradingDate): { readonly startMs: number; readonly endMs: number } {
  return {
    startMs: nyWallToUtcMs(previousCalendarDate(date), SESSION_CLOSE_HOUR_NY),
    endMs: sessionCloseUtcMs(date),
  };
}

function isWeekday(date: TradingDate): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

/** The session label a bar belongs to: its NY date, or the next date if it opened at/after 17:00 NY. */
export function sessionLabelOf(openMs: number): TradingDate {
  const w = nyWallClock(openMs);
  const base = Date.UTC(w.year, w.month - 1, w.day) + (w.hour >= SESSION_CLOSE_HOUR_NY ? 24 * HOUR_MS : 0);
  return new Date(base).toISOString().slice(0, 10);
}

export type SessionRejection = "not_closed" | "too_few_bars" | "missing_start" | "missing_end";

export type SessionResult =
  | {
      readonly ok: true;
      readonly date: TradingDate;
      readonly open: number;
      readonly high: number;
      readonly low: number;
      readonly close: number;
      readonly bars: number;
    }
  | { readonly ok: false; readonly date: TradingDate; readonly reason: SessionRejection };

export interface AggregateOptions {
  /** The current instant (UTC ms). A session that has not closed by now is never emitted. */
  readonly nowMs: number;
  /** Sessions dated on or after this are ignored entirely (the Decision_Date: look-ahead safety). */
  readonly asOf?: TradingDate;
  /** Override of {@link DEFAULT_MIN_BARS_PER_SESSION}. */
  readonly minBars?: number;
}

/**
 * Build every weekday session the given hourly bars touch, oldest first. Each is either a complete,
 * closed `ok` session or a rejection with the reason (so a caller can say WHY a day is missing).
 * Input order does not matter; duplicate bars at the same instant keep the first.
 */
export function aggregateSessions(
  bars: readonly HourlyBar[],
  options: AggregateOptions,
): readonly SessionResult[] {
  const minBars = options.minBars ?? DEFAULT_MIN_BARS_PER_SESSION;

  const byOpen = new Map<number, HourlyBar>();
  for (const bar of bars) {
    if (!byOpen.has(bar.openMs)) byOpen.set(bar.openMs, bar);
  }
  const sorted = [...byOpen.values()].sort((a, b) => a.openMs - b.openMs);

  const labels = new Set<TradingDate>();
  for (const bar of sorted) {
    const label = sessionLabelOf(bar.openMs);
    if (isWeekday(label) && (options.asOf === undefined || label < options.asOf)) labels.add(label);
  }

  const results: SessionResult[] = [];
  for (const date of [...labels].sort()) {
    const { startMs, endMs } = sessionWindowUtcMs(date);
    if (endMs > options.nowMs) {
      results.push({ ok: false, date, reason: "not_closed" });
      continue;
    }
    const inWindow = sorted.filter((b) => b.openMs >= startMs && b.openMs < endMs);
    if (inWindow.length < minBars) {
      results.push({ ok: false, date, reason: "too_few_bars" });
      continue;
    }
    const first = inWindow[0] as HourlyBar;
    const last = inWindow[inWindow.length - 1] as HourlyBar;
    if (first.openMs > startMs + MAX_START_SLACK_MS) {
      results.push({ ok: false, date, reason: "missing_start" });
      continue;
    }
    if (last.openMs < endMs - HOUR_MS) {
      results.push({ ok: false, date, reason: "missing_end" });
      continue;
    }
    results.push({
      ok: true,
      date,
      open: first.open,
      high: Math.max(...inWindow.map((b) => b.high)),
      low: Math.min(...inWindow.map((b) => b.low)),
      close: last.close,
      bars: inWindow.length,
    });
  }
  return results;
}

/** The newest complete session, or undefined if there is none. */
export function latestCompleteSession(results: readonly SessionResult[]): Extract<SessionResult, { ok: true }> | undefined {
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const r = results[i] as SessionResult;
    if (r.ok) return r;
  }
  return undefined;
}

/** A short, secret-free explanation of why no session could be produced. */
export function describeNoSession(results: readonly SessionResult[]): string {
  if (results.length === 0) return "no hourly bars in the requested window";
  const newest = results[results.length - 1] as SessionResult;
  if (newest.ok) return "no session";
  return `newest session ${newest.date} is not usable: ${newest.reason}`;
}
