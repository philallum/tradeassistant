// Frozen_Baseline storage PORT + in-memory reference — trader-edge-validation
// Stage D (task 9; design R11). Mirrors the house port + in-memory-reference +
// Supabase-adapter triad (`TradeLedgerStore` / `InMemoryTradeLedgerStore`,
// `FiringSetupStore`, `EvaluationReportStore`).
//
// The store is APPEND-ONLY: a capture is immutable once written so a result
// stays traceable to the exact frozen assumptions (R7.2, R11.1). Deterministic,
// dependency-free; LLM-free.

import type { FrozenBaseline } from "./parameterSet.js";

/**
 * Storage PORT for the `frozen_baselines` table (R11.1, R11.2). Append-only:
 * `append` persists captures keyed by `id`; `getById` / `getAll` read them back.
 */
export interface FrozenBaselineStore {
  /** Persist captures, keyed by `id`. Re-appending the same id is a no-op upsert. */
  append(baselines: readonly FrozenBaseline[]): Promise<void>;
  /** Read one capture by its version stamp, or null when absent. */
  getById(id: string): Promise<FrozenBaseline | null>;
  /** Read every capture, ordered by `capturedAt` ascending (newest last). */
  getAll(): Promise<readonly FrozenBaseline[]>;
}

/**
 * In-memory reference implementation of {@link FrozenBaselineStore}.
 * Deterministic, dependency-free; keyed by `id` so a repeat append replaces the
 * row (idempotent on the primary key, like the SQL table). Serves as the
 * reference for the Supabase adapter and lets the harness run offline in tests.
 */
export class InMemoryFrozenBaselineStore implements FrozenBaselineStore {
  readonly #byId = new Map<string, FrozenBaseline>();

  constructor(initial: readonly FrozenBaseline[] = []) {
    for (const b of initial) this.#byId.set(b.id, b);
  }

  append(baselines: readonly FrozenBaseline[]): Promise<void> {
    for (const b of baselines) this.#byId.set(b.id, b);
    return Promise.resolve();
  }

  getById(id: string): Promise<FrozenBaseline | null> {
    return Promise.resolve(this.#byId.get(id) ?? null);
  }

  getAll(): Promise<readonly FrozenBaseline[]> {
    const all = [...this.#byId.values()].sort((a, b) =>
      a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id),
    );
    return Promise.resolve(all);
  }

  size(): number {
    return this.#byId.size;
  }

  clear(): void {
    this.#byId.clear();
  }
}
