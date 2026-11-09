// Pure comparison of STORED daily candles against CANONICAL ones (hourly-derived, 17:00 NY close).
//
// Used by the candle repair tool to decide, per date, whether a stored candle is already the
// canonical one, must be replaced, or has no canonical counterpart (left alone, never deleted).
// No I/O, no clock: deterministic and unit-testable.

import type { Candle, TradingDate } from "../../guard/types.js";
import type { Pair, RawCandle } from "../../ingestion/types.js";

/** Differences at or below this (in price units) count as "the same candle". */
export const SAME_CANDLE_EPSILON = 1e-8;

/** A day is "material" when a field differs by this many pips or the range is under half. */
export const MATERIAL_PIPS = 10;
export const MATERIAL_RANGE_RATIO = 0.5;

export type RepairAction = "same" | "replace" | "insert";

export interface RepairEntry {
  readonly date: TradingDate;
  readonly action: RepairAction;
  /** Largest absolute difference across O/H/L/C, in pips (0 for an insert). */
  readonly maxDiffPips: number;
  /** Stored range / canonical range (null for an insert). */
  readonly rangeRatio: number | null;
  /** True when the stored candle was materially wrong (>= 10 pips off, or range < 50%). */
  readonly material: boolean;
  readonly canonical: RawCandle;
}

export interface RepairPlan {
  readonly pair: Pair;
  readonly entries: readonly RepairEntry[];
  /** Stored dates in range that have no canonical candle (left untouched, listed for review). */
  readonly unverifiedStoredDates: readonly TradingDate[];
}

export function pipSize(pair: Pair): number {
  return pair.endsWith("JPY") ? 0.01 : 0.0001;
}

export function planRepair(
  pair: Pair,
  stored: readonly Candle[],
  canonical: readonly RawCandle[],
): RepairPlan {
  const storedByDate = new Map<TradingDate, Candle>(stored.map((c) => [c.date, c]));
  const canonicalDates = new Set<TradingDate>();
  const entries: RepairEntry[] = [];

  for (const c of [...canonical].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const date = c.date as TradingDate;
    canonicalDates.add(date);
    const s = storedByDate.get(date);
    if (s === undefined) {
      entries.push({ date, action: "insert", maxDiffPips: 0, rangeRatio: null, material: true, canonical: c });
      continue;
    }
    const maxDiff = Math.max(
      Math.abs(s.open - c.open),
      Math.abs(s.high - c.high),
      Math.abs(s.low - c.low),
      Math.abs(s.close - c.close),
    );
    const canonicalRange = c.high - c.low;
    const rangeRatio = canonicalRange > 0 ? (s.high - s.low) / canonicalRange : null;
    const maxDiffPips = maxDiff / pipSize(pair);
    entries.push({
      date,
      action: maxDiff <= SAME_CANDLE_EPSILON ? "same" : "replace",
      maxDiffPips,
      rangeRatio,
      material: maxDiffPips >= MATERIAL_PIPS || (rangeRatio !== null && rangeRatio < MATERIAL_RANGE_RATIO),
      canonical: c,
    });
  }

  const unverifiedStoredDates = stored
    .map((c) => c.date)
    .filter((d) => !canonicalDates.has(d))
    .sort();
  return { pair, entries, unverifiedStoredDates };
}

/** The entries that need a write. */
export function changes(plan: RepairPlan): readonly RepairEntry[] {
  return plan.entries.filter((e) => e.action !== "same");
}
