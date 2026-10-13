import { describe, expect, it } from "vitest";
import {
  captureFrozenBaseline,
  captureLiveParameterSet,
  LIVE_PARAMETER_SET_VERSION,
  PATTERN_SCALES,
} from "./parameterSet.js";
import {
  DEFAULT_PIPELINE_CONFIG,
  DEFAULT_PIPELINE_WINDOW_SIZE,
} from "../pipeline/types.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../dashboard/types.js";
import { FIXED_PRIOR_WEIGHT, SAMPLE_SIZE_FLOOR } from "../confidence/types.js";
import {
  DEFAULT_STOP_LOSS_PERCENTILE,
  DEFAULT_TAKE_PROFIT_PERCENTILE,
} from "../risk-boundaries/types.js";

// Feature: trader-edge-validation, Task 8.1: Frozen_Baseline capture is faithful
// and read-only.
//
// Validates: Requirements 11.1, 11.3

describe("captureLiveParameterSet — faithful to the live defaults (R11.1)", () => {
  it("equals the live constants field-for-field", () => {
    const params = captureLiveParameterSet();

    expect(params.patternScales).toEqual([10, 20, 40]);
    expect(params.similarityEpsilon).toBe(DEFAULT_PIPELINE_CONFIG.retrieval.epsilon);
    expect(params.retrievalK).toBe(DEFAULT_PIPELINE_CONFIG.retrieval.k);
    expect(params.windowSize).toBe(DEFAULT_PIPELINE_WINDOW_SIZE);
    expect(params.analogueFloor).toBe(SAMPLE_SIZE_FLOOR);
    expect(params.weeklyTrendFilter).toBe(false);
    expect(params.shrinkageWeight).toBe(FIXED_PRIOR_WEIGHT);
    expect(params.confidenceThreshold).toBe(DEFAULT_CONFIDENCE_THRESHOLD);
    expect(params.horizonSelection).toBe("best_resolution");
    expect(params.stopLossPercentile).toBe(DEFAULT_STOP_LOSS_PERCENTILE);
    expect(params.takeProfitPercentile).toBe(DEFAULT_TAKE_PROFIT_PERCENTILE);
  });

  it("pins the known literal live values (regression guard on the frozen set)", () => {
    const params = captureLiveParameterSet();
    expect(params.confidenceThreshold).toBe(0.55);
    expect(params.analogueFloor).toBe(30);
    expect(params.shrinkageWeight).toBe(10);
    expect(params.stopLossPercentile).toBe(75);
    expect(params.takeProfitPercentile).toBe(50);
    expect(params.windowSize).toBe(60);
  });
});

describe("captureFrozenBaseline — version-stamped, read-only (R11.1, R11.3)", () => {
  it("stamps the default version and an ISO capturedAt from the injected clock", () => {
    const fixed = new Date("2026-02-01T00:00:00.000Z");
    const baseline = captureFrozenBaseline({ now: () => fixed });

    expect(baseline.id).toBe(LIVE_PARAMETER_SET_VERSION);
    expect(baseline.capturedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(baseline.params).toEqual(captureLiveParameterSet());
  });

  it("honours a caller-supplied id so a tuned variant stays traceable", () => {
    const baseline = captureFrozenBaseline({ id: "params-tuned-A" });
    expect(baseline.id).toBe("params-tuned-A");
  });

  it("capturing changes NO live constant (read-only, R11.3)", () => {
    // Snapshot the live constants, capture twice, and confirm nothing shifted.
    const before = {
      epsilon: DEFAULT_PIPELINE_CONFIG.retrieval.epsilon,
      k: DEFAULT_PIPELINE_CONFIG.retrieval.k,
      window: DEFAULT_PIPELINE_WINDOW_SIZE,
      floor: SAMPLE_SIZE_FLOOR,
      shrink: FIXED_PRIOR_WEIGHT,
      threshold: DEFAULT_CONFIDENCE_THRESHOLD,
      sl: DEFAULT_STOP_LOSS_PERCENTILE,
      tp: DEFAULT_TAKE_PROFIT_PERCENTILE,
      scales: [...PATTERN_SCALES],
    };

    captureFrozenBaseline();
    captureFrozenBaseline({ id: "params-tuned-B" });

    expect(DEFAULT_PIPELINE_CONFIG.retrieval.epsilon).toBe(before.epsilon);
    expect(DEFAULT_PIPELINE_CONFIG.retrieval.k).toBe(before.k);
    expect(DEFAULT_PIPELINE_WINDOW_SIZE).toBe(before.window);
    expect(SAMPLE_SIZE_FLOOR).toBe(before.floor);
    expect(FIXED_PRIOR_WEIGHT).toBe(before.shrink);
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(before.threshold);
    expect(DEFAULT_STOP_LOSS_PERCENTILE).toBe(before.sl);
    expect(DEFAULT_TAKE_PROFIT_PERCENTILE).toBe(before.tp);
    expect([...PATTERN_SCALES]).toEqual(before.scales);
  });

  it("mutating a returned baseline's params does not affect a fresh capture", () => {
    const first = captureFrozenBaseline();
    // Attempt a mutation on the returned array (defensive copy expectation).
    (first.params.patternScales as number[]).push(999);
    const second = captureLiveParameterSet();
    expect(second.patternScales).toEqual([10, 20, 40]);
  });
});
