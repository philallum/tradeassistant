// Pattern Vector Encoder Types (Requirements 8.1, 8.2, 8.3, 8.4, 17.1).

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

/** Macro-regime indicator: 5-trading-day rolling rate of change sign. (Requirement 8.3) */
export type WeeklyTrendSign = "UP" | "DOWN";

/** Multi-scale shape slices (10, 20, 40 trading days). */
export interface ScaleDims {
  readonly scale10: readonly number[];
  readonly scale20: readonly number[];
  readonly scale40: readonly number[];
}

/**
 * The fixed 70-dimensional shape-only pattern vector.
 * Requirements 8.1, 8.2, 8.4.
 */
export interface PatternVector {
  /** 10-trading-day normalized shape slice. */
  readonly scale10: readonly number[];
  /** 20-trading-day normalized shape slice. */
  readonly scale20: readonly number[];
  /** 40-trading-day normalized shape slice. */
  readonly scale40: readonly number[];
  /** Concatenated fixed-dimension vector (dim = 70 = 10 + 20 + 40). */
  readonly embedding: readonly number[];
  /** Macro-regime metadata. */
  readonly weeklyTrendSign: WeeklyTrendSign;
  /** Fixed dimension constant = 70. */
  readonly dim: number;
}

/** Stored pattern vector corresponding to the `pattern_vectors` table. */
export interface StoredPatternVector {
  readonly asset: Pair;
  readonly decisionDate: TradingDate;
  readonly embedding: readonly number[];
  readonly weeklyTrendSign: WeeklyTrendSign;
  readonly scaleDims: ScaleDims;
  readonly ingestedAt?: string;
}

/**
 * The storage PORT for pattern vectors (Requirement 17.1).
 */
export interface PatternVectorStore {
  /** Upsert a pattern vector keyed by (asset, decision_date). */
  upsertVector(
    asset: Pair,
    decisionDate: TradingDate,
    vector: PatternVector,
  ): Promise<void>;

  /** Query stored pattern vector by asset and decision date. */
  getVector(
    asset: Pair,
    decisionDate: TradingDate,
  ): Promise<StoredPatternVector | null>;

  /** Query all stored pattern vectors for an asset. */
  getVectorsByAsset(asset: Pair): Promise<readonly StoredPatternVector[]>;

  /**
   * Find nearest vectors by cosine similarity pre-filtered by weeklyTrendSign (Requirement 9.1, 9.2).
   */
  queryNearest(
    queryEmbedding: readonly number[],
    weeklyTrendSign: WeeklyTrendSign,
    options?: {
      asset?: Pair;
      excludeDecisionDate?: TradingDate;
      limit?: number;
    },
  ): Promise<readonly { vector: StoredPatternVector; cosineDistance: number }[]>;
}

/**
 * Compute cosine distance between two vectors: 1 - cosine_similarity.
 * Cosine distance is in range [0, 2].
 */
export function computeCosineDistance(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length !== b.length || a.length === 0) {
    throw new Error(
      `Vector dimension mismatch: a.length=${a.length}, b.length=${b.length}`,
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 1.0; // Orthogonal / neutral for zero vectors
  }

  const similarity = Math.max(-1.0, Math.min(1.0, dotProduct / denominator));
  return 1.0 - similarity;
}

/**
 * In-memory reference implementation of PatternVectorStore.
 */
export class InMemoryPatternVectorStore implements PatternVectorStore {
  // Key format: `${asset}:${decisionDate}`
  private readonly store = new Map<string, StoredPatternVector>();

  upsertVector(
    asset: Pair,
    decisionDate: TradingDate,
    vector: PatternVector,
  ): Promise<void> {
    const key = `${asset}:${decisionDate}`;
    this.store.set(key, {
      asset,
      decisionDate,
      embedding: [...vector.embedding],
      weeklyTrendSign: vector.weeklyTrendSign,
      scaleDims: {
        scale10: [...vector.scale10],
        scale20: [...vector.scale20],
        scale40: [...vector.scale40],
      },
    });
    return Promise.resolve();
  }

  getVector(
    asset: Pair,
    decisionDate: TradingDate,
  ): Promise<StoredPatternVector | null> {
    const key = `${asset}:${decisionDate}`;
    return Promise.resolve(this.store.get(key) ?? null);
  }

  getVectorsByAsset(asset: Pair): Promise<readonly StoredPatternVector[]> {
    const results: StoredPatternVector[] = [];
    for (const record of this.store.values()) {
      if (record.asset === asset) {
        results.push(record);
      }
    }
    return Promise.resolve(
      results.sort((a, b) => a.decisionDate.localeCompare(b.decisionDate)),
    );
  }

  queryNearest(
    queryEmbedding: readonly number[],
    weeklyTrendSign: WeeklyTrendSign,
    options?: {
      asset?: Pair;
      excludeDecisionDate?: TradingDate;
      limit?: number;
    },
  ): Promise<readonly { vector: StoredPatternVector; cosineDistance: number }[]> {
    const candidates: { vector: StoredPatternVector; cosineDistance: number }[] = [];

    for (const record of this.store.values()) {
      // Pre-filter on metadata (Requirements 8.3, 9.2)
      if (record.weeklyTrendSign !== weeklyTrendSign) {
        continue;
      }
      if (options?.asset && record.asset !== options.asset) {
        continue;
      }
      if (
        options?.excludeDecisionDate &&
        record.decisionDate === options.excludeDecisionDate
      ) {
        continue;
      }

      const dist = computeCosineDistance(queryEmbedding, record.embedding);
      candidates.push({ vector: record, cosineDistance: dist });
    }

    // Stable tie-break ordering: similarity (dist ascending), then date, then asset (Requirement 9.7)
    candidates.sort((a, b) => {
      const distDiff = a.cosineDistance - b.cosineDistance;
      if (Math.abs(distDiff) > 1e-9) {
        return distDiff;
      }
      const dateDiff = a.vector.decisionDate.localeCompare(b.vector.decisionDate);
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return a.vector.asset.localeCompare(b.vector.asset);
    });

    const limit = options?.limit ?? candidates.length;
    return Promise.resolve(candidates.slice(0, limit));
  }

  clear(): void {
    this.store.clear();
  }
}
