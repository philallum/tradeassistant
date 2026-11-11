import { describe, expect, it } from "vitest";

import type { OutcomeId } from "./horizonOutcomes.js";
import { studyHorizons, SOURCES, type ScoredRow, type SourceId } from "./horizonStudy.js";
import { blockBootstrap, mulberry32 } from "./researchStats.js";

function rows(n: number, seed: number, hitP: number, confEffect = 0): ScoredRow[] {
  const rand = mulberry32(seed);
  const start = Date.parse("2014-01-06T00:00:00Z");
  return Array.from({ length: n }, (_, i) => {
    const day = Math.floor(i / 5);
    const date = new Date(start + (day + 2 * Math.floor(day / 5)) * 86_400_000).toISOString().slice(0, 10);
    const confidence = 0.5 + rand() * 0.2;
    const hit = rand() < hitP + confEffect * (confidence - 0.6);
    const dir = rand() < 0.5 ? "UP" : "DOWN";
    return {
      pair: (["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD"] as const)[i % 5] ?? "EURUSD",
      date,
      direction: dir,
      confidence,
      n: 20,
      fires: confidence >= 0.55,
      weeklyTrendSign: rand() < 0.5 ? "UP" : "DOWN",
      realisedSide: hit ? dir : dir === "UP" ? "DOWN" : "UP",
      hit,
      baselineHit: rand() < 0.5,
      net: hit ? 10 : -12,
      baselineNet: 0,
    };
  });
}

function all(make: (s: SourceId, o: OutcomeId, k: number) => ScoredRow[]): Record<SourceId, Record<OutcomeId, ScoredRow[]>> {
  const out = {} as Record<SourceId, Record<OutcomeId, ScoredRow[]>>;
  let k = 0;
  for (const s of SOURCES) {
    out[s] = {} as Record<OutcomeId, ScoredRow[]>;
    for (const o of ["H1", "H3", "H5", "BR"] as const) out[s][o] = make(s, o, (k += 1));
  }
  return out;
}

describe("studyHorizons", () => {
  it("null data: nothing promising, at most a stray false discovery; H1 stays outside the families", () => {
    // BH at q = 0.10 over two families of 9 allows an occasional false discovery under the null
    // (about one run in five); calibration is checked separately below. "Promising" also needs a
    // positive net lower bound and stability, so it must stay empty.
    const s = studyHorizons(all((_, __, k) => rows(2500, 500 + k, 0.5)));
    const fam = s.cells.filter((c) => c.subset === "directional" && c.upliftQ !== null);
    expect(fam).toHaveLength(9);
    expect(fam.filter((c) => c.upliftSignificant || c.confSignificant).length).toBeLessThanOrEqual(2);
    expect(s.promising).toHaveLength(0);
    expect(s.cells.filter((c) => c.outcome === "H1").every((c) => c.upliftQ === null)).toBe(true);
  }, 180_000);

  it("a planted edge in one cell is found and only that cell is promising", () => {
    const s = studyHorizons(all((src, o, k) => rows(3000, 900 + k, src === "V0b" && o === "H5" ? 0.62 : 0.5, src === "V0b" && o === "H5" ? 3 : 0)));
    const planted = s.cells.find((c) => c.source === "V0b" && c.outcome === "H5" && c.subset === "directional");
    expect(planted?.upliftSignificant).toBe(true);
    expect(planted?.confSignificant).toBe(true);
    expect(planted?.promising).toBe(true);
    expect(s.promising.map((c) => `${c.source}/${c.outcome}`)).toEqual(["V0b/H5"]);
  }, 180_000);
});

describe("month-block bootstrap calibration", () => {
  it("rejects a true null at about the nominal 5% rate, including with overlapping windows", () => {
    let rejected = 0;
    const reps = 120;
    for (let k = 0; k < reps; k += 1) {
      const rand = mulberry32(7000 + k);
      const start = Date.parse("2013-06-03T00:00:00Z");
      const shocks = Array.from({ length: 1205 }, () => rand() - 0.5);
      const sample: { date: string; hit: boolean; base: boolean }[] = [];
      for (let d = 0; d < 1200; d += 1) {
        const date = new Date(start + (d + 2 * Math.floor(d / 5)) * 86_400_000).toISOString().slice(0, 10);
        const s = shocks.slice(d, d + 5).reduce((a, b) => a + b, 0); // shared 5-day move: overlap
        const real = s + (rand() - 0.5) * 0.5 > 0;
        sample.push({ date, hit: rand() < 0.5 === real, base: rand() < 0.5 === real });
      }
      const stat = (x: readonly { hit: boolean; base: boolean }[]): number =>
        x.length === 0 ? Number.NaN : (x.filter((r) => r.hit).length - x.filter((r) => r.base).length) / x.length;
      if (blockBootstrap(sample, (r) => r.date.slice(0, 7), stat, 300, 99 + k).p < 0.05) rejected += 1;
    }
    expect(rejected / reps).toBeLessThanOrEqual(0.12);
  }, 180_000);
});
