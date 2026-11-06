// Intraday validation compute step — Task 6 (intraday-validation feature).
//
// Wires the isolated 4H client (Task 1), the forming-bar selector (Task 2), the
// feature math (Task 3), and the classifier (Task 4) into a single per-pair
// fail-safe pass, persisting the results through the IntradayValidationStore
// PORT (Task 5). It is a READ-ONLY consumer of the already-persisted daily
// prediction: the caller supplies the original direction/confidence per pair
// (read back from `firing_setups` / `pairEvaluations`); this step reads them,
// fetches the forming 4H bar, classifies it, and writes ONLY to its own store.
// It never recomputes direction/confidence and never writes a daily-path table.
//
// PER-PAIR FAIL-SAFE: every pair is processed independently inside a guard, so a
// provider failure, a stale bar, a non-computable candle, or any unexpected
// error for one pair degrades THAT pair to "validation unavailable" (no record
// persisted for it) and never affects the others or the daily forecast.

import type { Pair } from "../ingestion/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import type { Result, TradingDate } from "../guard/types.js";
import type {
  IntradayFeedError,
  TwelveDataIntradayClient,
} from "../ingestion/intradayFeed/twelveDataIntraday.js";
import type { Intraday4hBar, IntradayValidationRecord } from "./types.js";
import { classifyValidation } from "./classify.js";
import { computeCandleFeatures, isCandleComputable } from "./features.js";
import { selectFormingBar } from "./formingBar.js";
import type { IntradayValidationStore } from "./store.js";

/**
 * The original daily prediction for one pair, read back from the persisted
 * source-of-truth rows. `confidence` is in PERCENTAGE POINTS `[0, 100]` (the
 * caller converts the stored `[0, 1]` Earned_Confidence by ×100).
 */
export interface OriginalPrediction {
  readonly pair: Pair;
  readonly direction: DirectionClass;
  readonly confidence: number;
}

/** The minimal 4H fetch capability the step needs (the client's `fetch4h`). */
export interface Intraday4hSource {
  fetch4h(
    pair: Pair,
    outputsize?: number,
  ): Promise<Result<readonly Intraday4hBar[], IntradayFeedError>>;
}

/** Everything {@link runIntradayValidation} needs; all injectable for tests. */
export interface RunIntradayValidationDeps {
  /** The Decision_Date whose daily prediction is being validated. */
  readonly decisionDate: TradingDate;
  /** The original daily prediction per pair (read back by the caller). */
  readonly originals: readonly OriginalPrediction[];
  /** The isolated 4H source (the Twelve Data client in prod; a stub in tests). */
  readonly source: Intraday4hSource;
  /** The store the validation records are written through. */
  readonly store: IntradayValidationStore;
  /** The current instant (UTC). Injected for determinism. */
  readonly now: Date;
  /** Secret-free warning sink (defaults to a structured `console.warn`). */
  readonly warn?: (pair: Pair, message: string) => void;
}

/** The outcome of a run: the records written, plus the per-pair unavailable list. */
export interface RunIntradayValidationResult {
  /** The validation records persisted this run (one per validated pair). */
  readonly records: readonly IntradayValidationRecord[];
  /** Pairs that degraded to "validation unavailable" (with a secret-free reason). */
  readonly unavailable: readonly { readonly pair: Pair; readonly reason: string }[];
}

function defaultWarn(pair: Pair, message: string): void {
  console.warn(
    JSON.stringify({ event: "intraday_validation.pair_unavailable", pair, message }),
  );
}

/**
 * Run the intraday validation for the Decision_Date's pairs. Never throws;
 * returns the persisted records and the per-pair unavailable list. Only pairs
 * that produced a usable, computable forming bar are persisted.
 */
export async function runIntradayValidation(
  deps: RunIntradayValidationDeps,
): Promise<RunIntradayValidationResult> {
  const warn = deps.warn ?? defaultWarn;
  const observedAt = deps.now.toISOString();
  const records: IntradayValidationRecord[] = [];
  const unavailable: { pair: Pair; reason: string }[] = [];

  for (const original of deps.originals) {
    const pair = original.pair;
    try {
      const fetched = await deps.source.fetch4h(pair);
      if (!fetched.ok) {
        unavailable.push({ pair, reason: fetched.error.message });
        warn(pair, fetched.error.message);
        continue;
      }

      const bar = selectFormingBar(fetched.value, deps.now);
      if (bar === null) {
        const reason = "no currently-forming 4H bar available (empty or stale provider data)";
        unavailable.push({ pair, reason });
        warn(pair, reason);
        continue;
      }

      const candle = {
        open: bar.open,
        high: bar.high,
        low: bar.low,
        currentPrice: bar.currentPrice,
      };
      if (!isCandleComputable(candle)) {
        const reason = "forming 4H candle OHLC is non-finite or violates the OHLC invariant";
        unavailable.push({ pair, reason });
        warn(pair, reason);
        continue;
      }

      const features = computeCandleFeatures(candle);
      const result = classifyValidation(features, original.direction, original.confidence);
      records.push({
        decisionDate: deps.decisionDate,
        pair,
        originalDirection: original.direction,
        originalConfidence: original.confidence,
        validationTimestamp: observedAt,
        barOpenUtc: bar.openTimeUtc,
        candle,
        features,
        result,
      });
    } catch (error) {
      // A pair's unexpected error must not affect the others or the daily run.
      const reason = error instanceof Error ? error.message : String(error);
      unavailable.push({ pair, reason });
      warn(pair, reason);
    }
  }

  // Persist in one idempotent upsert (write failure surfaces to the caller's
  // fail-safe wrapper; it is never allowed to fail the daily forecast).
  if (records.length > 0) {
    await deps.store.upsert(records);
  }

  return { records, unavailable };
}

/** Convenience alias to the concrete client type (prod wiring). */
export type { TwelveDataIntradayClient };
