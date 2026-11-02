// Signal_Provenance — trader-edge-validation Stage E (task 14; design R9).
//
// Answers, for one pair's forecast: "how fresh is the data behind this, and when
// could a trader actually act on it?" Derived deterministically from CandleStore
// coverage plus an INJECTED run clock (`computedAt`) — no `Date.now()` here — and
// carries no LLM field (R9.5). Read-only: only `getCoverageSummary` / `getCandles`
// are queried. Not yet referenced by the daily run or the snapshot (Stage F).
//
// DAILY CANDLE CONVENTION (explicit so DST can never silently shift it)
// ---------------------------------------------------------------------
// A daily candle dated `D` is the FX session that CLOSES at 17:00
// America/New_York (the NY close) on `D`; `D` is the candle's identity. Its
// timestamp is therefore `D` @ 17:00 NY, rendered with the explicit UTC offset
// in force on `D` (-05:00 in winter, -04:00 in summer). The offset is computed
// from the IANA zone per date, never hard-coded, so the same wall-clock close maps
// to 22:00Z or 21:00Z across DST. Trading dates are weekdays, and US DST changes
// at 02:00 on a Sunday, so 17:00 NY on a weekday is never ambiguous.
//
// `earliestEntryRef` is the stamp of the NEXT trading day's candle — the R2
// next-session-open reference (see `resolveEntry`): the fill is the open of the
// first candle dated strictly after the last candle, never the close the forecast
// was computed from (R2.3). Being a later trading date, it is strictly after
// `lastCandleTimestamp`.

import { addTradingDays, isTradingDay } from "../guard/tradingDate.js";
import type { TradingDate } from "../guard/types.js";
import type { CandleStore, Pair } from "../ingestion/types.js";
import { mostRecentCompletedTradingDay } from "../scheduled-run/completedTradingDay.js";

/** The IANA zone whose 17:00 close defines the daily candle. */
export const SESSION_TIME_ZONE = "America/New_York" as const;
/** Session-close hour (24h clock) in {@link SESSION_TIME_ZONE}. */
export const SESSION_CLOSE_HOUR = 17 as const;

/** Why a pair's data is not complete (R9.3). */
export type StaleReason =
  | "holiday"
  | "missing_candle"
  | "weekend_gap"
  | "stale";

export interface SignalProvenance {
  readonly pair: Pair;
  /** Last stored candle's close stamp, ISO with explicit offset (R9.1, R9.4). */
  readonly lastCandleTimestamp: string;
  /** The injected run clock as ISO UTC (explicit `Z`). */
  readonly computedAt: string;
  /** Next-session-open reference (R2), strictly after `lastCandleTimestamp`. */
  readonly earliestEntryRef: string;
  readonly horizonStart: string;
  readonly horizonEnd: string;
  /** false => surface as unavailable rather than normal (R9.2). */
  readonly dataComplete: boolean;
  readonly staleReason: StaleReason | null;
}

export interface DeriveProvenanceInput {
  readonly pair: Pair;
  readonly decisionDate: TradingDate;
  /** Forecast horizon in trading days (>= 1). */
  readonly horizonDays: number;
  /** The injected run clock. */
  readonly computedAt: Date;
  /** READ-ONLY: only getCoverageSummary / getCandles are queried. */
  readonly candleStore: CandleStore;
  /**
   * Known market-holiday dates. The project has no holiday calendar, so a missing
   * weekday is only labelled "holiday" when listed here; otherwise it is a
   * missing candle / stale gap.
   */
  readonly holidays?: ReadonlySet<TradingDate>;
  /** Trading days of history scanned for interior gaps. Default 30. */
  readonly interiorLookbackTradingDays?: number;
}

const DEFAULT_INTERIOR_LOOKBACK = 30;

/** UTC offset (minutes) of SESSION_TIME_ZONE on a given calendar date. */
function sessionOffsetMinutes(date: TradingDate): number {
  const [y, m, d] = date.split("-").map((v) => Number.parseInt(v, 10)) as [
    number,
    number,
    number,
  ];
  // Noon UTC falls on the same NY calendar date and on the same side of any DST
  // change (changes occur at 02:00 local on Sundays).
  const instant = Date.UTC(y, m - 1, d, 12, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SESSION_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(instant));
  const get = (t: string): number =>
    Number.parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant) / 60_000);
}

/** ISO stamp of the NY close (17:00) of a trading date, with explicit offset. */
export function sessionCloseTimestamp(date: TradingDate): string {
  const offset = sessionOffsetMinutes(date);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const hour = String(SESSION_CLOSE_HOUR).padStart(2, "0");
  return `${date}T${hour}:00:00${sign}${hh}:${mm}`;
}

