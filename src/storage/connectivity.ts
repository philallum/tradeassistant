// Supabase connectivity check via round-trip write + read (Requirement 6.4).
//
// Compute/storage separation (Requirement 17.1): the check is expressed against
// a narrow `ConnectivityStore` PORT — write a record, read it back, delete it.
// The deterministic core depends only on this port, never on a concrete
// Supabase client. A real Supabase-backed adapter (added when the storage
// schema lands in task 2.1) implements the same port without changing this
// logic, and an in-memory adapter makes the round-trip fully testable offline.

import type { SupabaseConfig } from "./supabaseConfig.js";

/** A single probe record written and read back during the round-trip. */
export interface ConnectivityProbe {
  /** Unique id for this probe (used to read the exact row back). */
  readonly id: string;
  /** Opaque payload whose read-back value must match what was written. */
  readonly value: string;
}

/**
 * The connectivity PORT: the minimal surface a storage backend must expose for
 * a round-trip health check. Implementations perform real I/O and may reject.
 */
export interface ConnectivityStore {
  /** Persist a probe record. */
  write(probe: ConnectivityProbe): Promise<void>;
  /** Read a probe record back by id, or `null` if absent. */
  read(id: string): Promise<ConnectivityProbe | null>;
  /** Remove a probe record by id (idempotent). Used for cleanup. */
  remove(id: string): Promise<void>;
}

/** Outcome of a connectivity check. */
export type ConnectivityResult =
  | { readonly ok: true; readonly target: SupabaseConfig["target"]; readonly probeId: string }
  | { readonly ok: false; readonly target: SupabaseConfig["target"] | null; readonly error: string };

let probeCounter = 0;

/** Generate a collision-resistant probe id for a connectivity round-trip. */
export function newProbeId(): string {
  probeCounter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `connectivity-probe-${Date.now().toString(36)}-${probeCounter.toString(36)}-${rand}`;
}

/**
 * Run a connectivity check that performs a round-trip write and read
 * (Requirement 6.4).
 *
 * The check writes a unique probe record, reads it back, and asserts the
 * read-back value matches what was written. The temporary probe is always
 * removed afterward (best-effort cleanup), whether the round-trip succeeds or
 * fails, so the check leaves no residue.
 *
 * Errors (connection failure, missing row, value mismatch) are returned as a
 * structured `{ ok: false }` result rather than thrown, so callers can report
 * connectivity status without exception handling.
 *
 * @param store   The storage backend to probe (real Supabase adapter in prod,
 *                in-memory adapter in tests).
 * @param target  The configured target, surfaced in the result for diagnostics.
 */
export async function checkConnectivity(
  store: ConnectivityStore,
  target: SupabaseConfig["target"],
): Promise<ConnectivityResult> {
  const probe: ConnectivityProbe = {
    id: newProbeId(),
    value: `round-trip-${Date.now()}`,
  };

  try {
    await store.write(probe);

    const readBack = await store.read(probe.id);
    if (readBack === null) {
      return {
        ok: false,
        target,
        error: `Round-trip read returned no record for probe "${probe.id}".`,
      };
    }
    if (readBack.value !== probe.value) {
      return {
        ok: false,
        target,
        error:
          `Round-trip value mismatch for probe "${probe.id}": ` +
          `wrote "${probe.value}", read "${readBack.value}".`,
      };
    }

    return { ok: true, target, probeId: probe.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, target, error: message };
  } finally {
    // Best-effort cleanup: never let a cleanup failure mask the round-trip
    // outcome, but do not leave the probe behind on the happy path.
    try {
      await store.remove(probe.id);
    } catch {
      // Intentionally ignored — cleanup is best-effort.
    }
  }
}

/**
 * Simple in-memory {@link ConnectivityStore}. Deterministic and dependency-free;
 * used to exercise the round-trip logic offline and as a reference for the
 * behavior a real Supabase adapter must reproduce.
 */
export class InMemoryConnectivityStore implements ConnectivityStore {
  readonly #rows = new Map<string, ConnectivityProbe>();

  write(probe: ConnectivityProbe): Promise<void> {
    this.#rows.set(probe.id, probe);
    return Promise.resolve();
  }

  read(id: string): Promise<ConnectivityProbe | null> {
    return Promise.resolve(this.#rows.get(id) ?? null);
  }

  remove(id: string): Promise<void> {
    this.#rows.delete(id);
    return Promise.resolve();
  }

  /** Test/inspection helper: number of probe rows currently held. */
  size(): number {
    return this.#rows.size;
  }
}
