import { describe, expect, it, vi } from "vitest";

import {
  InMemorySignalPredictionStore,
  type SignalPredictionStore,
} from "../dashboard/signalScorecard.js";
import { InMemoryCandleStore } from "../ingestion/types.js";
import type { ConfluenceResult } from "../strategies/confluenceEngine.js";
import type {
  CellOutcome,
  ConfluenceMatrix,
  PairConfluence,
} from "../strategies/confluenceMatrix.js";
import { STRATEGY_IDS, type SignalDirection } from "../strategies/types.js";
import type { RunMatrix } from "./confluenceSlice.js";
import { runSignalScorecardStep } from "./signalScorecardStep.js";

// The Signal Scorecard step records the per-signal directions from the SHARED per-run matrix.
// It must (a) record all six signals on a normal (live) run, (b) withhold ONLY the live-only
// `third_party` signal on a replayed Decision_Date and say so, (c) record nothing when the
// matrix could not be built, and (d) never throw.

const DECISION_DATE = "2026-11-05";
const RESULT: ConfluenceResult = { score: 0, status: "NEUTRAL", opposingStrategyIds: [], signals: [] };

function cell(index: number, direction: SignalDirection): CellOutcome {
  const strategyId = STRATEGY_IDS[index]!;
  return {
    available: true,
    signal: { strategyId, direction, strength: 0.6, rationale: `${strategyId} ${direction}` },
  };
}

function runMatrix(): RunMatrix {
  const pair: PairConfluence = {
    pair: "EURUSD",
    cells: STRATEGY_IDS.map((_, i) => cell(i, i % 2 === 0 ? "UP" : "DOWN")),
    result: RESULT,
  };
  const matrix: ConfluenceMatrix = { decisionDate: DECISION_DATE, config: {} as never, pairs: [pair] };
  return { matrix, failedPairs: new Set() };
}

async function recorded(store: InMemorySignalPredictionStore): Promise<string[]> {
  const rows = await store.getAll();
  return rows.map((r) => r.strategyId).sort();
}

describe("runSignalScorecardStep", () => {
  it("records all six signals by default (a normal, live run)", async () => {
    const store = new InMemorySignalPredictionStore();

    await runSignalScorecardStep({
      decisionDate: DECISION_DATE,
      store,
      candleStore: new InMemoryCandleStore(),
      run: runMatrix(),
    });

    expect(await recorded(store)).toEqual([...STRATEGY_IDS].sort());
  });

  it("withholds ONLY third_party on a replayed date, and reports it once", async () => {
    const store = new InMemorySignalPredictionStore();
    const skipped = vi.fn();

    await runSignalScorecardStep({
      decisionDate: DECISION_DATE,
      store,
      candleStore: new InMemoryCandleStore(),
      run: runMatrix(),
      recordThirdParty: false,
      onThirdPartySkipped: skipped,
    });

    const expected = STRATEGY_IDS.filter((id) => id !== "third_party").sort();
    expect(await recorded(store)).toEqual(expected);
    expect(skipped).toHaveBeenCalledTimes(1);
    expect(skipped).toHaveBeenCalledWith(DECISION_DATE);
  });

  it("does not report a skip on a normal run", async () => {
    const skipped = vi.fn();

    await runSignalScorecardStep({
      decisionDate: DECISION_DATE,
      store: new InMemorySignalPredictionStore(),
      candleStore: new InMemoryCandleStore(),
      run: runMatrix(),
      recordThirdParty: true,
      onThirdPartySkipped: skipped,
    });

    expect(skipped).not.toHaveBeenCalled();
  });

  it("records nothing and warns when the shared matrix could not be built", async () => {
    const store = new InMemorySignalPredictionStore();
    const warnings: string[] = [];

    await runSignalScorecardStep({
      decisionDate: DECISION_DATE,
      store,
      candleStore: new InMemoryCandleStore(),
      run: null,
      warn: (step) => warnings.push(step),
    });

    expect(store.size()).toBe(0);
    expect(warnings).toEqual(["record"]);
  });

  it("never throws: a failing store is warned and swallowed, and reconcile failure does not block recording", async () => {
    const real = new InMemorySignalPredictionStore();
    const failingReads: SignalPredictionStore = {
      upsert: (rows) => real.upsert(rows),
      getByDecisionDate: (date) => real.getByDecisionDate(date),
      getOpen: () => Promise.reject(new Error("read failed")),
      getAll: (from, to) => real.getAll(from, to),
    };
    const warnings: string[] = [];

    await expect(
      runSignalScorecardStep({
        decisionDate: DECISION_DATE,
        store: failingReads,
        candleStore: new InMemoryCandleStore(),
        run: runMatrix(),
        warn: (step) => warnings.push(step),
      }),
    ).resolves.toBeUndefined();

    // Reconcile failed (and was reported), but today's directions were still recorded.
    expect(warnings).toContain("reconcile");
    expect(await recorded(real)).toEqual([...STRATEGY_IDS].sort());
  });
});
