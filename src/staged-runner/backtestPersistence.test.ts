// StagedRunner backtest persistence wiring — unit tests (Task 4.3).
//
// Validates: Requirements 2.1, 2.4, 2.5, 2.6
//
// These are deterministic EXAMPLE-BASED unit tests (not property tests). They
// assert the Backtest_Stage wiring added by tasks 4.1 / 4.2:
//
//   Req 2.1 / 2.5 — the stage persists each composed verdict through the
//                   injected GateVerdictStore IN ADDITION to the existing
//                   logGateVerdict Research_Log append (persistence is additive;
//                   the log is preserved).
//   Req 2.4       — a PASS verdict triggers a feature_registry `included` upsert
//                   per admitted feature, carrying the justifying verdictId
//                   returned by the persist report.
//   Req 2.6       — a persist rejection propagates with the affected configId
//                   and is NOT swallowed (the stage does not return { ok: true }).
//
// composeGateVerdict remains the sole verdict producer: the PASS case drives a
// GENUINE PASS through the real composition over seeded in-memory data; nothing
// stubs or re-implements composeGateVerdict.

import { describe, it, expect, vi } from "vitest";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type { FeatureId } from "../feature-registry/types.js";
import type { AnalogueRecord } from "../retrieval/types.js";
import { LIVING_DOCS } from "../living-docs/livingDocs.js";
import {
  InMemoryGateVerdictStore,
  type GateVerdict,
  type GateVerdictSplit,
  type GateVerdictStore,
  type PersistVerdictReport,
} from "../kill-gate/types.js";
import { SupabaseRestError } from "../storage/supabase/client.js";
import * as killGateVerdict from "../kill-gate/verdict.js";
import { backtest } from "./stagedRunner.js";
import { makeTestDeps, makeStoredVector } from "./testHelpers.js";

// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

/**
 * Generate `count` distinct `YYYY-MM-DD` dates starting at 2010-01-01. These
 * are used only as opaque, chronologically-ordered trading-date keys; the
 * walk-forward construction de-duplicates and sorts them, and the in-memory
 * stores sort lexicographically (which matches ISO date ordering).
 */
