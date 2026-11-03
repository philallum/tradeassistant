// Tests for the v4 snapshot evidence slices (trader-edge-validation task 15;
// R10.1-10.3, R8.1, R9.1): v4 shape, empty defaults, and fail-safe degrade.
import { describe, expect, it } from "vitest";
import type { Confidence } from "../confidence/types.js";
import { dailyRun, type PairEvaluation } from "../dashboard/index.js";
import { InMemoryCandleStore } from "../ingestion/types.js";
import { InMemoryTradeLedgerStore, type TradeLedgerRow, type TradeLedgerStore } from "../trade-ledger/types.js";
import { buildEdgeSlices, deriveValidationStatus } from "./edgeSlices.js";
import {
  buildDashboardSnapshot,
  SNAPSHOT_SCHEMA_VERSION,
  serializeSnapshot,
} from "./snapshot.js";

const NOW = new Date("2024-03-15T21:00:00.000Z");

function evaluation(pair: "EURUSD" | "GBPUSD"): PairEvaluation {
  return {
    pair,
    earnedConfidence: 0.9 as Confidence,
    direction: "UP",
    horizon: 2,
    excursionProfile: { favorablePips: 40, adversePips: 15 },
    stopLossPips: 15,
    takeProfitPips: 40,
    choppiness: 0.8,
    rationale: "r",
    analogueLabels: [],
  };
}

function ledgerRow(strategyId: string, day: number, netPips: number): TradeLedgerRow {
  return {
    strategyId,
    pair: "EURUSD",
    decisionDate: `2024-03-${String(day).padStart(2, "0")}`,
    fired: true,
    direction: "UP",
    horizon: 2,
    earnedConfidence: 0.7,
    entryPrice: 1.1,
    entryDate: `2024-03-${String(day + 1).padStart(2, "0")}`,
    stopLossPips: 15,
    takeProfitPips: 30,
    outcome: netPips > 0 ? "target_first" : "stop_first",
    grossPips: netPips,
    costPips: 0,
    netPips,
    rMultiple: netPips / 15,
  };
}

const view = dailyRun("2024-03-15", [evaluation("EURUSD"), evaluation("GBPUSD")]);

describe("snapshot v4 shape + defaults", () => {
  it("is schema v4 and defaults every new slice to empty/absent", () => {
    const snap = buildDashboardSnapshot(view, undefined, {}, NOW);
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(5);
    expect(snap.schemaVersion).toBe(5);
    expect(snap.tradeLedgerSummary).toEqual({ window: null, strategies: [] });
    expect(snap.calibration).toEqual({ bands: [], monotonic: null, wellCalibrated: null });
    expect(snap.exposure).toEqual({ perCurrency: [], concentrated: false, strongestPair: null });
    expect(snap.provenance).toEqual([]);
    expect(snap.validationStatus).toEqual([]);
    expect(typeof serializeSnapshot(snap)).toBe("string");
  });
});

describe("buildEdgeSlices", () => {
  it("populates ledger summaries, calibration, exposure, and validation from artifacts", async () => {
    const ledger = new InMemoryTradeLedgerStore([
      ledgerRow("system", 4, 20),
      ledgerRow("system", 5, 10),
      ledgerRow("trend", 4, -5),
      ledgerRow("trend", 5, -5),
    ]);
    const slices = await buildEdgeSlices({
      view,
      evaluations: [evaluation("EURUSD")],
      ledgerStore: ledger,
      candleStore: new InMemoryCandleStore(),
      now: NOW,
    });
    expect(slices.tradeLedgerSummary?.strategies.map((s) => [s.role, s.summary.strategyId])).toEqual([
      ["system", "system"],
      ["comparator", "trend"],
    ]);
    expect(slices.calibration?.bands.length).toBeGreaterThan(0);
    expect(slices.exposure?.perCurrency.length).toBeGreaterThan(0);
    expect(slices.provenance).toHaveLength(1);
    expect(slices.provenance?.[0]?.computedAt).toBe(NOW.toISOString());
    expect(slices.validationStatus).toEqual([
      { decision_date: "2024-03-15", pair: "EURUSD", status: "validated" },
    ]);
  });

  it("is unvalidated with an empty ledger", async () => {
    const slices = await buildEdgeSlices({
      view,
      evaluations: [evaluation("EURUSD")],
      ledgerStore: new InMemoryTradeLedgerStore(),
    });
    expect(slices.tradeLedgerSummary?.strategies).toEqual([]);
    expect(slices.validationStatus?.[0]?.status).toBe("unvalidated");
  });

  it("degrades a failing ledger and provenance to empty (fail-safe) and still builds a snapshot", async () => {
    const warnings: string[] = [];
    const boom: TradeLedgerStore = {
      appendRows: () => Promise.reject(new Error("x")),
      getByWindow: () => Promise.reject(new Error("ledger down")),
    };
    const badCandles = {
      getCoverageSummary: () => Promise.reject(new Error("candles down")),
    } as unknown as InMemoryCandleStore;
    const slices = await buildEdgeSlices({
      view,
      evaluations: [evaluation("EURUSD")],
      ledgerStore: boom,
      candleStore: badCandles,
      warn: (slice) => warnings.push(slice),
    });
    expect(warnings).toEqual(["tradeLedgerSummary", "provenance"]);
    expect(slices.tradeLedgerSummary).toEqual({ window: null, strategies: [] });
    expect(slices.calibration?.bands).toEqual([]);
    expect(slices.provenance).toEqual([]);
    const snap = buildDashboardSnapshot(view, undefined, {}, NOW, [], slices);
    expect(snap.firingSetups).toHaveLength(2);
    expect(snap.exposure.concentrated).toBe(true);
  });

  it("marks a system that does not beat a comparator as unvalidated", () => {
    const row = (role: "system" | "comparator", id: string, net: number) => ({
      role,
      summary: {
        strategyId: id, netExpectancyPips: net, netExpectancyR: 0, grossExpectancyPips: net,
        winRate: 0, avgWinPips: 0, avgLossPips: 0, profitFactor: null, maxDrawdownPips: 0,
        longestLosingStreak: 0, tradeCount: 5, timeInMarketDays: 0, ambiguousShare: 0, expiredShare: 0,
      },
    });
    expect(
      deriveValidationStatus({ window: null, strategies: [row("system", "system", 5), row("comparator", "t", 8)] }),
    ).toBe("unvalidated");
  });
});
