// Supabase-backed FrozenBaselineStore adapter — trader-edge-validation Stage D
// (task 9; design R11). Backed by the `frozen_baselines` table added in migration
// 20260916000008_frozen_baselines.sql.
//
// Implements the SAME `FrozenBaselineStore` PORT as the in-memory reference
// `InMemoryFrozenBaselineStore` (src/walk-forward/frozenBaselineStore.ts),
// reaching storage ONLY through the injected `SupabaseRestClient`.
//
// FAIL-SAFE READ (Stage D deploy-safety): `getById` / `getAll` degrade to an
// EMPTY result on ANY error — including the additive-migration torn-deploy case
// where the `frozen_baselines` table is not yet present — logging a secret-free
// warning rather than throwing. The Supabase key is never part of a
// `SupabaseRestError`, so it is never surfaced. Writes use the upsert path
// (idempotent on the `id` primary key) and are NOT swallowed (a failed write
// should surface to the operator ops entry, which is not on the daily-run
// critical path).

import type {
  FrozenBaseline,
  ParameterSet,
} from "../../walk-forward/parameterSet.js";
import type { FrozenBaselineStore } from "../../walk-forward/frozenBaselineStore.js";
import { SupabaseRestError, type SupabaseRestClient } from "./client.js";

const FROZEN_BASELINES = "frozen_baselines";

/** frozen_baselines row shape (matches the SQL columns exactly). */
interface FrozenBaselineDbRow {
  readonly id: string;
  readonly captured_at: string;
  readonly params: ParameterSet;
}

/** Map a domain {@link FrozenBaseline} to its `frozen_baselines` DB row. */
function toDbRow(baseline: FrozenBaseline): Record<string, unknown> {
  return {
    id: baseline.id,
    captured_at: baseline.capturedAt,
    params: baseline.params,
  };
}

/** Reconstruct a domain {@link FrozenBaseline} from a DB row. */
function fromDbRow(row: FrozenBaselineDbRow): FrozenBaseline {
  return {
    id: row.id,
    capturedAt: row.captured_at,
    params: row.params,
  };
}

/** A minimal secret-free logger seam (defaults to `console.warn`). */
export interface FrozenBaselineLogger {
  warn(message: string): void;
}

const defaultLogger: FrozenBaselineLogger = {
  warn: (message: string) => console.warn(message),
};

/** Build a secret-free description of a caught error (never includes the key). */
function describeError(err: unknown): string {
  if (err instanceof SupabaseRestError) return `HTTP ${err.status} on "${err.table}"`;
  if (err instanceof Error) return err.name;
  return "unknown error";
}

export class SupabaseFrozenBaselineStore implements FrozenBaselineStore {
  readonly #client: SupabaseRestClient;
  readonly #logger: FrozenBaselineLogger;

  constructor(client: SupabaseRestClient, logger: FrozenBaselineLogger = defaultLogger) {
    this.#client = client;
    this.#logger = logger;
  }

  /** Upsert captures (idempotent on `id`). Not swallowed — a failed write surfaces to ops. */
  async append(baselines: readonly FrozenBaseline[]): Promise<void> {
    if (baselines.length === 0) return;
    await this.#client.upsert(FROZEN_BASELINES, baselines.map(toDbRow), "id");
  }

  /**
   * Read one capture by its `id`. FAIL-SAFE: any error (including a
   * not-yet-present `frozen_baselines` table during a torn additive deploy)
   * degrades to `null` with a secret-free warning.
   */
  async getById(id: string): Promise<FrozenBaseline | null> {
    try {
      const query = `id=eq.${encodeURIComponent(id)}&limit=1`;
      const rows = await this.#client.select<FrozenBaselineDbRow>(FROZEN_BASELINES, query);
      const row = rows[0];
      return row === undefined ? null : fromDbRow(row);
    } catch (err) {
      this.#logger.warn(
        `frozen_baselines read failed (${describeError(err)}); degrading to null (fail-safe)`,
      );
      return null;
    }
  }

  /**
   * Read every capture, ordered by `captured_at` ascending. FAIL-SAFE: any error
   * degrades to `[]` with a secret-free warning.
   */
  async getAll(): Promise<readonly FrozenBaseline[]> {
    try {
      const query = `order=captured_at.asc,id.asc`;
      const rows = await this.#client.select<FrozenBaselineDbRow>(FROZEN_BASELINES, query);
      return rows.map(fromDbRow);
    } catch (err) {
      this.#logger.warn(
        `frozen_baselines read failed (${describeError(err)}); degrading to empty (fail-safe)`,
      );
      return [];
    }
  }
}
