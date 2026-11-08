// Shared test helpers for StagedRunner tests.
//
// Provides in-memory dependency construction for property and unit tests.
// No disk I/O or network required.
//
// (The forward-look / composed-run / store-snapshot helpers that served the removed
// `forwardLook`, `runAll` and `backtest` stages were deleted in codebase-housekeeping
// Task 5.)

import type { Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import { PAIRS } from "../ingestion/types.js";
import { InMemoryCandleStore } from "../ingestion/types.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import { InMemoryAnalogueStore } from "../retrieval/types.js";
import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import { CsvLoader } from "../csv-loader/csvLoader.js";
import { EMBEDDING_DIM } from "../encoder/patternEncoder.js";
import type { PatternVector, WeeklyTrendSign } from "../encoder/types.js";
import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import type { StagedRunnerDeps } from "./types.js";
import type { ScheduledRunConfig } from "../scheduled-run/config.js";

/** Build a valid CSV string for a pair with the given date strings. */
export function buildCsvContent(dates: string[]): string {
  const header = "Time\tOpen\tHigh\tLow\tClose\tVolume";
  const rows = dates.map(
    (d) => `${d} 00:00:00\t1.1000\t1.1100\t1.0900\t1.1050\t1000\t500`,
  );
  return [header, ...rows].join("\n");
}

/** Stub ScheduledRunConfig for tests. */
export function makeConfig(
  decisionDate: TradingDate = "2020-06-01",
): ScheduledRunConfig {
  return {
    decisionDate,
    supabase: {
      url: "http://localhost:54321",
      key: "test-key",
      target: "local",
    },
    gcpProject: undefined,
    gcpRegion: undefined,
    geminiModel: undefined,
    dashboardSnapshotBucket: undefined,
  };
}

/**
 * Build a minimal StagedRunnerDeps using in-memory stores. The CsvLoader is
 * fed via an injected FileReader so no disk I/O is needed.
 *
 * Also returns a stub `config` (not part of `StagedRunnerDeps`) for tests of the ops
 * entries that need a `ScheduledRunConfig` alongside the shared stores.
 *
 * @param csvContents  Per-pair CSV contents. Missing pairs get an empty CSV
 *                     (header-only → CsvLoader reports empty, feeds nothing).
 */
export function makeTestDeps(
  csvContents: Partial<Record<Pair, string>> = {},
): StagedRunnerDeps & {
  candleStore: InMemoryCandleStore;
  vectorStore: InMemoryPatternVectorStore;
  analogueStore: InMemoryAnalogueStore;
  config: ScheduledRunConfig;
} {
  const candleStore = new InMemoryCandleStore();
  const ingestion = new OhlcIngestion(candleStore);
  const vectorStore = new InMemoryPatternVectorStore();
  const analogueStore = new InMemoryAnalogueStore();

  const reader = (path: string): Promise<string> => {
    for (const pair of PAIRS) {
      if (path.includes(pair)) {
        return Promise.resolve(
          csvContents[pair] ?? "Time\tOpen\tHigh\tLow\tClose\tVolume\n",
        );
      }
    }
    return Promise.resolve("Time\tOpen\tHigh\tLow\tClose\tVolume\n");
  };

  const csvLoader = new CsvLoader(ingestion, reader);

  return {
    csvLoader,
    ingestion,
    candleStore,
    vectorStore,
    analogueStore,
    dataDir: "/test/data",
    config: makeConfig(),
  };
}

// ---------------------------------------------------------------------------
// Seeding helpers: stored pattern vectors and matured analogue outcomes.
// ---------------------------------------------------------------------------

/**
 * Build a minimal, well-formed {@link PatternVector}. The embedding is a fixed
 * 70-dimensional vector; the exact values are irrelevant to callers that only need
 * vectors to EXIST (or to be identical, giving cosine distance 0), so a constant
 * fill keeps seeding deterministic.
 */
export function makeStoredVector(
  weeklyTrendSign: WeeklyTrendSign = "UP",
): PatternVector {
  const scale10 = Array<number>(10).fill(0.1);
  const scale20 = Array<number>(20).fill(0.2);
  const scale40 = Array<number>(40).fill(0.4);
  return {
    scale10,
    scale20,
    scale40,
    embedding: [...scale10, ...scale20, ...scale40],
    weeklyTrendSign,
    dim: EMBEDDING_DIM,
  };
}

/** Seed one stored pattern vector for a pair/date. */
export async function seedVector(
  vectorStore: InMemoryPatternVectorStore,
  pair: Pair,
  decisionDate: TradingDate,
  weeklyTrendSign: WeeklyTrendSign = "UP",
): Promise<void> {
  await vectorStore.upsertVector(
    pair,
    decisionDate,
    makeStoredVector(weeklyTrendSign),
  );
}

/**
 * Seed one MATURED analogue outcome for a pair. Its `decisionDate` must be strictly
 * before the query date for `getMaturedOutcomes(pair, decisionDate)` to return it.
 */
export async function seedMaturedOutcome(
  analogueStore: InMemoryAnalogueStore,
  pair: Pair,
  decisionDate: TradingDate,
  direction: DirectionClass = "UP",
): Promise<void> {
  const record: AnalogueRecord = {
    asset: pair,
    decisionDate,
    horizon: 1,
    direction,
    mfePips: 20,
    maePips: 10,
    atr14: 15,
    matured: true,
  };
  await analogueStore.upsertOutcome(record);
}
