// Unit test — Gate_Run entry wiring over in-memory stores (task 8.2; design
// Component 6).
//
// Validates: Requirements 2.1, 2.2, 4.2 — the Gate_Run entry runs the EXISTING
// Backtest_Stage against injected stores so composed verdicts PERSIST through
// the `GateVerdictStore`, a PASS yields `feature_registry` `included` rows
// carrying the justifying `verdictId`, and `composeGateVerdict` is the SOLE
// verdict producer (nothing is re-implemented, re-evaluated, or re-composed).
//
// These are EXAMPLE-BASED unit tests. They drive `runGateRun` with in-memory
// `GateVerdictStore` / `FeatureRegistryStore` and in-memory pipeline stores
// seeded via the shared StagedRunner test helpers — NO network, NO Supabase.
//
// To exercise the PASS branch deterministically (the natural fold construction
// over a short in-memory history yields no qualifying folds → CUT), the PASS
// test spies on the REAL `composeGateVerdict` export and makes it return a
// forced PASS verdict. Spying on the real module export is itself the assertion
// that `composeGateVerdict` is the single verdict-producing call site the entry
// routes through — the entry adds no second producer.

import { describe, it, expect, vi } from "vitest";

import { runGateRun } from "./main.js";
import { backfill } from "../../staged-runner/stagedRunner.js";
import * as killGateVerdict from "../../kill-gate/verdict.js";
import type { GateVerdict } from "../../kill-gate/types.js";
import { InMemoryGateVerdictStore } from "../../kill-gate/types.js";
import { InMemoryFeatureRegistryStore } from "../../feature-registry/types.js";
import type { FeatureId } from "../../feature-registry/types.js";
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
 * Backtest_Stage's candle/vector prerequisite is satisfied) plus in-memory gate
 * stores. The `fetchImpl` is a throwing stub asserting NO network is ever
 * touched when stores are injected.
 */
async function makeInjectedDeps(
  options: { admittedFeatures?: readonly FeatureId[] } = {},
) {
  const base = makeTestDeps({ EURUSD: buildCsvContent([...DATES]) });
  // Pre-seed the in-memory candle/vector stores to stand in for the ALREADY-
  // SEEDED hosted data the Gate_Run reads: the Gate_Run runs only the
  // Backtest_Stage, so (as in production) candles + vectors must already be
  // present from a prior seed. Running the existing Backfill_Stage over the
  // injected CSV populates them without re-implementing any seeding here.
  await backfill(base, "backfill");

  const gateVerdictStore = new InMemoryGateVerdictStore();
  const featureRegistryStore = new InMemoryFeatureRegistryStore();

  const noNetworkFetch: typeof fetch = () => {
    throw new Error("Gate_Run test must not touch the network");
  };

  return {
    base,
    gateVerdictStore,
    featureRegistryStore,
    deps: {
      config: base.config,
      stores: {
        candleStore: base.candleStore,
        vectorStore: base.vectorStore,
        analogueStore: base.analogueStore,
      },
      gateVerdictStore,
      featureRegistryStore,
      fetchImpl: noNetworkFetch,
      dataDir: base.dataDir,
      docs: base.docs,
      configId: "gate-run-test",
      ...(options.admittedFeatures !== undefined
        ? { admittedFeatures: options.admittedFeatures }
        : {}),
    },
  };
}

/** A forced PASS {@link GateVerdict} for the configId, with one qualifying fold. */
function forcedPassVerdict(configId: string): GateVerdict {
  const gate1 = {
    modelAccuracy: 0.7,
    baselineAccuracy: 0.6,
    deltaPp: 0.1,
    sampleSize: 40,
    evaluated: true,
    passed: true,
  };
  const gate2 = {
    modelRiskAdj: 1.2,
    baselineRiskAdj: 0.8,
    margin: 0.4,
    passed: true,
    evaluated: true,
  };
  return {
    configId,
    foldVerdicts: [
      { foldIndex: 0, sampleSize: 40, skipped: false, gate1, gate2, verdict: "PASS" },
    ],
    gate1,
    gate2,
    sampleSize: 40,
    verdict: "PASS",
    metrics: {
      qualifyingFolds: 1,
      skippedFolds: 0,
      totalFolds: 1,
      accuracyVsBaseline: 0.1,
      riskAdjustedVsBaseline: 0.4,
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

  it("on a PASS, upserts feature_registry `included` rows carrying the justifying verdictId (Req 2.2, 4.2)", async () => {
    const admittedFeatures: readonly FeatureId[] = ["%B", "RSI"];
    const { gateVerdictStore, featureRegistryStore, deps } =
      await makeInjectedDeps({ admittedFeatures });

    // Force the SOLE verdict producer to return a PASS so the PASS→included
    // branch is exercised deterministically. The spy targets the real export,
    // confirming the entry has no second producer to bypass it.
    const composeSpy = vi
      .spyOn(killGateVerdict, "composeGateVerdict")
      .mockReturnValue(forcedPassVerdict("gate-run-test"));

    const result = await runGateRun(deps);
    expect(result.ok).toBe(true);
    expect(composeSpy).toHaveBeenCalledTimes(1);

    // The PASS verdict was persisted and carries a generated id.
    const persisted = await gateVerdictStore.getVerdict("verdict-1");
    expect(persisted?.verdict.verdict).toBe("PASS");
    const verdictId = persisted?.verdictId;
    expect(verdictId).toBe("verdict-1");

    // Each admitted feature is now an `included` registry row justified by that
    // exact PASS verdictId.
    const rows = await featureRegistryStore.all();
    expect(rows.map((r) => r.featureId).sort()).toEqual(["%B", "RSI"]);
    for (const row of rows) {
      expect(row.status).toBe("included");
      expect(row.verdictId).toBe(verdictId);
    }

    composeSpy.mockRestore();
  });

  it("does not record included rows when the verdict is CUT (Req 2.2)", async () => {
    // No spy: the natural short-history path yields no qualifying folds → CUT.
    const { featureRegistryStore, deps } = await makeInjectedDeps({
      admittedFeatures: ["%B"],
    });

    const result = await runGateRun(deps);
    expect(result.ok).toBe(true);

    // A CUT admits nothing — the feature registry stays empty.
    const rows = await featureRegistryStore.all();
    expect(rows).toHaveLength(0);
  });
});
