// Small, pure statistics helpers for evidence reporting (no I/O, no clock, no randomness).
//
// These exist so every reported rate carries its sample size and an honest interval, and so a
// pooled interval is not over-confident when neighbouring days share overlapping information.

/** Two-sided 95% normal quantile. */
export const Z_95 = 1.959963984540054 as const;

export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

/**
 * Wilson score interval for a proportion. Preferred over the Wald interval because it behaves
 * at small n and near 0 or 1. Returns [0, 1] for n = 0 (no information).
 */
export function wilsonInterval(successes: number, n: number, z: number = Z_95): Interval {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/**
 * Conservative 95% interval on a difference of two accuracies measured on the SAME matched
 * sample: the worst-case binomial variance (p = 0.5) is used, as in the recorded evaluation
 * report. `effectiveN` lets the caller pass an overlap-discounted sample size.
 */
export function matchedDeltaInterval(delta: number, effectiveN: number, z: number = Z_95): Interval {
  if (effectiveN <= 0) return { lo: -1, hi: 1 };
  const half = z * Math.sqrt(0.25 / effectiveN);
  return { lo: delta - half, hi: delta + half };
}

/**
 * Overlap-discounted effective sample size. Daily neighbourhoods built from overlapping windows
 * and the same five correlated pairs are not independent, so the raw count overstates the
 * information. `clusterDays` is how many consecutive days are treated as one effective
 * observation (default matches `calibration.ts` DEFAULT_OVERLAP_WINDOW_DAYS conceptually, but
 * is a reporting aid only and never feeds firing).
 */
export function effectiveSampleSize(n: number, clusterDays: number): number {
  if (n <= 0) return 0;
  return n / Math.max(1, clusterDays);
}

export interface RateSummary {
  readonly n: number;
  readonly successes: number;
  readonly rate: number;
  readonly ci95: Interval;
}

/** A hit-rate with its sample size and Wilson interval. */
export function summarizeRate(successes: number, n: number): RateSummary {
  return { n, successes, rate: n === 0 ? 0 : successes / n, ci95: wilsonInterval(successes, n) };
}
