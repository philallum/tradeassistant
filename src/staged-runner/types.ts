// StagedRunner Types (Requirement 2).
//
// What remains of the StagedRunner (codebase-housekeeping Task 5): the `backfill` stage
// plus the `hasBacktestData` / `buildFoldInputs` helpers the evaluation-report path
// reuses. Nothing here re-implements module logic.

import type { DataSourceRole } from "../csv-loader/types.js";
import type { CandleStore } from "../ingestion/types.js";
import type { PatternVectorStore } from "../encoder/types.js";
import type { AnalogueStore, RetrievalConfig } from "../retrieval/types.js";
import type { CsvLoader } from "../csv-loader/csvLoader.js";
import type { OhlcIngestion } from "../ingestion/ohlcIngestion.js";

/**
 * Outcome of a single stage. On success `ok: true`; on a missing prerequisite
 * (required stored data absent) `ok: false` with `missingPrerequisite` naming
 * the absent item so no subsequent stage runs (Requirement 2.7).
 */
export type StageResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly missingPrerequisite: string };

/**
 * Injected dependencies for the StagedRunner. All live modules/stores are
 * injected so the runner is testable with in-memory fakes (Requirement 17.1).
 */
export interface StagedRunnerDeps {
  /** CsvLoader to load candles from CSV files. */
  readonly csvLoader: CsvLoader;
  /** OhlcIngestion wired to the candleStore. */
  readonly ingestion: OhlcIngestion;
  /** CandleStore PORT — the shared storage backend. */
  readonly candleStore: CandleStore;
  /** PatternVectorStore PORT — stores encoded pattern vectors. */
  readonly vectorStore: PatternVectorStore;
  /** AnalogueStore PORT — stores matured forward-outcome records. */
  readonly analogueStore: AnalogueStore;
  /** Data directory for CSV files (used by backfill). */
  readonly dataDir: string;
  /**
   * Retrieval knobs (neighborhood size `k` and Similarity_Radius `epsilon`)
   * used when `buildFoldInputs` sources the model's directional prediction
   * HONESTLY from the Analogue_Neighborhood as of each Decision_Date — exactly
   * as the live daily pipeline does (`src/pipeline/dailyPipeline.ts`). Optional:
   * when omitted, `buildFoldInputs` reuses the live pipeline's committed
   * `DEFAULT_RETRIEVAL_CONFIG`, so the evaluation fold inputs are scored under
   * the SAME retrieval parameters the live firing path uses. It is NOT a new
   * config source — it threads the existing pipeline default (Requirement 9.1).
   */
  readonly retrieval?: RetrievalConfig;
}

// Re-export DataSourceRole so stagedRunner.ts can import it from types.
export type { DataSourceRole };