function sequentialDates(count: number): TradingDate[] {
  const dates: TradingDate[] = [];
  const start = Date.UTC(2010, 0, 1);
  for (let i = 0; i < count; i++) {
    dates.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

/** Build a well-formed Candle for a pair/date (OHLC invariant satisfied). */
function makeCandle(pair: Pair, date: TradingDate): Candle {
  return {
    asset: pair,
    date,
    open: 1.1,
    high: 1.12,
    low: 1.09,
    close: 1.105,
    source: "csv",
  };
}

/** Seed `count` candles directly into the in-memory candle store. */
async function seedCandles(
  deps: ReturnType<typeof makeTestDeps>,
  pair: Pair,
  dates: readonly TradingDate[],
): Promise<void> {
  await deps.candleStore.upsertCandles(dates.map((d) => makeCandle(pair, d)));
}

/**
 * Seed one matured analogue outcome plus a backing pattern vector for a
 * decision date. The vector's `weeklyTrendSign` drives the Weekly_Trend_Follow
 * baseline prediction the Backtest_Stage derives (UP → baseline "UP").
 */
async function seedMaturedWithVector(
  deps: ReturnType<typeof makeTestDeps>,
  pair: Pair,
  date: TradingDate,
  direction: "UP" | "DOWN",
): Promise<void> {
  const record: AnalogueRecord = {
    asset: pair,
    decisionDate: date,
    horizon: 1,
    direction,
    mfePips: 30,
    maePips: 10,
    atr14: 15,
    matured: true,
  };
  await deps.analogueStore.upsertOutcome(record);
  // Weekly-trend baseline predicts "UP" (sign UP) — opposite the DOWN outcome,
  // so the baseline is wrong on every seeded firing date.
  await deps.vectorStore.upsertVector(pair, date, makeStoredVector("UP"));
}

// ---------------------------------------------------------------------------
// Req 2.1 / 2.5 — additive persistence beside the Research_Log append
// ---------------------------------------------------------------------------

describe("backtest persists through the GateVerdictStore IN ADDITION to logGateVerdict (Req 2.1, 2.5)", () => {
  it("writes the Research_Log entry AND the persisted verdict (both side effects observed)", async () => {
    const deps = makeTestDeps();
    // Seed a full walk-forward fold's worth of history so a GateVerdictSplit is
    // derived and the stage actually reaches the persist call. No matured
    // outcomes are seeded, so the composed verdict is a CUT — irrelevant here;
    // we are asserting that BOTH side effects (persist + log) occur.
    const dates = sequentialDates(1008);
    await seedCandles(deps, "EURUSD", dates);
    await deps.vectorStore.upsertVector(
      "EURUSD",
      dates[0]!,
      makeStoredVector("UP"),
    );

    const persistSpy = vi.spyOn(killGateVerdict, "persistGateVerdict");
    const logSpy = vi.spyOn(killGateVerdict, "logGateVerdict");

    // Nothing persisted or logged before the stage runs.
    expect(deps.docStore.peek(LIVING_DOCS.researchLog)).toBeNull();
    expect(await deps.gateVerdictStore.getVerdict("verdict-1")).toBeNull();

    const result = await backtest(deps);
    expect(result.ok).toBe(true);

    // Both the additive persist AND the preserved Research_Log append ran.
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy.mock.calls[0]?.[0]).toBe(deps.gateVerdictStore);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toBe(deps.docs);

    // Research_Log side effect: the doc store now carries the verdict entry.
    const log = deps.docStore.peek(LIVING_DOCS.researchLog);
    expect(log).not.toBeNull();
    expect(log).toContain(deps.configId);

    // Persistence side effect: the GateVerdictStore now holds the verdict.
    const persisted = await deps.gateVerdictStore.getVerdict("verdict-1");
    expect(persisted).not.toBeNull();
    expect(persisted?.verdict.configId).toBe(deps.configId);

    persistSpy.mockRestore();
    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Req 2.4 — a PASS verdict triggers an `included` feature_registry upsert
// carrying the justifying verdictId.
// ---------------------------------------------------------------------------

describe("a PASS verdict upserts included feature_registry rows with the justifying verdictId (Req 2.4)", () => {
  it("records each admitted feature as included with the persist report's verdictId", async () => {
    const deps = makeTestDeps();
    const admittedFeatures: FeatureId[] = ["%B", "RSI"];
    const depsWithFeatures = { ...deps, admittedFeatures };

    // Seed a full walk-forward fold's worth of history (756 train + 252 test).
    const dates = sequentialDates(1008);
    await seedCandles(deps, "EURUSD", dates);

    // The first fold's test window is dates[756..1007]. getMaturedOutcomes uses
    // a STRICT `< testEnd`, so seed 30 matured outcomes safely inside the test
    // window (indices 760..789). Each outcome is DOWN while its vector's weekly
    // trend is UP → the model (which predicts the actual outcome) is 100%
    // correct and the Weekly_Trend_Follow baseline is 0% correct, clearing the
    // Gate 1 ≥3pp margin on a ≥30-sample subset; identical model/baseline
    // excursions clear Gate 2 (margin 0 ≥ 0). A GENUINE PASS, composed entirely
    // by the real composeGateVerdict.
    for (let i = 760; i < 790; i++) {
      await seedMaturedWithVector(deps, "EURUSD", dates[i]!, "DOWN");
    }

    const result = await backtest(depsWithFeatures);
    expect(result.ok).toBe(true);

    // The genuinely-composed verdict is a PASS and was persisted as verdict-1.
    const persisted = await deps.gateVerdictStore.getVerdict("verdict-1");
    expect(persisted).not.toBeNull();
    expect(persisted?.verdict.verdict).toBe("PASS");

    // Each admitted feature is now an `included` row carrying that verdictId.
    for (const featureId of admittedFeatures) {
      const row = await deps.featureRegistryStore.get(featureId);
      expect(row).not.toBeNull();
      expect(row?.status).toBe("included");
      expect(row?.verdictId).toBe("verdict-1");
    }

    // No non-admitted feature was touched.
    const all = await deps.featureRegistryStore.all();
    expect(all.map((r) => r.featureId).sort()).toEqual(["%B", "RSI"]);
  });

  it("upserts nothing when a PASS is composed but no features are admitted (no-op)", async () => {
    const deps = makeTestDeps(); // admittedFeatures undefined

    const dates = sequentialDates(1008);
    await seedCandles(deps, "EURUSD", dates);
    for (let i = 760; i < 790; i++) {
      await seedMaturedWithVector(deps, "EURUSD", dates[i]!, "DOWN");
    }

    const result = await backtest(deps);
    expect(result.ok).toBe(true);

    // PASS was composed and persisted...
    const persisted = await deps.gateVerdictStore.getVerdict("verdict-1");
    expect(persisted?.verdict.verdict).toBe("PASS");
    // ...but with no admitted features the registry is left empty.
    expect(await deps.featureRegistryStore.all()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Req 2.6 — a persist rejection propagates with the configId and is not swallowed.
// ---------------------------------------------------------------------------

describe("a persist rejection propagates with the configId and is not swallowed (Req 2.6)", () => {
  /**
   * Build a backtest deps whose GateVerdictStore.persistVerdict always rejects,
   * seeded with just enough data for the stage to compose a verdict and reach
   * the persist call. The featureRegistryStore records any upsert so we can
   * assert the PASS→included path never ran after the failure.
   */
  function makeRejectingDeps(error: Error) {
    const deps = makeTestDeps();
    const rejectingStore: GateVerdictStore = {
      persistVerdict: (
        verdict: GateVerdict,
        split: GateVerdictSplit,
      ): Promise<PersistVerdictReport> => {
        // The verdict/split are intentionally unused — this stub exists only to
        // reject, so the Backtest_Stage's failure-surfacing path is exercised.
        void verdict;
        void split;
        return Promise.reject(error);
      },
      getVerdict: () => Promise.resolve(null),
    };
    return { ...deps, gateVerdictStore: rejectingStore };
  }

  /**
   * Seed just enough history for the Backtest_Stage to construct at least one
   * walk-forward fold (so a GateVerdictSplit is derived and the persist call is
   * actually reached). A single stored vector satisfies the stage prerequisite;
   * no matured outcomes are needed — the composed verdict's PASS/CUT value is
   * irrelevant to the failure-surfacing assertion, only that persistVerdict runs.
   */
  async function seedFoldHistory(
    deps: ReturnType<typeof makeRejectingDeps>,
  ): Promise<void> {
    const dates = sequentialDates(1008);
    await deps.candleStore.upsertCandles(
      dates.map((d) => makeCandle("EURUSD", d)),
    );
    await deps.vectorStore.upsertVector(
      "EURUSD",
      dates[0]!,
      makeStoredVector("UP"),
    );
  }

  it("rejects with a SupabaseRestError whose message names the configId (not { ok: true })", async () => {
    const deps = makeRejectingDeps(
      new SupabaseRestError("insert failed", 500, "gate_verdicts"),
    );
    await seedFoldHistory(deps);

    // The stage must REJECT — it must NOT resolve to { ok: true } as though the
    // verdict were recorded.
    await expect(backtest(deps)).rejects.toThrow(SupabaseRestError);
    await expect(backtest(deps)).rejects.toThrow(
      new RegExp(`config_id=${deps.configId}`),
    );
  });

  it("rejects with an Error naming the configId when a plain error is thrown", async () => {
    const deps = makeRejectingDeps(new Error("network down"));
    await seedFoldHistory(deps);

    await expect(backtest(deps)).rejects.toThrow(
      new RegExp(`config_id=${deps.configId}`),
    );
  });

  it("does not perform a feature_registry upsert when persistence fails on a PASS", async () => {
    // Seed a genuine PASS so the (unreached) PASS→included branch would fire if
    // the failure were swallowed. Admit a feature and inject a rejecting store.
    const base = makeTestDeps();
    const rejectingStore = new InMemoryGateVerdictStore();
    vi.spyOn(rejectingStore, "persistVerdict").mockRejectedValue(
      new SupabaseRestError("insert failed", 500, "gate_verdicts"),
    );
    const upsertSpy = vi.spyOn(base.featureRegistryStore, "upsert");

    const deps = {
      ...base,
      gateVerdictStore: rejectingStore,
      admittedFeatures: ["%B"] as FeatureId[],
    };

    const dates = sequentialDates(1008);
    await base.candleStore.upsertCandles(
      dates.map((d) => makeCandle("EURUSD", d)),
    );
    for (let i = 760; i < 790; i++) {
      const record: AnalogueRecord = {
        asset: "EURUSD",
        decisionDate: dates[i]!,
        horizon: 1,
        direction: "DOWN",
        mfePips: 30,
        maePips: 10,
        atr14: 15,
        matured: true,
      };
      await base.analogueStore.upsertOutcome(record);
      await base.vectorStore.upsertVector(
        "EURUSD",
        dates[i]!,
        makeStoredVector("UP"),
      );
    }

    await expect(backtest(deps)).rejects.toThrow(
      new RegExp(`config_id=${deps.configId}`),
    );
    // The included upsert must NOT have run — the failure was surfaced, not
    // swallowed, so the stage never proceeded as though the verdict recorded.
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(await base.featureRegistryStore.all()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Req 2.1 / 2.5 — multi-pair runs produce GLOBALLY-UNIQUE fold indices so the
// persisted (verdict_id, fold_index) rows never collide on the PK.
//
// `walkForwardFolds` restarts its per-pair `fold.foldIndex` at 0,1,2… for every
// pair. If the Backtest_Stage reused that raw index when building the aggregate
// verdict's foldInputs, two pairs' fold 0 would share foldIndex 0 → the composed
// verdict's foldVerdicts would carry DUPLICATE foldIndex values → the Supabase
// (verdict_id, fold_index) PK insert for the second fold row would collide.
//
// These tests seed enough history across MORE THAN ONE pair to construct folds
// for each, then assert the GENUINELY-composed verdict's foldVerdicts carry
// unique foldIndex values (so persistVerdict would never collide), and that the
// persisted fold-row count equals the fold count (one distinct row per fold).
// composeGateVerdict remains the sole verdict producer — nothing stubs it.
// ---------------------------------------------------------------------------

describe("multi-pair runs produce globally-unique fold indices (Req 2.1, 2.5)", () => {
  it("the composed verdict's foldVerdicts have unique foldIndex across pairs", async () => {
    const deps = makeTestDeps();

    // Seed a full walk-forward fold's worth of history for TWO pairs. Each pair
    // on its own yields at least one fold whose per-pair foldIndex starts at 0;
    // without the global-index fix both folds would carry foldIndex 0.
    const dates = sequentialDates(1008);
    await seedCandles(deps, "EURUSD", dates);
    await seedCandles(deps, "GBPUSD", dates);
    await deps.vectorStore.upsertVector(
      "EURUSD",
      dates[0]!,
      makeStoredVector("UP"),
    );
    await deps.vectorStore.upsertVector(
      "GBPUSD",
      dates[0]!,
      makeStoredVector("UP"),
    );

    // Capture the composed verdict handed to persistGateVerdict — this is the
    // GENUINE output of the real composeGateVerdict (nothing stubs it); the spy
    // only observes the argument it is called with.
    const persistSpy = vi.spyOn(killGateVerdict, "persistGateVerdict");

    const result = await backtest(deps);
    expect(result.ok).toBe(true);

    expect(persistSpy).toHaveBeenCalledTimes(1);
    const verdict = persistSpy.mock.calls[0]?.[1] as GateVerdict;
    expect(verdict).toBeDefined();

    // More than one fold was constructed (two pairs' worth) and every fold has
    // a DISTINCT foldIndex — so the (verdict_id, fold_index) PK never collides.
    const indices = verdict.foldVerdicts.map((f) => f.foldIndex);
    expect(indices.length).toBeGreaterThan(1);
    expect(new Set(indices).size).toBe(indices.length);

    persistSpy.mockRestore();
  });

  it("persists one distinct gate_fold_verdicts row per fold (no PK collision)", async () => {
    const deps = makeTestDeps();

    const dates = sequentialDates(1008);
    await seedCandles(deps, "EURUSD", dates);
    await seedCandles(deps, "GBPUSD", dates);
    await deps.vectorStore.upsertVector(
      "EURUSD",
      dates[0]!,
      makeStoredVector("UP"),
    );
    await deps.vectorStore.upsertVector(
      "GBPUSD",
      dates[0]!,
      makeStoredVector("UP"),
    );

    const result = await backtest(deps);
    expect(result.ok).toBe(true);

    // The persisted verdict's fold rows equal the composed fold count, and the
    // read-back verdict carries a distinct foldIndex per fold row — mirroring
    // the (verdict_id, fold_index) uniqueness the Supabase PK requires.
    const persisted = await deps.gateVerdictStore.getVerdict("verdict-1");
    expect(persisted).not.toBeNull();
    const foldIndices = persisted!.verdict.foldVerdicts.map((f) => f.foldIndex);
    expect(foldIndices.length).toBeGreaterThan(1);
    expect(new Set(foldIndices).size).toBe(foldIndices.length);
  });
});
