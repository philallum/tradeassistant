// v8 intradayValidation snapshot slice builder — Task 7 (intraday-validation
// feature).
//
// A separate, read-only, fail-safe slice builder in the pattern of
// `signalScorecardSlice.ts` / `confluenceSlice.ts`. It reads the persisted
// intraday-validation records for the Decision_Date through the
// `IntradayValidationStore` PORT and maps them to the v8 wire slice. It NEVER
// throws: on any failure it returns `EMPTY_INTRADAY_VALIDATION`, so the snapshot
// still publishes and the daily forecast is untouched.

import type { TradingDate } from "../guard/types.js";
import type { IntradayValidationStore } from "../intraday-validation/store.js";
import {
  EMPTY_INTRADAY_VALIDATION,
  type SnapshotIntradayValidationRow,
  type SnapshotIntradayValidationSlice,
} from "./snapshot.js";

const SLICE_NAME = "intraday_validation" as const;

export interface IntradayValidationSliceDeps {
  /** The Decision_Date whose validation records are surfaced. */
  readonly decisionDate: TradingDate;
  /** The validation store (Supabase adapter in prod, in-memory in tests). */
  readonly store: IntradayValidationStore;
  /** Secret-free warning sink. */
  readonly warn?: (slice: string, err: unknown) => void;
}

function defaultWarn(slice: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    JSON.stringify({ event: "scheduled_run.intraday_validation_slice_failed", slice, message }),
  );
}

/**
 * Build the v8 `intradayValidation` slice from the persisted records for the
 * Decision_Date. Never throws; returns `EMPTY_INTRADAY_VALIDATION` on any
 * failure. `observedAt` is the most recent `validationTimestamp` across the
 * day's records (or `null` when there are none).
 */
export async function buildIntradayValidationSlice(
  deps: IntradayValidationSliceDeps,
): Promise<SnapshotIntradayValidationSlice> {
  const warn = deps.warn ?? defaultWarn;
  try {
    const records = await deps.store.getByDecisionDate(deps.decisionDate);
    if (records.length === 0) {
      return EMPTY_INTRADAY_VALIDATION;
    }
    const rows: SnapshotIntradayValidationRow[] = records.map((r) => ({
      pair: r.pair,
      decisionDate: r.decisionDate,
      originalDirection: r.originalDirection,
      originalConfidence: r.originalConfidence,
      validationState: r.result.state,
      confidenceDelta: r.result.confidenceDelta,
      currentConfidence: r.result.currentConfidence,
      reason: r.result.reason,
      barOpenUtc: r.barOpenUtc,
      h4: {
        open: r.candle.open,
        high: r.candle.high,
        low: r.candle.low,
        currentPrice: r.candle.currentPrice,
      },
    }));
    const observedAt = records
      .map((r) => r.validationTimestamp)
      .reduce<string | null>((latest, ts) => (latest === null || ts > latest ? ts : latest), null);
    return { observedAt, validationLabel: "unvalidated", rows };
  } catch (err) {
    warn(SLICE_NAME, err);
    return EMPTY_INTRADAY_VALIDATION;
  }
}
