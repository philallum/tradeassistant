// Performance guard — buildFoldInputs pre-loads each pair's data ONCE and serves
// per-date retrieval from an in-memory mirror, instead of making a hosted
// round-trip per firing Decision_Date (simplify-to-cloud-minimal, task 8;
// Requirement 9.1).
//
// The OOS evaluation path called `retrieve(...)` once per firing date; each call
// did ~2 hosted PostgREST round-trips (`queryNearest` over-fetch +
// `getMaturedOutcomes`) plus a per-date `getVector`. Across all pairs × all OOS
// trading days that is thousands of sequential round-trips, which exceeded the
// Cloud_Run_Job task timeout. The fix bulk-loads each pair's stored vectors and
// matured outcomes ONCE from the injected (hosted) stores, mirrors them into
// in-memory stores that implement the SAME ports, and serves every per-date
// read from those mirrors.
//
// This file PINS that the round-trip reduction is BEHAVIOURALLY TRANSPARENT:
//
//   1. the injected PatternVectorStore's `getVectorsByAsset` is called AT MOST
//      ONCE per pair, and its per-date reads (`getVector`, `queryNearest`) are
//      NOT called at all during fold construction (the mirror serves them);
//   2. the injected AnalogueStore's `getMaturedOutcomes` is called a BOUNDED
//      number of times per pair (the one superset bulk-load), INDEPENDENT of the
//      number of firing dates — it does NOT grow with the OOS day count;
//   3. the fold inputs produced through the counting (round-trip-collapsing)
//      stores are BYTE-IDENTICAL to those produced by driving the SAME seeded
//      data through plain in-memory stores — i.e. the optimization changes WHERE
//      rows are read, never WHAT is retrieved.
//
// Validates: Requirement 9.1 (research-integrity preserved — behaviour unchanged
// by the data-access optimization).

import { describe, it, expect } from "vitest";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import type {
  PatternVector,
  PatternVectorStore,
  StoredPatternVector,
  WeeklyTrendSign,
} from "../encoder/types.js";
import type { AnalogueRecord, AnalogueStore } from "../retrieval/types.js";
import { addTradingDays } from "../guard/tradingDate.js";
import {
  DEFAULT_WALK_FORWARD_CONFIG,
  GATE1_SAMPLE_SIZE_FLOOR,
} from "../kill-gate/types.js";
import { buildFoldInputs } from "./stagedRunner.js";
import { makeStoredVector, makeTestDeps } from "./testHelpers.js";

const PAIR = "EURUSD" as const;

/** A chronological run of `count` trading days (weekends skipped) from `start`. */
function tradingDays(start: TradingDate, count: number): TradingDate[] {
  const days: TradingDate[] = [];
  let current = addTradingDays(start, 0);
  for (let i = 0; i < count; i += 1) {
    days.push(current);
    current = addTradingDays(current, 1);
  }
  return days;
}

/** A trivially-valid candle on `date` for the pair. */
function candleOn(date: TradingDate): Candle {
  return {
    asset: PAIR,
    date,
    open: 1.1,
    high: 1.11,
    low: 1.09,
    close: 1.105,
    source: "test",
  };
}

/** Per-method call counts for the counting store wrappers. */
interface Counts {
  getVectorsByAsset: number;
  getVector: number;
  queryNearest: number;
  getMaturedOutcomes: number;
}

/**
 * A PatternVectorStore wrapper that delegates to an inner store and counts the
 * methods `buildFoldInputs`/`retrieve` call. It models a hosted adapter: every
 * `getVector`/`queryNearest` here is a per-date hosted round-trip we are trying
 * to eliminate; `getVectorsByAsset` is the ONE bulk read the fix should use.
 */
class CountingVectorStore implements PatternVectorStore {
  constructor(
    private readonly inner: PatternVectorStore,
    private readonly counts: Counts,
  ) {}

  upsertVector(
    asset: Pair,
    decisionDate: TradingDate,
    vector: PatternVector,
  ): Promise<void> {
    return this.inner.upsertVector(asset, decisionDate, vector);
  }

  getVector(
    asset: Pair,
    decisionDate: TradingDate,
  ): Promise<StoredPatternVector | null> {
    this.counts.getVector += 1;
    return this.inner.getVector(asset, decisionDate);
  }

  getVectorsByAsset(asset: Pair): Promise<readonly StoredPatternVector[]> {
    this.counts.getVectorsByAsset += 1;
    return this.inner.getVectorsByAsset(asset);
  }

  queryNearest(
    queryEmbedding: readonly number[],
    weeklyTrendSign: WeeklyTrendSign,
    options?: {
      asset?: Pair;
      excludeDecisionDate?: TradingDate;
      limit?: number;
    },
  ): Promise<readonly { vector: StoredPatternVector; cosineDistance: number }[]> {
    this.counts.queryNearest += 1;
    return this.inner.queryNearest(queryEmbedding, weeklyTrendSign, options);
  }
}

/**
 * An AnalogueStore wrapper that delegates to an inner store and counts
 * `getMaturedOutcomes` — the hosted call the fix bulk-loads ONCE per pair.
 */
class CountingAnalogueStore implements AnalogueStore {
  constructor(
    private readonly inner: AnalogueStore,
    private readonly counts: Counts,
  ) {}

  upsertOutcome(record: AnalogueRecord): Promise<void> {
    return this.inner.upsertOutcome(record);
  }

  getMaturedOutcomes(
    asset: Pair,
    beforeDate: TradingDate,
  ): Promise<readonly AnalogueRecord[]> {
    this.counts.getMaturedOutcomes += 1;
    return this.inner.getMaturedOutcomes(asset, beforeDate);
  }

