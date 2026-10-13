import { describe, expect, it } from "vitest";
import { parameterSetToPipelineConfig } from "./pipelineForecastRegenerator.js";
import { captureLiveParameterSet } from "./parameterSet.js";
import { DEFAULT_PIPELINE_CONFIG } from "../pipeline/types.js";
import {
  DEFAULT_STOP_LOSS_PERCENTILE,
  DEFAULT_TAKE_PROFIT_PERCENTILE,
} from "../risk-boundaries/types.js";

// Feature: trader-edge-validation, Task 12: frozen ParameterSet -> PipelineConfig
// projection is faithful, so the regenerated OOS forecasts use the frozen knobs.

describe("parameterSetToPipelineConfig", () => {
  it("maps the live parameter set onto the live pipeline config", () => {
    const config = parameterSetToPipelineConfig(captureLiveParameterSet());
    expect(config.retrieval.k).toBe(DEFAULT_PIPELINE_CONFIG.retrieval.k);
    expect(config.retrieval.epsilon).toBe(DEFAULT_PIPELINE_CONFIG.retrieval.epsilon);
    expect(config.windowSize).toBe(DEFAULT_PIPELINE_CONFIG.windowSize);
    expect(config.riskBoundaries?.stopLossPercentile).toBe(DEFAULT_STOP_LOSS_PERCENTILE);
    expect(config.riskBoundaries?.takeProfitPercentile).toBe(DEFAULT_TAKE_PROFIT_PERCENTILE);
  });

  it("carries a tuned variant's knobs through verbatim", () => {
    const base = captureLiveParameterSet();
    const tuned = { ...base, retrievalK: 50, similarityEpsilon: 0.4, stopLossPercentile: 90 };
    const config = parameterSetToPipelineConfig(tuned);
    expect(config.retrieval.k).toBe(50);
    expect(config.retrieval.epsilon).toBe(0.4);
    expect(config.riskBoundaries?.stopLossPercentile).toBe(90);
  });
});
