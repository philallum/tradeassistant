// Daily-candle range sanity guard (pre-store).
//
// Motivation: a provider once served a forming / mis-dated bar as a completed session
// (a 2.4-pip EURUSD "day" on 2026-11-04). Structural completeness is checked upstream in
// `sessionAggregation.ts`; this is the independent backstop on the VALUE of the range: a day
// whose high-low range is implausibly small or large compared with the pair's own recent
// history is rejected before it can be stored.
//
// Pure and deterministic. Uses ONLY candles dated strictly before the candidate (no look-ahead).
// The constants are MEASUREMENT inputs, not signal knobs: they never feed scoring or firing.

import type { Candle } from "../guard/types.js";

/** Reject a range smaller than this fraction of the trailing median range. */
export const MIN_RANGE_FRACTION = 0.1;

/** Reject a range larger than this multiple of the trailing median range. */
export const MAX_RANGE_MULTIPLE = 8;

/** Fewest prior candles needed before the guard judges anything (seeding/backfill is skipped). */
export const MIN_HISTORY_FOR_RANGE_GUARD = 20;

/** Number of most recent prior candles used for the trailing median. */
export const RANGE_GUARD_LOOKBACK = 60;

export type RangeVerdict =
  | { readonly ok: true; readonly checked: boolean }
  | {
      readonly ok: false;
      readonly kind: "range_too_small" | "range_too_large";
      readonly range: number;
      readonly medianRange: number;
      readonly message: string;
    };

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Judge one candle's range against the trailing median range of `history`.
 * `history` may be in any order and may include dates on/after the candidate; those are ignored.
 * Returns `{ ok: true, checked: false }` when there is not enough prior history to judge.
 */
export function validateRange(
  candle: Pick<Candle, "date" | "high" | "low">,
  history: readonly Pick<Candle, "date" | "high" | "low">[],
): RangeVerdict {
  const prior = history
    .filter((c) => c.date < candle.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-RANGE_GUARD_LOOKBACK);

  if (prior.length < MIN_HISTORY_FOR_RANGE_GUARD) return { ok: true, checked: false };

  const medianRange = median(prior.map((c) => c.high - c.low));
  if (!(medianRange > 0)) return { ok: true, checked: false };

  const range = candle.high - candle.low;
  if (range < medianRange * MIN_RANGE_FRACTION) {
    return {
      ok: false,
      kind: "range_too_small",
      range,
      medianRange,
      message: `Implausible range: ${range} is below ${MIN_RANGE_FRACTION * 100}% of the trailing median range ${medianRange} (possible forming or mis-dated bar)`,
    };
  }
  if (range > medianRange * MAX_RANGE_MULTIPLE) {
    return {
      ok: false,
      kind: "range_too_large",
      range,
      medianRange,
      message: `Implausible range: ${range} is above ${MAX_RANGE_MULTIPLE}x the trailing median range ${medianRange}`,
    };
  }
  return { ok: true, checked: true };
}
