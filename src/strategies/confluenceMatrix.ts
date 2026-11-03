// Per-run matrix orchestration — `buildConfluenceMatrix`
// (Requirement 10; Design "7. Per-run orchestration: src/strategies/confluenceMatrix.ts").
//
// This is the one place the whole feature is assembled for a daily run: for
// each Pair it runs the four classical strategies, adapts the two existing
// producers (`custom_pattern`, `third_party`), and folds every available signal
// through the Confluence_Engine exactly once. It is a pure, deterministic
// function of its inputs — it touches no clock, randomness, environment,
// network, or storage, and it never mutates the caller's `inputs`, candles, or
// evaluations (Requirement 10.5).
//
// Failure isolation is the central design idea: one strategy throwing a typed
// error, a Pair with no candles, or even a producer bug in the engine never
// aborts the run. Each becomes a scoped `unavailable` cell or an
// `INSUFFICIENT_DATA` Pair, and every other strategy and Pair still runs
// (Requirements 10.3, 10.4, 10.8). The matrix therefore always carries all five
// Pairs in `PAIRS` order, each with exactly six cells in `STRATEGY_IDS` order.
//
// This module sits OUTSIDE the firing / confidence / Kill_Gate path. It imports
// only sibling strategy modules and the shared contract; the adapters it calls
// take the TYPES of `PairEvaluation` / `ExternalReferenceSignal` only, so the
// deterministic core can never, by construction, depend on the matrix
// (Requirement 7.10).

import type { Candle, TradingDate } from "../guard/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";
import {
  STRATEGY_IDS,
  type StrategyId,
  type StrategySignal,
  type StrategyResult,
  type StrategyError,
  type Strategy,
} from "./types.js";
import { adaptCustomPattern, adaptThirdParty } from "./adapters.js";
import type { ThirdPartyScoreScale } from "./adapters.js";
import type {
  ConfluenceConfig,
  ConfluenceEngine,
  ConfluenceResult,
} from "./confluenceEngine.js";

/**
 * The per-Pair inputs the matrix builder consumes (Design "7. Per-run
 * orchestration"). Every field is read-only and is never written back
 * (Requirement 10.5).
 *
 *   - `candles` — the Pair's stored candles as loaded. The strategies guard
 *     them (look-ahead, emptiness, finiteness); the builder only inspects their
 *     count to decide whether to call the engine.
 *   - `evaluation` — the Pair's deterministic Pattern_Vector evaluation, or
 *     `undefined` when none was produced for the Pair. Only its `direction` and
 *     `earnedConfidence` are read.
 *   - `thirdParty` — the display-only External_Reference_Signal for the Pair, or
 *     `null`/`undefined` when no reference is available (Requirement 7.7).
 */
export interface PairConfluenceInput {
  readonly pair: Pair;
  readonly candles: readonly Candle[];
  readonly evaluation:
    | Pick<PairEvaluation, "direction" | "earnedConfidence">
    | undefined;
  readonly thirdParty: ExternalReferenceSignal | null | undefined;
}

/**
 * The outcome of one Strategy_Id cell for one Pair. Either a validated
 * {@link StrategySignal} (`available: true`) or an `unavailable` cell carrying
 * the Strategy_Id and a non-empty reason naming the failure (Requirement 10.3,
 * 11.2).
 */
export type CellOutcome =
  | { readonly available: true; readonly signal: StrategySignal }
  | {
      readonly available: false;
      readonly strategyId: StrategyId;
      readonly reason: string;
    };

/**
 * The aggregated confluence for one Pair: exactly six {@link CellOutcome}s in
 * `STRATEGY_IDS` order and the {@link ConfluenceResult} the engine produced (or
 * the fail-safe `INSUFFICIENT_DATA` result).
 */
export interface PairConfluence {
  readonly pair: Pair;
  readonly cells: readonly CellOutcome[];
  readonly result: ConfluenceResult;
}

/**
 * The complete per-run Confluence_Matrix: the shared Decision_Date, the engine
 * configuration used, and one {@link PairConfluence} per Pair in `PAIRS` order.
 */
export interface ConfluenceMatrix {
  readonly decisionDate: TradingDate;
  readonly config: ConfluenceConfig;
  readonly pairs: readonly PairConfluence[];
}

/**
 * The four created classical strategies the builder runs per Pair. Each is a
 * {@link Strategy} returned by its factory; the config type parameter is erased
 * here because the builder only calls `evaluate`.
 */
export interface StrategyBundle {
  readonly trend: Strategy<unknown>;
  readonly breakout: Strategy<unknown>;
  readonly range: Strategy<unknown>;
  readonly reversal: Strategy<unknown>;
}

