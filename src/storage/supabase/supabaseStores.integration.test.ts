// Supabase Storage-Adapter Port-Contract Integration Test — task 2.3
// (Requirement 17.2 shared-schema interchangeability; parent Req 17.1).
//
// Proves the three Supabase adapters satisfy the SAME port contract the
// in-memory reference stores satisfy, run against a REAL local Supabase backend
// (the same migration set applied to local and hosted, Requirement 17.2). It is
// an INTEGRATION test, not a property test: it uses 1–3 representative fixtures
// rather than random iterations, and exercises the real REST transport, the
// real `pattern_vectors` HNSW/pgvector column, and the real `firing_setups`
// table end to end.
//
// Gating follows the existing repo convention (see connectivity.test.ts /
// schemaParity.integration.test.ts): the suite runs only when
// `SUPABASE_TARGET=local` selects a fully-configured local target AND that
// backend is actually reachable. When no local Supabase is running the suite
// skips cleanly so the offline suite stays green — but it is structured to run
// in full when a backend is available.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadSupabaseConfig,
  tryLoadSupabaseConfig,
  type SupabaseConfig,
} from "../supabaseConfig.js";
import type { Candle } from "../../guard/types.js";
import type { PatternVector } from "../../encoder/types.js";
import type { AnalogueRecord } from "../../retrieval/types.js";
import type { DashboardView } from "../../dashboard/index.js";
import { SupabaseRestClient } from "./client.js";
import { SupabaseCandleStore } from "./candleStore.js";
import { SupabasePatternVectorStore } from "./patternVectorStore.js";
import { SupabaseAnalogueStore } from "./analogueStore.js";
import { makeSupabaseViewPersister } from "./viewPersister.js";

// --- Gate: only run against a configured, reachable LOCAL Supabase ----------

const cfgResult = tryLoadSupabaseConfig();
const isLocalTarget = cfgResult.ok && cfgResult.config.target === "local";

// A stable test-data namespace so cleanup never touches real rows. The five
// PAIRS are real symbols; we scope by unique decision dates far in the future.
const TEST_DATE_1 = "2999-01-01";
const TEST_DATE_2 = "2999-01-02";
const TEST_DATE_3 = "2999-01-03";
const TEST_DATES = [TEST_DATE_1, TEST_DATE_2, TEST_DATE_3];

function seventyDims(seed: number): number[] {
  return Array.from({ length: 70 }, (_, i) => Math.sin((i + 1) * seed * 0.01));
}

function makeVector(embedding: number[], sign: "UP" | "DOWN"): PatternVector {
  return {
    scale10: embedding.slice(0, 10),
    scale20: embedding.slice(10, 30),
    scale40: embedding.slice(30, 70),
    embedding,
    weeklyTrendSign: sign,
    dim: 70,
  };
}

/** Probe reachability once; if the backend is down we skip the whole suite. */
let reachable = false;
let config: SupabaseConfig | undefined;
let client: SupabaseRestClient | undefined;

async function cleanup(c: SupabaseRestClient): Promise<void> {
  const dateFilter = `decision_date=in.(${TEST_DATES.join(",")})`;
  const candleDateFilter = `date=in.(${TEST_DATES.join(",")})`;
  // Best-effort removal of any rows this suite may have written.
  await Promise.allSettled([
    c.delete("candles", candleDateFilter),
    c.delete("pattern_vectors", dateFilter),
    c.delete("analogue_outcomes", dateFilter),
    c.delete("firing_setups", dateFilter),
  ]);
}

