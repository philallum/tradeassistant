// StagedRunner Types (Requirement 2).
//
// The StagedRunner orchestrates three sequential stages over the existing
// modules: backfill → backtest → forwardLook. Each stage is a pure dependency
// on the prior stage's stored output; no stage re-implements any module logic.

import type { DataSourceRole } from "../csv-loader/types.js";
import type { CandleStore } from "../ingestion/types.js";
import type { PatternVectorStore } from "../encoder/types.js";
import type { AnalogueStore, RetrievalConfig } from "../retrieval/types.js";
import type { GateVerdictStore } from "../kill-gate/types.js";
import type { LivingDocs } from "../living-docs/livingDocs.js";
import type {
  PairEvaluationLoader,
  DashboardViewPersister,
} from "../scheduled-run/scheduledRun.js";
import type { CsvLoader } from "../csv-loader/csvLoader.js";
import type { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import type { ScheduledRunConfig } from "../scheduled-run/config.js";

/** The three ordered stages of a StagedRunner run. */
export type StageName = "backfill" | "backtest" | "forwardLook";

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
  /**
   * GateVerdictStore PORT — persists composed gate verdicts (aggregate + per
   * fold rows). Injectable: tests pass the in-memory reference, the Gate_Run
   * passes the Supabase adapter.
   */
  readonly gateVerdictStore: GateVerdictStore;
  /** Data directory for CSV files (used by backfill). */
  readonly dataDir: string;
  /** Living-Docs writer for appending backtest verdicts to RESEARCH-LOG.md. */
  readonly docs: LivingDocs;
  /** The scheduled-run configuration, including Decision_Date and Supabase config. */
  readonly config: ScheduledRunConfig;
  /** The pipeline's per-pair evaluation loader (used by forwardLook). */
  readonly loadEvaluations: PairEvaluationLoader;
  /** The dashboard view persister (used by forwardLook). */
  readonly persistView?: DashboardViewPersister;
  /** Kill-gate config id for verdict composition. */
  readonly configId: string;
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
