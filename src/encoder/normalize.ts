// Shape Normalization (Requirements 8.2, 8.6).
//
// Per-scale independent standardization (Z-score normalization).
// Scale-invariant under positive price scalars (Property 9).
// Degenerate zero-variance windows cleanly produce a zero vector without error (Requirement 8.6).

/**
 * Normalizes a slice of closing prices to zero-mean and unit-variance.
 *
 * For a slice [p_1, ..., p_N]:
 *   z_i = (p_i - mean) / std_dev
 *
 * Degenerate (zero-variance) slices return a defined zero-vector of length N.
 */
export function normalizeShapeSlice(prices: readonly number[]): number[] {
  const n = prices.length;
  if (n === 0) {
    return [];
  }

  // Compute arithmetic mean
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += prices[i]!;
  }
  const mean = sum / n;

  // Compute population variance
  let sumSqDiff = 0;
  for (let i = 0; i < n; i++) {
    const diff = prices[i]! - mean;
    sumSqDiff += diff * diff;
  }
  const variance = sumSqDiff / n;
  const stdDev = Math.sqrt(variance);

  // Degenerate (zero-variance) case (Requirement 8.6)
  // Use relative threshold (stdDev / scale) so the zero-variance classification
  // is strictly scale-invariant under positive price scalars (Property 9).
  const scale = Math.max(Math.abs(mean), 1e-12);
  if (stdDev === 0 || stdDev / scale < 1e-9) {
    return new Array<number>(n).fill(0.0);
  }

  // Standardize
  const result = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    result[i] = (prices[i]! - mean) / stdDev;
  }
  return result;
}
