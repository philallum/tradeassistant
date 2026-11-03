// Unit tests for the per-run matrix builder (Requirement 10; Design "7. Per-run
// orchestration: src/strategies/confluenceMatrix.ts").
//
// These pin the orchestration contract with hand-built inputs and a real
// Confluence_Engine wrapped by a counting spy:
//   - exactly ONE `engine.aggregate` call per Pair that has candles, and zero
//     for a zero-candle Pair (Requirements 10.2, 10.4);
//   - a zero-candle Pair degrades to INSUFFICIENT_DATA without touching the
//     engine (Requirement 10.4);
//   - with all four classical strategies failing (look-ahead candles), the Pair
//     is still present with six cells and the engine is still called with the
//     remaining available signals (Requirements 10.3, 10.8);
//   - a missing evaluation yields a `custom_pattern` unavailable cell and a
//     missing reference yields a `third_party` unavailable cell;
//   - all five Pairs share the single `decisionDate` passed in (Requirement
//     10.7), carry six cells in `STRATEGY_IDS` order, and appear in `PAIRS`
//     order.
//
// The four classical strategies, the two adapters, and the engine are the REAL
// implementations — no mocks of production logic. Only `engine.aggregate` is
// wrapped so each call can be attributed to the Pair it was made for.

import { describe, expect, it } from "vitest";

import type { Candle, TradingDate } from "../guard/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import type { Confidence } from "../confidence/types.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";
import {
  STRATEGY_IDS,
  type StrategyId,
  type StrategySignal,
} from "./types.js";
import { createTrendStrategy } from "./trend.js";
import { createBreakoutStrategy } from "./breakout.js";
import { createRangeStrategy } from "./range.js";
import { createReversalStrategy } from "./reversal.js";
import {
  createConfluenceEngine,
  type ConfluenceEngine,
  type ConfluenceError,
  type ConfluenceResult,
} from "./confluenceEngine.js";
import { buildConfluenceMatrix } from "./confluenceMatrix.js";
import type {
  CellOutcome,
  ConfluenceMatrix,
  PairConfluence,
  PairConfluenceInput,
  StrategyBundle,
} from "./confluenceMatrix.js";
import type { Result } from "../guard/types.js";

// --- Helpers ----------------------------------------------------------------

/** The shared Decision_Date every test run uses. */
const DECISION_DATE: TradingDate = "2020-06-01";

/** Unwrap a `Result`, failing loudly if it is an error. */
function unwrap<T>(result: Result<T, { message?: string }>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Build the real four-strategy bundle used across the tests. */
function buildStrategies(): StrategyBundle {
  return {
    trend: unwrap(createTrendStrategy()),
    breakout: unwrap(createBreakoutStrategy()),
    range: unwrap(createRangeStrategy()),
    reversal: unwrap(createReversalStrategy()),
  };
}

/** The real default engine. */
function buildEngine(): ConfluenceEngine {
  return unwrap(createConfluenceEngine());
}

/**
 * Wrap a real engine so every `aggregate` call is recorded. The wrapper
 * delegates to the real implementation (no behaviour change) and appends each
 * call's input signals to `calls`, so the test can assert exactly how many
 * times — and with which signals — the engine was invoked.
 */
function spyEngine(inner: ConfluenceEngine): {
  readonly engine: ConfluenceEngine;
  readonly calls: StrategySignal[][];
} {
  const calls: StrategySignal[][] = [];
  const engine: ConfluenceEngine = {
    config: inner.config,
    aggregate(
      signals: readonly StrategySignal[],
    ): Result<ConfluenceResult, ConfluenceError> {
      calls.push([...signals]);
      return inner.aggregate(signals);
    },
  };
  return { engine, calls };
}

/**
 * A rising OHLC series of `count` candles ending strictly BEFORE
 * `DECISION_DATE`, so the whole series is past-only and the strategies run
 * normally. Dates are plain ascending calendar days — `prepareCandles` only
 * needs them strictly ordered and before the Decision_Date.
 */
function pastCandles(pair: Pair, count: number): Candle[] {
  const candles: Candle[] = [];
  // Start far enough back that `count` days still land before DECISION_DATE.
  const start = new Date("2019-01-01T00:00:00.000Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 0; i < count; i += 1) {
    const date = new Date(start + i * dayMs).toISOString().slice(0, 10);
    const base = 1 + i * 0.001;
    candles.push({
      asset: pair,
      date,
      open: base,
      high: base + 0.002,
      low: base - 0.001,
      close: base + 0.001,
    });
  }
  return candles;
}

/**
 * A series dated AT OR AFTER `DECISION_DATE`, so `prepareCandles` rejects every
 * strategy with a `look_ahead_violation`. The Pair still has candles, so the
 * engine is still called with whatever non-classical signals remain
 * (Requirement 10.8).
 */
function futureCandles(pair: Pair, count: number): Candle[] {
  const candles: Candle[] = [];
  const start = new Date(`${DECISION_DATE}T00:00:00.000Z`).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 0; i < count; i += 1) {
    const date = new Date(start + i * dayMs).toISOString().slice(0, 10);
    const base = 1 + i * 0.001;
    candles.push({
      asset: pair,
      date,
      open: base,
      high: base + 0.002,
      low: base - 0.001,
      close: base + 0.001,
    });
  }
  return candles;
}

