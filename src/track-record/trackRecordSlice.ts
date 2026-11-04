// Fail-safe v6 `trackRecord` slice builder.
//
// Combines the three look-ahead-safe replays into the snapshot slice:
//   - the four classical strategies, replayed from candles (strategyRecord.ts);
//   - the pattern engine, read from its own matured realized-outcome journal;
//   - the expected-candle-size forecast, replayed through the injected as-of
//     forecaster (rangeRecord.ts).
//
// Display-only and read-only: it writes nothing and returns nothing firing reads.
// It NEVER throws. A per-pair candle-load failure drops only that pair; a failing
// range replay (or one that exceeds its deadline) degrades to an empty range
// record while the strategy records still publish; any other failure returns
// `EMPTY_TRACK_RECORD`. A secret-free warning names only the slice and message.

import type { TradingDate } from "../guard/types.js";
import { PAIRS, type CandleStore, type Pair } from "../ingestion/types.js";
import { buildStrategyBundle } from "../scheduled-run/confluenceSlice.js";
import {
  EMPTY_TRACK_RECORD,
  type SnapshotRangeRecordRow,
  type SnapshotTrackRecordSlice,
} from "../scheduled-run/snapshot.js";
import { HISTORY_WINDOW_DAYS, windowStartDate } from "../scheduled-run/snapshotHistory.js";
import type { StrategyBundle } from "../strategies/confluenceMatrix.js";
import {
  DEFAULT_RANGE_RECORD_LOOKBACK_DAYS,
  replayRangeRecords,
  type RangeForecastAt,
} from "./rangeRecord.js";
import {
  DEFAULT_TRACK_RECORD_LOOKBACK_DAYS,
  patternRecords,
  replayClassicalRecords,
  type PairCandles,
  type PatternOutcomeInput,
} from "./strategyRecord.js";

const SLICE_NAME = "track_record" as const;

/** Upper bound for the range-forecast replay so it can never stall the daily run. */
export const DEFAULT_RANGE_REPLAY_DEADLINE_MS = 120_000 as const;

export interface TrackRecordSliceDeps {
  readonly decisionDate: TradingDate;
  readonly candleStore: CandleStore;
  /** Matured realized-outcome rows (the pattern engine's journal), from snapshot history. */
  readonly realizedOutcomes: readonly PatternOutcomeInput[];
  /** As-of forecaster for the range replay; omitted or lookback 0 disables that part. */
  readonly forecast?: RangeForecastAt;
  /** Strategy bundle; defaults to the real four-strategy bundle. */
  readonly strategies?: StrategyBundle;
  readonly lookbackDays?: number;
  readonly rangeLookbackDays?: number;
  readonly rangeDeadlineMs?: number;
  readonly warn?: (slice: string, err: unknown) => void;
}

function defaultWarn(slice: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(JSON.stringify({ event: "scheduled_run.track_record_failed", slice, message }));
}

function dayBefore(date: TradingDate): TradingDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Run `work` but give up after `ms`, resolving to `fallback`. Always clears its timer. */
async function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function buildTrackRecordSlice(
  deps: TrackRecordSliceDeps,
): Promise<SnapshotTrackRecordSlice> {
  const warn = deps.warn ?? defaultWarn;
  try {
    const strategies = deps.strategies ?? buildStrategyBundle();
    if (strategies === null) {
      warn(SLICE_NAME, new Error("strategy bundle construction failed"));
      return EMPTY_TRACK_RECORD;
    }
    const lookbackDays = deps.lookbackDays ?? DEFAULT_TRACK_RECORD_LOOKBACK_DAYS;
    const rangeLookbackDays = deps.rangeLookbackDays ?? DEFAULT_RANGE_RECORD_LOOKBACK_DAYS;

    // Candles strictly before the Decision_Date, per pair, failures isolated.
    const start = windowStartDate(deps.decisionDate, HISTORY_WINDOW_DAYS);
    const end = dayBefore(deps.decisionDate);
    const loaded = await Promise.all(
      PAIRS.map(async (pair: Pair): Promise<PairCandles | null> => {
        try {
          return { pair, candles: await deps.candleStore.getCandles(pair, start, end) };
        } catch (err) {
          warn(`${SLICE_NAME}:${pair}`, err);
          return null;
        }
      }),
    );
    const inputs = loaded.filter((x): x is PairCandles => x !== null);

    const classical = replayClassicalRecords({
      decisionDate: deps.decisionDate,
      lookbackDays,
      inputs,
      strategies,
    });
    const pattern = patternRecords(deps.realizedOutcomes, inputs, deps.decisionDate, lookbackDays);

    let rangeForecast: readonly SnapshotRangeRecordRow[] = [];
    if (deps.forecast !== undefined && rangeLookbackDays > 0) {
      try {
        rangeForecast = await withDeadline(
          replayRangeRecords({
            decisionDate: deps.decisionDate,
            lookbackDays: rangeLookbackDays,
            inputs,
            forecast: deps.forecast,
          }),
          deps.rangeDeadlineMs ?? DEFAULT_RANGE_REPLAY_DEADLINE_MS,
          [],
        );
      } catch (err) {
        warn(`${SLICE_NAME}:range`, err);
        rangeForecast = [];
      }
    }

    return { lookbackDays, strategies: [...classical, ...pattern], rangeForecast };
  } catch (err) {
    warn(SLICE_NAME, err);
    return EMPTY_TRACK_RECORD;
  }
}
