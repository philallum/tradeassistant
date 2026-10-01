// Supabase-backed CandleStore adapter (Requirement 17.1; design Component 3).
//
// Implements the SAME `CandleStore` PORT method signatures and semantics as the
// in-memory reference `InMemoryCandleStore` (src/ingestion/types.ts), backed by
// the `candles` table:
//   asset, date, open, high, low, close, source, ingested_at   PK (asset, date)
//
// The only substitution is the concrete backend — the pipeline and every
// downstream caller keep depending on the `CandleStore` interface, never on
// this class. Upsert is idempotent on the `(asset, date)` primary key, matching
// the in-memory `(asset, date)` keyed replace (Requirement 7.4). Reads return
// chronologically-sorted candles, and the coverage summary is emitted for all
// five PAIRS in fixed order, exactly like the reference.

import type { Candle, TradingDate } from "../../guard/types.js";
import type {
  CandleStore,
  Pair,
  PerPairCoverage,
} from "../../ingestion/types.js";
import { PAIRS } from "../../ingestion/types.js";
import type { SupabaseRestClient } from "./client.js";
import { eq } from "./client.js";

const CANDLES = "candles";

/** The row shape read back from / written to the `candles` table. */
interface CandleRow {
  readonly asset: string;
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly source: string;
  readonly ingested_at?: string;
}

function toRow(candle: Candle): Record<string, unknown> {
  const row: Record<string, unknown> = {
    asset: candle.asset,
    date: candle.date,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    // `source` is NOT NULL in the schema; the in-memory reference allows it to
    // be optional, so default to "csv" parity with the ingestion default.
    source: candle.source ?? "csv",
  };
  if (candle.ingestedAt !== undefined) {
    row.ingested_at = candle.ingestedAt;
  }
  return row;
}

function fromRow(row: CandleRow): Candle {
  const candle: Candle = {
    asset: row.asset,
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    source: row.source,
    ...(row.ingested_at === undefined ? {} : { ingestedAt: row.ingested_at }),
  };
  return candle;
}

export class SupabaseCandleStore implements CandleStore {
  readonly #client: SupabaseRestClient;

  constructor(client: SupabaseRestClient) {
    this.#client = client;
  }

  async upsertCandles(candles: readonly Candle[]): Promise<void> {
    await this.#client.upsert(CANDLES, candles.map(toRow), "asset,date");
  }

  async getCandles(
    asset: Pair,
    startDate?: TradingDate,
    endDate?: TradingDate,
  ): Promise<readonly Candle[]> {
    const filters = [`asset=${eq(asset)}`];
    if (startDate !== undefined) {
      filters.push(`date=gte.${encodeURIComponent(startDate)}`);
    }
    if (endDate !== undefined) {
      filters.push(`date=lte.${encodeURIComponent(endDate)}`);
    }
    // Chronological order to match the in-memory reference.
    filters.push("order=date.asc");
    const rows = await this.#client.select<CandleRow>(
      CANDLES,
      filters.join("&"),
    );
    return rows.map(fromRow);
  }

  async getCoverageSummary(): Promise<readonly PerPairCoverage[]> {
    // Emit coverage for all five PAIRS in fixed order, exactly like the
    // in-memory reference (a pair with no stored candles reports count 0).
    const summaries: PerPairCoverage[] = [];
    for (const pair of PAIRS) {
      const rows = await this.#client.select<{ date: string }>(
        CANDLES,
        `asset=${eq(pair)}&select=date&order=date.asc`,
      );
      if (rows.length === 0) {
        summaries.push({ pair, count: 0, earliestDate: null, latestDate: null });
        continue;
      }
      summaries.push({
        pair,
        count: rows.length,
        earliestDate: rows[0]?.date ?? null,
        latestDate: rows[rows.length - 1]?.date ?? null,
      });
    }
    return summaries;
  }
}
