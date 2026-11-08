import { describe, expect, it, vi } from "vitest";

import type { Candle } from "../guard/types.js";
import { InMemoryCandleStore, PAIRS, type CandleStore, type Pair } from "../ingestion/index.js";
import { buildConfluenceSlice, buildRunMatrix, sliceFromRunMatrix } from "./confluenceSlice.js";
import { EMPTY_CONFLUENCE } from "./snapshot.js";

// `buildRunMatrix` is the single place the per-run Confluence_Matrix is assembled; the daily run
// builds it ONCE and shares it with the confluence slice and the Signal Scorecard. These tests
// pin that seam: a failed candle load is WARNED and labelled `candles_unavailable` (never silent),
// the matrix is built in canonical PAIRS order regardless of load timing, and a supplied matrix
// is projected without rebuilding.

const DECISION_DATE = "2024-03-15";

function candles(pair: Pair): Candle[] {
  const out: Candle[] = [];
  let close = 1.1;
  for (let i = 0; i < 60; i += 1) {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const prev = close;
    close += i % 3 === 0 ? 0.002 : -0.0007;
    out.push({
      asset: pair,
      date: d.toISOString().slice(0, 10),
      open: prev,
      high: Math.max(prev, close) + 0.0006,
      low: Math.min(prev, close) - 0.0006,
      close,
    });
  }
  return out.filter((c) => c.date < DECISION_DATE);
}

async function seeded(): Promise<InMemoryCandleStore> {
  const store = new InMemoryCandleStore();
  for (const pair of PAIRS) await store.upsertCandles(candles(pair));
  return store;
}

/** A store whose read fails for one pair. */
function failingFor(inner: CandleStore, badPair: Pair): CandleStore {
  return {
    ...inner,
    getCandles: (pair, start, end) =>
      pair === badPair ? Promise.reject(new Error("read failed")) : inner.getCandles(pair, start, end),
  };
}

describe("buildRunMatrix", () => {
  it("returns one matrix covering every pair in canonical PAIRS order", async () => {
    const run = await buildRunMatrix({
      decisionDate: DECISION_DATE,
      evaluations: [],
      displayOnly: undefined,
      candleStore: await seeded(),
    });

    expect(run).not.toBeNull();
    expect(run!.matrix.pairs.map((p) => p.pair)).toEqual([...PAIRS]);
    expect(run!.failedPairs.size).toBe(0);
  });

  it("WARNS and records a pair whose candle load failed; the others are unaffected", async () => {
    const warnings: Array<{ slice: string; message: string }> = [];

    const run = await buildRunMatrix({
      decisionDate: DECISION_DATE,
      evaluations: [],
      displayOnly: undefined,
      candleStore: failingFor(await seeded(), "GBPUSD"),
      warn: (slice, err) =>
        warnings.push({ slice, message: err instanceof Error ? err.message : String(err) }),
    });

    expect([...run!.failedPairs]).toEqual(["GBPUSD"]);
    expect(warnings).toEqual([{ slice: "confluence:GBPUSD", message: "read failed" }]);
    // The failed pair still has an (all-unavailable) entry, so the matrix stays complete.
    const failed = run!.matrix.pairs.find((p) => p.pair === "GBPUSD");
    expect(failed).toBeDefined();
    expect(failed!.cells.every((c) => !c.available)).toBe(true);
  });
});

describe("sliceFromRunMatrix", () => {
  it("labels a failed pair's cells `candles_unavailable` and leaves the others as built", async () => {
    const run = await buildRunMatrix({
      decisionDate: DECISION_DATE,
      evaluations: [],
      displayOnly: undefined,
      candleStore: failingFor(await seeded(), "GBPUSD"),
      warn: () => {},
    });

    const slice = sliceFromRunMatrix(run);
    const gbp = slice.pairs.find((p) => p.pair === "GBPUSD");

    expect(gbp!.cells).toHaveLength(6);
    for (const c of gbp!.cells) {
      expect(c.available).toBe(false);
      if (!c.available) expect(c.reason).toBe("candles_unavailable");
    }
    // A healthy pair is not relabelled.
    const eur = slice.pairs.find((p) => p.pair === "EURUSD");
    expect(eur!.cells.some((c) => !c.available && c.reason === "candles_unavailable")).toBe(false);
  });

  it("maps a null matrix (could not be built) to the empty slice", () => {
    expect(sliceFromRunMatrix(null)).toEqual(EMPTY_CONFLUENCE);
  });
});

describe("buildConfluenceSlice with a supplied run", () => {
  it("projects the supplied matrix and does NOT read candles again", async () => {
    const store = await seeded();
    const run = await buildRunMatrix({
      decisionDate: DECISION_DATE,
      evaluations: [],
      displayOnly: undefined,
      candleStore: store,
    });
    const getCandles = vi.fn(() => Promise.reject(new Error("must not be called")));

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: [],
      displayOnly: undefined,
      candleStore: { ...store, getCandles } as unknown as CandleStore,
      run,
    });

    expect(getCandles).not.toHaveBeenCalled();
    expect(slice).toEqual(sliceFromRunMatrix(run));
  });

  it("a supplied null run yields the empty slice without building anything", async () => {
    const getCandles = vi.fn(() => Promise.reject(new Error("must not be called")));

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: [],
      displayOnly: undefined,
      candleStore: { getCandles } as unknown as CandleStore,
      run: null,
    });

    expect(slice).toEqual(EMPTY_CONFLUENCE);
    expect(getCandles).not.toHaveBeenCalled();
  });

  it("standalone (no run supplied) still builds its own - identical to projecting buildRunMatrix", async () => {
    const store = await seeded();
    const standalone = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: [],
      displayOnly: undefined,
      candleStore: store,
    });
    const viaRun = sliceFromRunMatrix(
      await buildRunMatrix({
        decisionDate: DECISION_DATE,
        evaluations: [],
        displayOnly: undefined,
        candleStore: store,
      }),
    );

    expect(standalone).toStrictEqual(viaRun);
  });
});