beforeAll(async () => {
  if (!isLocalTarget) {
    return;
  }
  config = loadSupabaseConfig();
  const probe = new SupabaseRestClient(config);
  try {
    // A trivial select proves the REST endpoint is up and the schema exists.
    await probe.select("candles", "limit=1");
    reachable = true;
    client = probe;
    await cleanup(probe);
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (client) {
    await cleanup(client);
  }
});

const shouldRun = (): boolean => isLocalTarget && reachable;

describe.skipIf(!isLocalTarget)(
  "Supabase storage adapters — port contract against local Supabase (Req 17.2)",
  () => {
    it("SupabaseCandleStore round-trips candles and reports coverage", async () => {
      if (!shouldRun() || !client) return;
      const store = new SupabaseCandleStore(client);

      const candles: Candle[] = [
        { asset: "EURUSD", date: TEST_DATE_1, open: 1.1, high: 1.2, low: 1.0, close: 1.15, source: "csv" },
        { asset: "EURUSD", date: TEST_DATE_2, open: 1.15, high: 1.25, low: 1.1, close: 1.2, source: "csv" },
        { asset: "EURUSD", date: TEST_DATE_3, open: 1.2, high: 1.3, low: 1.15, close: 1.25, source: "csv" },
      ];
      await store.upsertCandles(candles);

      const read = await store.getCandles("EURUSD", TEST_DATE_1, TEST_DATE_3);
      expect(read.map((c) => c.date)).toEqual([TEST_DATE_1, TEST_DATE_2, TEST_DATE_3]);
      expect(read[0]?.close).toBe(1.15);

      // Idempotent upsert on (asset, date): re-writing does not duplicate.
      await store.upsertCandles([{ ...candles[0]!, close: 1.16 }]);
      const reread = await store.getCandles("EURUSD", TEST_DATE_1, TEST_DATE_1);
      expect(reread).toHaveLength(1);
      expect(reread[0]?.close).toBe(1.16);

      const coverage = await store.getCoverageSummary();
      const eur = coverage.find((c) => c.pair === "EURUSD");
      expect(eur?.count).toBeGreaterThanOrEqual(3);
      expect(eur?.earliestDate).toBe(TEST_DATE_1);
      expect(eur?.latestDate).toBe(TEST_DATE_3);
      // Coverage is emitted for all five pairs, in fixed order.
      expect(coverage).toHaveLength(5);
    });

    it("SupabasePatternVectorStore round-trips vectors and honors queryNearest ordering + pre-filter", async () => {
      if (!shouldRun() || !client) return;
      const store = new SupabasePatternVectorStore(client);

      const base = seventyDims(1);
      const near = base.map((v, i) => v + (i === 0 ? 1e-4 : 0));
      const far = base.map((v) => -v);

      // Two UP candidates (one near the query, one far) + one DOWN candidate
      // that the metadata pre-filter must exclude.
      await store.upsertVector("EURUSD", TEST_DATE_1, makeVector(base, "UP"));
      await store.upsertVector("GBPUSD", TEST_DATE_2, makeVector(far, "UP"));
      await store.upsertVector("USDJPY", TEST_DATE_3, makeVector(near, "DOWN"));

      const got = await store.getVector("EURUSD", TEST_DATE_1);
      expect(got?.embedding).toHaveLength(70);
      expect(got?.weeklyTrendSign).toBe("UP");
      expect(got?.scaleDims.scale40).toHaveLength(40);

      const results = await store.queryNearest(base, "UP");
      // Only UP vectors are admitted (DOWN pre-filtered out).
      expect(results.every((r) => r.vector.weeklyTrendSign === "UP")).toBe(true);
      expect(results.some((r) => r.vector.asset === "USDJPY")).toBe(false);
      // The exact-match UP vector ranks first (smallest cosine distance).
      expect(results[0]?.vector.decisionDate).toBe(TEST_DATE_1);
      // Distances are non-decreasing (similarity ordering).
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.cosineDistance).toBeGreaterThanOrEqual(
          results[i - 1]!.cosineDistance,
        );
      }
    });

    it("pgvector ANN sanity: nearest neighbor of an exact query is that vector", async () => {
      if (!shouldRun() || !client) return;
      const store = new SupabasePatternVectorStore(client);
      const emb = seventyDims(2);
      await store.upsertVector("USDCHF", TEST_DATE_1, makeVector(emb, "UP"));

      const nearest = await store.queryNearest(emb, "UP", {
        asset: "USDCHF",
        limit: 1,
      });
      expect(nearest).toHaveLength(1);
      expect(nearest[0]?.vector.asset).toBe("USDCHF");
      // An exact match has ~zero cosine distance.
      expect(nearest[0]?.cosineDistance ?? 1).toBeLessThan(1e-6);
    });

    it("SupabaseAnalogueStore round-trips outcomes and filters matured/pre-date", async () => {
      if (!shouldRun() || !client) return;
      const store = new SupabaseAnalogueStore(client);

      const matured: AnalogueRecord = {
        asset: "USDCAD",
        decisionDate: TEST_DATE_1,
        horizon: 1,
        direction: "UP",
        mfePips: 30,
        maePips: 10,
        atr14: 12,
        matured: true,
      };
      const immature: AnalogueRecord = {
        ...matured,
        decisionDate: TEST_DATE_2,
        horizon: 2,
        matured: false,
      };
      await store.upsertOutcome(matured);
      await store.upsertOutcome(immature);

      const outcomes = await store.getOutcomes("USDCAD", TEST_DATE_1);
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.direction).toBe("UP");

      // Only matured, strictly-before beforeDate are returned.
      const beforeMatured = await store.getMaturedOutcomes("USDCAD", TEST_DATE_3);
      expect(beforeMatured.map((o) => o.decisionDate)).toEqual([TEST_DATE_1]);
      const beforeNone = await store.getMaturedOutcomes("USDCAD", TEST_DATE_1);
      expect(beforeNone).toHaveLength(0);
    });

    it("makeSupabaseViewPersister writes a DashboardView to firing_setups", async () => {
      if (!shouldRun() || !client || !config) return;
      const persist = makeSupabaseViewPersister(config);

      // No dashboard-level suppressors remain (Requirements 3.1, 3.3), so the
      // view carries only firing cards and the writer emits only surfaced rows.
      const view: DashboardView = {
        decisionDate: TEST_DATE_1,
        cards: [
          {
            pair: "EURUSD",
            direction: "UP",
            horizon: 2,
            earnedConfidence: 0.72,
            excursionProfile: { favorablePips: 40, adversePips: 15 },
            stopLossPips: 15,
            takeProfitPips: 40,
            rationale: "analogues resolved up",
            analogueLabels: ["trend-continuation"],
          },
        ],
      };
      await persist(view, config);

      const rows = await client.select<{
        pair: string;
        surfaced: boolean;
        suppression_reason: string | null;
        direction: string;
      }>("firing_setups", `decision_date=eq.${TEST_DATE_1}&order=pair.asc`);

      const byPair = new Map(rows.map((r) => [r.pair, r]));
      expect(byPair.get("EURUSD")?.surfaced).toBe(true);
      expect(byPair.get("EURUSD")?.direction).toBe("UP");
      expect(byPair.get("EURUSD")?.suppression_reason).toBeNull();

      // Idempotent on (decision_date, pair, strategy_id): re-persist, no dupes.
      await persist(view, config);
      const reread = await client.select<{ pair: string }>(
        "firing_setups",
        `decision_date=eq.${TEST_DATE_1}`,
      );
      expect(reread).toHaveLength(1);
    });
  },
);
