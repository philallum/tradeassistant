// Fail-safe v7 `signalScorecard` slice builder (signal-scorecard feature).
//
// Reads the RECORDED `signal_predictions` rows (all six signals, incl. the
// non-replayable third_party) through the scorecard store, aggregates them into
// per (pair, strategyId) tallies with `aggregateSignalScorecard`, and maps the
// result to the v7 wire slice. Display-only and read-only: it reads
// already-persisted rows and writes nothing. It NEVER throws — any failure
// (including a not-yet-present table, which the store already degrades to `[]`)
// logs the slice name + message secret-free and returns `EMPTY_SIGNAL_SCORECARD`,
// so the daily run always publishes a well-formed `dashboard.json`.

import type { SignalPredictionStore } from "../dashboard/signalScorecard.js";
import { aggregateSignalScorecard } from "../dashboard/signalScorecard.js";
import {
  EMPTY_SIGNAL_SCORECARD,
  type SnapshotSignalScorecardRow,
  type SnapshotSignalScorecardSlice,
} from "./snapshot.js";
import { warnEvent } from "./warn.js";

const SLICE_NAME = "signal_scorecard" as const;

export interface SignalScorecardSliceDeps {
  /** The scorecard store (Supabase adapter in prod, in-memory in tests). */
  readonly store: SignalPredictionStore;
  /** Secret-free warning sink. */
  readonly warn?: (slice: string, err: unknown) => void;
}

function defaultWarn(slice: string, err: unknown): void {
  warnEvent("scheduled_run.signal_scorecard_slice_failed", { slice }, err);
}

/**
 * Build the v7 `signalScorecard` slice from the recorded prediction rows. Never
 * throws; returns `EMPTY_SIGNAL_SCORECARD` on any failure.
 */
export async function buildSignalScorecardSlice(
  deps: SignalScorecardSliceDeps,
): Promise<SnapshotSignalScorecardSlice> {
  const warn = deps.warn ?? defaultWarn;
  try {
    const rows = await deps.store.getAll();
    const aggregate = aggregateSignalScorecard(rows);
    const sliceRows: SnapshotSignalScorecardRow[] = aggregate.tallies.map((t) => ({
      pair: t.pair,
      strategyId: t.strategyId,
      calls: t.calls,
      correct: t.correct,
      flat: t.flat,
      pending: t.pending,
    }));
    return { totalRecorded: aggregate.totalRecorded, rows: sliceRows };
  } catch (err) {
    warn(SLICE_NAME, err);
    return EMPTY_SIGNAL_SCORECARD;
  }
}
