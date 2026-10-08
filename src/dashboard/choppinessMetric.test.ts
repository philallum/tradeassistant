// Unit tests for the Choppiness_Metric (Efficiency Ratio) — DISPLAY-ONLY
// (Requirements 3.1, 3.2). The former Choppiness_Guard suppression has been
// removed; only the look-ahead-safe metric computation is retained and these
// tests cover its core deterministic behaviour.

import { describe, expect, it } from "vitest";

import { efficiencyRatio, efficiencyRatioFromCloses } from "./choppinessMetric.js";
import type { Candle, TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

const DECISION_DATE = "2024-06-15" as TradingDate;

function candlesFromCloses(pair: Pair, closes: readonly number[]): Candle[] {
  return closes.map((close, i) => {
    const day = String((i % 28) + 1).padStart(2, "0");
    return { asset: pair, date: `2024-04-${day}`, open: close, high: close, low: close, close };
  });
}

describe("efficiencyRatioFromCloses", () => {
  it("returns 1 for a perfectly straight-line move", () => {
    expect(efficiencyRatioFromCloses([1, 2, 3, 4, 5], 4)).toBeCloseTo(1, 10);
  });

  it("returns 0 for a path that returns to its origin (pure chop)", () => {
    expect(efficiencyRatioFromCloses([1, 2, 1, 2, 1], 4)).toBe(0);
  });

  it("returns a value strictly between 0 and 1 for a noisy uptrend", () => {
    const er = efficiencyRatioFromCloses([1, 3, 2, 4, 3, 5], 5);
    expect(er).toBeGreaterThan(0);
    expect(er).toBeLessThan(1);
  });

  it("returns 0 for degenerate inputs (empty, single close, non-positive window)", () => {
    expect(efficiencyRatioFromCloses([], 14)).toBe(0);
    expect(efficiencyRatioFromCloses([42], 14)).toBe(0);
    expect(efficiencyRatioFromCloses([1, 2, 3], 0)).toBe(0);
  });

  it("is deterministic for identical inputs (Requirement 3.1)", () => {
    const closes = [1, 3, 2, 5, 4, 6];
    expect(efficiencyRatioFromCloses(closes, 5)).toBe(efficiencyRatioFromCloses(closes, 5));
  });
});

describe("efficiencyRatio (look-ahead-safe)", () => {
  it("ignores candles dated on or after the Decision_Date (Requirement 3.2)", () => {
    const closes = [1, 2, 3, 4, 5];
    const candles = candlesFromCloses("EURUSD", closes);
    const withFuture: Candle[] = [
      ...candles,
      { asset: "EURUSD", date: "2024-06-20", open: 1, high: 1, low: 1, close: 1 },
    ];
    const clean = efficiencyRatio(candles, DECISION_DATE, 4);
    const guarded = efficiencyRatio(withFuture, DECISION_DATE, 4);
    expect(guarded).toBe(clean);
  });

  it("yields a metric in [0,1] and is deterministic", () => {
    const candles = candlesFromCloses("EURUSD", [1, 3, 2, 5, 4, 6]);
    const er1 = efficiencyRatio(candles, DECISION_DATE, 5);
    const er2 = efficiencyRatio(candles, DECISION_DATE, 5);
    expect(er1).toBe(er2);
    expect(er1).toBeGreaterThanOrEqual(0);
    expect(er1).toBeLessThanOrEqual(1);
  });
});
