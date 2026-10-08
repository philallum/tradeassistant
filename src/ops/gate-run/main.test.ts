// Unit test — Gate_Run entry wiring over in-memory stores (task 8.2; design
// Component 6).
//
// Validates: Requirements 2.1, 2.2, 4.2 — the Gate_Run entry runs the EXISTING
// Backtest_Stage against injected stores so composed verdicts PERSIST through
// the `GateVerdictStore`, and `composeGateVerdict` is the SOLE verdict producer
// (nothing is re-implemented, re-evaluated, or re-composed).
//
// These are EXAMPLE-BASED unit tests. They drive `runGateRun` with an in-memory
// `GateVerdictStore` and in-memory pipeline stores seeded via the shared
// StagedRunner test helpers — NO network, NO Supabase.

import { describe, it, expect, vi } from "vitest";

import { runGateRun } from "./main.js";
import { backfill } from "../../staged-runner/stagedRunner.js";
import * as killGateVerdict from "../../kill-gate/verdict.js";
import { InMemoryGateVerdictStore } from "../../kill-gate/types.js";
import {
  makeTestDeps,
  buildCsvContent,
} from "../../staged-runner/testHelpers.js";

/**
 * A chronological run of trading dates long enough that `walkForwardFolds`
 * (default ~756-day train / ~252-day test) emits at least ONE full fold, so the
 * Backtest_Stage derives a non-null `GateVerdictSplit` and actually PERSISTS the
 * composed verdict (a shorter history yields zero folds → no split → nothing to
 * persist). The single-fold floor is ~1008 stored candle dates; ingestion drops
 * a fraction of the raw rows, so 1600 raw daily dates clears it comfortably.
 */
const DATES: readonly string[] = Array.from({ length: 1600 }, (_, i) =>
  new Date(Date.UTC(2015, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
);

/**
 * Build injected in-memory collaborators for the Gate_Run entry: in-memory
 * pipeline stores (seeded via the shared StagedRunner helpers so the
 * Backtest_Stage's candle/vector prerequisite is satisfied) plus an in-memory
 * gate-verdict store. The `fetchImpl` is a throwing stub asserting NO network
 * is ever touched when stores are injected.
 */
async function makeInjectedDeps() {
  const base = makeTestDeps({ EURUSD: buildCsvContent([...DATES]) });
  // Pre-seed the in-memory candle/vector stores to stand in for the ALREADY-
  // SEEDED hosted data the Gate_Run reads: the Gate_Run runs only the
  // Backtest_Stage, so (as in production) candles + vectors must already be
  // present from a prior seed. Running the existing Backfill_Stage over the
  // injected CSV populates them without re-implementing any seeding here.
  await backfill(base, "backfill");

  const gateVerdictStore = new InMemoryGateVerdictStore();

  const noNetworkFetch: typeof fetch = () => {
    throw new Error("Gate_Run test must not touch the network");
  };

  return {
    base,
    gateVerdictStore,
    deps: {
      config: base.config,
      stores: {
        candleStore: base.candleStore,
        vectorStore: base.vectorStore,
        analogueStore: base.analogueStore,
      },
      gateVerdictStore,
      fetchImpl: noNetworkFetch,
      dataDir: base.dataDir,
      docs: base.docs,
      configId: "gate-run-test",
    },
  };
}

describe("Gate_Run entry wires the Backtest_Stage over in-memory stores (task 8.2)", () => {
  it("persists the composed verdict through the injected GateVerdictStore (Req 2.1)", async () => {
    const { gateVerdictStore, deps } = await makeInjectedDeps();

    const result = await runGateRun(deps);

    // The Backtest_Stage ran to completion against the seeded in-memory stores.
    expect(result.ok).toBe(true);

    // The composed verdict was persisted: the in-memory store assigns ids
    // sequentially from `verdict-1`, so the first recorded verdict is readable.
    const persisted = await gateVerdictStore.getVerdict("verdict-1");
    expect(persisted).not.toBeNull();
    expect(persisted?.verdict.configId).toBe("gate-run-test");
  });

  it("routes verdict production solely through composeGateVerdict (Req 2.2, 4.2)", async () => {
    const { deps } = await makeInjectedDeps();
    const composeSpy = vi.spyOn(killGateVerdict, "composeGateVerdict");

    const result = await runGateRun(deps);
    expect(result.ok).toBe(true);

    // composeGateVerdict is the single verdict producer the entry routes
    // through — called exactly once with the entry's configId. The entry adds
    // no second producer and re-implements no composition.
    expect(composeSpy).toHaveBeenCalledTimes(1);
    expect(composeSpy.mock.calls[0]?.[0]).toBe("gate-run-test");

    composeSpy.mockRestore();
  });
});
