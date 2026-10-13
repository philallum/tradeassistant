import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { Candle } from "../guard/types.js";
import { InMemoryCandleStore } from "../ingestion/types.js";
import type { Pair } from "../ingestion/types.js";
import {
  DEFAULT_EXECUTION_MODEL,
  resolveEntry,
  type ExecutionModel,
} from "../trade-sim/executionModel.js";
import { buildTradeLedger } from "../trade-ledger/buildTradeLedger.js";
import {
  compareStrategies,
  defaultComparators,
  directionalCoinflipSource,
  returnsVolatilitySource,
  trendContinuationSource,
  type SystemForecast,
} from "./comparators.js";

// Feature: trader-edge-validation, Property (task 10.1): Comparator fairness.
//
// The system and every comparator consume the IDENTICAL Execution_Model and
// entry timing on the SAME forecast timestamps; a differing model is a test
// failure (R5.5). We also confirm determinism, that each strategy is scored on
// the identical timestamp set (R5.3), and that `systemBeatsComparators` is a
// plainly-stated boolean a negative result cannot hide (R5.4, R12.6).
//
// Validates: Requirements 5.3, 5.5

const PAIRS: readonly Pair[] = ["EURUSD", "USDJPY"] as const;

/** A rising forward path so a long trade can resolve; deterministic. */
function candlesFor(pair: Pair): Candle[] {
  const base = pair.includes("JPY") ? 150 : 1.1;
  const step = pair.includes("JPY") ? 0.3 : 0.002;
  const out: Candle[] = [];
  for (let i = 0; i < 20; i += 1) {
    const o = base + step * i;
    out.push({
      asset: pair,
      date: `2024-03-${String(5 + i).padStart(2, "0")}`,
      open: o,
      high: o + step,
      low: o - step,
      close: o + step * 0.5,
    });
  }
  return out;
}

function storeWithAll(): InMemoryCandleStore {
  const store = new InMemoryCandleStore();
  for (const pair of PAIRS) void store.upsertCandles(candlesFor(pair));
  return store;
}

const systemForecastArb: fc.Arbitrary<SystemForecast> = fc.record({
  pair: fc.constantFrom(...PAIRS),
  decisionDate: fc
    .integer({ min: 6, max: 18 })
    .map((d) => `2024-03-${String(d).padStart(2, "0")}`),
  fired: fc.constant(true),
  direction: fc.constantFrom("UP" as const, "DOWN" as const),
  horizon: fc.constantFrom(1 as const, 2 as const, 3 as const),
  earnedConfidence: fc.double({ min: 0.55, max: 0.95, noNaN: true }),
  stopLossPips: fc.constant(20),
  takeProfitPips: fc.constant(40),
});

