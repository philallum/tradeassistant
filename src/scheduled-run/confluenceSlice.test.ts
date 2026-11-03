// Unit tests for the fail-safe confluence slice builder
// (multi-strategy-confluence-engine task 18.2; Requirements 10.4, 10.6, 10.7).
//
// `buildConfluenceSlice` is the I/O wrapper that turns the pure per-run
// Confluence_Matrix into the v5 `confluence` snapshot slice. These tests pin the
// fail-safe contract with injected, in-memory collaborators — a stub
// `CandleStore` and a captured `warn` sink (never the real `console`):
//
//   - a candle store that throws (its error carrying a FAKE secret) is handled
//     fail-safely, and the warning the builder emits leaks no secret-like
//     substring (Requirements 10.4, 10.6);
//   - an "any other failure" (a throwing `displayOnly`) degrades the whole slice
//     to `EMPTY_CONFLUENCE` with a secret-free warning (Requirement 10.6);
//   - a per-Pair candle-load failure yields that Pair's six cells all
//     `candles_unavailable` while every other Pair still produces results
//     (Requirement 10.4);
//   - the third-party reference is read from `displayOnly.comparisons` and flows
//     into the matrix (Design "9. Snapshot wiring");
//   - all Pairs use the single shared `decisionDate` (Requirement 10.7);
//   - a malformed `CONFLUENCE_*` env var falls back to the default weights and
//     thresholds, with a secret-free warning (Requirements 10.6).
//
// The strategies, adapters, and engine are the REAL implementations; only the
// `CandleStore` and the `warn` sink are injected stubs.

import { describe, expect, it } from "vitest";

import type { Candle, TradingDate } from "../guard/types.js";
import { PAIRS, type Pair, type CandleStore } from "../ingestion/types.js";
import type { Confidence } from "../confidence/types.js";
import type { PairEvaluation } from "../dashboard/dashboard.js";
import type {
  ExternalReferenceSignal,
  ReferenceDirection,
} from "../external-signal/types.js";
import type {
  DisplayOnlyWrite,
  ReferenceComparisonWrite,
} from "../storage/supabase/index.js";
import { buildConfluenceSlice } from "./confluenceSlice.js";
import {
  CONFLUENCE_WEIGHTS_ENV,
  CONFLUENCE_CONFLICT_THRESHOLD_ENV,
  CONFLUENCE_ALIGNMENT_THRESHOLD_ENV,
} from "../strategies/index.js";
import { DEFAULT_CONFLUENCE_CONFIG } from "../strategies/confluenceEngine.js";
import {
  EMPTY_CONFLUENCE,
  type SnapshotConfluencePair,
  type SnapshotConfluenceSlice,
} from "./snapshot.js";

// --- Helpers ----------------------------------------------------------------

/** The shared Decision_Date every test run uses. */
const DECISION_DATE: TradingDate = "2020-06-01";

/** A fake secret value that must never appear in any emitted warning. */
const FAKE_SECRET = "sk-live-TOPSECRET-0123456789abcdef";

/**
 * A rising OHLC series of `count` candles ending strictly BEFORE
 * `DECISION_DATE`, so the whole series is past-only and the real strategies run
 * normally (producing available cells rather than look-ahead rejections).
 */
function pastCandles(pair: Pair, count: number): Candle[] {
  const candles: Candle[] = [];
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
 * A `CandleStore` stub serving a fixed per-Pair candle series from a map and
 * recording the exact `(asset, startDate, endDate)` arguments it was called
 * with, so a test can assert the shared end date (the day before the
 * Decision_Date) was used for every Pair. A Pair absent from the map serves an
 * empty series. `onGet`, when provided, can override a Pair's behaviour (e.g.
 * throw) to exercise the per-Pair failure path.
 */
interface GetCall {
  readonly asset: Pair;
  readonly startDate: TradingDate | undefined;
  readonly endDate: TradingDate | undefined;
}

function stubStore(
  byPair: Partial<Record<Pair, readonly Candle[]>>,
  onGet?: (pair: Pair) => void,
): { readonly store: CandleStore; readonly calls: GetCall[] } {
  const calls: GetCall[] = [];
  const store: CandleStore = {
    upsertCandles: () => Promise.resolve(),
    getCoverageSummary: () => Promise.resolve([]),
    getCandles: (asset, startDate, endDate) => {
      calls.push({ asset, startDate, endDate });
      onGet?.(asset);
      return Promise.resolve(byPair[asset] ?? []);
    },
  };
  return { store, calls };
}

