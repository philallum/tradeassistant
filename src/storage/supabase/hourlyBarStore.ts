// Supabase adapter for the `hourly_candles` archive (additive migration 20260916000011).
//
// FAIL-SAFE both ways (torn-deploy safety): a missing table or any transport error degrades to
// an empty read / a swallowed write with a secret-free warning, because the archive is a
// measurement aid and must never be able to fail the daily run.
import { PAIRS, type Pair } from "../../ingestion/types.js";
import type { HourlyBarRow, HourlyBarStore } from "../../hourly-store/types.js";
import { SupabaseRestError, type SupabaseRestClient } from "./client.js";

const HOURLY_CANDLES = "hourly_candles";
const CONFLICT_TARGET = "pair,bar_open_utc";

interface HourlyDbRow {
  readonly pair: string;
  readonly bar_open_utc: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly source: string;
}

export interface HourlyBarLogger {
  warn(message: string): void;
}
const defaultLogger: HourlyBarLogger = { warn: (m) => console.warn(m) };

function describe(err: unknown): string {
  return err instanceof SupabaseRestError ? `HTTP ${err.status} on "${err.table}"` : err instanceof Error ? err.name : "unknown error";
}

export class SupabaseHourlyBarStore implements HourlyBarStore {
  readonly #client: SupabaseRestClient;
  readonly #logger: HourlyBarLogger;

  constructor(client: SupabaseRestClient, logger: HourlyBarLogger = defaultLogger) {
    this.#client = client;
    this.#logger = logger;
  }

  async upsert(rows: readonly HourlyBarRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
      await this.#client.upsert(
        HOURLY_CANDLES,
        rows.map((r) => ({
          pair: r.pair,
          bar_open_utc: new Date(r.openMs).toISOString(),
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          source: r.source,
        })),
        CONFLICT_TARGET,
      );
    } catch (err) {
      this.#logger.warn(`hourly_candles write failed (${describe(err)}); archive skipped (fail-safe)`);
    }
  }

  async getRange(pair: Pair, fromMs: number, toMs: number): Promise<readonly HourlyBarRow[]> {
    const query =
      `select=pair,bar_open_utc,open,high,low,close,source` +
      `&pair=eq.${encodeURIComponent(pair)}` +
      `&bar_open_utc=gte.${encodeURIComponent(new Date(fromMs).toISOString())}` +
      `&bar_open_utc=lt.${encodeURIComponent(new Date(toMs).toISOString())}` +
      `&order=bar_open_utc.asc`;
    try {
      const rows = await this.#client.select<HourlyDbRow>(HOURLY_CANDLES, query);
      return rows.flatMap((r): HourlyBarRow[] =>
        (PAIRS as readonly string[]).includes(r.pair)
          ? [{ pair: r.pair as Pair, openMs: Date.parse(r.bar_open_utc), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), source: r.source }]
          : [],
      );
    } catch (err) {
      this.#logger.warn(`hourly_candles read failed (${describe(err)}); degrading to empty (fail-safe)`);
      return [];
    }
  }
}