/** The four classical Strategy_Ids the {@link StrategyBundle} provides. */
type ClassicalId = "trend" | "breakout" | "range" | "reversal";

/**
 * The fail-safe `INSUFFICIENT_DATA` result used when a Pair has no candles
 * (Requirement 10.4) or when the engine itself returns a producer-bug error
 * (converted, never thrown). Score 0, no opposing ids, no signals.
 */
const INSUFFICIENT_DATA_RESULT: ConfluenceResult = {
  score: 0,
  status: "INSUFFICIENT_DATA",
  opposingStrategyIds: [],
  signals: [],
};

/**
 * Turn a {@link StrategyError} into the human-readable `reason` string a failed
 * cell carries (Requirement 10.3). The reason names the failure type:
 *
 *   - `look_ahead_violation`
 *   - `insufficient_data`
 *   - `invalid_candle:<field>@<date>`
 *   - `invalid_signal:<field>` (defensive: a producer bug caught by `buildSignal`)
 */
function strategyErrorReason(error: StrategyError): string {
  switch (error.reason) {
    case "look_ahead_violation":
      return "look_ahead_violation";
    case "insufficient_data":
      return "insufficient_data";
    case "invalid_candle":
      return `invalid_candle:${error.field}@${error.date}`;
    case "invalid_signal":
      return `invalid_signal:${error.field}`;
  }
}

/**
 * Run one classical strategy inside its own `Result` handling and project it to
 * a {@link CellOutcome}. A typed error becomes an `unavailable` cell whose
 * reason names the failure; an unexpected throw is caught defensively and
 * reported as an `unavailable` cell so a single misbehaving producer can never
 * abort the Pair (Requirement 10.3).
 */
function runStrategyCell(
  strategyId: ClassicalId,
  strategy: Strategy<unknown>,
  candles: readonly Candle[],
  decisionDate: TradingDate,
): CellOutcome {
  let outcome: StrategyResult;
  try {
    outcome = strategy.evaluate(candles, decisionDate);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { available: false, strategyId, reason: `strategy_error:${message}` };
  }
  if (outcome.ok) {
    return { available: true, signal: outcome.value };
  }
  return {
    available: false,
    strategyId,
    reason: strategyErrorReason(outcome.error),
  };
}

/**
 * Build the `custom_pattern` cell from the Pair's evaluation (Requirement 7.1,
 * 7.2). A missing evaluation yields an `unavailable` cell with reason
 * "no pattern evaluation"; otherwise the adapter's outcome is projected.
 */
function customPatternCell(
  evaluation: PairConfluenceInput["evaluation"],
): CellOutcome {
  if (evaluation === undefined) {
    return {
      available: false,
      strategyId: "custom_pattern",
      reason: "no pattern evaluation",
    };
  }
  const adapted = adaptCustomPattern(evaluation);
  if (adapted.kind === "signal") {
    return { available: true, signal: adapted.signal };
  }
  return {
    available: false,
    strategyId: "custom_pattern",
    reason: adapted.reason,
  };
}

/**
 * Build the `third_party` cell from the Pair's reference (Requirements 7.3–7.8).
 * A missing/invalid reference yields an `unavailable` cell with the adapter's
 * reason (Requirement 7.7); otherwise the adapted signal is used.
 */
function thirdPartyCell(
  thirdParty: PairConfluenceInput["thirdParty"],
  scale: ThirdPartyScoreScale | undefined,
): CellOutcome {
  const adapted = adaptThirdParty(thirdParty, scale);
  if (adapted.kind === "signal") {
    return { available: true, signal: adapted.signal };
  }
  return {
    available: false,
    strategyId: "third_party",
    reason: adapted.reason,
  };
}

/**
 * Assemble the six cells for one Pair in `STRATEGY_IDS` order, running the four
 * classical strategies with isolated failure handling and adapting the two
 * existing producers. The returned array is always length six and in canonical
 * order (Requirements 10.3, 11.2).
 */
function buildPairCells(
  input: PairConfluenceInput,
  strategies: StrategyBundle,
  decisionDate: TradingDate,
  scale: ThirdPartyScoreScale | undefined,
): CellOutcome[] {
  const classical: Record<ClassicalId, CellOutcome> = {
    trend: runStrategyCell("trend", strategies.trend, input.candles, decisionDate),
    breakout: runStrategyCell(
      "breakout",
      strategies.breakout,
      input.candles,
      decisionDate,
    ),
    range: runStrategyCell("range", strategies.range, input.candles, decisionDate),
    reversal: runStrategyCell(
      "reversal",
      strategies.reversal,
      input.candles,
      decisionDate,
    ),
  };

  const customPattern = customPatternCell(input.evaluation);
  const thirdParty = thirdPartyCell(input.thirdParty, scale);

  // Emit in canonical STRATEGY_IDS order so the matrix is deterministic.
  return STRATEGY_IDS.map((id): CellOutcome => {
    switch (id) {
      case "trend":
      case "breakout":
      case "range":
      case "reversal":
        return classical[id];
      case "custom_pattern":
        return customPattern;
      case "third_party":
        return thirdParty;
    }
  });
}

