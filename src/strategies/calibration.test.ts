import { describe, expect, it } from "vitest";

import { DEFAULT_CONFLUENCE_CONFIG, createConfluenceEngine } from "./confluenceEngine.js";
import {
  patternStrength,
  signalOf,
  statusReport,
  strengthDistribution,
  sweep,
  type CalibrationSample,
} from "./calibration.js";

const sample = (
  signals: ReturnType<typeof signalOf>[],
  realized: "UP" | "DOWN" | "FLAT",
): CalibrationSample => ({ pair: "EURUSD", date: "2024-01-02", signals, realized });

describe("conflict threshold regression (pattern vs trend)", () => {
  // The case that motivated the change: the pattern matcher calls UP with a
  // firing-level strength (~0.57) while the trend strategy calls DOWN firmly.
  const signals = [
    signalOf("trend", "DOWN", 0.9),
    signalOf("breakout", "FLAT", 0),
    signalOf("range", "FLAT", 0),
    signalOf("reversal", "FLAT", 0),
    signalOf("custom_pattern", "UP", 0.57),
  ];

  it("the default conflict threshold is 0.5", () => {
    expect(DEFAULT_CONFLUENCE_CONFIG.conflictThreshold).toBe(0.5);
    expect(DEFAULT_CONFLUENCE_CONFIG.alignmentThreshold).toBe(0.4);
  });

  it("is CONFLICT_FLAT under the calibrated defaults, naming both opposing strategies", () => {
    const engine = createConfluenceEngine();
    if (!engine.ok) throw new Error("default engine must be valid");
    const result = engine.value.aggregate(signals);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("CONFLICT_FLAT");
    expect(result.value.opposingStrategyIds).toEqual(["trend", "custom_pattern"]);
  });

  it("was NEUTRAL under the old 0.6 threshold (the bug this fixes)", () => {
    const engine = createConfluenceEngine({ conflictThreshold: 0.6 });
    if (!engine.ok) throw new Error("engine must be valid");
    const result = engine.value.aggregate(signals);
    expect(result.ok && result.value.status).toBe("NEUTRAL");
  });

  it("still ignores weak opposition (range/reversal-level strengths stay below 0.5)", () => {
    const weak = [signalOf("trend", "DOWN", 0.9), signalOf("range", "UP", 0.2), signalOf("reversal", "UP", 0.3)];
    const engine = createConfluenceEngine();
    if (!engine.ok) throw new Error("default engine must be valid");
    const result = engine.value.aggregate(weak);
    expect(result.ok && result.value.status).not.toBe("CONFLICT_FLAT");
  });
});

describe("patternStrength", () => {
  it("applies the fixed-prior shrinkage toward 0.5", () => {
    expect(patternStrength(30, 0.6)).toBeCloseTo(0.575, 6);
    expect(patternStrength(30, 0.5)).toBeCloseTo(0.5, 6);
    // More analogues -> less shrinkage.
    expect(patternStrength(200, 0.7)).toBeGreaterThan(patternStrength(30, 0.7));
  });
  it("a firing pattern (>= 0.55) clears the 0.5 conflict bar but not always 0.6", () => {
    expect(patternStrength(30, 0.62)).toBeLessThan(0.6);
    expect(patternStrength(30, 0.62)).toBeGreaterThanOrEqual(0.55);
  });
});

describe("strengthDistribution", () => {
  it("summarises directional calls only", () => {
    const samples = [
      sample([signalOf("trend", "UP", 0.2), signalOf("range", "FLAT", 0)], "UP"),
      sample([signalOf("trend", "DOWN", 0.6), signalOf("range", "UP", 0.4)], "DOWN"),
      sample([signalOf("trend", "UP", 1)], "UP"),
    ];
    const dist = strengthDistribution(samples);
    const trend = dist.find((d) => d.strategyId === "trend")!;
    expect(trend.n).toBe(3);
    expect(trend.p50).toBeCloseTo(0.6, 6);
    expect(trend.max).toBe(1);
    expect(dist.find((d) => d.strategyId === "range")!.n).toBe(1); // the FLAT was skipped
  });
});

describe("statusReport / sweep", () => {
  const aligned = (realized: "UP" | "DOWN"): CalibrationSample =>
    sample([signalOf("trend", "UP", 1), signalOf("breakout", "UP", 1)], realized);

  it("counts statuses and the aligned hit-rate through the real engine", () => {
    const report = statusReport(
      [aligned("UP"), aligned("UP"), aligned("DOWN"), sample([signalOf("trend", "FLAT", 0)], "UP")],
      { conflictThreshold: 0.5, alignmentThreshold: 0.3 },
    );
    expect(report.days).toBe(4);
    expect(report.counts.ALIGNED_UP).toBe(3);
    expect(report.alignedCalls).toBe(3);
    expect(report.alignedCorrect).toBe(2);
    expect(report.alignedHitRate).toBeCloseTo(2 / 3, 6);
  });

  it("reports a null hit-rate when nothing was aligned", () => {
    const report = statusReport([sample([], "UP")], { conflictThreshold: 0.5, alignmentThreshold: 0.4 });
    expect(report.alignedHitRate).toBeNull();
    expect(report.counts.INSUFFICIENT_DATA).toBe(1);
  });

  it("a higher alignment bar never creates MORE aligned days", () => {
    const samples = [aligned("UP"), sample([signalOf("trend", "UP", 0.6), signalOf("breakout", "UP", 0.5)], "UP")];
    const rows = sweep(samples, [0.5], [0.1, 0.3, 0.5]);
    const calls = rows.map((r) => r.alignedCalls);
    expect([...calls].sort((a, b) => b - a)).toEqual(calls);
  });

  it("rejects an out-of-range threshold loudly", () => {
    expect(() => statusReport([], { conflictThreshold: 2, alignmentThreshold: 0.4 })).toThrow();
  });
});
