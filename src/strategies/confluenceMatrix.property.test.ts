// Feature: multi-strategy-confluence-engine, Property 24: Matrix construction is complete and isolates failures
//
// Property 24 (Design "7. Per-run orchestration"; Requirements 7.7, 10.1, 10.2,
// 10.3, 10.4, 10.8). For ARBITRARY inputs — including empty / future-dated
// candle series, present or absent pattern evaluations, present / absent /
// invalid third-party references, and an arbitrary subset of the five Pairs —
// `buildConfluenceMatrix` must:
//
//   - never throw (every failure is scoped, never propagated);
//   - ALWAYS return exactly five Pairs in `PAIRS` order (completeness — 10.1,
//     10.8);
//   - ALWAYS give each Pair exactly six cells in `STRATEGY_IDS` order;
//   - isolate failures: one strategy / producer failing never removes or
//     corrupts another cell or another Pair (10.3);
//   - yield `INSUFFICIENT_DATA` for a zero-candle Pair (10.4);
//   - render a missing third-party reference as an unavailable `third_party`
//     cell without affecting any other cell (7.7);
//   - make every cell either `available` with a valid signal or `available:
//     false` with a non-empty reason (10.3).
//
// Backend fast-check 4.10.0; numRuns >= 100. The test uses the REAL strategy
// factories and `createConfluenceEngine` — no stubs — so the isolation it
// observes is the production behaviour.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Candle, TradingDate } from "../guard/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { ExternalReferenceSignal } from "../external-signal/types.js";
import {
  buildConfluenceMatrix,
  type PairConfluenceInput,
  type StrategyBundle,
} from "./confluenceMatrix.js";
import {
  createTrendStrategy,
  createBreakoutStrategy,
  createRangeStrategy,
  createReversalStrategy,
} from "./index.js";
import { createConfluenceEngine } from "./confluenceEngine.js";
import {
  STRATEGY_IDS,
  SIGNAL_DIRECTIONS,
  validateStrategySignal,
  type SignalDirection,
} from "./types.js";
import {
  arbCandleSeries,
  arbDecisionDateAfter,
  arbFutureCandles,
} from "./testing/arbitraries.js";

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// The real strategies and engine, built once (pure, config-only).
// ---------------------------------------------------------------------------

function realStrategies(): StrategyBundle {
  const trend = createTrendStrategy();
  const breakout = createBreakoutStrategy();
  const range = createRangeStrategy();
  const reversal = createReversalStrategy();
  if (!trend.ok || !breakout.ok || !range.ok || !reversal.ok) {
    throw new Error("default strategy factories must succeed");
  }
  return {
    trend: trend.value,
    breakout: breakout.value,
    range: range.value,
    reversal: reversal.value,
  };
}

function realEngine() {
  const engine = createConfluenceEngine();
  if (!engine.ok) throw new Error("default engine factory must succeed");
  return engine.value;
}

// ---------------------------------------------------------------------------
// Arbitraries for a single Pair's inputs
// ---------------------------------------------------------------------------

/**
 * An arbitrary pattern evaluation, or `undefined` (absent). `earnedConfidence`
 * stays in `[0, 1]` as the branded `Confidence` the adapter expects; the cast
 * is confined to the generator.
 */