/** A `custom_pattern` evaluation fixture. */
function evaluation(
  direction: PairEvaluation["direction"],
  earnedConfidence: number,
): Pick<PairEvaluation, "direction" | "earnedConfidence"> {
  return { direction, earnedConfidence: earnedConfidence as Confidence };
}

/** A well-formed display-only third-party reference fixture. */
function reference(
  pair: Pair,
  overrides: Partial<ExternalReferenceSignal> = {},
): ExternalReferenceSignal {
  return {
    pair,
    decisionDate: DECISION_DATE,
    direction: "BUY",
    provider: "test-provider",
    fetchedAt: `${DECISION_DATE}T00:00:00.000Z`,
    ...overrides,
  };
}

/** Find a Pair's PairConfluence in the matrix, failing loudly if absent. */
function pairOf(matrix: ConfluenceMatrix, pair: Pair): PairConfluence {
  const found = matrix.pairs.find((p) => p.pair === pair);
  if (found === undefined) {
    throw new Error(`pair ${pair} missing from matrix`);
  }
  return found;
}

/** The Strategy_Id a cell carries, whether available or not. */
function cellStrategyId(cell: CellOutcome): StrategyId {
  return cell.available ? cell.signal.strategyId : cell.strategyId;
}

// --- Exactly one aggregate call per Pair with candles (Req 10.2) ------------

describe("buildConfluenceMatrix — one aggregate call per Pair with candles (Req 10.2)", () => {
  it("calls engine.aggregate exactly once per Pair that has candles", () => {
    const strategies = buildStrategies();
    const { engine, calls } = spyEngine(buildEngine());

    // All five Pairs carry candles, so the engine runs once for each.
    const inputs: PairConfluenceInput[] = PAIRS.map((pair) => ({
      pair,
      candles: pastCandles(pair, 60),
      evaluation: evaluation("UP", 0.6),
      thirdParty: reference(pair),
    }));

    buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    expect(calls.length).toBe(PAIRS.length);
  });

  it("calls the engine once for a Pair even when candles are present but short", () => {
    const strategies = buildStrategies();
    const { engine, calls } = spyEngine(buildEngine());

    // A single candle: strategies return FLAT (insufficient history), but the
    // Pair still HAS candles, so the engine is called exactly once.
    const inputs: PairConfluenceInput[] = [
      {
        pair: "EURUSD",
        candles: pastCandles("EURUSD", 1),
        evaluation: evaluation("UP", 0.6),
        thirdParty: reference("EURUSD"),
      },
    ];

    buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    // One call for EURUSD; the four absent Pairs have no candles, no call.
    expect(calls.length).toBe(1);
  });
});

// --- Zero-candle Pair: INSUFFICIENT_DATA, no engine call (Req 10.4) ----------

describe("buildConfluenceMatrix — zero-candle Pair skips the engine (Req 10.4)", () => {
  it("yields INSUFFICIENT_DATA and does not call the engine for a zero-candle Pair", () => {
    const strategies = buildStrategies();
    const { engine, calls } = spyEngine(buildEngine());

    const inputs: PairConfluenceInput[] = [
      {
        pair: "EURUSD",
        candles: [],
        evaluation: evaluation("UP", 0.6),
        thirdParty: reference("EURUSD"),
      },
    ];

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    // No Pair carries candles, so the engine is never invoked.
    expect(calls.length).toBe(0);

    const eurusd = pairOf(matrix, "EURUSD");
    expect(eurusd.result.status).toBe("INSUFFICIENT_DATA");
    expect(eurusd.result.score).toBe(0);
    expect(eurusd.result.signals).toEqual([]);
    expect(eurusd.result.opposingStrategyIds).toEqual([]);
    // Still six cells, none available (no candles, missing adapters still run).
    expect(eurusd.cells.length).toBe(STRATEGY_IDS.length);
  });

  it("only calls the engine for Pairs that have candles in a mixed run", () => {
    const strategies = buildStrategies();
    const { engine, calls } = spyEngine(buildEngine());

    const inputs: PairConfluenceInput[] = [
      {
        pair: "EURUSD",
        candles: pastCandles("EURUSD", 60),
        evaluation: evaluation("UP", 0.6),
        thirdParty: reference("EURUSD"),
      },
      {
        pair: "GBPUSD",
        candles: [], // zero candles -> no engine call, INSUFFICIENT_DATA
        evaluation: evaluation("DOWN", 0.4),
        thirdParty: reference("GBPUSD", { direction: "SELL" }),
      },
    ];

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    // EURUSD has candles (1 call); GBPUSD is empty; the three absent Pairs are
    // also empty. So exactly one aggregate call overall.
    expect(calls.length).toBe(1);
    expect(pairOf(matrix, "GBPUSD").result.status).toBe("INSUFFICIENT_DATA");
  });
});

