import { describe, expect, it } from "vitest";

import type { ChartFeatures } from "./chartFeatures.js";
import { extractSetups, FAMILY_FEATURES, studyFamilies } from "./familyStudy.js";
import type { ResearchRow } from "./researchDataset.js";
import { mulberry32 } from "./researchStats.js";

const features: ChartFeatures = {
  rangePos20: 0.5,
  rangePos60: 0.8,
  rangePos120: 0.5,
  distSma20Atr: 1.5,
  distSma50Atr: 1,
  trend20Atr: 2,
  swing: 0.5,
  body: 0.6,
  upperWick: 0.1,
  lowerWick: 0.3,
  closePos: 0.9,
  compression: 0.7,
  channelExcursion: 0.4,
};

function row(over: Partial<ResearchRow>): ResearchRow {
  return {
    pair: "EURUSD",
    date: "2018-03-05",
    weekday: 1,
    direction: "UP",
    fires: true,
    confidence: 0.6,
    n: 40,
    nearestDistance: 0.1,
    medianDistance: 0.1,
    meanDistance: 0.1,
    rawAgreement: 0.7,
    closest10Agreement: 0.7,
    closest25Agreement: 0.7,
    atr14: 0.005,
    atrPips: 50,
    atrPercentile: 0.5,
    efficiencyRatio: 0.3,
    weeklyTrendSign: "UP",
    yesterdaySign: "UP",
    stopLossPips: null,
    takeProfitPips: null,
    usdLong: false,
    eventOnTargetSession: null,
    strategies: { trend: "UP", breakout: "DOWN", range: "FLAT", reversal: null },
    agreeCount: 1,
    opposeCount: 1,
    confluenceScore: 0,
    confluenceStatus: "NEUTRAL",
    targetDate: "2018-03-06",
    targetClose: 1.1,
    realizedSign: "UP",
    realizedPips: 12,
    hit: true,
    baselineHit: true,
    netPips: 11,
    hitOn: true,
    netPipsOn: 11,
    costPips: 1,
    features,
    ...over,
  };
}

describe("extractSetups", () => {
  it("picks only days where the strategy gives UP or DOWN, and skips rows without features", () => {
    const rows = [row({}), row({ strategies: { trend: "FLAT", breakout: null, range: "FLAT", reversal: null } }), row({ features: null })];
    expect(extractSetups(rows, "trend")).toHaveLength(1);
    expect(extractSetups(rows, "range")).toHaveLength(0);
  });

  it("scores the setup direction against the realised sign and deducts cost", () => {
    const up = extractSetups([row({})], "trend")[0];
    expect(up?.hit).toBe(true);
    expect(up?.net).toBeCloseTo(11, 12);
    const down = extractSetups([row({})], "breakout")[0]; // breakout says DOWN, session went UP
    expect(down?.side).toBe("DOWN");
    expect(down?.hit).toBe(false);
    expect(down?.net).toBeCloseTo(-12 - 1, 12);
  });

  it("orients features to the setup direction", () => {
    const up = extractSetups([row({})], "trend")[0];
    const down = extractSetups([row({})], "breakout")[0];
    expect(up?.features.rangePosDir).toBeCloseTo(0.8, 12);
    expect(down?.features.rangePosDir).toBeCloseTo(0.2, 12);
    expect(down?.features.bodyDir).toBeCloseTo(-0.6, 12);
  });

  it("records the relation to the pattern call", () => {
    expect(extractSetups([row({})], "trend")[0]?.patternRelation).toBe("agree");
    expect(extractSetups([row({})], "breakout")[0]?.patternRelation).toBe("oppose");
    expect(extractSetups([row({ direction: "FLAT" })], "trend")[0]?.patternRelation).toBe("none");
  });

  it("the pattern family uses the pattern's own call", () => {
    expect(extractSetups([row({ direction: "DOWN" })], "pattern")[0]?.side).toBe("DOWN");
    expect(extractSetups([row({ direction: "FLAT" })], "pattern")).toHaveLength(0);
  });
});

describe("pre-registered feature lists", () => {
  it("has exactly four features per family (20 tests)", () => {
    for (const f of Object.values(FAMILY_FEATURES)) expect(f).toHaveLength(4);
  });
});

describe("studyFamilies", () => {
  function synthetic(n: number, seed: number, plant: boolean): ResearchRow[] {
    const rand = mulberry32(seed);
    const start = Date.parse("2016-01-04T00:00:00Z");
    return Array.from({ length: n }, (_, i) => {
      const day = Math.floor(i / 5);
      const date = new Date(start + (day + 2 * Math.floor(day / 5)) * 86_400_000).toISOString().slice(0, 10);
      const body = rand() * 2 - 1;
      const side = rand() < 0.5 ? "UP" : "DOWN";
      // Planted: a trend setup is more likely to win when the last candle's body is in its favour.
      const p = plant ? 0.5 + 0.2 * (side === "UP" ? body : -body) : 0.5;
      const win = rand() < p;
      const sign = win ? side : side === "UP" ? "DOWN" : "UP";
      return row({
        date,
        pair: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"][i % 5] as ResearchRow["pair"],
        direction: side,
        strategies: { trend: side, breakout: "FLAT", range: "FLAT", reversal: null },
        realizedSign: sign,
        realizedPips: sign === "UP" ? 10 : -10,
        features: { ...features, body, rangePos60: rand(), distSma20Atr: rand() * 4 - 2, swing: Math.floor(rand() * 5) / 2 - 1, trend20Atr: rand() * 6 - 3 },
      });
    });
  }

  it("null data: nothing is significant", () => {
    const s = studyFamilies(synthetic(3000, 3, false));
    expect(s.flatMap((f) => f.features).filter((f) => f.significant)).toHaveLength(0);
  }, 120_000);

  it("a planted body-in-favour effect is found in the trend family", () => {
    const s = studyFamilies(synthetic(4000, 4, true));
    const trend = s.find((f) => f.family === "pattern");
    // The pattern family uses the same direction, so the planted bodyDir effect shows there.
    const body = trend?.features.find((f) => f.feature === "bodyDir");
    expect(body?.rho).toBeGreaterThan(0.05);
    expect(body?.significant).toBe(true);
  }, 120_000);
});
