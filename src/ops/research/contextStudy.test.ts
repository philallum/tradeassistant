import { describe, expect, it } from "vitest";

import type { Candle } from "../../guard/types.js";
import {
  adverse,
  contextOutcome,
  historicalStopQuantiles,
  MIN_STOP_HISTORY,
  pinball,
  quantileSorted,
  studyContext,
  type ContextRow,
} from "./contextStudy.js";
import { mulberry32 } from "./researchStats.js";

function c(k: number, o: number, h: number, l: number, cl: number): Candle {
  const d = new Date(Date.UTC(2014, 0, 6) + k * 86_400_000).toISOString().slice(0, 10);
  return { asset: "EURUSD", date: d, open: o, high: h, low: l, close: cl };
}

function walk(n: number, seed: number): Candle[] {
  const rand = mulberry32(seed);
  let p = 1.1;
  return Array.from({ length: n }, (_, k) => {
    const o = p;
    const cl = o + (rand() - 0.5) * 0.01;
    p = cl;
    return c(k, o, Math.max(o, cl) + rand() * 0.004, Math.min(o, cl) - rand() * 0.004, cl);
  });
}

describe("contextOutcome", () => {
  it("computes next-week range / ATR, the 5-session efficiency ratio and next-session range", () => {
    // Five sessions after i = 0, each range 0.02, closes rising 1.00 -> 1.05 in a straight line.
    const cs = [c(0, 1, 1, 1, 1), ...[1, 2, 3, 4, 5].map((k) => c(k, 1 + (k - 1) * 0.01, 1 + k * 0.01 + 0.005, 1 + (k - 1) * 0.01 - 0.005, 1 + k * 0.01))];
    const o = contextOutcome(cs, 0, 0.01);
    expect(Math.exp(o.logRangeRatio as number)).toBeCloseTo(2, 9);
    expect(o.er5).toBeCloseTo(1, 9);
    expect(o.nextRangeRatio).toBeCloseTo(2, 9);
  });

  it("efficiency ratio is low for a round trip", () => {
    const cs = [c(0, 1, 1, 1, 1), c(1, 1, 1.03, 0.99, 1.02), c(2, 1.02, 1.03, 0.99, 1), c(3, 1, 1.03, 0.99, 1.02), c(4, 1.02, 1.03, 0.99, 1), c(5, 1, 1.03, 0.99, 1.0)];
    expect(contextOutcome(cs, 0, 0.01).er5 as number).toBeLessThan(0.05);
  });

  it("is null when the window runs past the data or ATR is zero", () => {
    expect(contextOutcome([c(0, 1, 1, 1, 1)], 0, 0.01).er5).toBeNull();
    expect(contextOutcome(walk(10, 1), 0, 0).logRangeRatio).toBeNull();
  });
});

describe("stop helpers", () => {
  it("adverse excursion is measured against the position from the open", () => {
    const k = c(1, 1.0, 1.02, 0.97, 1.01);
    expect(adverse(k, "UP")).toBeCloseTo(0.03, 12);
    expect(adverse(k, "DOWN")).toBeCloseTo(0.02, 12);
  });

  it("quantile and pinball loss match hand values", () => {
    expect(quantileSorted([1, 2, 3, 4, 5], 0.75)).toBeCloseTo(4, 12);
    expect(pinball(2, 1, 0.75)).toBeCloseTo(0.75, 12);
    expect(pinball(1, 2, 0.75)).toBeCloseTo(0.25, 12);
  });

  it("historical quantiles use only sessions before the decision date's candle", () => {
    const cs = walk(MIN_STOP_HISTORY + 80, 2);
    const i = MIN_STOP_HISTORY + 40;
    const a = historicalStopQuantiles(cs);
    const tampered = cs.map((x, k) => (k >= i ? ({ ...x, high: x.high + 1, low: x.low - 1 }) : x));
    const b = historicalStopQuantiles(tampered);
    expect(a.ratioQ[i]).not.toBeNull();
    expect(b.ratioQ[i]).toEqual(a.ratioQ[i]);
    expect(b.priceQ[i]).toEqual(a.priceQ[i]);
    expect(a.ratioQ[10]).toBeNull(); // too little history
  });
});

function rows(n: number, seed: number, plant: { v1?: boolean; e1?: boolean }): ContextRow[] {
  const rand = mulberry32(seed);
  const start = Date.parse("2013-06-03T00:00:00Z");
  return Array.from({ length: n }, (_, d) => {
    const date = new Date(start + (d + 2 * Math.floor(d / 5)) * 86_400_000).toISOString().slice(0, 10);
    const compression = 0.5 + rand();
    const event = date >= "2021-01-01" && rand() < 0.15; // enough event rows to clear the 200 minimum
    const noise = (rand() - 0.5) * 0.6;
    const y = (plant.v1 === true ? -0.4 * (compression - 1) : 0) + noise;
    const er5 = rand();
    const statusR = rand();
    const yStop = rand() * 1.2;
    return {
      pair: (["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const)[d % 5] ?? "EURUSD",
      date,
      compression,
      atrPercentile: rand(),
      er14: rand(),
      confluenceStatus: statusR < 0.3 ? "CONFLICT_FLAT" : "NEUTRAL",
      eventKinds: date < "2021-01-01" ? null : event ? ["US_NFP"] : [],
      logRangeRatio: y,
      er5,
      nextRangeRatio: (plant.e1 === true && event ? 1.6 : 1) * (0.6 + rand() * 0.8),
      stop: { y: yStop, analogue: 0.9, atrScaled: 0.9, priceUncond: 0.9 },
    };
  });
}

describe("studyContext", () => {
  it("null data: nothing usable", () => {
    const s = studyContext(rows(3000, 7, {}));
    expect(s.tests).toHaveLength(6);
    expect(s.tests.filter((t) => t.usable)).toHaveLength(0);
    expect(s.tests.filter((t) => t.significant).length).toBeLessThanOrEqual(1);
    // identical stop rules: zero loss difference
    expect(s.tests.find((t) => t.id === "Q1")?.estimate).toBeCloseTo(0, 12);
  }, 180_000);

  it("planted compression and event effects are found and usable; the others are not", () => {
    const s = studyContext(rows(4000, 8, { v1: true, e1: true }));
    const byId = new Map(s.tests.map((t) => [t.id, t]));
    expect(byId.get("V1")?.usable).toBe(true);
    expect(byId.get("V1")?.estimate).toBeLessThan(0);
    expect(byId.get("E1")?.usable).toBe(true);
    expect(byId.get("E1")?.practical.value).toBeGreaterThan(1.3);
    expect(byId.get("S1")?.usable).toBe(false);
  }, 180_000);
});