/** A full per-Pair evaluation fixture (only direction/confidence are read). */
function evaluation(
  pair: Pair,
  direction: PairEvaluation["direction"] = "UP",
  earnedConfidence = 0.6,
): PairEvaluation {
  return {
    pair,
    direction,
    earnedConfidence: earnedConfidence as Confidence,
    horizon: 2,
    excursionProfile: { favorablePips: 40, adversePips: 15 },
    stopLossPips: 15,
    takeProfitPips: 40,
    choppiness: 0.8,
    rationale: "r",
    analogueLabels: [],
  };
}

/** A display-only third-party comparison write carrying a reference. */
function comparison(
  pair: Pair,
  direction: ReferenceDirection,
  score?: number,
): ReferenceComparisonWrite {
  const reference: ExternalReferenceSignal = {
    pair,
    decisionDate: DECISION_DATE,
    direction,
    ...(score !== undefined ? { score } : {}),
    provider: "test-provider",
    fetchedAt: `${DECISION_DATE}T00:00:00.000Z`,
  };
  return {
    decisionDate: DECISION_DATE,
    pair,
    ownDirection: null,
    reference,
    comparison: "neutral",
  };
}

/** Collect every `(slice, err)` the builder warns with, serialised secret-free. */
function captureWarn(): {
  readonly warn: (slice: string, err: unknown) => void;
  readonly entries: Array<{ slice: string; err: unknown }>;
} {
  const entries: Array<{ slice: string; err: unknown }> = [];
  return { warn: (slice, err) => entries.push({ slice, err }), entries };
}

/** Find one Pair's slice, failing loudly if absent. */
function pairOf(
  slice: SnapshotConfluenceSlice,
  pair: Pair,
): SnapshotConfluencePair {
  const found = slice.pairs.find((p) => p.pair === pair);
  if (found === undefined) {
    throw new Error(`pair ${pair} missing from slice`);
  }
  return found;
}

// --- Throwing candle store: fail-safe + secret-free warning (Req 10.4, 10.6) -

describe("buildConfluenceSlice — throwing candle store (Req 10.4, 10.6)", () => {
  it("degrades every Pair to candles_unavailable and never leaks the store's secret", async () => {
    const { warn, entries } = captureWarn();
    // The store error carries a fake secret in a custom property (the kind of
    // thing a real client error might attach) — the warning must not echo it.
    const storeError = Object.assign(new Error("candle store connection failed"), {
      apiKey: FAKE_SECRET,
    });
    const { store } = stubStore({}, () => {
      throw storeError;
    });

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: PAIRS.map((pair) => evaluation(pair)),
      displayOnly: undefined,
      candleStore: store,
      env: {},
      warn,
    });

    // The slice is still well-formed: five Pairs, each with six cells, all of
    // them unavailable with reason `candles_unavailable` (Requirement 10.4).
    expect(slice.pairs.map((p) => p.pair)).toEqual([...PAIRS]);
    for (const pair of PAIRS) {
      const cells = pairOf(slice, pair).cells;
      expect(cells).toHaveLength(6);
      for (const cell of cells) {
        expect(cell.available).toBe(false);
        if (!cell.available) {
          expect(cell.reason).toBe("candles_unavailable");
        }
      }
    }

    // A warning was emitted per failing Pair, and NONE of the warning payloads
    // — serialised the way the builder would log them (slice + err.message) —
    // contains the fake secret the error object carried (Requirement 10.6).
    expect(entries.length).toBeGreaterThan(0);
    for (const { slice: name, err } of entries) {
      const message = err instanceof Error ? err.message : String(err);
      expect(name).not.toContain(FAKE_SECRET);
      expect(message).not.toContain(FAKE_SECRET);
    }
  });

  it("returns EMPTY_CONFLUENCE with a secret-free warning on an any-other failure", async () => {
    const { warn, entries } = captureWarn();
    // A failure OUTSIDE the per-Pair candle handling (here, reading the
    // display-only comparisons throws) hits the fail-safe outer catch, which
    // returns EMPTY_CONFLUENCE and logs the slice name + err.message only.
    const badDisplayOnly = {
      get comparisons(): readonly ReferenceComparisonWrite[] {
        throw Object.assign(new Error("display-only read failed"), {
          secret: FAKE_SECRET,
        });
      },
    } as unknown as DisplayOnlyWrite;

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: [],
      displayOnly: badDisplayOnly,
      candleStore: stubStore({}).store,
      env: {},
      warn,
    });

    expect(slice).toEqual(EMPTY_CONFLUENCE);
    expect(entries.length).toBeGreaterThan(0);
    for (const { slice: name, err } of entries) {
      const message = err instanceof Error ? err.message : String(err);
      expect(name).not.toContain(FAKE_SECRET);
      expect(message).not.toContain(FAKE_SECRET);
    }
  });
});

// --- Per-Pair candle-load failure isolation (Req 10.4) ----------------------

