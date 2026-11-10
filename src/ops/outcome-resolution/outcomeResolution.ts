// Historical Outcome Resolution (Feature: operational-wiring).
//
// Drives the EXISTING forward-outcome `resolve(...)` over all stored history so
// the `analogue_outcomes` table is populated. `resolve` is the ONLY writer of
// that table and upserts per-horizon rows idempotently on
// (asset, decision_date, horizon); it also sets each row's `matured` flag via
// the Look-Ahead Guard's `isMatured(analogueDate, horizon, evalDate)`. Nothing
// else currently drives it across history, so a fresh hosted backend has an
// empty `analogue_outcomes` → every pair is non-firing → no Decision_Date is
// persisted. The design intends outcomes to be "populated by the existing
// resolver ... during ingestion/backfill"; this module is that driver.
//
// It re-implements NO module logic. It reads candles and pattern vectors only
// through the existing storage PORTs (`CandleStore`, `PatternVectorStore`),
// computes ATR_14 through the existing `computeAtr14`, and persists through the
// existing `resolve(...)` → `AnalogueStore`. It is pure of I/O beyond the
// injected stores, deterministic, and — because `resolve` upserts — idempotent.
// No `Secret_Key` value is ever read or logged.

import { computeAtr14 } from "../../confidence/atr.js";
import type { Candle, TradingDate } from "../../guard/types.js";
import { PAIRS } from "../../ingestion/types.js";
import type { Pair } from "../../ingestion/types.js";
import type { PipelineStores } from "../../pipeline/types.js";
import { DEFAULT_PIPELINE_WINDOW_SIZE } from "../../pipeline/types.js";
import { resolve, type FlatBandMode, type LabelAlignment } from "../../retrieval/resolver.js";
import type {
  OutcomeResolutionResult,
  PerPairOutcomeResolution,
} from "./types.js";

/** The number of per-horizon rows `resolve` writes for each analogue date. */
const HORIZONS_PER_DATE = 3 as const;

/** Injected collaborators for {@link resolveHistoricalOutcomes}. */
export interface OutcomeResolutionDeps {
  /**
   * The three storage PORTs. Candles and pattern vectors are READ from here;
   * resolved outcomes are WRITTEN through `analogueStore` by the existing
   * `resolve(...)`. Inject in-memory stores to run without a backend.
   */
  readonly stores: PipelineStores;
  /**
   * The current evaluation date. Passed verbatim to `resolve(...)`, which
   * stamps each written row's `matured` flag as
   * `isMatured(analogueDate, horizon, evalDate)`.
   */
  readonly evalDate: TradingDate;
  /**
   * The trailing-window length (in trading days) over which ATR_14 is computed,
   * matching the pipeline. Defaults to {@link DEFAULT_PIPELINE_WINDOW_SIZE}.
   */
  readonly windowSize?: number;
  /**
   * When true (the default — the production-correct filter), an outcome is
   * resolved only for a candle date that ALSO has a stored pattern vector, so
   * retrieval can later match it. Set false in tests that seed candles but no
   * vectors; the forward-candle gate still applies.
   */
  readonly requireVector?: boolean;
  /**
   * When set, analogue dates BEFORE this date are skipped (their stored outcomes are left as
   * they are). Used by the candle repair tool to recompute only the affected tail. Omitted =
   * every date, exactly as before.
   */
  readonly fromDate?: TradingDate;
  /**
   * FLAT dead-band definition passed to `resolve`. Omitted = `"legacy"` (the live, stored
   * behaviour). `"atr_pips"` is for OFFLINE measurement against local stores only.
   */
  readonly flatBandMode?: FlatBandMode;
  /**
   * Which session the outcome measures. Omitted = `"after_decision_date"` (live, stored).
   * `"on_decision_date"` is for OFFLINE measurement against local stores only.
   */
  readonly labelAlignment?: LabelAlignment;
}