/**
 * Build the {@link PairConfluence} for one Pair.
 *
 *   - Zero candles dated before the Decision_Date: skip the engine entirely and
 *     return the fail-safe `INSUFFICIENT_DATA` result with the Pair's
 *     unavailable cells (Requirement 10.4).
 *   - Otherwise: pass every `available` cell's signal to `engine.aggregate`
 *     exactly once (Requirement 10.2). The Pair is aggregated even if every
 *     strategy cell is unavailable, using whatever signals remain
 *     (Requirement 10.8).
 *   - An `aggregate` error (a producer bug) is converted to the same
 *     `INSUFFICIENT_DATA` shape with an `unavailable` reason on the offending
 *     cell — it is NOT thrown.
 */
function buildPairConfluence(
  input: PairConfluenceInput,
  strategies: StrategyBundle,
  engine: ConfluenceEngine,
  decisionDate: TradingDate,
  scale: ThirdPartyScoreScale | undefined,
): PairConfluence {
  const cells = buildPairCells(input, strategies, decisionDate, scale);

  // Zero candles ⇒ INSUFFICIENT_DATA without calling the engine (Req 10.4).
  if (input.candles.length === 0) {
    return { pair: input.pair, cells, result: INSUFFICIENT_DATA_RESULT };
  }

  // Collect the available signals, preserving the canonical cell order.
  const signals: StrategySignal[] = [];
  for (const cell of cells) {
    if (cell.available) {
      signals.push(cell.signal);
    }
  }

  const aggregated = engine.aggregate(signals);
  if (aggregated.ok) {
    return { pair: input.pair, cells, result: aggregated.value };
  }

  // A producer-bug aggregate error is converted, never thrown: mark the
  // offending cell unavailable and fall back to INSUFFICIENT_DATA.
  const offendingId: StrategyId =
    aggregated.error.reason === "duplicate_strategy_id"
      ? aggregated.error.strategyId
      : (signals[aggregated.error.index]?.strategyId ?? "trend");
  const reason = `unavailable: ${aggregated.error.message}`;
  const degradedCells = cells.map((cell): CellOutcome => {
    if (cell.available && cell.signal.strategyId === offendingId) {
      return { available: false, strategyId: offendingId, reason };
    }
    return cell;
  });

  return {
    pair: input.pair,
    cells: degradedCells,
    result: INSUFFICIENT_DATA_RESULT,
  };
}

/**
 * Build the per-run {@link ConfluenceMatrix} for one Decision_Date.
 *
 * For every Pair in `PAIRS` order it runs the four strategies with isolated
 * failure handling, adapts `custom_pattern` and `third_party`, and calls
 * `engine.aggregate` exactly once (or skips it for a zero-candle Pair). The
 * matrix always carries all five Pairs, each with exactly six cells in
 * `STRATEGY_IDS` order; no failure is ever thrown. All Pairs share the single
 * `decisionDate` (Requirement 10.7), and the function never mutates `inputs`,
 * candles, or evaluations (Requirement 10.5).
 *
 * Inputs for a Pair that is absent from `inputs` are treated as a Pair with no
 * candles and no producers, which yields an `INSUFFICIENT_DATA` Pair with all
 * cells unavailable.
 */
export function buildConfluenceMatrix(args: {
  readonly decisionDate: TradingDate;
  readonly inputs: readonly PairConfluenceInput[];
  readonly strategies: StrategyBundle;
  readonly engine: ConfluenceEngine;
  readonly thirdPartyScale?: ThirdPartyScoreScale;
}): ConfluenceMatrix {
  const { decisionDate, inputs, strategies, engine, thirdPartyScale } = args;

  // Index the supplied inputs by Pair so the output follows PAIRS order
  // regardless of the input order, and a missing Pair degrades gracefully.
  const byPair = new Map<Pair, PairConfluenceInput>();
  for (const input of inputs) {
    byPair.set(input.pair, input);
  }

  const pairs = PAIRS.map((pair): PairConfluence => {
    const input: PairConfluenceInput = byPair.get(pair) ?? {
      pair,
      candles: [],
      evaluation: undefined,
      thirdParty: undefined,
    };
    return buildPairConfluence(
      input,
      strategies,
      engine,
      decisionDate,
      thirdPartyScale,
    );
  });

  return { decisionDate, config: engine.config, pairs };
}
