import { describe, expect, it } from "vitest";
import type { Horizon } from "../confidence/types.js";
import type { Pair } from "../ingestion/types.js";
import type { DirectionClass, ForwardOutcome } from "../retrieval/types.js";
import { GATE1_SAMPLE_SIZE_FLOOR, type Gate1FiringSample } from "../kill-gate/types.js";
import type { FoldGateInput } from "../kill-gate/verdict.js";
import { LivingDocs, InMemoryDocStore, LIVING_DOCS } from "../living-docs/livingDocs.js";
import { FeatureRegistry } from "./featureRegistry.js";
import {
  CANDIDATE_FEATURES,
  InMemoryFeatureRegistryStore,
  type FeatureComputer,
  type ModelConfig,
} from "./types.js";

// Unit tests for the Feature Registry (Task 8.7).
//
// Covers, with concrete examples (not property-based):
//   1. candidates() returns exactly the CANDIDATE_FEATURES membership
//      (Requirements 13.1, 13.5).
//   2. evaluateOneAtATime()/evaluateAndRecord() run the gate for a single
//      candidate and produce a PASS or CUT verdict (Requirement 13.1).
//   3. On a CUT, the failure is logged to the Research_Log via LivingDocs
//      with its metric deltas (Requirement 13.3), asserted against the
//      InMemoryDocStore contents.
//
// The gate outcome is driven through a stub FeatureComputer that fabricates one
// qualifying walk-forward fold whose gates either pass (=> PASS verdict) or fail
// Gate 1 (=> CUT verdict), letting each test choose the verdict deterministically.

/**
 * Build a matched firing subset of `size` Decision_Dates whose model-minus-
 * baseline directional accuracy either clears the +3pp Gate 1 margin
 * (`gate1Pass`) or misses it entirely (delta 0).
 */
function buildFiringSubset(size: number, gate1Pass: boolean): Gate1FiringSample[] {
  const out: Gate1FiringSample[] = [];
  for (let i = 0; i < size; i += 1) {
    const decisionDate = `2020-02-${String((i % 28) + 1).padStart(2, "0")}`;
    if (gate1Pass) {
      // model correct, baseline wrong => delta 1.0 (>= 0.03).
      out.push({
        decisionDate,
        modelPrediction: "UP",
        baselinePrediction: "DOWN",
        actual: "UP",
      });
    } else {
      // model and baseline both wrong => delta 0 (< 0.03).
      out.push({
        decisionDate,
        modelPrediction: "DOWN",
        baselinePrediction: "DOWN",
        actual: "UP",
      });
    }
  }
  return out;
}

/** A forward outcome carrying the given MFE/MAE on every horizon. */
function outcomeWith(mfePips: number, maePips: number): ForwardOutcome {
  const h = { direction: "FLAT" as DirectionClass, mfePips, maePips };
  return { perHorizon: { 1: h, 2: h, 3: h } };
}

/**
 * A stub {@link FeatureComputer} that fabricates exactly one qualifying fold
 * per config. The `pass` flag dictates whether that fold passes both gates
 * (=> PASS verdict) or fails Gate 1 (=> CUT verdict), so a test can drive a
 * deterministic single-candidate verdict.
 */
class StubFeatureComputer implements FeatureComputer {
  constructor(
    private readonly pass: boolean,
    private readonly pair: Pair,
    private readonly horizon: Horizon,
  ) {}

  gateInputsFor(config: ModelConfig): readonly FoldGateInput[] {
    // The registry toggles exactly one candidate onto the empty base, so a
    // single-candidate run always presents a config with one feature.
    expect(config.features).toHaveLength(1);

    const firingSubset = buildFiringSubset(GATE1_SAMPLE_SIZE_FLOOR, this.pass);
    // Gate 2 margin is model minus baseline risk-adjusted; a big favorable
    // model excursion clears it. It only matters when Gate 1 passes.
    const model = this.pass ? outcomeWith(50, 5) : outcomeWith(5, 50);
    const baseline = this.pass ? outcomeWith(5, 50) : outcomeWith(50, 5);

    return [
      {
        foldIndex: 0,
        pair: this.pair,
        horizon: this.horizon,
        firingSubset,
        modelOutcomes: firingSubset.map(() => model),
        baselineOutcomes: firingSubset.map(() => baseline),
      },
    ];
  }
}

function makeRegistry(
  pass: boolean,
  pair: Pair = "EURUSD",
  horizon: Horizon = 1,
): { registry: FeatureRegistry; docStore: InMemoryDocStore } {
  const docStore = new InMemoryDocStore();
  const registry = new FeatureRegistry({
    computer: new StubFeatureComputer(pass, pair, horizon),
    store: new InMemoryFeatureRegistryStore(),
    docs: new LivingDocs(docStore),
  });
  return { registry, docStore };
}

