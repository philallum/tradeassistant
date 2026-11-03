// Fail-safe confluence slice — multi-strategy-confluence-engine Stage F (task
// 18.1; Requirements 10.1, 10.4, 10.6, 10.7, 11.2, 11.3, 11.4, 11.5, 11.6,
// 11.10; Design "9. Snapshot wiring: src/scheduled-run/").
//
// This is the I/O wrapper that turns the pure per-run Confluence_Matrix
// (`src/strategies/confluenceMatrix.ts`) into the v5 `confluence` snapshot slice
// for a daily run. It is a separate read-only consumer of already-produced
// deterministic data: it reads candles and the display-only third-party
// references, runs the four classical strategies + the two adapters through the
// engine, and maps the result to the wire slice. NOTHING here feeds firing,
// confidence, the Kill_Gate, or the persisted rows (Requirement 10.5) — only the
// output artifact grows.
//
// FAIL-SAFE (Requirement 10.6): `buildConfluenceSlice` NEVER throws. Config
// resolution falls back to the engine defaults with a secret-free warning; a
// per-Pair candle load failure degrades that Pair to all-unavailable cells with
// reason `candles_unavailable` (Requirement 10.4) while every other Pair
// continues; any other failure logs the slice name and `err.message` ONLY (no
// keys, env values, or config dumps) and returns `EMPTY_CONFLUENCE`. The daily
// run therefore always publishes a well-formed `dashboard.json`.
//
// The wire mapping is pure and LLM-free: `toSnapshotConfluence` copies the
// weights and thresholds the engine actually used, stamps the `unvalidated`
// Validation_Label (Requirement 11.6), and emits zero or exactly five Pairs with
// six cells each in canonical order (Requirements 11.2, 11.5). The type does not
// admit any provenance / LLM field (Requirement 11.10).

import type { TradingDate } from "../guard/types.js";
import { PAIRS, type Pair, type CandleStore } from "../ingestion/types.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";
import {
  buildConfluenceMatrix,
  createConfluenceEngine,
  createTrendStrategy,
  createBreakoutStrategy,
  createRangeStrategy,
  createReversalStrategy,
  confluenceConfigFromEnv,
  STRATEGY_IDS,
  type ConfluenceMatrix,
  type ConfluenceConfig,
  type PairConfluenceInput,
  type StrategyBundle,
  type CellOutcome,
} from "../strategies/index.js";
import type { DisplayOnlyWrite } from "../storage/supabase/index.js";
import {
  EMPTY_CONFLUENCE,
  type SnapshotConfluenceCell,
  type SnapshotConfluencePair,
  type SnapshotConfluenceSlice,
  type SnapshotConfluenceStrategyId,
} from "./snapshot.js";
import { HISTORY_WINDOW_DAYS, windowStartDate } from "./snapshotHistory.js";

/**
 * The collaborators {@link buildConfluenceSlice} needs. All read-only; the slice
 * builder reads candles and the display-only references, and writes nothing
 * back (Requirement 10.5).
 */
export interface ConfluenceSliceDeps {
  /** The run's Decision_Date (`YYYY-MM-DD`). Shared by every Pair (Req 10.7). */
  readonly decisionDate: TradingDate;
  /** The run's deterministic per-pair evaluations (for the `custom_pattern` cell). */
  readonly evaluations: readonly PairEvaluation[];
  /** The display-only writes carrying the per-Pair third-party `reference`s. */
  readonly displayOnly: DisplayOnlyWrite | undefined;
  /** The Candle storage port the per-Pair history is loaded through. */
  readonly candleStore: CandleStore;
  /** Environment for the engine config override. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Secret-free warning sink (defaults to a structured `console.warn`). */
  readonly warn?: (slice: string, err: unknown) => void;
}

/** The slice name carried in every warning log. */
const SLICE_NAME = "confluence" as const;

/**
 * Secret-free structured warning: logs ONLY the slice name and `err.message`
 * (no keys, env values, or config dumps) (Requirement 10.6).
 */
function defaultWarn(slice: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(JSON.stringify({ event: "scheduled_run.confluence_slice_failed", slice, message }));
}

/**
 * Decrement a `YYYY-MM-DD` date by one calendar day (UTC). The store's `endDate`
 * is inclusive, so loading up to the day BEFORE the Decision_Date keeps every
 * candle strictly before it; the strategies' own `assertPastOnly` still guards
 * look-ahead on top of this (Design "9. Snapshot wiring").
 */
function dayBefore(date: TradingDate): TradingDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Map an engine {@link ConfluenceConfig} weights record to the wire record. */
function toWireWeights(
  config: ConfluenceConfig,
): Readonly<Record<SnapshotConfluenceStrategyId, number>> {
  return {
    trend: config.weights.trend,
    breakout: config.weights.breakout,
    range: config.weights.range,
    reversal: config.weights.reversal,
    custom_pattern: config.weights.custom_pattern,
    third_party: config.weights.third_party,
  };
}

