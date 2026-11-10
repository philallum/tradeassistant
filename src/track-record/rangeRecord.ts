// Expected-candle-size track record by replay.
//
// For each recent past date R the expected candle size is re-derived exactly as it
// would have been on R (the injected `forecast` runs the same as-of-R pipeline),
// then compared with what the candles after R actually did, bucketed against the
// SAME as-of-R pair-relative cut-offs. Only forecasts whose horizon window has
// fully closed before today's Decision_Date are scored.
//
// Fail-safe per pair: a forecast that throws or returns null is skipped, so a
// partial failure only shrinks the sample, never the run.

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import { realizedBucket } from "../range-forecast/realized.js";
import type { ExpectedRange } from "../range-forecast/types.js";
import type { SnapshotRangeRecordRow } from "../scheduled-run/snapshot.js";
import { replayDates, type PairCandles } from "./strategyRecord.js";

/** Default replay window for the range forecast, in trading days. */
export const DEFAULT_RANGE_RECORD_LOOKBACK_DAYS = 20 as const;

/** Re-derive the forecast as of `date` for `pair`, or null when none could be made. */
export type RangeForecastAt = (pair: Pair, date: TradingDate) => Promise<ExpectedRange | null>;

export interface RangeRecordArgs {
  readonly decisionDate: TradingDate;
  readonly lookbackDays: number;
  readonly inputs: readonly PairCandles[];
  readonly forecast: RangeForecastAt;
}

export async function replayRangeRecords(args: RangeRecordArgs): Promise<SnapshotRangeRecordRow[]> {
  const rows: SnapshotRangeRecordRow[] = [];
  for (const { pair, candles } of args.inputs) {
    let forecasts = 0;
    let correct = 0;
    for (const date of replayDates(candles, args.decisionDate, args.lookbackDays)) {
      let predicted: ExpectedRange | null;
      try {
        predicted = await args.forecast(pair, date);
      } catch {
        predicted = null;
      }
      if (predicted === null) continue;
      const realized = realizedBucket(
        predicted,
        candles,
        date,
        pair,
        args.decisionDate,
      );
      if (realized === null) continue; // horizon window not closed yet
      forecasts += 1;
      if (realized === predicted.bucket) correct += 1;
    }
    rows.push({ pair, forecasts, correct });
  }
  return rows;
}