const arbEvaluation: fc.Arbitrary<PairConfluenceInput["evaluation"]> = fc.option(
  fc.record({
    direction: fc.constantFrom<SignalDirection>(...SIGNAL_DIRECTIONS),
    earnedConfidence: fc.double({
      min: 0,
      max: 1,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  }),
  { nil: undefined },
) as fc.Arbitrary<PairConfluenceInput["evaluation"]>;

/** A valid third-party reference for the given Pair. */
function arbValidReference(
  pair: Pair,
  decisionDate: TradingDate,
): fc.Arbitrary<ExternalReferenceSignal> {
  return fc.record({
    direction: fc.constantFrom("BUY", "SELL", "HOLD"),
    score: fc.option(
      fc.double({ min: -5, max: 5, noNaN: true, noDefaultInfinity: true }),
      { nil: undefined },
    ),
    provider: fc.constantFrom("fcs", "demo", "vendor-x"),
  }).map(({ direction, score, provider }) => {
    const ref: ExternalReferenceSignal = {
      pair,
      decisionDate,
      direction,
      ...(score !== undefined ? { score } : {}),
      provider,
      fetchedAt: "2020-01-01T00:00:00.000Z",
    };
    return ref;
  });
}

/**
 * A structurally INVALID / unavailable third-party reference: a bad direction
 * or a non-finite score. These must degrade to an unavailable `third_party`
 * cell, never a throw (Requirement 7.7).
 */
const arbInvalidReference: fc.Arbitrary<unknown> = fc.oneof(
  fc.record({ direction: fc.constant("MAYBE"), provider: fc.string() }),
  fc.record({
    direction: fc.constantFrom("BUY", "SELL"),
    score: fc.constantFrom(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ),
    provider: fc.string(),
  }),
);

/**
 * A third-party slot for a Pair: absent (`null`/`undefined`), a valid
 * reference, or an invalid one. Covers "arbitrary present/absent third-party
 * references" including the invalid shapes the adapter must reject.
 */
function arbThirdParty(
  pair: Pair,
  decisionDate: TradingDate,
): fc.Arbitrary<PairConfluenceInput["thirdParty"]> {
  return fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    arbValidReference(pair, decisionDate),
    arbInvalidReference,
  ) as fc.Arbitrary<PairConfluenceInput["thirdParty"]>;
}

/**
 * A candle series for a Pair that spans the awkward cases the matrix must
 * tolerate without throwing:
 *   - empty (zero candles — must yield INSUFFICIENT_DATA, Req 10.4);
 *   - a healthy past-only series of varying length (some below, some above the
 *     strategies' minimum history);
 *   - a FUTURE-dated series (every candle at/after the Decision_Date — a
 *     guaranteed look-ahead rejection in each classical cell).
 */
function arbPairCandles(
  decisionDate: TradingDate,
): fc.Arbitrary<readonly Candle[]> {
  return fc.oneof(
    fc.constant<readonly Candle[]>([]),
    arbCandleSeries({ min: 0, max: 3 }),
    arbCandleSeries({ min: 55, max: 70 }),
    arbFutureCandles(decisionDate, { min: 1, max: 5 }),
  );
}

/** One Pair's complete input, assembled around a shared Decision_Date. */
function arbPairInput(
  pair: Pair,
  decisionDate: TradingDate,
): fc.Arbitrary<PairConfluenceInput> {
  return fc
    .tuple(
      arbPairCandles(decisionDate),
      arbEvaluation,
      arbThirdParty(pair, decisionDate),
    )
    .map(([candles, evaluation, thirdParty]) => ({
      pair,
      candles,
      evaluation,
      thirdParty,
    }));
}

/**
 * The full set of per-Pair inputs the matrix builder is handed: a Decision_Date
 * and an ARBITRARY SUBSET of the five Pairs (so a Pair may be entirely absent,
 * exercising the "missing Pair degrades gracefully" path), each with its own
 * arbitrary inputs.
 */
const arbMatrixArgs = arbDecisionDateAfter([]).chain((decisionDate) =>
  fc
    .subarray([...PAIRS], { minLength: 0, maxLength: PAIRS.length })
    .chain((pairs) =>
      pairs.length === 0
        ? fc.constant<PairConfluenceInput[]>([])
        : fc.tuple(...pairs.map((p) => arbPairInput(p, decisionDate))),
    )
    .map((inputs) => ({ decisionDate, inputs })),
);

describe("Confluence matrix completeness and failure isolation", () => {
  // Feature: multi-strategy-confluence-engine, Property 24: Matrix construction is complete and isolates failures
  //
  // Validates: Requirements 7.7, 10.1, 10.2, 10.3, 10.4, 10.8
  it("Property 24: matrix always has five Pairs and six well-formed cells, isolating every failure", () => {
    const strategies = realStrategies();
    const engine = realEngine();

    fc.assert(
      fc.property(arbMatrixArgs, ({ decisionDate, inputs }) => {
        // (a) `buildConfluenceMatrix` never throws, whatever the inputs.
        const matrix = buildConfluenceMatrix({
          decisionDate,
          inputs,
          strategies,
          engine,
        });

        // (b) Completeness: exactly five Pairs, in PAIRS order (10.1, 10.8).
        expect(matrix.pairs).toHaveLength(PAIRS.length);
        expect(matrix.pairs.map((p) => p.pair)).toEqual([...PAIRS]);

        // All Pairs share the single Decision_Date and engine config.
        expect(matrix.decisionDate).toBe(decisionDate);
        expect(matrix.config).toBe(engine.config);

        // Index the supplied inputs so per-Pair expectations can be checked.
        const byPair = new Map<Pair, PairConfluenceInput>();
        for (const input of inputs) byPair.set(input.pair, input);

        for (const pairConfluence of matrix.pairs) {
          const { pair, cells, result } = pairConfluence;
          const input = byPair.get(pair);

          // (c) Each Pair always has exactly six cells in STRATEGY_IDS order.
          expect(cells).toHaveLength(STRATEGY_IDS.length);
          expect(
            cells.map((cell) =>
              cell.available ? cell.signal.strategyId : cell.strategyId,
            ),
          ).toEqual([...STRATEGY_IDS]);

          // (d) Every cell is EITHER available with a valid signal OR
          //     unavailable with a non-empty reason (10.3).
          for (const cell of cells) {
            if (cell.available) {
              const check = validateStrategySignal(cell.signal);
              expect(check.ok).toBe(true);
            } else {
              expect(typeof cell.reason).toBe("string");
              expect(cell.reason.length).toBeGreaterThan(0);
            }
          }

          // The aggregated result always carries the six (sorted) signals'
          // worth of shape: a finite score in [-1, 1] and a known status.
          expect(Number.isFinite(result.score)).toBe(true);
          expect(result.score).toBeGreaterThanOrEqual(-1);
          expect(result.score).toBeLessThanOrEqual(1);

          const candleCount = input?.candles.length ?? 0;

          // (e) A zero-candle Pair (absent, or present with an empty series)
          //     yields INSUFFICIENT_DATA (10.4).
          if (candleCount === 0) {
            expect(result.status).toBe("INSUFFICIENT_DATA");
          }

          // (f) The third_party cell reflects ONLY the Pair's reference: a
          //     missing/invalid reference is an unavailable third_party cell,
          //     and it never leaks into another cell (7.7).
          const thirdPartyCell = cells[STRATEGY_IDS.indexOf("third_party")]!;
          const reference = input?.thirdParty;
          const referenceIsValidShape =
            reference !== null &&
            reference !== undefined &&
            typeof reference === "object" &&
            typeof (reference as { direction?: unknown }).direction ===
              "string" &&
            ["BUY", "SELL", "HOLD"].includes(
              (reference as { direction: string }).direction,
            ) &&
            ((reference as { score?: unknown }).score === undefined ||
              (typeof (reference as { score?: unknown }).score === "number" &&
                Number.isFinite((reference as { score: number }).score)));

          if (!referenceIsValidShape) {
            // A missing or malformed reference MUST surface as unavailable and
            // MUST carry a third_party-scoped reason.
            expect(thirdPartyCell.available).toBe(false);
            if (!thirdPartyCell.available) {
              expect(thirdPartyCell.strategyId).toBe("third_party");
              expect(thirdPartyCell.reason.length).toBeGreaterThan(0);
            }
          }
        }

        // (g) Isolation across Pairs: the custom_pattern / third_party cells of
        //     one Pair are a pure function of THAT Pair's evaluation and
        //     reference — a neighbouring Pair's failure cannot alter them. We
        //     verify this by rebuilding the matrix for each Pair in ISOLATION
        //     (a single-Pair input) and asserting the producer cells match.
        for (const pairConfluence of matrix.pairs) {
          const input = byPair.get(pairConfluence.pair);
          if (input === undefined) continue;

          const solo = buildConfluenceMatrix({
            decisionDate,
            inputs: [input],
            strategies,
            engine,
          });
          const soloPair = solo.pairs.find(
            (p) => p.pair === pairConfluence.pair,
          )!;

          // The six cells are identical whether the Pair was built alongside
          // the others or entirely alone — no cross-Pair interference (10.3).
          expect(soloPair.cells).toEqual(pairConfluence.cells);
          expect(soloPair.result).toEqual(pairConfluence.result);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
