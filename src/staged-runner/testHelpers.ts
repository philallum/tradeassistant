// Shared test helpers for StagedRunner tests.
//
// Provides in-memory dependency construction for property and unit tests.
// No disk I/O or network required.

import type { Pair } from "../ingestion/types.js";
import type { TradingDate } from "../guard/types.js";
import { PAIRS } from "../ingestion/types.js";
import { InMemoryCandleStore } from "../ingestion/types.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import { InMemoryAnalogueStore } from "../retrieval/types.js";
import { InMemoryGateVerdictStore } from "../kill-gate/types.js";
import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import { CsvLoader } from "../csv-loader/csvLoader.js";
import { LivingDocs, InMemoryDocStore } from "../living-docs/livingDocs.js";
import type { StagedRunnerDeps } from "./types.js";
import type { ScheduledRunConfig } from "../scheduled-run/config.js";
import type { PairEvaluationLoader } from "../scheduled-run/scheduledRun.js";

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
  };
}

/** Stub PairEvaluationLoader that returns empty evaluations. */
export const noopLoader: PairEvaluationLoader = () => Promise.resolve([]);

/**
 * Build a minimal StagedRunnerDeps using in-memory stores. The CsvLoader is
 * fed via an injected FileReader so no disk I/O is needed.
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
  gateVerdictStore: InMemoryGateVerdictStore;
  docStore: InMemoryDocStore;
} {
  const candleStore = new InMemoryCandleStore();
  const ingestion = new OhlcIngestion(candleStore);
  const vectorStore = new InMemoryPatternVectorStore();
  const analogueStore = new InMemoryAnalogueStore();
  const gateVerdictStore = new InMemoryGateVerdictStore();
  const docStore = new InMemoryDocStore();
  const docs = new LivingDocs(docStore);

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
    gateVerdictStore,
    dataDir: "/test/data",
    docs,
    docStore,
    config: makeConfig(),
    loadEvaluations: noopLoader,
    configId: "test-config",
  };
}

// ---------------------------------------------------------------------------
// Forward-look determinism helpers (Property 10).
//
// These are ADDITIVE: they do not change the shape returned by `makeTestDeps`
// (used by Property 7). They provide (a) seeding of the two forwardLook
// prerequisites — stored pattern vectors AND matured analogue outcomes — and
// (b) a StagedRunnerDeps variant whose `loadEvaluations` returns a fixed set of
// deterministic `PairEvaluation`s and whose `persistView` captures the produced
// `DashboardView` so two runs can be deep-compared.
// ---------------------------------------------------------------------------

import { EMBEDDING_DIM } from "../encoder/patternEncoder.js";
import type { PatternVector, WeeklyTrendSign } from "../encoder/types.js";
import type { AnalogueRecord, DirectionClass } from "../retrieval/types.js";
import type { PairEvaluation, DashboardView } from "../dashboard/index.js";
import type { DashboardViewPersister } from "../scheduled-run/scheduledRun.js";

/**
 * Build a minimal, well-formed {@link PatternVector}. The embedding is a fixed
 * 70-dimensional vector; the exact values are irrelevant to forwardLook (which
 * only needs vectors to EXIST so the prerequisite check passes), so a constant
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

/** Seed one stored pattern vector for a pair/date (forwardLook prerequisite). */
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
 * Seed one MATURED analogue outcome for a pair (forwardLook prerequisite). Its
 * `decisionDate` must be strictly before the run's Decision_Date for
 * `getMaturedOutcomes(pair, decisionDate)` to return it.
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

/**
 * A StagedRunnerDeps whose forwardLook prerequisites are satisfied and whose
 * produced {@link DashboardView} is captured on every run.
 *
 * `getView()` returns the view captured by the most recent `persistView` call
 * (or `undefined` if forwardLook aborted before persisting).
 */
export interface CapturingForwardLookDeps extends StagedRunnerDeps {
  readonly getView: () => DashboardView | undefined;
}

/**
 * Build deps for a genuine forwardLook run: seed one stored vector and one
 * matured analogue outcome per `seededPairs` so neither prerequisite aborts,
 * wire a `loadEvaluations` that returns the given `evaluations` deterministically,
 * and a capturing `persistView`.
 *
 * The `vectorDate` and `maturedDate` default to dates strictly before the
 * config's `decisionDate` so the matured-outcome prerequisite (which requires
 * `decisionDate < beforeDate`) is satisfied.
 */