describe("buildConfluenceSlice — per-Pair candle-load failure (Req 10.4)", () => {
  it("marks one Pair's six cells candles_unavailable while other Pairs still produce results", async () => {
    const { warn, entries } = captureWarn();
    // Every Pair has real candles; only GBPUSD's load throws.
    const byPair: Partial<Record<Pair, readonly Candle[]>> = {};
    for (const pair of PAIRS) {
      byPair[pair] = pastCandles(pair, 60);
    }
    const failing: Pair = "GBPUSD";
    const { store } = stubStore(byPair, (pair) => {
      if (pair === failing) {
        throw new Error("gbp load failed");
      }
    });

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: PAIRS.map((pair) => evaluation(pair)),
      displayOnly: undefined,
      candleStore: store,
      env: {},
      warn,
    });

    // The failing Pair: all six cells unavailable with `candles_unavailable`.
    const gbp = pairOf(slice, failing);
    expect(gbp.cells).toHaveLength(6);
    for (const cell of gbp.cells) {
      expect(cell.available).toBe(false);
      if (!cell.available) {
        expect(cell.reason).toBe("candles_unavailable");
      }
    }

    // Every OTHER Pair still produced results: at least one available cell and
    // no `candles_unavailable` reason anywhere.
    for (const pair of PAIRS) {
      if (pair === failing) {
        continue;
      }
      const cells = pairOf(slice, pair).cells;
      const availableCount = cells.filter((c) => c.available).length;
      expect(availableCount).toBeGreaterThan(0);
      for (const cell of cells) {
        if (!cell.available) {
          expect(cell.reason).not.toBe("candles_unavailable");
        }
      }
    }

    // Exactly the one failing Pair was warned about.
    expect(entries.map((e) => e.slice)).toEqual([`confluence:${failing}`]);
  });
});

// --- Third-party extraction from displayOnly.comparisons --------------------

describe("buildConfluenceSlice — third-party reference from displayOnly", () => {
  it("reads the third-party reference from displayOnly.comparisons into the matrix", async () => {
    const { warn } = captureWarn();
    const byPair: Partial<Record<Pair, readonly Candle[]>> = {};
    for (const pair of PAIRS) {
      byPair[pair] = pastCandles(pair, 60);
    }
    const { store } = stubStore(byPair);

    // A BUY reference with a non-zero score for EURUSD; no comparison for the
    // other Pairs, so their third_party cell is unavailable.
    const displayOnly: DisplayOnlyWrite = {
      comparisons: [comparison("EURUSD", "BUY", 0.8)],
    };

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: PAIRS.map((pair) => evaluation(pair)),
      displayOnly,
      candleStore: store,
      env: {},
      warn,
    });

    const eurThird = pairOf(slice, "EURUSD").cells.find(
      (c) => c.strategyId === "third_party",
    )!;
    // The reference flowed through the adapter into an available UP cell
    // (BUY → UP). This only happens if the reference was read from
    // displayOnly.comparisons.
    expect(eurThird.available).toBe(true);
    if (eurThird.available) {
      expect(eurThird.direction).toBe("UP");
      expect(eurThird.strength).toBeGreaterThan(0);
    }

    // GBPUSD had no comparison, so its third_party cell is unavailable.
    const gbpThird = pairOf(slice, "GBPUSD").cells.find(
      (c) => c.strategyId === "third_party",
    )!;
    expect(gbpThird.available).toBe(false);
  });

  it("maps a SELL reference to a DOWN third-party cell", async () => {
    const { warn } = captureWarn();
    const byPair: Partial<Record<Pair, readonly Candle[]>> = {
      USDJPY: pastCandles("USDJPY", 60),
    };
    const { store } = stubStore(byPair);

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: [evaluation("USDJPY")],
      displayOnly: { comparisons: [comparison("USDJPY", "SELL", 0.5)] },
      candleStore: store,
      env: {},
      warn,
    });

    const third = pairOf(slice, "USDJPY").cells.find(
      (c) => c.strategyId === "third_party",
    )!;
    expect(third.available).toBe(true);
    if (third.available) {
      expect(third.direction).toBe("DOWN");
    }
  });
});

// --- Single shared decisionDate across all Pairs (Req 10.7) -----------------

