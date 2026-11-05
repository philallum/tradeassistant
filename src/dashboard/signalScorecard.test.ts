// Unit tests for the Signal Scorecard (signal-scorecard feature):
//   - recordPredictions copies every AVAILABLE signal cell's direction into one
//     open row per (decisionDate, pair, strategyId), and skips unavailable cells;
//   - reconcileOutcomes fills the realized side once the next session closes,
//     scoring UP/DOWN calls and leaving FLAT (abstention) unscored;
//   - both are idempotent on the composite key.

import { describe, expect, it } from "vitest";
import type { Candle } from "../guard/types.js";
import { InMemoryCandleStore } from "../ingestion/types.js";
import type {
  CellOutcome,
  ConfluenceMatrix,
  PairConfluence,
} from "../strategies/confluenceMatrix.js";
import type { ConfluenceResult } from "../strategies/confluenceEngine.js";
import { STRATEGY_IDS, type SignalDirection } from "../strategies/types.js";
import {
  InMemorySignalPredictionStore,
  recordPredictions,
  reconcileOutcomes,
} from "./signalScorecard.js";

const RESULT: ConfluenceResult = {
  score: 0,
  status: "NEUTRAL",
  opposingStrategyIds: [],
  signals: [],
};

/** An available cell carrying a direction for the strategy at STRATEGY_IDS[index]. */
function availableCell(index: number, direction: SignalDirection): CellOutcome {
  const strategyId = STRATEGY_IDS[index]!;
  return {
    available: true,
    signal: {
      strategyId,
      direction,
      strength: direction === "FLAT" ? 0 : 0.6,
      rationale: `${strategyId} says ${direction}`,
    },
  };
}

/** An unavailable cell for the strategy at STRATEGY_IDS[index]. */
function unavailableCell(index: number): CellOutcome {
  return { available: false, strategyId: STRATEGY_IDS[index]!, reason: "insufficient_data" };
}

/** A matrix with one pair whose six cells carry the given directions (null = unavailable). */
function matrixWith(
  decisionDate: string,
  directions: readonly (SignalDirection | null)[],
): ConfluenceMatrix {
  const cells = directions.map((d, i) =>
    d === null ? unavailableCell(i) : availableCell(i, d),
  );
  const pair: PairConfluence = { pair: "EURUSD", cells, result: RESULT };
  return { decisionDate, config: {} as never, pairs: [pair] };
}

function candle(date: string, open: number, close: number): Candle {
  return { asset: "EURUSD", date, open, high: Math.max(open, close), low: Math.min(open, close), close };
}

describe("recordPredictions", () => {
  it("writes one open row per available cell, skipping unavailable cells", async () => {
    const store = new InMemorySignalPredictionStore();
    // trend UP, breakout DOWN, range FLAT, reversal unavailable, pattern UP, third_party DOWN
    const matrix = matrixWith("2026-11-05", ["UP", "DOWN", "FLAT", null, "UP", "DOWN"]);

    const rows = await recordPredictions(store, matrix);

    expect(rows).toHaveLength(5); // reversal skipped
    const byStrategy = new Map(rows.map((r) => [r.strategyId, r]));
    expect(byStrategy.get("trend")?.predictedDirection).toBe("UP");
    expect(byStrategy.get("breakout")?.predictedDirection).toBe("DOWN");
    expect(byStrategy.get("range")?.predictedDirection).toBe("FLAT");
    expect(byStrategy.has("reversal")).toBe(false);
    expect(byStrategy.get("custom_pattern")?.predictedDirection).toBe("UP");
    expect(byStrategy.get("third_party")?.predictedDirection).toBe("DOWN");
    // Every recorded row starts open (unreconciled).
    for (const row of rows) {
      expect(row.realizedDirection).toBeNull();
      expect(row.correct).toBeNull();
    }
  });

  it("is idempotent — re-recording the same day replaces rather than duplicates", async () => {
    const store = new InMemorySignalPredictionStore();
    const matrix = matrixWith("2026-11-05", ["UP", "UP", "UP", "UP", "UP", "UP"]);
    await recordPredictions(store, matrix);
    await recordPredictions(store, matrix);
    expect(store.size()).toBe(6);
  });
});

describe("reconcileOutcomes", () => {
  it("fills the realized side and scores UP/DOWN calls once the next session closes", async () => {
    const store = new InMemorySignalPredictionStore();
    const candleStore = new InMemoryCandleStore();
    // The prediction day and its FORWARD session (next day is an UP session).
    await candleStore.upsertCandles([
      candle("2026-11-04", 1.1, 1.1),
      candle("2026-11-05", 1.1, 1.12), // forward session for a 2026-11-04 prediction: UP
    ]);

    // Register on 2026-11-04: trend UP (will be right), breakout DOWN (wrong), range FLAT (abstain).
    await recordPredictions(store, matrixWith("2026-11-04", ["UP", "DOWN", "FLAT", null, null, null]));

    // Reconcile as of 2026-11-05 (the forward candle now exists).
    const updated = await reconcileOutcomes(store, "2026-11-05", candleStore);

    const after = await store.getByDecisionDate("2026-11-04");
    const byStrategy = new Map(after.map((r) => [r.strategyId, r]));
    expect(updated).toHaveLength(3);
    expect(byStrategy.get("trend")).toMatchObject({ realizedDirection: "UP", correct: true });
    expect(byStrategy.get("breakout")).toMatchObject({ realizedDirection: "UP", correct: false });
    // FLAT is an abstention: realized direction recorded, but correct stays null.
    expect(byStrategy.get("range")).toMatchObject({ realizedDirection: "UP", correct: null });
  });

  it("leaves a prediction open when its forward session has not closed yet", async () => {
    const store = new InMemorySignalPredictionStore();
    const candleStore = new InMemoryCandleStore();
    // Only the prediction day exists; no forward candle.
    await candleStore.upsertCandles([candle("2026-11-05", 1.1, 1.1)]);
    await recordPredictions(store, matrixWith("2026-11-05", ["UP", null, null, null, null, null]));

    const updated = await reconcileOutcomes(store, "2026-11-05", candleStore);
    expect(updated).toHaveLength(0);
    const row = (await store.getByDecisionDate("2026-11-05"))[0];
    expect(row?.realizedDirection).toBeNull();
    expect(row?.correct).toBeNull();
  });
});
