import { describe, expect, it } from "vitest";

import type { ResearchRow } from "./researchDataset.js";
import { mulberry32 } from "./researchStats.js";
import { evaluateCell, studySubset } from "./studies.js";

const PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const;

interface Overrides {
  readonly hit?: boolean;
  readonly baselineHit?: boolean;
  readonly netPips?: number;
}

function row(i: number, rand: () => number, o: Overrides = {}): ResearchRow {
  const start = Date.parse("2016-01-04T00:00:00Z");
  const day = Math.floor(i / 5);
  const date = new Date(start + (day + 2 * Math.floor(day / 5)) * 86_400_000).toISOString().slice(0, 10);
  const dir = rand() < 0.5 ? "UP" : "DOWN";
  const hit = o.hit ?? rand() < 0.5;
  const baselineHit = o.baselineHit ?? rand() < 0.5;
  return {
    pair: PAIRS[i % 5] as (typeof PAIRS)[number],
    date,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    direction: dir,
    fires: rand() < 0.45,
    confidence: 0.5 + rand() * 0.2,
    n: Math.floor(rand() * 150),
    nearestDistance: rand() * 0.2,
    medianDistance: rand() * 0.2,
    meanDistance: rand() * 0.2,
    rawAgreement: 0.5 + rand() * 0.5,
    closest10Agreement: rand() < 0.5 ? 0.5 + Math.floor(rand() * 6) / 10 : null,
    closest25Agreement: null,
    atr14: 0.005,
    atrPips: 50,
    atrPercentile: rand(),
    efficiencyRatio: rand(),
    weeklyTrendSign: rand() < 0.5 ? "UP" : "DOWN",
    yesterdaySign: "UP",
    stopLossPips: null,
    takeProfitPips: null,
    usdLong: dir === "UP",
    eventOnTargetSession: null,
    strategies: {
      trend: rand() < 0.5 ? "UP" : "DOWN",
      breakout: "FLAT",
      range: "FLAT",
      reversal: null,
    },
    agreeCount: Math.floor(rand() * 3),
    opposeCount: Math.floor(rand() * 3),
    confluenceScore: 0,
    confluenceStatus: "NEUTRAL",
    targetDate: date,
    targetClose: 1.1,
    realizedSign: hit ? dir : dir === "UP" ? "DOWN" : "UP",
    realizedPips: 10,
    hit,
    baselineHit,
    netPips: o.netPips ?? (hit ? 9 : -11),
    hitOn: hit,
    netPipsOn: o.netPips ?? (hit ? 9 : -11),
    costPips: 1,
    features: null,
  };
}

describe("evaluateCell", () => {
  it("counts scored days, hit rates, uplift and net expectancy", () => {
    const rand = mulberry32(1);
    const rows = [
      row(0, rand, { hit: true, baselineHit: false, netPips: 5 }),
      row(1, rand, { hit: true, baselineHit: true, netPips: 3 }),
      row(2, rand, { hit: false, baselineHit: true, netPips: -4 }),
      row(3, rand, { hit: true, baselineHit: false, netPips: 2 }),
    ];
    const c = evaluateCell(rows, "test", "all", "exploratory");
    expect(c.scored).toBe(4);
    expect(c.modelHit).toBeCloseTo(0.75, 12);
    expect(c.baselineHit).toBeCloseTo(0.5, 12);
    expect(c.delta).toBeCloseTo(0.25, 12);
    expect(c.netMean).toBeCloseTo(1.5, 12);
    expect(c.reportable).toBe(false);
  });

  it("excludes days with no scoreable outcome from the denominator", () => {
    const rand = mulberry32(2);
    const base = row(0, rand, { hit: true, baselineHit: true });
    const unscored: ResearchRow = { ...base, hit: null, baselineHit: null, netPips: null };
    const c = evaluateCell([base, unscored], "test", "all", "exploratory");
    expect(c.scored).toBe(1);
    expect(c.days).toBe(2);
  });
});

describe("studySubset", () => {
  it("null data: nothing is called significant and no candidate edge exists", () => {
    const rand = mulberry32(2024);
    const rows = Array.from({ length: 3000 }, (_, i) => row(i, rand));
    const s = studySubset(rows, "directional");
    expect(s.variables.flatMap((v) => (v.correlation === null ? [] : [v.correlation])).filter((c) => c.significant)).toHaveLength(0);
    expect([...s.variables.flatMap((v) => v.cells), ...s.strategyCells].filter((c) => c.significant)).toHaveLength(0);
    expect(s.standalone.filter((x) => x.significant)).toHaveLength(0);
  }, 120_000);

  it("a planted gradient in analogue count is found, in the expected direction", () => {
    const rand = mulberry32(77);
    const rows: ResearchRow[] = [];
    for (let i = 0; i < 4000; i += 1) {
      const base = row(i, rand);
      const strong = rand() < 0.5;
      const n = strong ? 80 + Math.floor(rand() * 60) : Math.floor(rand() * 20);
      const hit = rand() < (strong ? 0.62 : 0.5);
      rows.push({ ...base, n, hit, realizedSign: hit ? base.direction : base.direction === "UP" ? "DOWN" : "UP", netPips: hit ? 9 : -11 });
    }
    const s = studySubset(rows, "directional");
    const h1 = s.variables.find((v) => v.id === "n")?.correlation;
    expect(h1?.significant).toBe(true);
    expect(h1?.matchesExpectation).toBe(true);
    expect(h1?.rho).toBeGreaterThan(0);
  }, 120_000);

  it("firing subset only contains firing days", () => {
    const rand = mulberry32(5);
    const rows = Array.from({ length: 600 }, (_, i) => row(i, rand));
    const firing = rows.filter((r) => r.fires && r.direction !== "FLAT" && r.hit !== null).length;
    expect(studySubset(rows, "firing").overall.scored).toBe(firing);
  }, 120_000);
});
