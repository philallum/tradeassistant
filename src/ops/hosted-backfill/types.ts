// Hosted Backfill Execution — shared types (spec Req 7, design Component 8).
//
// Hosted_Candle_Seeding is the operational act of running the EXISTING
// `StagedRunner.backfill("backfill")` with its `PipelineStores` bound to the
// Supabase adapters via `buildSupabaseStores(supabase)` (design Component 3).
// This module introduces NO new ingestion/encoding/storage logic — only a thin
// entry seam and a pure coverage-complete predicate.
//
// Secret confidentiality (spec Req 6.2, 6.3, 7.6): NO shape here carries or
// echoes the Supabase `Secret_Key` value. The result records only non-secret
// references — per-pair coverage counts and dates.

import type { PerPairCoverage } from "../../ingestion/types.js";
import type { StageResult } from "../../staged-runner/types.js";

/**
 * The outcome of one Hosted_Candle_Seeding run (spec Req 7.3, 7.5, 7.6):
 *
 *  - `result`   — the {@link StageResult} the existing Backfill_Stage returned;
 *  - `coverage` — the per-pair coverage summary read back from the hosted
 *                 `candles` table (stored count + earliest/latest date per Pair,
 *                 spec Req 7.5);
 *  - `complete` — the pure {@link isBackfillComplete} verdict over `coverage`:
 *                 true iff every one of the five PAIRS has a non-zero stored
 *                 candle count (spec Req 7.5).
 *
 * NAME/COUNT-ONLY: no `Secret_Key` value ever appears here (spec Req 7.6).
 */
export interface HostedBackfillResult {
  /** The Backfill_Stage result (success, or missing-prerequisite abort). */
  readonly result: StageResult;
  /** The per-pair coverage summary read back after seeding (spec Req 7.5). */
  readonly coverage: readonly PerPairCoverage[];
  /** Whether every one of the five PAIRS has a non-zero stored candle count. */
  readonly complete: boolean;
}
