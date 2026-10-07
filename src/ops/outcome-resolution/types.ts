// Historical Outcome Resolution — shared types (Feature: operational-wiring).
//
// Outcome_Resolution is the operational act of driving the EXISTING
// forward-outcome `resolve(...)` (src/retrieval/resolver.ts) over all stored
// history so the `analogue_outcomes` table is populated. `resolve` is the ONLY
// writer of that table and upserts per-horizon rows idempotently on
// (asset, decision_date, horizon). Nothing currently drives it across history,
// so in a fresh hosted backend `analogue_outcomes` is empty, every pair is
// non-firing, and no Decision_Date is persisted. This module WIRES the existing
// pieces — it re-implements no ingestion/encoding/resolver/ATR logic.
//
// Secret confidentiality: NO shape here carries or echoes any Supabase
// `Secret_Key` value. The result records only non-secret references — per-pair
// counts of dates resolved and outcome rows written.

import type { Pair } from "../../ingestion/types.js";

/** Per-pair summary of one historical outcome-resolution pass. */
export interface PerPairOutcomeResolution {
  /** The currency pair this summary describes. */
  readonly pair: Pair;
  /**
   * How many analogue dates had an outcome resolved for them — i.e. the number
   * of candle dates that passed the forward-candle (and, in production, the
   * stored-vector) gate.
   */
  readonly datesResolved: number;
  /**
   * How many `analogue_outcomes` rows were written for this pair. `resolve`
   * writes exactly one row per horizon (1, 2, 3), so this is `datesResolved * 3`.
   */
  readonly outcomesWritten: number;
}

/**
 * The outcome of one historical outcome-resolution pass across all PAIRS
 * (Feature: operational-wiring).
 *
 * NAME/COUNT-ONLY: no `Secret_Key` value ever appears here.
 */
export interface OutcomeResolutionResult {
  /** Per-pair resolution summaries, one entry per pair in PAIRS. */
  readonly perPair: ReadonlyArray<PerPairOutcomeResolution>;
  /** The sum of `outcomesWritten` across every pair. */
  readonly totalOutcomesWritten: number;
}