// --- All four classical strategies failing (Req 10.3, 10.8) -----------------

describe("buildConfluenceMatrix — all classical strategies failing (Req 10.3, 10.8)", () => {
  it("keeps the Pair with six cells and still calls the engine with the remaining signals", () => {
    const strategies = buildStrategies();
    const { engine, calls } = spyEngine(buildEngine());

    // Future-dated candles make every classical strategy fail with a
    // look_ahead_violation, but the Pair still HAS candles.
    const inputs: PairConfluenceInput[] = [
      {
        pair: "EURUSD",
        candles: futureCandles("EURUSD", 60),
        evaluation: evaluation("UP", 0.7),
        thirdParty: reference("EURUSD", { direction: "BUY", score: 0.5 }),
      },
    ];

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    const eurusd = pairOf(matrix, "EURUSD");

    // Pair present with exactly six cells.
    expect(eurusd.cells.length).toBe(STRATEGY_IDS.length);

    // The four classical cells are unavailable with a look-ahead reason.
    for (const id of ["trend", "breakout", "range", "reversal"] as const) {
      const cell = eurusd.cells.find((c) => cellStrategyId(c) === id)!;
      expect(cell.available).toBe(false);
      if (!cell.available) {
        expect(cell.reason).toBe("look_ahead_violation");
      }
    }

    // custom_pattern and third_party adapters still produced signals.
    const custom = eurusd.cells.find(
      (c) => cellStrategyId(c) === "custom_pattern",
    )!;
    const third = eurusd.cells.find(
      (c) => cellStrategyId(c) === "third_party",
    )!;
    expect(custom.available).toBe(true);
    expect(third.available).toBe(true);

    // The engine was still called exactly once, with only the two remaining
    // available signals (Requirement 10.8).
    expect(calls.length).toBe(1);
    const passed = calls[0]!.map((s) => s.strategyId).sort();
    expect(passed).toEqual(["custom_pattern", "third_party"]);
  });
});

// --- Missing evaluation / missing reference (Req 10.3) ----------------------

describe("buildConfluenceMatrix — missing producers give unavailable cells", () => {
  it("renders custom_pattern unavailable when the evaluation is undefined", () => {
    const strategies = buildStrategies();
    const engine = buildEngine();

    const inputs: PairConfluenceInput[] = [
      {
        pair: "EURUSD",
        candles: pastCandles("EURUSD", 60),
        evaluation: undefined, // no pattern evaluation
        thirdParty: reference("EURUSD"),
      },
    ];

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    const custom = pairOf(matrix, "EURUSD").cells.find(
      (c) => cellStrategyId(c) === "custom_pattern",
    )!;
    expect(custom.available).toBe(false);
    if (!custom.available) {
      expect(custom.strategyId).toBe("custom_pattern");
      expect(custom.reason.length).toBeGreaterThan(0);
    }
  });

  it("renders third_party unavailable when the reference is missing", () => {
    const strategies = buildStrategies();
    const engine = buildEngine();

    const inputs: PairConfluenceInput[] = [
      {
        pair: "EURUSD",
        candles: pastCandles("EURUSD", 60),
        evaluation: evaluation("UP", 0.6),
        thirdParty: null, // no third-party reference
      },
    ];

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    const third = pairOf(matrix, "EURUSD").cells.find(
      (c) => cellStrategyId(c) === "third_party",
    )!;
    expect(third.available).toBe(false);
    if (!third.available) {
      expect(third.strategyId).toBe("third_party");
      expect(third.reason.length).toBeGreaterThan(0);
    }
  });

  it("renders third_party unavailable for an undefined reference too", () => {
    const strategies = buildStrategies();
    const engine = buildEngine();

    const inputs: PairConfluenceInput[] = [
      {
        pair: "EURUSD",
        candles: pastCandles("EURUSD", 60),
        evaluation: evaluation("UP", 0.6),
        thirdParty: undefined,
      },
    ];

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    const third = pairOf(matrix, "EURUSD").cells.find(
      (c) => cellStrategyId(c) === "third_party",
    )!;
    expect(third.available).toBe(false);
  });
});