describe("buildConfluenceSlice — single shared decisionDate (Req 10.7)", () => {
  it("loads every Pair up to the day before the one Decision_Date", async () => {
    const { warn } = captureWarn();
    const byPair: Partial<Record<Pair, readonly Candle[]>> = {};
    for (const pair of PAIRS) {
      byPair[pair] = pastCandles(pair, 60);
    }
    const { store, calls } = stubStore(byPair);

    await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: PAIRS.map((pair) => evaluation(pair)),
      displayOnly: undefined,
      candleStore: store,
      env: {},
      warn,
    });

    // One getCandles call per Pair, every one ending on the day BEFORE the
    // single shared Decision_Date (2020-05-31) — proving one decisionDate drove
    // all five loads (Requirement 10.7).
    expect(calls.map((c) => c.asset).sort()).toEqual([...PAIRS].sort());
    for (const call of calls) {
      expect(call.endDate).toBe("2020-05-31");
    }
    // All Pairs' start dates are identical too (one shared window).
    const starts = new Set(calls.map((c) => c.startDate));
    expect(starts.size).toBe(1);
  });

  it("does not raise a look_ahead_violation for any Pair under the shared date", async () => {
    const { warn } = captureWarn();
    const byPair: Partial<Record<Pair, readonly Candle[]>> = {};
    for (const pair of PAIRS) {
      byPair[pair] = pastCandles(pair, 60);
    }
    const { store } = stubStore(byPair);

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: PAIRS.map((pair) => evaluation(pair)),
      displayOnly: undefined,
      candleStore: store,
      env: {},
      warn,
    });

    // Past-only candles under the shared Decision_Date never trip look-ahead.
    for (const pair of PAIRS) {
      for (const cell of pairOf(slice, pair).cells) {
        if (!cell.available) {
          expect(cell.reason).not.toBe("look_ahead_violation");
        }
      }
    }
  });
});

// --- Invalid env falls back to defaults (Req 10.6) --------------------------

describe("buildConfluenceSlice — invalid env falls back to defaults (Req 10.6)", () => {
  it("uses the default weights and thresholds for a malformed CONFLUENCE_WEIGHTS and warns secret-free", async () => {
    const { warn, entries } = captureWarn();
    const byPair: Partial<Record<Pair, readonly Candle[]>> = {};
    for (const pair of PAIRS) {
      byPair[pair] = pastCandles(pair, 60);
    }
    const { store } = stubStore(byPair);

    // Malformed JSON for the weights env var. A fake secret is placed in a
    // SIBLING env var to confirm the warning never dumps the environment.
    const env = {
      [CONFLUENCE_WEIGHTS_ENV]: "{ not-valid-json ",
      SOME_API_KEY: FAKE_SECRET,
    } as NodeJS.ProcessEnv;

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: PAIRS.map((pair) => evaluation(pair)),
      displayOnly: undefined,
      candleStore: store,
      env,
      warn,
    });

    // The slice still carries the engine DEFAULT weights and thresholds.
    expect(slice.weights).toEqual(DEFAULT_CONFLUENCE_CONFIG.weights);
    expect(slice.conflictThreshold).toBe(
      DEFAULT_CONFLUENCE_CONFIG.conflictThreshold,
    );
    expect(slice.alignmentThreshold).toBe(
      DEFAULT_CONFLUENCE_CONFIG.alignmentThreshold,
    );
    // The Pairs still evaluated normally (the fallback did not break the run).
    expect(slice.pairs.map((p) => p.pair)).toEqual([...PAIRS]);

    // A warning was emitted for the invalid config, and no warning payload
    // leaks the sibling secret (Requirement 10.6).
    expect(entries.length).toBeGreaterThan(0);
    for (const { slice: name, err } of entries) {
      const message = err instanceof Error ? err.message : String(err);
      expect(name).not.toContain(FAKE_SECRET);
      expect(message).not.toContain(FAKE_SECRET);
    }
  });

  it("falls back to defaults for an out-of-range threshold env var", async () => {
    const { warn, entries } = captureWarn();
    const byPair: Partial<Record<Pair, readonly Candle[]>> = {
      EURUSD: pastCandles("EURUSD", 60),
    };
    const { store } = stubStore(byPair);

    // A syntactically valid but out-of-range threshold: the engine rejects it,
    // so the builder falls back to the defaults rather than failing the slice.
    const env = {
      [CONFLUENCE_CONFLICT_THRESHOLD_ENV]: "5",
      [CONFLUENCE_ALIGNMENT_THRESHOLD_ENV]: "-1",
    } as NodeJS.ProcessEnv;

    const slice = await buildConfluenceSlice({
      decisionDate: DECISION_DATE,
      evaluations: [evaluation("EURUSD")],
      displayOnly: undefined,
      candleStore: store,
      env,
      warn,
    });

    expect(slice.conflictThreshold).toBe(
      DEFAULT_CONFLUENCE_CONFIG.conflictThreshold,
    );
    expect(slice.alignmentThreshold).toBe(
      DEFAULT_CONFLUENCE_CONFIG.alignmentThreshold,
    );
    expect(slice.weights).toEqual(DEFAULT_CONFLUENCE_CONFIG.weights);
    expect(entries.length).toBeGreaterThan(0);
  });
});
