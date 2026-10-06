// Supabase-backed FeatureRegistryStore adapter (Requirement 1.1, 1.2, 1.5-1.9;
// design Component 2).
//
// Implements the SAME `FeatureRegistryStore` PORT signatures and semantics as
// the in-memory reference `InMemoryFeatureRegistryStore`
// (src/feature-registry/types.ts), backed by the `feature_registry` table:
//   feature_id text pk, status ('candidate'|'included'|'cut'), verdict_id uuid|null
//
// Compute/storage separation (Requirement 17.1): this adapter reaches storage
// ONLY through the injected `SupabaseRestClient`. It re-implements NO
// feature-admission logic — it does NOT validate the ≤12 `FEATURE_CEILING`, and
// it decides no admission; that is the Feature Registry orchestration's job
// (Req 1.8). It persists and reads back only the row it is given.
//
// Idempotence (Req 1.5): `upsert` uses the client's merge-duplicates upsert with
// `onConflict = "feature_id"` (the table PK), so re-upserting the same
// `feature_id` REPLACES that row rather than inserting a duplicate — matching
// `InMemoryFeatureRegistryStore`'s keyed replace.
//
// Column mapping (Req 1.6): `status` is persisted as exactly one of
// `candidate | included | cut` and `verdict_id` as the `gate_verdicts` id or
// `null`, via the `toRow` / `fromRow` idiom mirroring `SupabaseAnalogueStore`.
//
// Paginated reads (Req 1.7): `get` uses a `limit=1` select; `all` reads the
// complete set via the client's paginated `select`, so neither relies on an
// unbounded GET the hosted gateway would truncate at ~1000 rows.
//
// Secret-free errors (Req 1.9): failures propagate as the existing
// `SupabaseRestError { message, status, table }`, which never carries the
// Supabase key; the adapter augments the message with the affected `feature_id`
// for diagnosis — never the key.

import type {
  FeatureId,
  FeatureRegistryRow,
  FeatureRegistryStore,
  FeatureStatus,
} from "../../feature-registry/types.js";
import { SupabaseRestError, type SupabaseRestClient } from "./client.js";
import { eq } from "./client.js";

const FEATURE_REGISTRY = "feature_registry";

/** The row shape stored in / read from `feature_registry`. */
interface FeatureRegistryDbRow {
  readonly feature_id: string;
  readonly status: FeatureStatus;
  readonly verdict_id: string | null;
}

/** Map a {@link FeatureRegistryRow} to its `feature_registry` row. */
function toRow(record: FeatureRegistryRow): Record<string, unknown> {
  return {
    feature_id: record.featureId,
    status: record.status,
    verdict_id: record.verdictId,
  };
}

/** Reconstruct a {@link FeatureRegistryRow} from its row. */
function fromRow(row: FeatureRegistryDbRow): FeatureRegistryRow {
  return {
    featureId: row.feature_id as FeatureId,
    status: row.status,
    verdictId: row.verdict_id,
  };
}

export class SupabaseFeatureRegistryStore implements FeatureRegistryStore {
  readonly #client: SupabaseRestClient;

  constructor(client: SupabaseRestClient) {
    this.#client = client;
  }

  /**
   * Idempotent upsert keyed on `feature_id` (the table PK). Uses the client's
   * merge-duplicates upsert with `onConflict = "feature_id"`, so re-upserting
   * the same `feature_id` REPLACES that row rather than inserting a duplicate —
   * matching `InMemoryFeatureRegistryStore` (Req 1.5). `status` is persisted as
   * exactly one of `candidate | included | cut`; `verdict_id` is the
   * `gate_verdicts` id or null (Req 1.6). Errors are augmented with the
   * `feature_id` and remain secret-free (Req 1.9).
   */
  async upsert(row: FeatureRegistryRow): Promise<void> {
    await this.#guard(row.featureId, () =>
      this.#client.upsert(FEATURE_REGISTRY, [toRow(row)], "feature_id"),
    );
  }

  /**
   * Read a single row by `feature_id`, or null when absent (Req 1.6). Uses a
   * `limit=1` select through the paginated `select` and `eq()` encoder the rest
   * of the adapter uses.
   */
  async get(featureId: FeatureId): Promise<FeatureRegistryRow | null> {
    const rows = await this.#guard(featureId, () =>
      this.#client.select<FeatureRegistryDbRow>(
        FEATURE_REGISTRY,
        `feature_id=${eq(featureId)}&limit=1`,
      ),
    );
    const row = rows[0];
    return row === undefined ? null : fromRow(row);
  }

  /**
   * Read all recorded rows via the client's paginated `select`, so a set that
   * exceeds one PostgREST page is retrieved in full and never truncated at
   * ~1000 rows (Req 1.7). Order is unspecified, matching the reference.
   */
  async all(): Promise<readonly FeatureRegistryRow[]> {
    const rows = await this.#client.select<FeatureRegistryDbRow>(
      FEATURE_REGISTRY,
      "select=*",
    );
    return rows.map(fromRow);
  }

  /**
   * Run `op`, re-raising a {@link SupabaseRestError} with the `feature_id`
   * appended to its message for diagnosis. The Supabase key is never part of a
   * `SupabaseRestError`, so it is never surfaced (Req 1.9).
   */
  async #guard<T>(featureId: FeatureId, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof SupabaseRestError) {
        throw new SupabaseRestError(
          `${err.message} (feature_id=${featureId})`,
          err.status,
          err.table,
        );
      }
      throw err;
    }
  }
}