function baseConfig(pair: Pair = "EURUSD", horizon: Horizon = 1): ModelConfig {
  return { configId: "base-8.7", features: [], pair, horizon };
}

describe("FeatureRegistry.candidates() membership (Requirements 13.1, 13.5)", () => {
  it("returns exactly the seven canonical candidate features", () => {
    const { registry } = makeRegistry(true);
    expect(registry.candidates()).toEqual([
      "%B",
      "RSI",
      "volumeProxyRegime",
      "weeklyTrendContext",
      "distanceToSma",
      "structuralLiquiditySr",
      "yieldSpread10y",
    ]);
  });

  it("matches the CANDIDATE_FEATURES set exactly — no extras, no omissions", () => {
    const { registry } = makeRegistry(true);
    const candidates = registry.candidates();
    expect(new Set(candidates)).toEqual(new Set(CANDIDATE_FEATURES));
    expect(candidates).toHaveLength(CANDIDATE_FEATURES.length);
  });

  it("returns a fresh array so callers cannot mutate the canonical list", () => {
    const { registry } = makeRegistry(true);
    const first = registry.candidates();
    first.push("%B");
    // A second call is unaffected by mutating the first result.
    expect(registry.candidates()).toEqual([...CANDIDATE_FEATURES]);
  });
});

describe("single-candidate gate run (Requirement 13.1)", () => {
  it("evaluateOneAtATime() runs the gate for one candidate and yields a PASS verdict", () => {
    const { registry } = makeRegistry(true);
    const verdict = registry.evaluateOneAtATime("%B", baseConfig());
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.gate1.passed).toBe(true);
    expect(verdict.gate2.passed).toBe(true);
    expect(verdict.metrics.qualifyingFolds).toBe(1);
  });

  it("evaluateOneAtATime() yields a CUT verdict when the single candidate fails Gate 1", () => {
    const { registry } = makeRegistry(false);
    const verdict = registry.evaluateOneAtATime("RSI", baseConfig());
    expect(verdict.verdict).toBe("CUT");
    expect(verdict.gate1.passed).toBe(false);
  });

  it("evaluateAndRecord() admits a single PASS candidate as included", async () => {
    const { registry } = makeRegistry(true);
    const evaluation = await registry.evaluateAndRecord("%B", baseConfig());
    expect(evaluation.verdict.verdict).toBe("PASS");
    expect(evaluation.included).toBe(true);
    expect(evaluation.status).toBe("included");
    expect(await registry.included()).toEqual(["%B"]);
  });

  it("evaluateAndRecord() cuts a single failing candidate (not included)", async () => {
    const { registry } = makeRegistry(false);
    const evaluation = await registry.evaluateAndRecord("RSI", baseConfig());
    expect(evaluation.verdict.verdict).toBe("CUT");
    expect(evaluation.included).toBe(false);
    expect(evaluation.status).toBe("cut");
    expect(await registry.included()).toEqual([]);
  });
});

describe("cut logging with metric deltas (Requirement 13.3)", () => {
  it("appends a CUT entry to the Research_Log carrying its accuracy/risk-adjusted deltas", async () => {
    const { registry, docStore } = makeRegistry(false);
    const evaluation = await registry.evaluateAndRecord("yieldSpread10y", baseConfig());
    expect(evaluation.verdict.verdict).toBe("CUT");

    const log = docStore.peek(LIVING_DOCS.researchLog);
    expect(log).not.toBeNull();
    const entry = log as string;

    // The failure is logged, tagged as a CUT for the cut candidate.
    expect(entry).toContain("[CUT]");
    expect(entry).toContain("— CUT");
    expect(entry).toContain("- Verdict: CUT");

    // The entry carries the metric deltas: accuracy-vs-baseline (Gate 1 delta)
    // and risk-adjusted-vs-baseline (Gate 2 margin) recorded on the verdict.
    const { accuracyVsBaseline, riskAdjustedVsBaseline } = evaluation.verdict.metrics;
    expect(entry).toContain("- Metrics:");
    expect(entry).toContain(`accuracyVsBaseline=${accuracyVsBaseline}`);
    expect(entry).toContain(`riskAdjustedVsBaseline=${riskAdjustedVsBaseline}`);
    expect(entry).toContain("deltaPp=");
    expect(entry).toContain("margin=");
  });

  it("does not log a CUT entry when the single candidate passes", async () => {
    const { registry, docStore } = makeRegistry(true);
    await registry.evaluateAndRecord("%B", baseConfig());

    const log = docStore.peek(LIVING_DOCS.researchLog) ?? "";
    // A PASS is recorded as a VERDICT, never as a CUT.
    expect(log).toContain("[VERDICT]");
    expect(log).not.toContain("[CUT]");
  });
});
