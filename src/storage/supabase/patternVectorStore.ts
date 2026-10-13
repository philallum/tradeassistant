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

/**
 * Explicit column projections (egress reduction). PostgREST `SELECT *` ships the
 * 70-dim `embedding` string AND the `scale_dims` jsonb on every row; projecting
 * to only the columns a caller consumes cuts the bytes crossing the wire (and
 * prevents a future column from silently inflating these hot-path reads).
 *
 * - {@link FULL_VECTOR_COLUMNS}: every column — used where the caller needs the
 *   reconstructed `scaleDims` (`getVector`, `getVectorsByAsset`; the backtest
 *   mirror rebuilds the query vector from `scale_dims`).
 * - {@link ANN_VECTOR_COLUMNS}: omits `scale_dims` — used by `queryNearest`,
 *   whose consumer (`src/retrieval/retrieve.ts`) reads only `embedding`,
 *   `decisionDate`, and `weeklyTrendSign`, never `scaleDims`. Dropping the jsonb
 *   is the primary per-row egress saving on the largest (full-slice) read.
 */
const FULL_VECTOR_COLUMNS = "asset,decision_date,embedding,weekly_trend_sign,scale_dims";
const ANN_VECTOR_COLUMNS = "asset,decision_date,embedding,weekly_trend_sign";

/** Map a FULLY-projected row (incl. `scale_dims`) to a {@link StoredPatternVector}. */
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

/**
 * Map an ANN-projected row (NO `scale_dims`) to a {@link StoredPatternVector}.
 * `scaleDims` is returned EMPTY by design: `queryNearest` does not fetch the
 * jsonb (egress), and its sole consumer never reads `scaleDims` off the result —
 * it ranks by `embedding` cosine distance and keeps `decisionDate`. A caller
 * that needs the real `scaleDims` must use `getVector` / `getVectorsByAsset`.
 */
function fromAnnRow(row: Omit<PatternVectorRow, "scale_dims">): StoredPatternVector {
  return {
    asset: row.asset as Pair,
    decisionDate: row.decision_date,
    embedding: parseEmbedding(row.embedding),
    weeklyTrendSign: row.weekly_trend_sign as WeeklyTrendSign,
    scaleDims: { scale10: [], scale20: [], scale40: [] },
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
      `select=${FULL_VECTOR_COLUMNS}&asset=${eq(asset)}&decision_date=${eq(decisionDate)}&limit=1`,
    );
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  async getVectorsByAsset(asset: Pair): Promise<readonly StoredPatternVector[]> {
    const rows = await this.#client.select<PatternVectorRow>(
      PATTERN_VECTORS,
      `select=${FULL_VECTOR_COLUMNS}&asset=${eq(asset)}&order=decision_date.asc`,
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
    const filters = [`select=${ANN_VECTOR_COLUMNS}`, `weekly_trend_sign=${eq(weeklyTrendSign)}`];
    if (options?.asset !== undefined) {
      filters.push(`asset=${eq(options.asset)}`);
    }
    // ANN projection: `scale_dims` is deliberately NOT fetched (egress) — the
    // ranked candidates feed cosine-distance ranking only.
    const rows = await this.#client.select<Omit<PatternVectorRow, "scale_dims">>(
      PATTERN_VECTORS,
      filters.join("&"),
    );

    const candidates: { vector: StoredPatternVector; cosineDistance: number }[] =
      [];
    for (const row of rows) {
      const vector = fromAnnRow(row);
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