  getOutcomes(
    asset: Pair,
    decisionDate: TradingDate,
  ): Promise<readonly AnalogueRecord[]> {
    return this.inner.getOutcomes(asset, decisionDate);
  }
}

/**
 * Seed one full default fold's worth of history with a populated test window:
 *   - every stored vector shares one embedding + weeklyTrendSign="UP";
 *   - the entire train window carries matured UP analogues (the retrieved
 *     neighborhood for every test-window date);
 *   - the first `GATE1_SAMPLE_SIZE_FLOOR + 10` test-window dates each get a
 *     stored vector and a matured DOWN realized outcome (the firing dates).
 *
 * This mirrors the leak-guard fixture, so the model fires on many dates and
 * `retrieve` runs per firing date — exactly the per-date hosted round-trips the
 * fix collapses. Returns the number of firing dates seeded.
 */
async function seedFoldFixture(
  vectorStore: PatternVectorStore,
  analogueStore: AnalogueStore,
  candleUpsert: (candles: readonly Candle[]) => Promise<void>,
): Promise<number> {
  const { trainDays, testDays } = DEFAULT_WALK_FORWARD_CONFIG;
  const history = tradingDays("2015-01-01", trainDays + testDays);
  await candleUpsert(history.map(candleOn));

  const trainWindow = history.slice(0, trainDays);
  const testWindow = history.slice(trainDays);

  const upVector = makeStoredVector("UP");

  for (const date of trainWindow) {
    await vectorStore.upsertVector(PAIR, date, upVector);
    await analogueStore.upsertOutcome({
      asset: PAIR,
      decisionDate: date,
      horizon: 1,
      direction: "UP",
      mfePips: 30,
      maePips: 12,
      atr14: 15,
      matured: true,
    });
  }

  const firingDates = testWindow.slice(0, GATE1_SAMPLE_SIZE_FLOOR + 10);
  for (const date of firingDates) {
    await vectorStore.upsertVector(PAIR, date, upVector);
    await analogueStore.upsertOutcome({
      asset: PAIR,
      decisionDate: date,
      horizon: 1,
      direction: "DOWN",
      mfePips: 42,
      maePips: 7,
      atr14: 15,
      matured: true,
    });
  }

  return firingDates.length;
}

describe("buildFoldInputs — per-pair pre-load collapses hosted round-trips (task 8)", () => {
  it("reads each pair's vectors once and does NOT make per-date store calls, while producing identical fold inputs", async () => {
    // --- Deps with COUNTING stores wrapping real in-memory stores. ---------
    const counts: Counts = {
      getVectorsByAsset: 0,
      getVector: 0,
      queryNearest: 0,
      getMaturedOutcomes: 0,
    };
    const deps = makeTestDeps();
    const innerVector = deps.vectorStore;
    const innerAnalogue = deps.analogueStore;

    const firingCount = await seedFoldFixture(
      innerVector,
      innerAnalogue,
      (candles) => deps.candleStore.upsertCandles(candles),
    );
    // Sanity: the fixture seeds many firing dates — enough that per-date
    // round-trips would dwarf a single bulk load.
    expect(firingCount).toBeGreaterThan(GATE1_SAMPLE_SIZE_FLOOR);

    const countingDeps = {
      ...deps,
      vectorStore: new CountingVectorStore(innerVector, counts),
      analogueStore: new CountingAnalogueStore(innerAnalogue, counts),
    };

    const { foldInputs } = await buildFoldInputs(countingDeps);

    // (1) The injected PatternVectorStore is bulk-read AT MOST ONCE per pair
    // (one `getVectorsByAsset` per pair; there are 5 pairs, only one of which
    // has data, but every pair with candles is pre-loaded exactly once). It is
    // NEVER read per-date: `getVector` / `queryNearest` are served by the mirror.
    expect(counts.getVector).toBe(0);
    expect(counts.queryNearest).toBe(0);
    // One bulk read per pair with candles (here exactly one pair has history).
    expect(counts.getVectorsByAsset).toBe(1);

    // (2) The injected AnalogueStore's `getMaturedOutcomes` is called a BOUNDED
    // number of times — ONE superset bulk-load per pair with history — and does
    // NOT scale with the firing-date count. The leaked per-date `retrieve` would
    // have called it `firingCount` additional times.
    expect(counts.getMaturedOutcomes).toBe(1);
    expect(counts.getMaturedOutcomes).toBeLessThan(firingCount);

    // The fold actually fired on every firing date (so retrieval genuinely ran
    // per date, served from the mirror).
    const populated = foldInputs.filter((f) => f.firingSubset.length > 0);
    expect(populated.length).toBe(1);
    expect(populated[0]!.firingSubset.length).toBe(firingCount);

    // --- (3) Reference run through PLAIN in-memory stores (no counting, no
    // mirror indirection in the deps) over the SAME seeded data. The fold
    // inputs must be byte-identical, proving the pre-load serves identical
    // retrieval results. ---------------------------------------------------
    const refDeps = makeTestDeps();
    await seedFoldFixture(
      refDeps.vectorStore,
      refDeps.analogueStore,
      (candles) => refDeps.candleStore.upsertCandles(candles),
    );
    const { foldInputs: refFoldInputs } = await buildFoldInputs(refDeps);

    expect(foldInputs).toStrictEqual(refFoldInputs);
  });

  it("is deterministic: two runs over the same fixture produce identical fold inputs", async () => {
    const depsA = makeTestDeps();
    await seedFoldFixture(
      depsA.vectorStore,
      depsA.analogueStore,
      (candles) => depsA.candleStore.upsertCandles(candles),
    );

    const first = await buildFoldInputs(depsA);
    const second = await buildFoldInputs(depsA);

    expect(first.foldInputs).toStrictEqual(second.foldInputs);
  });
});
