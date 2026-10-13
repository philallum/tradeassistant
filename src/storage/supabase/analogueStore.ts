// Supabase-backed AnalogueStore adapter (Requirement 17.1; design Component 3).
//
// Implements the SAME `AnalogueStore` PORT signatures and semantics as the
// in-memory reference `InMemoryAnalogueStore` (src/retrieval/types.ts), backed
// by the `analogue_outcomes` table:
//   asset, decision_date, horizon, direction, mfe_pips, mae_pips, atr14, matured
//   PK (asset, decision_date, horizon)
//
// Upsert is idempotent on the (asset, decision_date, horizon) primary key,
// matching the in-memory keyed replace (Requirement 9.6). `getMaturedOutcomes`
// returns matured rows strictly before `beforeDate` ordered by decision_date
// then horizon; `getOutcomes` returns all horizons for a date ordered by
// horizon — both identical to the reference.

import type { TradingDate } from "../../guard/types.js";
import type {
  AnalogueRecord,
  AnalogueStore,
  DirectionClass,
} from "../../retrieval/types.js";
import type { Pair } from "../../ingestion/types.js";
import type { SupabaseRestClient } from "./client.js";
import { eq } from "./client.js";

const ANALOGUE_OUTCOMES = "analogue_outcomes";

/**
 * Explicit column projection (egress reduction). Lists exactly the columns
 * {@link fromRow} consumes so PostgREST never widens these hot-path reads to a
 * `SELECT *` (and a future column cannot silently inflate the bytes on the wire).
 */
const ANALOGUE_COLUMNS =
  "select=asset,decision_date,horizon,direction,mfe_pips,mae_pips,atr14,matured";

/** The row shape stored in / read from `analogue_outcomes`. */
interface AnalogueRow {
  readonly asset: string;
  readonly decision_date: string;
  readonly horizon: number;
  readonly direction: string;
  readonly mfe_pips: number;
  readonly mae_pips: number;
  readonly atr14: number;
  readonly matured: boolean;
}

function toRow(record: AnalogueRecord): Record<string, unknown> {
  return {
    asset: record.asset,
    decision_date: record.decisionDate,
    horizon: record.horizon,
    direction: record.direction,
    mfe_pips: record.mfePips,
    mae_pips: record.maePips,
    atr14: record.atr14,
    matured: record.matured,
  };
}

function fromRow(row: AnalogueRow): AnalogueRecord {
  return {
    asset: row.asset as Pair,
    decisionDate: row.decision_date,
    horizon: row.horizon as 1 | 2 | 3,
    direction: row.direction as DirectionClass,
    mfePips: row.mfe_pips,
    maePips: row.mae_pips,
    atr14: row.atr14,
    matured: row.matured,
  };
}

export class SupabaseAnalogueStore implements AnalogueStore {
  readonly #client: SupabaseRestClient;

  constructor(client: SupabaseRestClient) {
    this.#client = client;
  }

  async upsertOutcome(record: AnalogueRecord): Promise<void> {
    await this.#client.upsert(
      ANALOGUE_OUTCOMES,
      [toRow(record)],
      "asset,decision_date,horizon",
    );
  }

  async getMaturedOutcomes(
    asset: Pair,
    beforeDate: TradingDate,
  ): Promise<readonly AnalogueRecord[]> {
    // matured = true AND decision_date < beforeDate, ordered by (date, horizon)
    // to match the in-memory reference.
    const rows = await this.#client.select<AnalogueRow>(
      ANALOGUE_OUTCOMES,
      `${ANALOGUE_COLUMNS}&asset=${eq(asset)}&matured=is.true&decision_date=lt.${encodeURIComponent(beforeDate)}&order=decision_date.asc,horizon.asc`,
    );
    return rows.map(fromRow);
  }

  async getOutcomes(
    asset: Pair,
    decisionDate: TradingDate,
  ): Promise<readonly AnalogueRecord[]> {
    const rows = await this.#client.select<AnalogueRow>(
      ANALOGUE_OUTCOMES,
      `${ANALOGUE_COLUMNS}&asset=${eq(asset)}&decision_date=${eq(decisionDate)}&order=horizon.asc`,
    );
    return rows.map(fromRow);
  }
}
