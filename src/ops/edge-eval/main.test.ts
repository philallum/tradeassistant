// trader-edge-validation task 20 — edge-eval operator entry.
// Validates: Requirements 12.1, 12.5. In-memory stores and a stub regenerator;
// NO network, NO Supabase.

import { describe, it, expect } from "vitest";

import { runEdgeEval, EDGE_EVAL_WINDOWS } from "./main.js";
import { InMemoryTradeLedgerStore } from "../../trade-ledger/types.js";
import { InMemoryFrozenBaselineStore } from "../../walk-forward/frozenBaselineStore.js";
import { LivingDocs, InMemoryDocStore, LIVING_DOCS } from "../../living-docs/livingDocs.js";
import { makeTestDeps } from "../../staged-runner/testHelpers.js";
import type { ForecastRegenerator } from "../../walk-forward/walkForward.js";
import type { Candle } from "../../guard/types.js";

const SECRET = "super-secret-key-value";

function candles(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 12; i += 1) {
    const date = `2024-01-${String(2 + i).padStart(2, "0")}`;
    const base = 1.1 + i * 0.001;
    out.push({
      asset: "EURUSD",
      date,
      open: base,
      high: base + 0.004,
      low: base - 0.004,
      close: base + 0.001,
    });
  }
  return out;
}

async function setup(withCandles = true) {
  const base = makeTestDeps();
  if (withCandles) await base.candleStore.upsertCandles(candles());
  const ledger = new InMemoryTradeLedgerStore();
  const frozen = new InMemoryFrozenBaselineStore();
  const docStore = new InMemoryDocStore({
    [LIVING_DOCS.state]: "STATE-ORIGINAL",
  });
  const docs = new LivingDocs(docStore);
  const regenerate: ForecastRegenerator = (_p, _oos, strategyId) =>
    Promise.resolve([
      {
        strategyId,
        pair: "EURUSD",
        decisionDate: "2024-01-03",
        fired: true,
        direction: "UP",
        horizon: 2,
        earnedConfidence: 0.6,
        stopLossPips: 20,
        takeProfitPips: 30,
      },
    ]);
  return {
    ledger,
    frozen,
    docStore,
    deps: {
      config: { ...base.config, supabase: { ...base.config.supabase, key: SECRET } },
      stores: {
        candleStore: base.candleStore,
        vectorStore: base.vectorStore,
        analogueStore: base.analogueStore,
      },
      tradeLedgerStore: ledger,
      frozenBaselineStore: frozen,
      docs,
      regenerate,
    },
  };
}

describe("edge-eval operator entry (task 20)", () => {
  it("runs the suite, persists baseline + ledger, and returns a secret-free summary", async () => {
    const { deps, ledger, frozen } = await setup();
    const result = await runEdgeEval(deps);
    expect(result.completed).toBe(true);
    if (!result.completed) return;
    expect(frozen.size()).toBe(1);
    expect(ledger.size()).toBeGreaterThan(0);
    expect(result.summary.windows).toHaveLength(EDGE_EVAL_WINDOWS.length);
    expect(result.summary.comparison.results[0]?.strategyId).toBe("system");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("routes the note to RESEARCH-LOG only, never PROJECT-STATE, with no verdict token", async () => {
    const { deps, docStore } = await setup();
    await runEdgeEval(deps);
    const log = (await docStore.read(LIVING_DOCS.researchLog)) ?? "";
    expect(log).toContain("[EDGE-EVAL]");
    expect(log).not.toMatch(/\b(PASS|CUT|KILL)\b/);
    expect(log).not.toContain(SECRET);
    expect(await docStore.read(LIVING_DOCS.state)).toBe("STATE-ORIGINAL");
  });

  it("records the after-cost figures in RESEARCH-LOG (they are no longer shown in the UI)", async () => {
    // dashboard-simplification: net expectancy, drawdown and the comparator table were removed
    // from every UI surface, so each evaluation run must keep them readable here.
    const { deps, docStore } = await setup();
    await runEdgeEval(deps);
    const log = (await docStore.read(LIVING_DOCS.researchLog)) ?? "";
    expect(log).toMatch(/Pooled independent OOS \(net of costs\):.*netExpectancyPips=-?\d/);
    expect(log).toMatch(/maxDrawdownPips=/);
    expect(log).toMatch(/Comparators: .*system/);
  });

  it("does not fabricate a result when no candles are stored", async () => {
    const { deps, docStore, frozen } = await setup(false);
    const result = await runEdgeEval(deps);
    expect(result.completed).toBe(false);
    expect(frozen.size()).toBe(0);
    expect(await docStore.read(LIVING_DOCS.researchLog)).toBeNull();
  });
});
