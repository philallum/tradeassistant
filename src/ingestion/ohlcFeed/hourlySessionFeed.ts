// Shared "daily candle from hourly bars" logic for the OHLC providers.
//
// A provider adapter only knows how to fetch HOURLY bars for a UTC window. This module turns
// them into the system's own daily candles (17:00 America/New_York close) via the pure
// session aggregator, keeping only CLOSED and COMPLETE sessions. See
// src/ingestion/sessionAggregation.ts and docs/state/RISKS.md ("DAILY CANDLE DATA INTEGRITY").

import { err, ok, type Result, type TradingDate } from "../../guard/types.js";
import type { Pair, RawCandle } from "../types.js";
import {
  aggregateSessions,
  describeNoSession,
  latestCompleteSession,
  type HourlyBar,
  type SessionResult,
} from "../sessionAggregation.js";
import type { OhlcFeedError } from "./types.js";

/** Fetch hourly bars for `pair` covering the UTC calendar dates `[fromDate, toDate]` inclusive. */
export type HourlyFetcher = (
  pair: Pair,
  fromDate: TradingDate,
  toDate: TradingDate,
) => Promise<Result<readonly HourlyBar[], OhlcFeedError>>;

/** How far back a "latest" request looks for the newest complete session (covers a long weekend). */
const LATEST_LOOKBACK_DAYS = 6;

/** Largest hourly span requested at once (~3,600 bars, under every provider's page limit). */
const CHUNK_DAYS = 150;

function addDays(date: TradingDate, days: number): TradingDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toRaw(pair: Pair, source: string, s: Extract<SessionResult, { ok: true }>): RawCandle {
  return {
    asset: pair,
    pair,
    date: s.date,
    open: s.open,
    high: s.high,
    low: s.low,
    close: s.close,
    source,
  };
}

function noSession(provider: string, pair: Pair, message: string): OhlcFeedError {
  return { reason: "ohlc_feed_error", mode: "empty", provider, pair, message };
}

/**
 * The single most recent closed, complete session dated before `asOf` (the Decision_Date).
 * Exactly one candle is returned so a top-up can never overwrite more than the target day.
 */
export async function latestSessionCandle(
  provider: string,
  pair: Pair,
  asOf: TradingDate,
  nowMs: number,
  fetchHourly: HourlyFetcher,
): Promise<Result<readonly RawCandle[], OhlcFeedError>> {
  const bars = await fetchHourly(pair, addDays(asOf, -LATEST_LOOKBACK_DAYS), asOf);
  if (!bars.ok) return err(bars.error);
  const results = aggregateSessions(bars.value, { nowMs, asOf });
  const latest = latestCompleteSession(results);
  if (latest === undefined) {
    return err(noSession(provider, pair, `${provider}: ${describeNoSession(results)}`));
  }
  return ok([toRaw(pair, provider, latest)]);
}

/** Every closed, complete session dated in `[fromDate, toDate]`, oldest first. */
export async function rangeSessionCandles(
  provider: string,
  pair: Pair,
  fromDate: TradingDate,
  toDate: TradingDate,
  nowMs: number,
  fetchHourly: HourlyFetcher,
): Promise<Result<readonly RawCandle[], OhlcFeedError>> {
  const all: HourlyBar[] = [];
  // Session `fromDate` starts two calendar days earlier at most (weekend + 17:00 NY open).
  let cursor = addDays(fromDate, -2);
  const last = toDate;
  while (cursor <= last) {
    const chunkEnd = addDays(cursor, CHUNK_DAYS - 1) < last ? addDays(cursor, CHUNK_DAYS - 1) : last;
    const bars = await fetchHourly(pair, cursor, chunkEnd);
    if (!bars.ok) return err(bars.error);
    all.push(...bars.value);
    cursor = addDays(chunkEnd, 1);
  }
  const results = aggregateSessions(all, { nowMs });
  const candles = results
    .filter((r): r is Extract<SessionResult, { ok: true }> => r.ok && r.date >= fromDate && r.date <= toDate)
    .map((s) => toRaw(pair, provider, s));
  if (candles.length === 0) {
    return err(noSession(provider, pair, `${provider}: no complete session in ${fromDate}..${toDate}`));
  }
  return ok(candles);
}