export async function makeCapturingForwardLookDeps(options: {
  evaluations: readonly PairEvaluation[];
  decisionDate?: TradingDate;
  seededPairs?: readonly Pair[];
  priorDate?: TradingDate;
}): Promise<CapturingForwardLookDeps> {
  const decisionDate = options.decisionDate ?? "2020-06-01";
  const seededPairs = options.seededPairs ?? [...PAIRS];
  const priorDate = options.priorDate ?? "2020-05-01";

  const base = makeTestDeps();

  // Seed the two forwardLook prerequisites.
  for (const pair of seededPairs) {
    await seedVector(base.vectorStore, pair, priorDate);
    await seedMaturedOutcome(base.analogueStore, pair, priorDate);
  }

  let captured: DashboardView | undefined;

  const loadEvaluations: PairEvaluationLoader = () =>
    Promise.resolve(options.evaluations);

  const persistView: DashboardViewPersister = (view) => {
    captured = view;
    return Promise.resolve();
  };

  return {
    ...base,
    config: makeConfig(decisionDate),
    loadEvaluations,
    persistView,
    getView: () => captured,
  };
}

// ---------------------------------------------------------------------------
// Composed-run side-effect tracking helpers (Properties 8 & 11).
//
// These are ADDITIVE: they do NOT change the shapes returned by `makeTestDeps`
// or `makeCapturingForwardLookDeps` (relied on by Property 7 / Property 10).
//
// The three StagedRunner stages are module-level functions, not values injected
// into `runAll`, so a composed run cannot be driven by swapping in fake stage
// functions. Instead these helpers drive the REAL stages over in-memory stores
// and observe genuine side effects:
//
//   - RESEARCH-LOG.md append  — the only observable write of the backtest stage
//                               (via `logGateVerdict` → LivingDocs → docStore).
//   - persistView call        — the only observable write of the forwardLook
//                               stage (the DashboardView it produces).
//
// By seeding (or deliberately NOT seeding) each stage's prerequisites, a run can
// be made to stop at any point in the backfill → backtest → forwardLook chain,
// and the recorded side effects reveal exactly which stages actually executed.
// ---------------------------------------------------------------------------

import { LIVING_DOCS } from "../living-docs/livingDocs.js";

/**
 * A StagedRunnerDeps whose composed-run side effects are observable:
 *
 *   - `persistViewCount()` — how many times forwardLook's `persistView` ran.
 *   - `researchLogWritten()` — whether backtest appended to RESEARCH-LOG.md.
 *
 * `persistView` is always wired (it counts calls), so forwardLook — if it runs
 * to completion — produces an observable side effect. `researchLogWritten`
 * reads the in-memory doc store the backtest stage writes through.
 */
export interface TrackedComposedRunDeps extends StagedRunnerDeps {
  readonly candleStore: InMemoryCandleStore;
  readonly vectorStore: InMemoryPatternVectorStore;
  readonly analogueStore: InMemoryAnalogueStore;
  readonly docStore: InMemoryDocStore;
  /** Number of times forwardLook's persistView has been invoked. */
  readonly persistViewCount: () => number;
  /** True once backtest has appended to RESEARCH-LOG.md. */
  readonly researchLogWritten: () => boolean;
}

/**
 * Build a composed-run deps whose stages run against in-memory stores, with the
 * two downstream side effects (RESEARCH-LOG append, persistView) observable.
 *
 * @param options.csvContents   Per-pair CSV fed to backfill. Omit to feed
 *                              nothing (header-only), which makes backtest abort
 *                              on its missing-prerequisite check.
 * @param options.seedForward   When true, seed the two forwardLook prerequisites
 *                              (stored vectors + matured outcomes) so forwardLook
 *                              can run if backtest succeeds.
 * @param options.decisionDate  The run's Decision_Date.
 * @param options.priorDate     Date strictly before `decisionDate` used for the
 *                              seeded vector/outcome.
 */
