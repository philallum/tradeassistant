import { describe, expect, it } from "vitest";

import {
  averageRanks,
  benjaminiHochberg,
  blockBootstrap,
  blockBootstrapSpearman,
  mulberry32,
  spearman,
  weekBlock,
} from "./researchStats.js";

describe("averageRanks / spearman", () => {
  it("ties share the mean rank", () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("matches known values", () => {
    expect(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 9])).toBeCloseTo(1, 12);
    expect(spearman([1, 2, 3, 4, 5], [9, 8, 7, 6, 5])).toBeCloseTo(-1, 12);
    expect(spearman([1, 2, 3], [1, 1, 1])).toBe(0);
  });
});

describe("benjaminiHochberg", () => {
  it("reproduces the textbook example", () => {
    // Benjamini & Hochberg (1995) style example: m = 5.
    const p = [0.01, 0.04, 0.03, 0.005, 0.5];
    const r = benjaminiHochberg(p, 0.05);
    // Sorted: 0.005, 0.01, 0.03, 0.04, 0.5 -> adjusted 0.025, 0.025, 0.05, 0.05, 0.5
    expect(r.adjusted[3]).toBeCloseTo(0.025, 12);
    expect(r.adjusted[0]).toBeCloseTo(0.025, 12);
    expect(r.adjusted[2]).toBeCloseTo(0.05, 12);
    expect(r.adjusted[1]).toBeCloseTo(0.05, 12);
    expect(r.adjusted[4]).toBeCloseTo(0.5, 12);
    expect(r.rejected).toEqual([true, true, true, true, false]);
  });

  it("adjusted values never fall below the raw p and never exceed 1", () => {
    const rand = mulberry32(5);
    const p = Array.from({ length: 50 }, () => rand());
    const r = benjaminiHochberg(p, 0.1);
    r.adjusted.forEach((a, i) => {
      expect(a).toBeGreaterThanOrEqual(p[i] as number);
      expect(a).toBeLessThanOrEqual(1);
    });
  });

  it("handles an empty family", () => {
    expect(benjaminiHochberg([], 0.1)).toEqual({ adjusted: [], rejected: [] });
  });
});

describe("weekBlock", () => {
  it("keeps Monday to Friday of one week together and separates weeks", () => {
    expect(weekBlock("2024-03-04")).toBe(weekBlock("2024-03-08"));
    expect(weekBlock("2024-03-08")).not.toBe(weekBlock("2024-03-11"));
  });

  it("uses the ISO year at the year boundary", () => {
    expect(weekBlock("2024-12-30")).toBe("2025-W01");
    expect(weekBlock("2021-01-01")).toBe("2020-W53");
  });
});

interface Row {
  readonly date: string;
  readonly hit: boolean;
}

function datedRows(n: number, p: number, seed: number): Row[] {
  const rand = mulberry32(seed);
  const rows: Row[] = [];
  const start = Date.parse("2020-01-06T00:00:00Z");
  for (let i = 0; i < n; i += 1) {
    const d = new Date(start + Math.floor(i / 3) * 86_400_000);
    rows.push({ date: d.toISOString().slice(0, 10), hit: rand() < p });
  }
  return rows;
}

const hitMinusHalf = (s: readonly Row[]): number => (s.length === 0 ? Number.NaN : s.filter((r) => r.hit).length / s.length - 0.5);

describe("blockBootstrap", () => {
  it("is deterministic for a fixed seed", () => {
    const rows = datedRows(600, 0.5, 1);
    const a = blockBootstrap(rows, (r) => weekBlock(r.date), hitMinusHalf, 300, 42);
    const b = blockBootstrap(rows, (r) => weekBlock(r.date), hitMinusHalf, 300, 42);
    expect(a).toEqual(b);
  });

  it("detects a genuine shift", () => {
    const rows = datedRows(1500, 0.6, 2);
    const r = blockBootstrap(rows, (x) => weekBlock(x.date), hitMinusHalf, 400, 7);
    expect(r.estimate).toBeGreaterThan(0.05);
    expect(r.ci95.lo).toBeGreaterThan(0);
    expect(r.p).toBeLessThan(0.01);
  });

  it("null data: BH over many fair-coin tests rejects nothing at q = 0.10", () => {
    const ps: number[] = [];
    for (let k = 0; k < 40; k += 1) {
      const rows = datedRows(450, 0.5, 100 + k);
      ps.push(blockBootstrap(rows, (x) => weekBlock(x.date), hitMinusHalf, 300, 900 + k).p);
    }
    expect(benjaminiHochberg(ps, 0.1).rejected.filter(Boolean)).toHaveLength(0);
  });

  it("returns a degenerate result with fewer than two blocks", () => {
    const rows: Row[] = [{ date: "2024-03-04", hit: true }];
    const r = blockBootstrap(rows, (x) => weekBlock(x.date), hitMinusHalf, 50, 1);
    expect(r.p).toBe(1);
  });
});

describe("blockBootstrapSpearman", () => {
  it("finds a planted gradient and not a null one", () => {
    const rand = mulberry32(11);
    const n = 1200;
    const x: number[] = [];
    const yPlanted: number[] = [];
    const yNull: number[] = [];
    const blocks: string[] = [];
    const start = Date.parse("2020-01-06T00:00:00Z");
    for (let i = 0; i < n; i += 1) {
      const v = rand();
      x.push(v);
      yPlanted.push(rand() < 0.35 + 0.3 * v ? 1 : 0);
      yNull.push(rand() < 0.5 ? 1 : 0);
      blocks.push(weekBlock(new Date(start + Math.floor(i / 3) * 86_400_000).toISOString().slice(0, 10)));
    }
    const planted = blockBootstrapSpearman(x, yPlanted, blocks, 300, 3);
    const nul = blockBootstrapSpearman(x, yNull, blocks, 300, 4);
    expect(planted.estimate).toBeGreaterThan(0.1);
    expect(planted.p).toBeLessThan(0.01);
    expect(nul.p).toBeGreaterThan(0.01);
  });
});