/** Project one {@link CellOutcome} to its wire {@link SnapshotConfluenceCell}. */
function toWireCell(
  strategyId: SnapshotConfluenceStrategyId,
  cell: CellOutcome,
): SnapshotConfluenceCell {
  if (cell.available) {
    return {
      strategyId,
      available: true,
      direction: cell.signal.direction,
      strength: cell.signal.strength,
      rationale: cell.signal.rationale,
    };
  }
  return { strategyId, available: false, reason: cell.reason };
}

/**
 * Pure projection of the per-run {@link ConfluenceMatrix} to the v5 wire slice
 * (Requirements 11.2, 11.3, 11.4, 11.5, 11.6, 11.10).
 *
 * Copies the weights and thresholds the engine actually used (`matrix.config`),
 * stamps the literal `"unvalidated"` Validation_Label (Requirement 11.6), and
 * emits one {@link SnapshotConfluencePair} per Pair in `PAIRS` order with exactly
 * six cells in `STRATEGY_IDS` order. `opposingStrategyIds` is carried verbatim
 * from the engine result (non-empty ONLY for a `CONFLICT_FLAT` Pair — Reqs 11.3,
 * 11.4). The wire type admits no provenance / LLM field (Requirement 11.10).
 */
export function toSnapshotConfluence(matrix: ConfluenceMatrix): SnapshotConfluenceSlice {
  const pairs: SnapshotConfluencePair[] = matrix.pairs.map((pairConfluence) => {
    const cells: SnapshotConfluenceCell[] = STRATEGY_IDS.map((id, index) =>
      toWireCell(id, pairConfluence.cells[index]!),
    );
    return {
      pair: pairConfluence.pair,
      score: pairConfluence.result.score,
      status: pairConfluence.result.status,
      opposingStrategyIds: pairConfluence.result.opposingStrategyIds,
      cells,
    };
  });

  return {
    validationLabel: "unvalidated",
    weights: toWireWeights(matrix.config),
    conflictThreshold: matrix.config.conflictThreshold,
    alignmentThreshold: matrix.config.alignmentThreshold,
    pairs,
  };
}

/**
 * Build the real four-strategy bundle. Each factory is called with its
 * defaults; a factory `ConfigError` (none is expected with defaults) propagates
 * to the fail-safe wrapper in {@link buildConfluenceSlice} and degrades to the
 * empty slice. Returns `null` if any factory rejects.
 */
function buildStrategyBundle(): StrategyBundle | null {
  const trend = createTrendStrategy();
  const breakout = createBreakoutStrategy();
  const range = createRangeStrategy();
  const reversal = createReversalStrategy();
  if (!trend.ok || !breakout.ok || !range.ok || !reversal.ok) {
    return null;
  }
  return {
    trend: trend.value,
    breakout: breakout.value,
    range: range.value,
    reversal: reversal.value,
  };
}

/**
 * Load every Pair's pre-Decision_Date candles, isolating a per-Pair failure. A
 * Pair whose load throws yields `candles: null`, which the caller turns into
 * all-unavailable cells with reason `candles_unavailable` (Requirement 10.4);
 * every other Pair still loads. The window reuses `HISTORY_WINDOW_DAYS` and
 * `windowStartDate`, and the inclusive end is the day BEFORE the Decision_Date.
 */
async function loadCandlesByPair(
  candleStore: CandleStore,
  decisionDate: TradingDate,
  warn: (slice: string, err: unknown) => void,
): Promise<Map<Pair, PairConfluenceInput["candles"] | null>> {
  const windowStart = windowStartDate(decisionDate, HISTORY_WINDOW_DAYS);
  const endDate = dayBefore(decisionDate);

  const entries = await Promise.all(
    PAIRS.map(async (pair): Promise<[Pair, PairConfluenceInput["candles"] | null]> => {
      try {
        const candles = await candleStore.getCandles(pair, windowStart, endDate);
        return [pair, candles];
      } catch (err) {
        warn(`${SLICE_NAME}:${pair}`, err);
        return [pair, null];
      }
    }),
  );

  return new Map(entries);
}