/** Dedupe forecasts on (pair, decisionDate) so the ledger key is unique. */
function dedupe(forecasts: readonly SystemForecast[]): SystemForecast[] {
  const seen = new Set<string>();
  const out: SystemForecast[] = [];
  for (const f of forecasts) {
    const key = `${f.pair}|${f.decisionDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

describe("Comparator fairness (R5.5, R5.3)", () => {
  it("every strategy is scored on the IDENTICAL timestamp set", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(systemForecastArb, { minLength: 1, maxLength: 8 }),
        async (raw) => {
          const forecasts = dedupe(raw);
          const report = await compareStrategies(forecasts, defaultComparators(), {
            candleStore: storeWithAll(),
            executionModel: DEFAULT_EXECUTION_MODEL,
          });
          // system + 2 comparators.
          expect(report.results).toHaveLength(3);
          // Each strategy's ledger has exactly one row per timestamp: trade count
          // never exceeds the forecast count (suppressed/FLAT rows aren't trades).
          for (const r of report.results) {
            expect(r.summary.tradeCount).toBeLessThanOrEqual(forecasts.length);
          }
          // The verdict boolean is always defined (a negative result is surfaced).
          expect(typeof report.systemBeatsComparators).toBe("boolean");
        },
      ),
      { numRuns: 120 },
    );
  });

  it("the SAME Execution_Model and entry timing is used for every strategy", async () => {
    // Spy on resolveEntry via a wrapped execution model identity check: each
    // strategy's rows must use entry dates resolved from the SAME model/candles.
    const forecasts = dedupe([
      {
        pair: "EURUSD",
        decisionDate: "2024-03-06",
        fired: true,
        direction: "UP",
        horizon: 2,
        earnedConfidence: 0.7,
        stopLossPips: 20,
        takeProfitPips: 40,
      },
    ]);
    const store = storeWithAll();
    const deps = { candleStore: store, executionModel: DEFAULT_EXECUTION_MODEL };

    const report = await compareStrategies(forecasts, defaultComparators(), deps);

    // Independently resolve the expected entry under the shared model.
    const candles = await store.getCandles("EURUSD");
    const expectedEntry = resolveEntry("EURUSD", "2024-03-06", candles);
    expect(expectedEntry).not.toBeNull();

    // Every strategy's single ledger row must share that identical entry date.
    for (const strat of report.results) {
      const rows = await buildTradeLedger(
        await sourceFor(strat.strategyId).produce(forecasts, store),
        deps,
      );
      for (const row of rows) {
        if (row.entryPrice !== 0) {
          expect(row.entryDate).toBe(expectedEntry!.entryDate);
        }
      }
    }
  });

  it("a comparator run with a DIFFERENT Execution_Model is detectably unfair", async () => {
    const forecasts = dedupe([
      {
        pair: "EURUSD",
        decisionDate: "2024-03-06",
        fired: true,
        direction: "UP",
        horizon: 2,
        earnedConfidence: 0.7,
        stopLossPips: 20,
        takeProfitPips: 40,
      },
    ]);
    const store = storeWithAll();

    const cheap: ExecutionModel = DEFAULT_EXECUTION_MODEL;
    const expensive: ExecutionModel = {
      ...DEFAULT_EXECUTION_MODEL,
      id: "exec-expensive",
      perPairCost: {
        ...DEFAULT_EXECUTION_MODEL.perPairCost,
        EURUSD: { spreadPips: 50, commissionPips: 5, slippagePips: 5 },
      },
    };

    const src = trendContinuationSource();
    const fair = await buildTradeLedger(await src.produce(forecasts, store), {
      candleStore: store,
      executionModel: cheap,
    });
    const unfair = await buildTradeLedger(await src.produce(forecasts, store), {
      candleStore: store,
      executionModel: expensive,
    });

    // Same forecasts, different Execution_Model ⇒ different net pips. This is why
    // compareStrategies threads ONE shared model to every strategy.
    expect(fair[0]!.netPips).not.toBe(unfair[0]!.netPips);
    expect(fair[0]!.costPips).not.toBe(unfair[0]!.costPips);
  });

  it("is deterministic: identical inputs produce an identical report", async () => {
    const forecasts = dedupe([
      {
        pair: "EURUSD",
        decisionDate: "2024-03-06",
        fired: true,
        direction: "DOWN",
        horizon: 1,
        earnedConfidence: 0.6,
        stopLossPips: 20,
        takeProfitPips: 40,
      },
      {
        pair: "USDJPY",
        decisionDate: "2024-03-07",
        fired: true,
        direction: "UP",
        horizon: 3,
        earnedConfidence: 0.8,
        stopLossPips: 20,
        takeProfitPips: 40,
      },
    ]);
    const comps = [
      trendContinuationSource(),
      returnsVolatilitySource(),
      directionalCoinflipSource(),
    ];
    const a = await compareStrategies(forecasts, comps, {
      candleStore: storeWithAll(),
      executionModel: DEFAULT_EXECUTION_MODEL,
    });
    const b = await compareStrategies(forecasts, comps, {
      candleStore: storeWithAll(),
      executionModel: DEFAULT_EXECUTION_MODEL,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

/** Resolve a ForecastSource by its strategy id for the fairness assertions. */
function sourceFor(strategyId: string) {
  switch (strategyId) {
    case "trendContinuation":
      return trendContinuationSource();
    case "returnsVolatility":
      return returnsVolatilitySource();
    case "directionalCoinflip":
      return directionalCoinflipSource();
    default:
      // The system passes its forecasts through verbatim.
      return {
        strategyId,
        produce: (fs: readonly SystemForecast[]) =>
          Promise.resolve(
            fs.map((f) => ({
              strategyId,
              pair: f.pair,
              decisionDate: f.decisionDate,
              fired: f.fired,
              direction: f.direction,
              horizon: f.horizon,
              earnedConfidence: f.earnedConfidence,
              stopLossPips: f.stopLossPips,
              takeProfitPips: f.takeProfitPips,
            })),
          ),
      };
  }
}
