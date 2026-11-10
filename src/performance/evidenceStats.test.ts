import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { effectiveSampleSize, matchedDeltaInterval, summarizeRate, wilsonInterval } from "./evidenceStats.js";

describe("evidenceStats", () => {
  it("wilson interval matches a known value (50/100 -> ~[0.404, 0.596])", () => {
    const ci = wilsonInterval(50, 100);
    expect(ci.lo).toBeCloseTo(0.4038, 3);
    expect(ci.hi).toBeCloseTo(0.5962, 3);
  });

  it("wilson interval is [0,1] with no data and stays inside [0,1]", () => {
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1 });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 1, max: 500 }), (s, n) => {
        const successes = Math.min(s, n);
        const ci = wilsonInterval(successes, n);
        const p = successes / n;
        return ci.lo >= 0 && ci.hi <= 1 && ci.lo <= p + 1e-12 && p <= ci.hi + 1e-12;
      }),
    );
  });

  it("the interval narrows as n grows", () => {
    const small = wilsonInterval(5, 10);
    const large = wilsonInterval(500, 1000);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it("matched delta interval reproduces the recorded half-width (n=28470 -> ~0.0058)", () => {
    const ci = matchedDeltaInterval(0.0124, 28470);
    expect((ci.hi - ci.lo) / 2).toBeCloseTo(0.0058, 4);
  });

  it("discounting the sample size widens the interval", () => {
    const raw = matchedDeltaInterval(0.0124, 28470);
    const eff = matchedDeltaInterval(0.0124, effectiveSampleSize(28470, 10));
    expect(eff.hi - eff.lo).toBeGreaterThan(raw.hi - raw.lo);
  });

  it("summarizeRate carries n and the interval", () => {
    const r = summarizeRate(55, 100);
    expect(r).toMatchObject({ n: 100, successes: 55, rate: 0.55 });
    expect(r.ci95.lo).toBeLessThan(0.55);
  });
});
