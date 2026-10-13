import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { InMemoryCandleStore } from "../ingestion/types.js";
import type { Candle } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import { DEFAULT_EXECUTION_MODEL } from "../trade-sim/executionModel.js";
import type { LedgerForecast } from "../trade-ledger/buildTradeLedger.js";
import {
  captureFrozenBaseline,
  captureLiveParameterSet,
  type ParameterSet,
} from "./parameterSet.js";
import {
  walkForward,
  type BaselineSelector,
  type DateWindow,
  type ForecastRegenerator,
  type WalkForwardWindow,
} from "./walkForward.js";

// Feature: trader-edge-validation, Property (task 12.1): the freeze.
//
//   (a) a parameter chosen on the in-sample window is provably FROZEN before the
//       OOS window is scored — the regenerator receives EXACTLY the frozen set
//       the selector returned, and the selector never sees the OOS span (R7.1,
//       R7.2);
//   (b) a tuned-against window is marked non-independent (R7.6) and excluded from
//       the pooled-independent headline;
//   (c) the reserved window records usedReservedWindow (R7.5).
//
// Validates: Requirements 7.1, 7.2, 7.6

const PAIR: Pair = "EURUSD";

function candles(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 40; i += 1) {
    const o = 1.1 + 0.002 * i;
    out.push({
      asset: PAIR,
      date: `2024-03-${String(1 + i).padStart(2, "0")}`.slice(0, 10),
      open: o,
      high: o + 0.003,
      low: o - 0.003,
      close: o + 0.0015,
    });
  }
  return out;
}

function storeWith(cs: readonly Candle[]): InMemoryCandleStore {
  const store = new InMemoryCandleStore();
  void store.upsertCandles(cs);
  return store;
}

function window(id: string, reserved = false): WalkForwardWindow {
  return {
    id,
    inSample: { start: "2024-03-01", end: "2024-03-10" },
    outOfSample: { start: "2024-03-11", end: "2024-03-20" },
    reserved,
  };
}

/** A one-forecast regenerator that records the params it was handed per window. */
function recordingRegenerator(recorder: {
  calls: { params: ParameterSet; oos: DateWindow; strategyId: string }[];
}): ForecastRegenerator {
  return (params, outOfSample, strategyId) => {
    recorder.calls.push({ params, oos: outOfSample, strategyId });
    const forecast: LedgerForecast = {
      strategyId,
      pair: PAIR,
      decisionDate: "2024-03-11",
      fired: true,
      direction: "UP",
      horizon: 2,
      earnedConfidence: 0.7,
      stopLossPips: 20,
      takeProfitPips: 40,
    };
    return Promise.resolve([forecast]);
  };
}

describe("Walk-forward freeze (R7.1, R7.2, R7.6)", () => {
  it("(a) the regenerator receives EXACTLY the frozen set the selector returned", async () => {
    const recorder = { calls: [] as { params: ParameterSet; oos: DateWindow; strategyId: string }[] };
    let selectorSawOos = false;

    const selector: BaselineSelector = (inSample, windowId) => {
      // The selector must only ever receive the IN-SAMPLE window.
      if (inSample.start !== "2024-03-01" || inSample.end !== "2024-03-10") {
        selectorSawOos = true;
      }
      return captureFrozenBaseline({ id: `frozen-${windowId}`, now: () => new Date("2024-03-10T00:00:00Z") });
    };

    const report = await walkForward([window("w1"), window("w2")], {
      candleStore: storeWith(candles()),
      executionModel: DEFAULT_EXECUTION_MODEL,
      baselineSelector: selector,
      regenerate: recordingRegenerator(recorder),
    });

    expect(selectorSawOos).toBe(false);
    // Each window's regenerate call used the frozen baseline from its selector,
    // and the result records that exact baseline (R7.2).
    for (const result of report.windows) {
      const call = recorder.calls.find((c) => c.strategyId === result.frozenBaseline.id);
      expect(call).toBeDefined();
      expect(call!.params).toEqual(result.frozenBaseline.params);
      expect(call!.oos).toEqual(result.outOfSample);
    }
    expect(report.windows.map((w) => w.frozenBaseline.id)).toEqual(["frozen-w1", "frozen-w2"]);
  });

  it("(a') the frozen params equal the live set when the default selector is used", async () => {
    const recorder = { calls: [] as { params: ParameterSet; oos: DateWindow; strategyId: string }[] };
    const selector: BaselineSelector = (_inSample, windowId) =>
      captureFrozenBaseline({ id: `frozen-${windowId}` });

    const report = await walkForward([window("w1")], {
      candleStore: storeWith(candles()),
      executionModel: DEFAULT_EXECUTION_MODEL,
      baselineSelector: selector,
      regenerate: recordingRegenerator(recorder),
    });

    expect(report.windows[0]!.frozenBaseline.params).toEqual(captureLiveParameterSet());
  });

  it("(b) a tuned-against window is marked non-independent and excluded from the pooled headline", async () => {
    const recorder = { calls: [] as { params: ParameterSet; oos: DateWindow; strategyId: string }[] };
    const selector: BaselineSelector = (_i, windowId) =>
      captureFrozenBaseline({ id: `frozen-${windowId}` });

    const report = await walkForward([window("tuned"), window("clean")], {
      candleStore: storeWith(candles()),
      executionModel: DEFAULT_EXECUTION_MODEL,
      baselineSelector: selector,
      regenerate: recordingRegenerator(recorder),
      tunedAgainstWindowIds: ["tuned"],
    });

    const tuned = report.windows.find((w) => w.windowId === "tuned")!;
    const clean = report.windows.find((w) => w.windowId === "clean")!;
    expect(tuned.independent).toBe(false);
    expect(clean.independent).toBe(true);

    // Pooled-independent headline reflects ONLY the clean window: one trade.
    expect(report.pooledIndependent.tradeCount).toBe(1);
  });

  it("(c) the reserved window records usedReservedWindow (R7.5)", async () => {
    const recorder = { calls: [] as { params: ParameterSet; oos: DateWindow; strategyId: string }[] };
    const selector: BaselineSelector = (_i, windowId) =>
      captureFrozenBaseline({ id: `frozen-${windowId}` });

    const report = await walkForward([window("w1"), window("reserved", true)], {
      candleStore: storeWith(candles()),
      executionModel: DEFAULT_EXECUTION_MODEL,
      baselineSelector: selector,
      regenerate: recordingRegenerator(recorder),
    });

    expect(report.windows.find((w) => w.windowId === "w1")!.usedReservedWindow).toBe(false);
    expect(report.windows.find((w) => w.windowId === "reserved")!.usedReservedWindow).toBe(true);
  });

  it("is deterministic over arbitrary window orderings", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 5 }),
        async (ids) => {
          const windows = ids.map((n, i) => window(`w${n}-${i}`));
          const selector: BaselineSelector = (_i, windowId) =>
            captureFrozenBaseline({
              id: `frozen-${windowId}`,
              now: () => new Date("2024-03-10T00:00:00Z"),
            });
          const deps = {
            candleStore: storeWith(candles()),
            executionModel: DEFAULT_EXECUTION_MODEL,
            baselineSelector: selector,
            regenerate: recordingRegenerator({ calls: [] }),
          };
          const a = await walkForward(windows, deps);
          const b = await walkForward(windows, {
            ...deps,
            candleStore: storeWith(candles()),
            regenerate: recordingRegenerator({ calls: [] }),
          });
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        },
      ),
      { numRuns: 60 },
    );
  });
});