/** Weekdays strictly after `from` up to and including `to`. */
function weekdaysBetween(from: TradingDate, to: TradingDate): TradingDate[] {
  const out: TradingDate[] = [];
  let cursor = from;
  while (cursor < to) {
    cursor = addTradingDays(cursor, 1);
    if (cursor <= to) out.push(cursor);
  }
  return out;
}

function classifyMissing(
  missing: readonly TradingDate[],
  holidays: ReadonlySet<TradingDate>,
): StaleReason {
  return missing.every((d) => holidays.has(d)) ? "holiday" : "missing_candle";
}

/**
 * Derive Signal_Provenance for one pair. Deterministic given the store contents,
 * inputs, and the injected `computedAt` (R9.5).
 *
 * Stale classification (first match wins), with `target =
 * mostRecentCompletedTradingDay(decisionDate)` (R9.4):
 *   - no stored candle                         => missing_candle
 *   - last candle behind target, missing days:
 *       all listed holidays                    => holiday
 *       exactly one, spanning a weekend        => weekend_gap
 *       exactly one otherwise                  => missing_candle
 *       more than one                          => stale
 *   - last candle at/after target but an interior weekday is absent
 *       all listed holidays                    => holiday
 *       otherwise                              => missing_candle
 */
export async function deriveSignalProvenance(
  input: DeriveProvenanceInput,
): Promise<SignalProvenance> {
  const holidays = input.holidays ?? new Set<TradingDate>();
  const target = mostRecentCompletedTradingDay(input.decisionDate);
  const lookback = Math.max(
    1,
    input.interiorLookbackTradingDays ?? DEFAULT_INTERIOR_LOOKBACK,
  );
  const horizonDays = Math.max(1, Math.floor(input.horizonDays));

  const coverage = await input.candleStore.getCoverageSummary();
  const latest =
    coverage.find((c) => c.pair === input.pair)?.latestDate ?? null;

  // Anchor for the timestamps: the last candle, or the target when none exists
  // (kept so a total-gap pair still yields well-formed, explicit-tz provenance).
  const anchor: TradingDate = latest ?? target;
  const entryDate = addTradingDays(anchor, 1);
  const horizonEndDate = addTradingDays(entryDate, horizonDays - 1);

  let staleReason: StaleReason | null = null;
  if (latest === null) {
    staleReason = "missing_candle";
  } else if (latest < target) {
    const missing = weekdaysBetween(latest, target);
    if (missing.length > 0 && missing.every((d) => holidays.has(d))) {
      staleReason = "holiday";
    } else if (missing.length === 1) {
      // A single missing day right after a Friday candle spans the weekend.
      const [only] = missing;
      const crossesWeekend =
        only !== undefined && !isTradingDay(addCalendarDay(latest));
      staleReason = crossesWeekend
        ? "weekend_gap"
        : classifyMissing(missing, holidays);
    } else {
      staleReason = "stale";
    }
  } else {
    const windowStart = addTradingDays(latest, -(lookback - 1));
    const have = new Set(
      (await input.candleStore.getCandles(input.pair, windowStart, latest)).map(
        (c) => c.date,
      ),
    );
    const interiorMissing = weekdaysBetween(
      addTradingDays(windowStart, -1),
      latest,
    ).filter((d) => !have.has(d));
    // Weekdays before the pair's first stored candle are history we never had,
    // not gaps.
    const first = coverage.find((c) => c.pair === input.pair)?.earliestDate;
    const gaps = interiorMissing.filter((d) => first == null || d > first);
    if (gaps.length > 0) {
      staleReason = classifyMissing(gaps, holidays);
    }
  }

  return {
    pair: input.pair,
    lastCandleTimestamp: sessionCloseTimestamp(anchor),
    computedAt: input.computedAt.toISOString(),
    earliestEntryRef: sessionCloseTimestamp(entryDate),
    horizonStart: sessionCloseTimestamp(entryDate),
    horizonEnd: sessionCloseTimestamp(horizonEndDate),
    dataComplete: staleReason === null,
    staleReason,
  };
}

/** The calendar day after `date` (weekend-aware callers use isTradingDay). */
function addCalendarDay(date: TradingDate): TradingDate {
  const [y, m, d] = date.split("-").map((v) => Number.parseInt(v, 10)) as [
    number,
    number,
    number,
  ];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const yy = String(next.getUTCFullYear()).padStart(4, "0");
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
