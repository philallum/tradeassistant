import { describe, expect, it } from "vitest";
import {
  atrUsable,
  clamp01,
  emaSeries,
  populationStdDev,
  roundTo,
  rsiWilder,
  sma,
} from "./indicators.js";

// --- sma ---------------------------------------------------------------------

describe("sma — mean of the last n values", () => {
  it("averages the trailing window", () => {
    // Last 3 of [1,2,3,4,5] are [3,4,5]; mean = 12/3 = 4.
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4);
  });

  it("uses the whole series when n equals the length", () => {
    // [2,4,6] -> 12/3 = 4.
    expect(sma([2, 4, 6], 3)).toBe(4);
  });
});

// --- populationStdDev --------------------------------------------------------

describe("populationStdDev — divides by N (population, not sample)", () => {
  it("matches a hand-computed series", () => {
    // [2,4,4,4,5,5,7,9]: mean = 40/8 = 5.
    // squared deviations: 9,1,1,1,0,0,4,16 -> sum 32; variance = 32/8 = 4.
    // stddev = sqrt(4) = 2.
    expect(populationStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it("returns 0 for a single value", () => {
    expect(populationStdDev([42])).toBe(0);
  });
});

// --- emaSeries ---------------------------------------------------------------

describe("emaSeries — SMA-seeded EMA aligned to the input index", () => {
  it("is undefined before the seed index, seeds with SMA, then recurses", () => {
    // values [1,2,3,4,5], period 3: alpha = 2/(3+1) = 0.5.
    // index 0,1: undefined (before period-1 = 2).
    // index 2 (seed): SMA([1,2,3]) = 2.
    // index 3: 0.5*4 + 0.5*2 = 3.
    // index 4: 0.5*5 + 0.5*3 = 4.
    const series = emaSeries([1, 2, 3, 4, 5], 3);

    expect(series).toHaveLength(5);
    expect(series[0]).toBeUndefined();
    expect(series[1]).toBeUndefined();
    expect(series[2]).toBe(2);
    expect(series[3]).toBe(3);
    expect(series[4]).toBe(4);
  });

  it("returns an all-undefined series when there are fewer values than the period", () => {
    const series = emaSeries([1, 2], 3);
    expect(series).toEqual([undefined, undefined]);
  });
});

// --- rsiWilder ---------------------------------------------------------------

describe("rsiWilder — Wilder-smoothed RSI with edge cases", () => {
  it("computes a hand-checked mixed case", () => {
    // closes [10,11,9,12], period 2.
    // changes = [1,-2,3].
    // seed over first 2 changes: avgGain = 1/2 = 0.5, avgLoss = 2/2 = 1.
    // i=2 (change 3): gain 3, loss 0.
    //   avgGain = (0.5*1 + 3)/2 = 1.75; avgLoss = (1*1 + 0)/2 = 0.5.
    // rs = 1.75/0.5 = 3.5; rsi = 100 - 100/4.5 = 77.77777...
    expect(rsiWilder([10, 11, 9, 12], 2)).toBeCloseTo(100 - 100 / 4.5, 12);
  });

  it("returns 100 when the average loss is 0 and the average gain is not (all gains)", () => {
    // Strictly increasing closes -> every change a gain, avgLoss stays 0.
    expect(rsiWilder([1, 2, 3, 4], 2)).toBe(100);
  });

  it("returns 50 when every change is 0 (both averages 0)", () => {
    // Flat closes -> avgGain and avgLoss both 0.
    expect(rsiWilder([5, 5, 5, 5], 2)).toBe(50);
  });
});

// --- roundTo -----------------------------------------------------------------

describe("roundTo — fixed-precision rounding with -0 normalised to 0", () => {
  it("rounds to the requested decimal places", () => {
    expect(roundTo(1.23456, 2)).toBe(1.23);
    expect(roundTo(1.005, 2)).toBeCloseTo(1, 10);
  });

  it("normalises a literal -0 to +0", () => {
    const result = roundTo(-0, 2);
    expect(result).toBe(0);
    // Object.is distinguishes -0 from +0; assert we got +0.
    expect(Object.is(result, 0)).toBe(true);
    expect(Object.is(result, -0)).toBe(false);
  });

  it("normalises a value that rounds to -0 to +0", () => {
    // A tiny negative value rounds to -0 via toFixed; must come back as +0.
    const result = roundTo(-0.0001, 2);
    expect(Object.is(result, 0)).toBe(true);
    expect(Object.is(result, -0)).toBe(false);
  });
});

// --- clamp01 -----------------------------------------------------------------

describe("clamp01 — clamp into [0, 1], NaN -> 0", () => {
  it("passes through values already in range", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });

  it("clamps out-of-range values to the bounds", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(5)).toBe(1);
  });

  it("maps NaN to 0", () => {
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

// --- atrUsable ---------------------------------------------------------------

describe("atrUsable — finite and strictly positive", () => {
  it("accepts a finite positive ATR", () => {
    expect(atrUsable(0.0085)).toBe(true);
  });

  it("rejects zero, negative, and non-finite ATR", () => {
    expect(atrUsable(0)).toBe(false);
    expect(atrUsable(-1)).toBe(false);
    expect(atrUsable(Number.NaN)).toBe(false);
    expect(atrUsable(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