/**
 * Resolve historical forward outcomes for every pair in {@link PAIRS}.
 *
 * For each pair:
 *   1. Load all stored candles (chronologically ascending).
 *   2. Select the analogue dates to resolve — every candle date that
 *      (a) has at least one FORWARD candle (i.e. is NOT the last candle, so
 *      `resolve` has data to work with) AND, when `requireVector` is true,
 *      (b) has a stored pattern vector for that date.
 *   3. For each selected date, compute ATR_14 over the trailing window of up to
 *      `windowSize` candles with date <= the analogue date (inclusive), gather
 *      the forward candles (date > the analogue date), and call the EXISTING
 *      `resolve(analogueDate, pair, forwardCandles, atr14, evalDate, store)`.
 *   4. Count the dates resolved and the rows written (3 horizon rows per date).
 *
 * Deterministic and idempotent: running it twice over the same stores yields
 * the same `analogue_outcomes` state (`resolve` upserts). No `Secret_Key` value
 * is ever read or logged.
 */
export async function resolveHistoricalOutcomes(
  deps: OutcomeResolutionDeps,
): Promise<OutcomeResolutionResult> {
  const { stores, evalDate } = deps;
  const windowSize = deps.windowSize ?? DEFAULT_PIPELINE_WINDOW_SIZE;
  const requireVector = deps.requireVector ?? true;

  const perPair: PerPairOutcomeResolution[] = [];
  let totalOutcomesWritten = 0;

  for (const pair of PAIRS) {
    const summary = await resolvePair(stores, pair, evalDate, windowSize, requireVector, deps.fromDate, deps.flatBandMode, deps.labelAlignment);
    perPair.push(summary);
    totalOutcomesWritten += summary.outcomesWritten;
  }

  return { perPair, totalOutcomesWritten };
}

/** Resolve outcomes for a single pair. Pure of I/O beyond the injected stores. */
async function resolvePair(
  stores: PipelineStores,
  pair: Pair,
  evalDate: TradingDate,
  windowSize: number,
  requireVector: boolean,
  fromDate: TradingDate | undefined,
  flatBandMode: FlatBandMode | undefined,
  labelAlignment: LabelAlignment | undefined,
): Promise<PerPairOutcomeResolution> {
  // Candles ascending (the CandleStore PORT already sorts; the resolver and ATR
  // both require ascending order).
  const candles = await stores.candleStore.getCandles(pair);
  if (candles.length === 0) {
    return { pair, datesResolved: 0, outcomesWritten: 0 };
  }

  // The set of dates that have a stored pattern vector — the production-correct
  // retrieval gate (only read when it is actually applied).
  const vectorDates = requireVector
    ? new Set(
        (await stores.vectorStore.getVectorsByAsset(pair)).map(
          (v) => v.decisionDate,
        ),
      )
    : null;

  let datesResolved = 0;

  // The last candle has no forward candle, so it never produces a row; stop at
  // length - 1. Each index i yields the forward slice candles[i+1 ..].
  for (let i = 0; i < candles.length - 1; i++) {
    const analogueDate: TradingDate = candles[i]!.date;

    if (fromDate !== undefined && analogueDate < fromDate) {
      continue;
    }

    // Vector gate (production): skip dates without a stored pattern vector.
    if (vectorDates !== null && !vectorDates.has(analogueDate)) {
      continue;
    }

    // ATR_14 over the trailing window of up to `windowSize` candles ending at
    // (and including) the analogue date — i.e. candles with date <= analogueDate.
    const windowEnd = i + 1; // slice end is exclusive, so include index i.
    const windowStart = Math.max(0, windowEnd - windowSize);
    const trailingWindow: readonly Candle[] = candles.slice(windowStart, windowEnd);
    const atr14 = computeAtr14(trailingWindow);

    // Forward candles: strictly after the analogue date. `resolve` filters
    // again defensively, but we pass only the genuine forward slice.
    const forwardCandles: readonly Candle[] =
      labelAlignment === "on_decision_date" ? candles.slice(i) : candles.slice(i + 1);

    await resolve(
      analogueDate,
      pair,
      forwardCandles,
      atr14,
      evalDate,
      stores.analogueStore,
      {
        ...(flatBandMode === undefined ? {} : { flatBandMode }),
        ...(labelAlignment === undefined ? {} : { labelAlignment }),
      },
    );

    datesResolved += 1;
  }

  return {
    pair,
    datesResolved,
    outcomesWritten: datesResolved * HORIZONS_PER_DATE,
  };
}
