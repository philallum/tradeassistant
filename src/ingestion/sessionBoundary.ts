// Session-Boundary Normalization (Requirements 7.7, 7.8).
//
// Normalizes every source feed to the 17:00 America/New_York (New York close)
// daily session boundary before storage.
// Produces standard Monday-Friday 5-day-per-week daily candles and merges
// Sunday partial/short candles into Monday.

import {
  formatTradingDate,
  parseTradingDate,
} from "../guard/tradingDate.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair, RawCandle } from "./types.js";

interface InternalCandle {
  asset: string;
  date: TradingDate;
  dayOfWeek: number; // 0=Sun, 1=Mon, ..., 6=Sat
  open: number;
  high: number;
  low: number;
  close: number;
  source: string;
}

/**
 * Extract an ISO TradingDate and DayOfWeek from a raw candle's date or timestamp.
 * In FX, the 17:00 America/New_York close corresponds to 22:00 UTC (EST) / 21:00 UTC (EDT).
 */
export function extractSessionDate(raw: RawCandle): {
  date: TradingDate;
  dayOfWeek: number;
} {
  if (raw.timestamp !== undefined) {
    const dt =
      raw.timestamp instanceof Date
        ? raw.timestamp
        : new Date(raw.timestamp);

    // Shift timestamp relative to 17:00 America/New_York.
    // Daily candle session closes at 17:00 New York.
    // Timestamps before 17:00 NY belong to the current NY trading day;
    // timestamps at or after 17:00 NY belong to the next NY trading day.
    // Using Intl.DateTimeFormat for America/New_York session calculation:
    const nyFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = nyFormatter.formatToParts(dt);
    const getPart = (type: string) =>
      Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    const hour = getPart("hour");

    let nyDate = new Date(Date.UTC(year, month - 1, day));
    // If hour >= 17:00 NY, the candle belongs to the next session date
    if (hour >= 17) {
      nyDate = new Date(nyDate.getTime() + 86_400_000);
    }

    const dateStr = formatTradingDate(nyDate);
    return { date: dateStr, dayOfWeek: nyDate.getUTCDay() };
  }

  if (raw.date !== undefined) {
    const dateStr = raw.date.trim().slice(0, 10);
    const dt = parseTradingDate(dateStr);
    return { date: dateStr, dayOfWeek: dt.getUTCDay() };
  }

  throw new Error("RawCandle must provide either 'date' or 'timestamp'");
}

/**
 * Normalizes an array of raw candles into standard Monday-Friday NY-close daily candles.
 * Sunday partial candles are merged into Monday daily candles (Requirement 7.7, 7.8).
 */
export function normalizeSessionBoundary(
  rawCandles: readonly RawCandle[],
  defaultAsset: Pair = "EURUSD",
): Candle[] {
  if (rawCandles.length === 0) {
    return [];
  }

  // Parse into internal representation
  const parsed: InternalCandle[] = [];
  for (const raw of rawCandles) {
    const asset = raw.asset ?? raw.pair ?? defaultAsset;
    const { date, dayOfWeek } = extractSessionDate(raw);
    parsed.push({
      asset,
      date,
      dayOfWeek,
      open: raw.open,
      high: raw.high,
      low: raw.low,
      close: raw.close,
      source: raw.source ?? "unknown",
    });
  }

  // Group by asset
  const byAsset = new Map<string, InternalCandle[]>();
  for (const candle of parsed) {
    const list = byAsset.get(candle.asset) ?? [];
    list.push(candle);
    byAsset.set(candle.asset, list);
  }

  const result: Candle[] = [];

  for (const [asset, candles] of byAsset.entries()) {
    // Sort chronologically
    candles.sort((a, b) => a.date.localeCompare(b.date));

    // Map to store combined Monday-Friday candles keyed by Monday-Friday date
    const merged = new Map<TradingDate, Candle>();
    const sundayCandles: InternalCandle[] = [];

    for (const c of candles) {
      if (c.dayOfWeek === 0) {
        // Sunday partial candle: hold to merge into Monday
        sundayCandles.push(c);
      } else if (c.dayOfWeek === 6) {
        // Saturday: skip or exclude non-session partial
        continue;
      } else {
        // Monday through Friday
        merged.set(c.date, {
          asset,
          date: c.date,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          source: c.source,
        });
      }
    }

    // Merge Sunday partials into their corresponding Monday
    for (const sun of sundayCandles) {
      // Find following Monday (Sunday + 1 calendar day)
      const sunDt = parseTradingDate(sun.date);
      const monDt = new Date(sunDt.getTime() + 86_400_000);
      const mondayDate = formatTradingDate(monDt);

      const existingMonday = merged.get(mondayDate);
      if (existingMonday) {
        // Merge: Sunday open becomes open, take max high, min low, Monday close
        merged.set(mondayDate, {
          asset,
          date: mondayDate,
          open: sun.open, // Sunday opened the week session
          high: Math.max(sun.high, existingMonday.high),
          low: Math.min(sun.low, existingMonday.low),
          close: existingMonday.close,
          source: existingMonday.source ?? sun.source,
        });
      } else {
        // If no separate Monday candle existed, the Sunday candle IS the opening for Monday
        merged.set(mondayDate, {
          asset,
          date: mondayDate,
          open: sun.open,
          high: sun.high,
          low: sun.low,
          close: sun.close,
          source: sun.source,
        });
      }
    }

    // Append sorted
    const assetCandles = [...merged.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    result.push(...assetCandles);
  }

  return result.sort((a, b) => {
    const dComp = a.date.localeCompare(b.date);
    return dComp !== 0 ? dComp : a.asset.localeCompare(b.asset);
  });
}
