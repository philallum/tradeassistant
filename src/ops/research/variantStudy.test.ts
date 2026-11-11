import { describe, expect, it } from "vitest";

import { XTB_STANDARD_MODEL } from "./costModel.js";
import { mulberry32 } from "./researchStats.js";
import { compareVariants, rowsFromRecords, studyVariants, summariseVariant, type VariantRow } from "./variantStudy.js";
import type { DayRecord } from "../local-eval/dayRecords.js";

function rows(n: number, hitP: number, seed: number): VariantRow[] {
  const rand = mulberry32(seed);
  const start = Date.parse("2016-01-04T00:00:00Z");
  return Array.from({ length: n }, (_, i) => {
    const day = Math.floor(i / 5);
    const date = new Date(start + (day + 2 * Math.floor(day / 5)) * 86_400_000).toISOString().slice(0, 10);
    const hit = rand() < hitP;
    return {
      pair: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"][i % 5] as string,
      date,
      direction: rand() < 0.5 ? "UP" : "DOWN",
      fires: rand() < 0.5,
      confidence: 0.55,
      n: 30,
      weeklyTrendSign: "UP",
      hit,
      baselineHit: rand() < 0.5,
      net: hit ? 8 : -10,
    };
  });
}

describe("rowsFromRecords", () => {
  const rec = (over: Partial<DayRecord>): DayRecord =>
    ({
      pair: "EURUSD",
      date: "2024-03-04",
      weekday: 1,
      weeklyTrendSign: "UP",
      direction: "UP",
      horizon: 1,
      confidence: 0.6,
      fires: true,
      n: 30,
      meanCosineDistance: 0.1,
      atr14: 0.005,
      atrPercentile: 0.5,
      yesterdaySign: "UP",
      realizedAfter: { sign: "UP", pips: 20 },
      realizedOn: null,
      ...over,
    });

  it("scores a correct call and deducts the pair's cost", () => {
    const [r] = rowsFromRecords([rec({})], XTB_STANDARD_MODEL);
    expect(r?.hit).toBe(true);
    expect(r?.baselineHit).toBe(true);
    expect(r?.net).toBeCloseTo(20 - 1.0, 12); // EURUSD total 0.8 + 0 + 0.2
  });

  it("a DOWN call earns the negative of the move, and costs differ by pair", () => {
    const [r] = rowsFromRecords([rec({ direction: "DOWN", pair: "USDCHF", realizedAfter: { sign: "DOWN", pips: -15 } })], XTB_STANDARD_MODEL);
    expect(r?.hit).toBe(true);
    expect(r?.net).toBeCloseTo(15 - 2.1, 12);
  });

  it("a FLAT realised session is not scoreable but still has a net result", () => {
    const [r] = rowsFromRecords([rec({ realizedAfter: { sign: "FLAT", pips: 0 } })], XTB_STANDARD_MODEL);
    expect(r?.hit).toBeNull();
    expect(r?.baselineHit).toBeNull();
    expect(r?.net).toBeCloseTo(-1.0, 12);
  });

  it("no call means no hit and no net", () => {
    const [r] = rowsFromRecords([rec({ direction: "FLAT" })], XTB_STANDARD_MODEL);
    expect(r?.hit).toBeNull();
    expect(r?.net).toBeNull();
  });
});

describe("XTB cost model", () => {
  it("matches the pre-registered totals", () => {
    const t = (p: keyof typeof XTB_STANDARD_MODEL.perPairCost): number => {
      const c = XTB_STANDARD_MODEL.perPairCost[p];
      return c.spreadPips + c.commissionPips + c.slippagePips;
    };
    expect(t("EURUSD")).toBeCloseTo(1.0, 12);
    expect(t("GBPUSD")).toBeCloseTo(1.2, 12);
    expect(t("USDJPY")).toBeCloseTo(1.3, 12);
    expect(t("USDCHF")).toBeCloseTo(2.1, 12);
    expect(t("USDCAD")).toBeCloseTo(1.9, 12);
  });
});

describe("compareVariants / studyVariants", () => {
  it("identical rows give a zero difference", () => {
    const a = rows(800, 0.5, 1);
    const c = compareVariants("V1", "V0b", a, a, "directional", 5);
    expect(c.diff).toBe(0);
  });

  it("detects a genuinely better variant on matched days", () => {
    const control = rows(3000, 0.5, 2);
    const better = control.map((r, i) => (i % 3 === 0 && r.hit === false ? { ...r, hit: true, net: 8 } : r));
    const c = compareVariants("V1", "V0b", better, control, "directional", 6);
    expect(c.diff).toBeGreaterThan(0.03);
    expect(c.p).toBeLessThan(0.05);
  });

  it("null data: no variant is promising and nothing is significant", () => {
    const rowsById = {
      V0b: rows(2500, 0.5, 11),
      V1: rows(2500, 0.5, 12),
      V2: rows(2500, 0.5, 13),
      V3: rows(2500, 0.5, 14),
      V4: rows(2500, 0.5, 15),
    };
    const s = studyVariants(rowsById);
    expect(s.comparisons.filter((c) => c.significant)).toHaveLength(0);
    expect(s.promising).toHaveLength(0);
    expect(s.summaries.length).toBeGreaterThan(0);
  }, 120_000);

  it("summaries report how often the call equals the weekly trend", () => {
    const r = rows(500, 0.5, 3);
    const s = summariseVariant("V0b", r, "directional", 1);
    expect(s.equalsWeeklyTrend).toBeGreaterThan(0.3);
    expect(s.equalsWeeklyTrend).toBeLessThan(0.7);
  });
});