export async function makeTrackedComposedRunDeps(options: {
  csvContents?: Partial<Record<Pair, string>>;
  seedForward?: boolean;
  decisionDate?: TradingDate;
  priorDate?: TradingDate;
} = {}): Promise<TrackedComposedRunDeps> {
  const decisionDate = options.decisionDate ?? "2020-06-01";
  const priorDate = options.priorDate ?? "2020-05-01";

  const base = makeTestDeps(options.csvContents ?? {});

  if (options.seedForward === true) {
    for (const pair of PAIRS) {
      await seedVector(base.vectorStore, pair, priorDate);
      await seedMaturedOutcome(base.analogueStore, pair, priorDate);
    }
  }

  let persistCount = 0;
  const persistView: DashboardViewPersister = () => {
    persistCount += 1;
    return Promise.resolve();
  };

  return {
    ...base,
    config: makeConfig(decisionDate),
    persistView,
    persistViewCount: () => persistCount,
    researchLogWritten: () => base.docStore.peek(LIVING_DOCS.researchLog) !== null,
  };
}

// ---------------------------------------------------------------------------
// Store-snapshot helper (Property 9).
//
// ADDITIVE: does NOT change the shapes returned by `makeTestDeps`,
// `makeCapturingForwardLookDeps`, or `makeTrackedComposedRunDeps`.
//
// Property 9 asserts that a stage aborting on a missing prerequisite leaves
// stored data UNCHANGED. To prove "unchanged" generically we capture a
// deep-copied, order-stable snapshot of every in-memory store a stage could
// write to — candles, pattern vectors, analogue outcomes, and the Living-Docs
// RESEARCH-LOG — then take a second snapshot after the aborted call and
// deep-compare. Because the capture reads only through the public PORT query
// methods and JSON-clones the results, the snapshot is independent of the live
// store and cannot be mutated by a later write.
// ---------------------------------------------------------------------------

/**
 * A deep, serializable snapshot of every in-memory store the StagedRunner
 * stages can write to. Deterministic ordering (per-pair query methods already
 * sort) makes two snapshots directly deep-comparable.
 */
export interface StoreSnapshot {
  /** Per-pair stored candles, in the store's canonical (date-sorted) order. */
  readonly candles: Record<Pair, unknown>;
  /** Per-pair stored pattern vectors, in canonical order. */
  readonly vectors: Record<Pair, unknown>;
  /** Per-pair ALL stored analogue outcomes (any maturity), keyed by date. */
  readonly outcomes: Record<Pair, unknown>;
  /** The full RESEARCH-LOG.md contents, or null if never written. */
  readonly researchLog: string | null;
}

/**
 * Capture a {@link StoreSnapshot} of the given in-memory stores. Every value is
 * JSON-cloned so the snapshot is a frozen copy, decoupled from later writes.
 *
 * `allOutcomeDates` lets the caller enumerate the decision dates to probe via
 * `getOutcomes` (the AnalogueStore PORT exposes no "list all" method, so the
 * caller supplies the dates it seeded plus any under test). Matured outcomes
 * are additionally captured via `getMaturedOutcomes(pair, maturedBefore)`.
 */
export async function snapshotStores(
  stores: {
    readonly ingestion: OhlcIngestion;
    readonly vectorStore: InMemoryPatternVectorStore;
    readonly analogueStore: InMemoryAnalogueStore;
    readonly docStore: InMemoryDocStore;
  },
  options: {
    readonly allOutcomeDates: readonly TradingDate[];
    readonly maturedBefore: TradingDate;
  },
): Promise<StoreSnapshot> {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  const candles = {} as Record<Pair, unknown>;
  const vectors = {} as Record<Pair, unknown>;
  const outcomes = {} as Record<Pair, unknown>;

  for (const pair of PAIRS) {
    candles[pair] = clone(await stores.ingestion.getCandles(pair));
    vectors[pair] = clone(await stores.vectorStore.getVectorsByAsset(pair));

    // Capture both the matured view (what forwardLook/backtest read) and every
    // outcome at each probed date, so a mutation to maturity or excursions is
    // caught regardless of which query surfaces it.
    const matured = clone(
      await stores.analogueStore.getMaturedOutcomes(pair, options.maturedBefore),
    );
    const byDate: Record<string, unknown> = {};
    for (const date of options.allOutcomeDates) {
      byDate[date] = clone(await stores.analogueStore.getOutcomes(pair, date));
    }
    outcomes[pair] = { matured, byDate };
  }

  return {
    candles,
    vectors,
    outcomes,
    researchLog: stores.docStore.peek(LIVING_DOCS.researchLog),
  };
}
