import { describe, expect, it } from "vitest";

import type { Candle } from "../../guard/types.js";
import {
  computeChartFeatures,
  confirmedPivots,
  featureVector,
  MIN_FEATURE_HISTORY,
  orient,
} from "./chartFeatures.js";

function candle(i: number, o: number, h: number, l: number, c: number): Candle {
  const d = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
  return { asset: "EURUSD", date: d, open: o, high: h, low: l, close: c };
}

/** Candle i: open slightly below close f(i), high f(i)+0.5, low f(i)-0.5 (no tied neighbours at turns). */
function series(n: number, f: (i: number) => number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const v = f(i);
    return candle(i, v - 0.1, v + 0.5, v - 0.5, v);
  });
}

describe("confirmedPivots (no look-ahead)", () => {
  // A single sharp peak at index 10.
  const base = (n: number): Candle[] => series(n, (i) => 100 + (i === 10 ? 10 : 0));

  it("the newest two candles can never be pivots", () => {
    expect(confirmedPivots(base(12), "high")).toEqual([]); // peak has only 1 later candle
    expect(confirmedPivots(base(11), "high")).toEqual([]); // peak is the newest candle
  });

  it("a peak is recognised once two later candles exist", () => {
    expect(confirmedPivots(base(13), "high")).toEqual([10]);
  });

  it("future candles beyond the cut cannot change a pivot decision made at the cut", () => {
    const full = series(60, (i) => 100 + 5 * Math.sin(i / 3));
    for (let cut = 30; cut < 58; cut += 1) {
      const atCut = confirmedPivots(full.slice(0, cut), "high");
      const later = confirmedPivots(full.slice(0, cut + 2), "high").filter((k) => k <= cut - 3);
      // Pivots that were confirmable at the cut must still be pivots later (no revision).
      for (const k of atCut) expect(later).toContain(k);
    }
  });
});

describe("computeChartFeatures", () => {
  it("returns null with too little history", () => {
    expect(computeChartFeatures(series(10, (i) => 100 + i))).toBeNull();
  });

  it("a steady uptrend: range position at the top, price above its averages, higher highs and lows", () => {
    // Rising zigzag so pivots exist: +3 per step with a dip every 6th candle.
    const f = computeChartFeatures(series(200, (i) => 100 + 1.0 * i + 6 * Math.sin(i / 2)));
    expect(f).not.toBeNull();
    const x = f as NonNullable<typeof f>;
    expect(x.rangePos20 as number).toBeGreaterThan(0.6);
    expect(x.rangePos120 as number).toBeGreaterThan(0.6);
    expect(x.distSma20Atr as number).toBeGreaterThan(0);
    expect(x.trend20Atr as number).toBeGreaterThan(0);
    expect(x.swing).toBe(1);
  });

  it("a steady downtrend gives lower highs and lower lows", () => {
    const f = computeChartFeatures(series(200, (i) => 400 - 1.0 * i + 6 * Math.sin(i / 2)));
    expect((f as NonNullable<typeof f>).swing).toBe(-1);
    expect((f as NonNullable<typeof f>).trend20Atr as number).toBeLessThan(0);
  });

  it("channel excursion is positive after a close above the prior 20-day high", () => {
    const flat = series(150, () => 100);
    const last = flat[flat.length - 1] as Candle;
    const spike = candle(150, last.close, 103, 100, 102.5);
    const f = computeChartFeatures([...flat, spike]) as NonNullable<ReturnType<typeof computeChartFeatures>>;
    expect(f.channelExcursion as number).toBeGreaterThan(0);
    const inside = computeChartFeatures(flat) as NonNullable<ReturnType<typeof computeChartFeatures>>;
    expect(inside.channelExcursion).toBe(0);
  });

  it("candle shape: body, wicks and close position of the last candle", () => {
    const flat = series(150, () => 100);
    const shaped = candle(150, 100, 110, 98, 108); // range 12, body +8, upper wick 2, lower wick 2
    const f = computeChartFeatures([...flat, shaped]) as NonNullable<ReturnType<typeof computeChartFeatures>>;
    expect(f.body).toBeCloseTo(8 / 12, 12);
    expect(f.upperWick).toBeCloseTo(2 / 12, 12);
    expect(f.lowerWick).toBeCloseTo(2 / 12, 12);
    expect(f.closePos).toBeCloseTo(10 / 12, 12);
  });

  it("is a pure function of the candles it is given", () => {
    const a = series(200, (i) => 100 + 5 * Math.sin(i / 7));
    const b = a.map((c, i) => (i >= 150 ? ({ ...c, high: c.high + 50, close: c.close + 20 }) : c));
    expect(computeChartFeatures(a.slice(0, 150))).toEqual(computeChartFeatures(b.slice(0, 150)));
  });
});

describe("featureVector / orient", () => {
  const f = computeChartFeatures(series(MIN_FEATURE_HISTORY + 20, (i) => 100 + 4 * Math.sin(i / 3))) as NonNullable<
    ReturnType<typeof computeChartFeatures>
  >;

  it("has 13 numbers, each within [-1, 1]", () => {
    const v = featureVector(f) as number[];
    expect(v).toHaveLength(13);
    for (const x of v) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Math.abs(x)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("is null when a required feature is unavailable", () => {
    expect(featureVector({ ...f, swing: null })).toBeNull();
  });

  it("orientation mirrors a DOWN setup", () => {
    const up = orient(f, "UP");
    const down = orient(f, "DOWN");
    expect((down.rangePosDir as number) + (up.rangePosDir as number)).toBeCloseTo(1, 12);
    expect(down.bodyDir).toBeCloseTo(-up.bodyDir, 12);
    expect(down.closePosDir + up.closePosDir).toBeCloseTo(1, 12);
    expect(up.wickRejection).toBeCloseTo(f.lowerWick, 12);
    expect(down.wickRejection).toBeCloseTo(f.upperWick, 12);
  });
});
