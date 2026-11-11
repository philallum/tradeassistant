import { describe, expect, it } from "vitest";

import type { Candle } from "../../guard/types.js";
import { XTB_STANDARD_MODEL } from "./costModel.js";
import { buildOutcomeTable, OUTCOMES, type OutcomeId } from "./horizonOutcomes.js";
import type { ResearchRow, RuleStrategyId } from "./researchDataset.js";
import { mulberry32 } from "./researchStats.js";
import { excessHit, strategyTrades, studyStrategyHorizons, type StrategyTrade } from "./strategyHorizonStudy.js";

function trade(call: "UP" | "DOWN", real: "UP" | "DOWN", date = "2018-03-05"): StrategyTrade {
  return { pair: "EURUSD", date, call, weeklyTrendSign: "UP", realisedSide: real, hit: call === real, baselineHit: real === "UP", net: 0 };
}

describe("excessHit", () => {
  it("is zero for an always-long strategy in a rising market (no timing skill)", () => {
    const t = [...Array.from({ length: 70 }, () => trade("UP", "UP")), ...Array.from({ length: 30 }, () => trade("UP", "DOWN"))];
    // hit 70% but expected 1.0 x 0.7 = 70%
    expect(excessHit(t)).toBeCloseTo(0, 12);
  });

  it("is positive when calls line up with outcomes beyond the mix", () => {
    const t = [...Array.from({ length: 40 }, () => trade("UP", "UP")), ...Array.from({ length: 40 }, () => trade("DOWN", "DOWN")), ...Array.from({ length: 10 }, () => trade("UP", "DOWN")), ...Array.from({ length: 10 }, () => trade("DOWN", "UP"))];
    // hit 80%, u = r = 0.5 -> expected 50%
    expect(excessHit(t)).toBeCloseTo(0.3, 12);
  });

  it("ignores unscored trades and is NaN with none", () => {
    expect(Number.isNaN(excessHit([]))).toBe(true);
    const unscored: StrategyTrade = { ...trade("UP", "UP"), realisedSide: null, hit: null, baselineHit: null };
    expect(excessHit([unscored, trade("UP", "UP")])).toBeCloseTo(0, 12);
  });
});

function candles(n: number, seed: number): Candle[] {
  const rand = mulberry32(seed);
  let p = 1.1;
  return Array.from({ length: n }, (_, k) => {
    const o = p;
    const c = o + (rand() - 0.5) * 0.01;
    p = c;
    const d = new Date(Date.UTC(2015, 0, 5) + k * 86_400_000).toISOString().slice(0, 10);
    return { asset: "EURUSD", date: d, open: o, high: Math.max(o, c) + 0.002, low: Math.min(o, c) - 0.002, close: c };
  });
}

describe("strategyTrades", () => {
  const cs = candles(140, 9);
  const t = buildOutcomeTable(cs, 0.0001);
  const mk = (k: number, trend: "UP" | "DOWN" | "FLAT" | null): ResearchRow =>
    ({ pair: "EURUSD", date: (cs[k] as Candle).date, weeklyTrendSign: "UP", strategies: { trend, breakout: null, range: "FLAT", reversal: null } }) as unknown as ResearchRow;

  it("takes only UP/DOWN days and drops rows whose 5-session window leaves the window", () => {
    const rows = [mk(100, "UP"), mk(101, "FLAT"), mk(102, null), mk(103, "DOWN"), mk(130, "UP")];
    const tr = strategyTrades(rows, new Map([["EURUSD" as const, t]]), "trend", "H3", XTB_STANDARD_MODEL, (cs[128] as Candle).date);
    expect(tr.map((x) => x.date)).toEqual([100, 103].map((k) => (cs[k] as Candle).date));
  });

  it("scores the call against the same realised outcome and pays cost once", () => {
    const [x] = strategyTrades([mk(100, "DOWN")], new Map([["EURUSD" as const, t]]), "trend", "H5", XTB_STANDARD_MODEL, (cs[139] as Candle).date);
    const real = t.byOutcome.H5[100];
    expect(x?.net).toBeCloseTo(-(real?.upPips ?? 0) - 1.0, 9);
    expect(x?.hit).toBe(real?.side === null ? null : real?.side === "DOWN");
  });
});

describe("studyStrategyHorizons", () => {
  function synth(n: number, seed: number, skill: number, lean: number): StrategyTrade[] {
    const rand = mulberry32(seed);
    const start = Date.parse("2013-06-03T00:00:00Z");
    return Array.from({ length: n }, (_, d) => {
      const date = new Date(start + (d + 2 * Math.floor(d / 5)) * 86_400_000).toISOString().slice(0, 10);
      const real = rand() < 0.5 + lean ? "UP" : "DOWN";
      const call = rand() < skill ? real : rand() < 0.5 + lean ? "UP" : "DOWN";
      return { ...trade(call, real, date), pair: (["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const)[d % 5] ?? "EURUSD", net: call === real ? 20 : -21 };
    });
  }
  function all(make: (s: RuleStrategyId, o: OutcomeId, k: number) => StrategyTrade[]): Record<RuleStrategyId, Record<OutcomeId, StrategyTrade[]>> {
    const out = {} as Record<RuleStrategyId, Record<OutcomeId, StrategyTrade[]>>;
    let k = 0;
    for (const s of ["trend", "breakout", "range", "reversal"] as const) {
      out[s] = {} as Record<OutcomeId, StrategyTrade[]>;
      for (const o of OUTCOMES) out[s][o] = make(s, o, (k += 1));
    }
    return out;
  }

  it("a pure lean with a trending market is not called skill", () => {
    // Market goes up 60% of the time and every strategy leans long 60%: hit > 50% but no skill.
    const s = studyStrategyHorizons(all((_, __, k) => synth(2500, 300 + k, 0, 0.1)));
    expect(s.promising).toHaveLength(0);
    expect(s.cells.filter((c) => c.significant).length).toBeLessThanOrEqual(1);
    expect(s.cells.every((c) => Math.abs(c.excess) < 0.05)).toBe(true);
  }, 180_000);

  it("planted timing skill in one cell is found", () => {
    const s = studyStrategyHorizons(all((st, o, k) => synth(3000, 600 + k, st === "breakout" && o === "H5" ? 0.15 : 0, 0)));
    const c = s.cells.find((x) => x.strategy === "breakout" && x.outcome === "H5");
    expect(c?.significant).toBe(true);
    expect(c?.excess).toBeGreaterThan(0.04);
    expect(s.promising.map((x) => `${x.strategy}/${x.outcome}`)).toEqual(["breakout/H5"]);
  }, 180_000);
});
