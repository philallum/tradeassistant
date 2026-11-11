// Statistics helpers for the research programme (pure; seeded randomness only).
//
// - Block bootstrap: rows are resampled in blocks (calendar weeks), so the five correlated pairs
//   of a week and the overlapping daily windows stay together instead of being treated as
//   independent observations.
// - Benjamini-Hochberg false-discovery-rate control across a pre-registered family.
// - Spearman rank correlation (average ranks for ties).
import type { Interval } from "../../performance/evidenceStats.js";

/** Small, fast, seedable PRNG (mulberry32). Deterministic for a given seed. */
export function mulberry32(seed: number): () => number {
  // Scramble the seed first (splitmix32-style finaliser): raw mulberry32 streams from ADJACENT
  // seeds are visibly correlated over their first draws, which biased synthetic test data.
  let z = (seed >>> 0) + 0x9e3779b9;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  let a = (z ^ (z >>> 16)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Average ranks (1-based) with ties sharing the mean rank. */
export function averageRanks(values: readonly number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  let k = 0;
  while (k < idx.length) {
    let j = k;
    while (j + 1 < idx.length && (idx[j + 1] as { v: number }).v === (idx[k] as { v: number }).v) j += 1;
    const mean = (k + j) / 2 + 1;
    for (let m = k; m <= j; m += 1) ranks[(idx[m] as { i: number }).i] = mean;
    k = j + 1;
  }
  return ranks;
}

/** Pearson correlation of two equal-length arrays; 0 when either has no variance. */
export function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += x[i] as number;
    sy += y[i] as number;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** Spearman rank correlation. */
export function spearman(x: readonly number[], y: readonly number[]): number {
  return pearson(averageRanks(x), averageRanks(y));
}

export interface BootstrapResult {
  readonly estimate: number;
  readonly ci95: Interval;
  /** Two-sided percentile-bootstrap p-value against `nullValue`. Floor is 1/(iterations+1). */
  readonly p: number;
}

/**
 * Block bootstrap of a statistic over rows.
 *
 * `blockOf` maps a row to its block key. Each iteration draws as many blocks as exist, with
 * replacement, concatenates their rows and evaluates `statistic`. The p-value is the usual
 * two-sided percentile-bootstrap value against `nullValue`.
 */
export function blockBootstrap<T>(
  rows: readonly T[],
  blockOf: (row: T) => string,
  statistic: (sample: readonly T[]) => number,
  iterations: number,
  seed: number,
  nullValue = 0,
): BootstrapResult {
  const estimate = statistic(rows);
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = blockOf(r);
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [r]);
    else g.push(r);
  }
  const blocks = [...groups.values()];
  if (blocks.length < 2) return { estimate, ci95: { lo: estimate, hi: estimate }, p: 1 };

  const rand = mulberry32(seed);
  const draws: number[] = [];
  for (let it = 0; it < iterations; it += 1) {
    const sample: T[] = [];
    for (let b = 0; b < blocks.length; b += 1) {
      const block = blocks[Math.floor(rand() * blocks.length)] as T[];
      for (const r of block) sample.push(r);
    }
    const s = statistic(sample);
    if (Number.isFinite(s)) draws.push(s);
  }
  if (draws.length === 0) return { estimate, ci95: { lo: estimate, hi: estimate }, p: 1 };
  draws.sort((a, b) => a - b);
  const q = (f: number): number => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(f * draws.length)))] as number;
  let le = 0;
  let ge = 0;
  for (const d of draws) {
    if (d <= nullValue) le += 1;
    if (d >= nullValue) ge += 1;
  }
  const denom = draws.length + 1;
  const p = Math.min(1, 2 * Math.min((le + 1) / denom, (ge + 1) / denom));
  return { estimate, ci95: { lo: q(0.025), hi: q(0.975) }, p };
}

/**
 * Spearman correlation with a block-bootstrap interval and p-value. Ranks are computed once on
 * the full data and reused across resamples (a standard shortcut that keeps this linear in n).
 */
export function blockBootstrapSpearman(
  x: readonly number[],
  y: readonly number[],
  blocks: readonly string[],
  iterations: number,
  seed: number,
): BootstrapResult & { readonly n: number } {
  const n = x.length;
  const rx = averageRanks(x);
  const ry = averageRanks(y);
  const estimate = pearson(rx, ry);
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i += 1) {
    const key = blocks[i] as string;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [i]);
    else g.push(i);
  }
  const list = [...groups.values()];
  if (list.length < 2 || n < 3) return { n, estimate, ci95: { lo: estimate, hi: estimate }, p: 1 };

  const rand = mulberry32(seed);
  const draws: number[] = [];
  const sx: number[] = [];
  const sy: number[] = [];
  for (let it = 0; it < iterations; it += 1) {
    sx.length = 0;
    sy.length = 0;
    for (let b = 0; b < list.length; b += 1) {
      const block = list[Math.floor(rand() * list.length)] as number[];
      for (const i of block) {
        sx.push(rx[i] as number);
        sy.push(ry[i] as number);
      }
    }
    draws.push(pearson(sx, sy));
  }
  draws.sort((a, b) => a - b);
  const q = (f: number): number => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(f * draws.length)))] as number;
  let le = 0;
  let ge = 0;
  for (const d of draws) {
    if (d <= 0) le += 1;
    if (d >= 0) ge += 1;
  }
  const denom = draws.length + 1;
  const p = Math.min(1, 2 * Math.min((le + 1) / denom, (ge + 1) / denom));
  return { n, estimate, ci95: { lo: q(0.025), hi: q(0.975) }, p };
}

export interface FdrResult {
  readonly adjusted: readonly number[];
  readonly rejected: readonly boolean[];
}

/** Benjamini-Hochberg step-up procedure. `adjusted` are BH q-values in input order. */
export function benjaminiHochberg(pValues: readonly number[], q: number): FdrResult {
  const m = pValues.length;
  if (m === 0) return { adjusted: [], rejected: [] };
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjusted = new Array<number>(m).fill(1);
  let running = 1;
  for (let k = m - 1; k >= 0; k -= 1) {
    const item = order[k] as { p: number; i: number };
    running = Math.min(running, (item.p * m) / (k + 1));
    adjusted[item.i] = Math.min(1, running);
  }
  return { adjusted, rejected: adjusted.map((a) => a <= q) };
}

/** ISO-week key (UTC) used as the bootstrap block, e.g. "2024-W07". */
export function weekBlock(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this week decides the ISO year
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
