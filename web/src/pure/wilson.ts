/**
 * Wilson score interval for a proportion (95%). Pure. Behaves at small n and near 0 or 1,
 * unlike the normal approximation. Mirrors `src/performance/evidenceStats.ts` (backend).
 */
const Z_95 = 1.959963984540054;

export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

export function wilsonInterval(successes: number, n: number): Interval {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}
