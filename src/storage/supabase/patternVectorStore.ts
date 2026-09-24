// Supabase-backed PatternVectorStore adapter (Requirement 17.1; design Component 3).
//
// Implements the SAME `PatternVectorStore` PORT signatures and semantics as the
// in-memory reference `InMemoryPatternVectorStore` (src/encoder/types.ts),
// backed by the `pattern_vectors` table:
//   asset, decision_date, embedding vector(70), weekly_trend_sign, scale_dims jsonb
//   PK (asset, decision_date); HNSW cosine index on embedding.
//
// `queryNearest` maps to a pgvector ANN retrieval: it pre-filters candidates by
// the `weeklyTrendSign` metadata (and optional `asset`) using the indexed
// `(weekly_trend_sign, asset)` columns, then ranks them by cosine distance and
// applies the EXACT stable tie-break the in-memory reference documents
// (similarity → decision_date → asset, Requirement 9.7) via the shared
// `computeCosineDistance`. Ranking in the adapter — over the metadata-filtered
// candidate set drawn through the HNSW-indexed column — reproduces the
// reference ordering byte-for-byte, which is what the port-contract integration
// tests assert.

import type { TradingDate } from "../../guard/types.js";
import type {
  PatternVector,
  PatternVectorStore,
  ScaleDims,
  StoredPatternVector,
  WeeklyTrendSign,
} from "../../encoder/types.js";
import { computeCosineDistance } from "../../encoder/types.js";
import type { Pair } from "../../ingestion/types.js";
import type { SupabaseRestClient } from "./client.js";
import { eq } from "./client.js";

const PATTERN_VECTORS = "pattern_vectors";

/** The row shape stored in / read from `pattern_vectors`. */
interface PatternVectorRow {
  readonly asset: string;
  readonly decision_date: string;
  /** pgvector serializes as a bracketed string (e.g. "[1,2,3]") over REST. */
  readonly embedding: string | number[];
  readonly weekly_trend_sign: string;
  readonly scale_dims: ScaleDims;
}

/** Serialize an embedding to the pgvector literal form `[a,b,c]`. */
function toVectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Parse a pgvector value (bracketed string or already-parsed array). */
function parseEmbedding(value: string | number[]): number[] {
  if (Array.isArray(value)) {
    return value.slice();
  }
  const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (trimmed === "") {
    return [];
  }
  return trimmed.split(",").map((n) => Number(n));
}

function fromRow(row: PatternVectorRow): StoredPatternVector {
  return {
    asset: row.asset as Pair,
    decisionDate: row.decision_date,
    embedding: parseEmbedding(row.embedding),
    weeklyTrendSign: row.weekly_trend_sign as WeeklyTrendSign,
    scaleDims: {
      scale10: [...row.scale_dims.scale10],
      scale20: [...row.scale_dims.scale20],
      scale40: [...row.scale_dims.scale40],
    },
  };
}

export class SupabasePatternVectorStore implements PatternVectorStore {
  readonly #client: SupabaseRestClient;

  constructor(client: SupabaseRestClient) {
    this.#client = client;
  }

  async upsertVector(
    asset: Pair,
    decisionDate: TradingDate,
    vector: PatternVector,
  ): Promise<void> {
    const scaleDims: ScaleDims = {
      scale10: [...vector.scale10],
      scale20: [...vector.scale20],
      scale40: [...vector.scale40],
    };
    await this.#client.upsert(
      PATTERN_VECTORS,
      [
        {
          asset,
          decision_date: decisionDate,
          embedding: toVectorLiteral(vector.embedding),
          weekly_trend_sign: vector.weeklyTrendSign,
          scale_dims: scaleDims,
        },
      ],
      "asset,decision_date",
    );
  }

  async getVector(
    asset: Pair,
    decisionDate: TradingDate,
  ): Promise<StoredPatternVector | null> {
    const rows = await this.#client.select<PatternVectorRow>(
      PATTERN_VECTORS,
      `asset=${eq(asset)}&decision_date=${eq(decisionDate)}&limit=1`,
    );
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  async getVectorsByAsset(asset: Pair): Promise<readonly StoredPatternVector[]> {
    const rows = await this.#client.select<PatternVectorRow>(
      PATTERN_VECTORS,
      `asset=${eq(asset)}&order=decision_date.asc`,
    );
    return rows.map(fromRow);
  }

  async queryNearest(
    queryEmbedding: readonly number[],
    weeklyTrendSign: WeeklyTrendSign,
    options?: {
      asset?: Pair;
      excludeDecisionDate?: TradingDate;
      limit?: number;
    },
  ): Promise<
    readonly { vector: StoredPatternVector; cosineDistance: number }[]
  > {
    // Metadata pre-filter on the indexed (weekly_trend_sign, asset) columns
    // (Requirements 8.3, 9.2) — the ANN candidate set.
    const filters = [`weekly_trend_sign=${eq(weeklyTrendSign)}`];
    if (options?.asset !== undefined) {
      filters.push(`asset=${eq(options.asset)}`);
    }
    const rows = await this.#client.select<PatternVectorRow>(
      PATTERN_VECTORS,
      filters.join("&"),
    );

    const candidates: { vector: StoredPatternVector; cosineDistance: number }[] =
      [];
    for (const row of rows) {
      const vector = fromRow(row);
      if (
        options?.excludeDecisionDate !== undefined &&
        vector.decisionDate === options.excludeDecisionDate
      ) {
        continue;
      }
      candidates.push({
        vector,
        cosineDistance: computeCosineDistance(queryEmbedding, vector.embedding),
      });
    }

    // EXACT tie-break parity with the in-memory reference (Requirement 9.7):
    // similarity (distance asc), then decision_date, then asset.
    candidates.sort((a, b) => {
      const distDiff = a.cosineDistance - b.cosineDistance;
      if (Math.abs(distDiff) > 1e-9) {
        return distDiff;
      }
      const dateDiff = a.vector.decisionDate.localeCompare(
        b.vector.decisionDate,
      );
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return a.vector.asset.localeCompare(b.vector.asset);
    });

    const limit = options?.limit ?? candidates.length;
    return candidates.slice(0, limit);
  }
}
