// StagedRunner Types (Requirement 2).
//
// The StagedRunner orchestrates three sequential stages over the existing
// modules: backfill → backtest → forwardLook. Each stage is a pure dependency
// on the prior stage's stored output; no stage re-implements any module logic.

import type { DataSourceRole } from "../csv-loader/types.js";
import type { CandleStore } from "../ingestion/types.js";
import type { PatternVectorStore } from "../encoder/types.js";
import type { AnalogueStore } from "../retrieval/types.js";
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
}

// Re-export DataSourceRole so stagedRunner.ts can import it from types.
export type { DataSourceRole };
