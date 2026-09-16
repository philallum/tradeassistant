// Trading Date utilities (Requirement 4, 7.7, 7.8).
//
// Daily candles in FX are defined on the 17:00 America/New_York session close,
// producing standard Monday-Friday 5-day-per-week trading schedules.
// Date representation is ISO-8601 string 'YYYY-MM-DD'.

import type { TradingDate } from "./types.js";

/**
 * Validates whether a string matches standard ISO YYYY-MM-DD date format.
 */
export function isValidTradingDateFormat(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [y, m, d] = dateStr.split("-").map((v) => Number.parseInt(v, 10));
  if (y === undefined || m === undefined || d === undefined) {
    return false;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Parse a TradingDate into UTC Date components.
 */
export function parseTradingDate(dateStr: TradingDate): Date {
  const [y, m, d] = dateStr.split("-").map((v) => Number.parseInt(v, 10));
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`Invalid trading date string: "${dateStr}"`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Format a Date object to TradingDate ('YYYY-MM-DD').
 */
export function formatTradingDate(date: Date): TradingDate {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Returns true if the day is a weekday (Monday to Friday, UTC day 1..5).
 * Saturday (6) and Sunday (0) are non-trading days.
 */
export function isTradingDay(date: Date | TradingDate): boolean {
  const dt = typeof date === "string" ? parseTradingDate(date) : date;
  const dayOfWeek = dt.getUTCDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Advance a TradingDate by a given number of trading days (skipping weekends).
 * For days = 0, returns the same date if it is a trading day, or next trading day.
 */
export function addTradingDays(
  startDate: TradingDate,
  days: number,
): TradingDate {
  let dt = parseTradingDate(startDate);
  if (days === 0) {
    while (!isTradingDay(dt)) {
      dt = new Date(dt.getTime() + 86_400_000);
    }
    return formatTradingDate(dt);
  }

  const step = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);

  while (remaining > 0) {
    dt = new Date(dt.getTime() + step * 86_400_000);
    if (isTradingDay(dt)) {
      remaining -= 1;
    }
  }

  return formatTradingDate(dt);
}

/**
 * Compare two TradingDates lexicographically (since YYYY-MM-DD sorts chronologically).
 * Returns negative if a < b, 0 if a == b, positive if a > b.
 */
export function compareTradingDates(a: TradingDate, b: TradingDate): number {
  return a.localeCompare(b);
}