/**
 * Build the v5 `confluence` slice for a daily run. NEVER throws (Requirement
 * 10.6).
 *
 * Steps:
 *   1. Resolve the engine config from the environment via
 *      {@link confluenceConfigFromEnv}; a parse failure (or a rejected engine
 *      config) falls back to the engine DEFAULTS with a secret-free warning.
 *   2. Load each Pair's candles (strictly before the Decision_Date). A per-Pair
 *      load failure becomes that Pair's all-unavailable `candles_unavailable`
 *      cells (Requirement 10.4); other Pairs continue.
 *   3. Read the per-Pair third-party `reference`s from `displayOnly.comparisons`.
 *   4. Run {@link buildConfluenceMatrix} for the single shared Decision_Date
 *      (Requirement 10.7) and map the result with {@link toSnapshotConfluence}.
 *
 * Any failure outside the per-Pair candle handling logs the slice name and
 * `err.message` only and returns {@link EMPTY_CONFLUENCE}, so the run and every
 * other slice are unaffected.
 */
export async function buildConfluenceSlice(
  deps: ConfluenceSliceDeps,
): Promise<SnapshotConfluenceSlice> {
  const warn = deps.warn ?? defaultWarn;

  try {
    // 1. Resolve config from env, falling back to defaults on any problem.
    const envConfig = confluenceConfigFromEnv(deps.env ?? process.env);
    let engineResult = createConfluenceEngine(
      envConfig.ok ? envConfig.value : undefined,
    );
    if (!envConfig.ok) {
      warn(SLICE_NAME, new Error(`invalid confluence config; using defaults: ${envConfig.error.message}`));
      engineResult = createConfluenceEngine();
    } else if (!engineResult.ok) {
      // A valid parse that still produces an out-of-range engine config: log and
      // fall back to the defaults rather than failing the slice.
      warn(SLICE_NAME, new Error(`invalid confluence config; using defaults: ${engineResult.error.message}`));
      engineResult = createConfluenceEngine();
    }
    if (!engineResult.ok) {
      // The default engine config cannot be invalid; this is defensive only.
      warn(SLICE_NAME, new Error(engineResult.error.message));
      return EMPTY_CONFLUENCE;
    }
    const engine = engineResult.value;

    const strategies = buildStrategyBundle();
    if (strategies === null) {
      warn(SLICE_NAME, new Error("strategy bundle construction failed"));
      return EMPTY_CONFLUENCE;
    }

    // 3. Index the display-only third-party references by Pair.
    const referenceByPair = new Map<Pair, ExternalReferenceSignal | null>();
    for (const comparison of deps.displayOnly?.comparisons ?? []) {
      referenceByPair.set(comparison.pair as Pair, comparison.reference);
    }

    // 2. Load candles per Pair with isolated failure handling.
    const candlesByPair = await loadCandlesByPair(
      deps.candleStore,
      deps.decisionDate,
      warn,
    );

    // Index the deterministic evaluations by Pair for the custom_pattern cell.
    const evaluationByPair = new Map<Pair, PairEvaluation>();
    for (const evaluation of deps.evaluations) {
      evaluationByPair.set(evaluation.pair, evaluation);
    }

    // Assemble one input per Pair. A failed candle load (null) is left to the
    // per-Pair fallback below; otherwise build the normal matrix input.
    const failedPairs = new Set<Pair>();
    const inputs: PairConfluenceInput[] = [];
    for (const pair of PAIRS) {
      const candles = candlesByPair.get(pair);
      if (candles === null || candles === undefined) {
        failedPairs.add(pair);
        continue;
      }
      inputs.push({
        pair,
        candles,
        evaluation: evaluationByPair.get(pair),
        thirdParty: referenceByPair.get(pair),
      });
    }

    // 4. Build the matrix for the single shared Decision_Date and map to wire.
    const matrix = buildConfluenceMatrix({
      decisionDate: deps.decisionDate,
      inputs,
      strategies,
      engine,
    });
    const slice = toSnapshotConfluence(matrix);

    // A Pair whose candle load FAILED (as opposed to returning zero candles)
    // gets all-unavailable `candles_unavailable` cells (Requirement 10.4). The
    // matrix already returns an INSUFFICIENT_DATA Pair for it (absent input ⇒
    // zero candles), so only the cell reasons need overriding to name the load
    // failure specifically.
    if (failedPairs.size === 0) {
      return slice;
    }
    const pairs = slice.pairs.map((pairSlice): SnapshotConfluencePair => {
      if (!failedPairs.has(pairSlice.pair as Pair)) {
        return pairSlice;
      }
      const cells = STRATEGY_IDS.map(
        (id): SnapshotConfluenceCell => ({
          strategyId: id,
          available: false,
          reason: "candles_unavailable",
        }),
      );
      return { ...pairSlice, cells };
    });
    return { ...slice, pairs };
  } catch (err) {
    // Any failure outside the per-Pair candle handling: log secret-free and
    // return the empty slice so the run still publishes dashboard.json (Req 10.6).
    warn(SLICE_NAME, err);
    return EMPTY_CONFLUENCE;
  }
}