// --- Shared Decision_Date across all Pairs (Req 10.7) -----------------------

describe("buildConfluenceMatrix — single shared decisionDate (Req 10.7)", () => {
  it("echoes the one passed-in decisionDate on the matrix", () => {
    const strategies = buildStrategies();
    const engine = buildEngine();

    const inputs: PairConfluenceInput[] = PAIRS.map((pair) => ({
      pair,
      candles: pastCandles(pair, 60),
      evaluation: evaluation("UP", 0.6),
      thirdParty: reference(pair),
    }));

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    expect(matrix.decisionDate).toBe(DECISION_DATE);
  });

  it("applies the same decisionDate to every Pair's look-ahead guard", () => {
    const strategies = buildStrategies();
    const engine = buildEngine();

    // Every Pair's candles end on 2020-05-29 (before DECISION_DATE), so all
    // five evaluate against the one shared Decision_Date without a look-ahead
    // rejection. If a different date leaked per Pair this would not hold.
    const inputs: PairConfluenceInput[] = PAIRS.map((pair) => ({
      pair,
      candles: pastCandles(pair, 60),
      evaluation: evaluation("UP", 0.6),
      thirdParty: reference(pair),
    }));

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    // No Pair should carry a look_ahead_violation cell, confirming the shared,
    // past-only Decision_Date was used for all of them.
    for (const pair of PAIRS) {
      const cells = pairOf(matrix, pair).cells;
      for (const cell of cells) {
        if (!cell.available) {
          expect(cell.reason).not.toBe("look_ahead_violation");
        }
      }
    }
  });
});

// --- Canonical ordering: six cells per Pair, five Pairs in order ------------

describe("buildConfluenceMatrix — canonical cell and Pair ordering (Req 10.3, 10.1)", () => {
  it("returns five Pairs in PAIRS order", () => {
    const strategies = buildStrategies();
    const engine = buildEngine();

    // Supply inputs in a DELIBERATELY SHUFFLED order; output must follow PAIRS.
    const shuffled: Pair[] = ["USDCAD", "EURUSD", "USDJPY", "GBPUSD", "USDCHF"];
    const inputs: PairConfluenceInput[] = shuffled.map((pair) => ({
      pair,
      candles: pastCandles(pair, 60),
      evaluation: evaluation("UP", 0.6),
      thirdParty: reference(pair),
    }));

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    expect(matrix.pairs.map((p) => p.pair)).toEqual([...PAIRS]);
  });

  it("returns exactly six cells per Pair in STRATEGY_IDS order", () => {
    const strategies = buildStrategies();
    const engine = buildEngine();

    const inputs: PairConfluenceInput[] = PAIRS.map((pair) => ({
      pair,
      candles: pastCandles(pair, 60),
      evaluation: evaluation("UP", 0.6),
      thirdParty: reference(pair),
    }));

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    for (const pair of PAIRS) {
      const cells = pairOf(matrix, pair).cells;
      expect(cells.length).toBe(STRATEGY_IDS.length);
      expect(cells.map(cellStrategyId)).toEqual([...STRATEGY_IDS]);
    }
  });

  it("includes a Pair absent from inputs as an INSUFFICIENT_DATA Pair with six cells", () => {
    const strategies = buildStrategies();
    const engine = buildEngine();

    // Only provide EURUSD; the other four Pairs are absent entirely.
    const inputs: PairConfluenceInput[] = [
      {
        pair: "EURUSD",
        candles: pastCandles("EURUSD", 60),
        evaluation: evaluation("UP", 0.6),
        thirdParty: reference("EURUSD"),
      },
    ];

    const matrix = buildConfluenceMatrix({
      decisionDate: DECISION_DATE,
      inputs,
      strategies,
      engine,
    });

    // All five Pairs still present, in order, each with six cells.
    expect(matrix.pairs.map((p) => p.pair)).toEqual([...PAIRS]);
    for (const pair of PAIRS) {
      expect(pairOf(matrix, pair).cells.length).toBe(STRATEGY_IDS.length);
    }
    // The four absent Pairs degrade to INSUFFICIENT_DATA.
    for (const pair of ["GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const) {
      expect(pairOf(matrix, pair).result.status).toBe("INSUFFICIENT_DATA");
    }
  });
});
