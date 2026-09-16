import { describe, expect, it } from "vitest";
import {
  InMemoryConnectivityStore,
  checkConnectivity,
  newProbeId,
  type ConnectivityProbe,
  type ConnectivityStore,
} from "./connectivity.js";
import { tryLoadSupabaseConfig } from "./supabaseConfig.js";

describe("newProbeId", () => {
  it("produces unique ids across calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newProbeId()));
    expect(ids.size).toBe(200);
  });
});

describe("checkConnectivity — round-trip write and read (Req 6.4)", () => {
  it("succeeds when the store round-trips the probe faithfully", async () => {
    const store = new InMemoryConnectivityStore();
    const result = await checkConnectivity(store, "local");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target).toBe("local");
      expect(result.probeId).toMatch(/^connectivity-probe-/);
    }
  });

  it("cleans up the temporary probe after a successful check", async () => {
    const store = new InMemoryConnectivityStore();
    const result = await checkConnectivity(store, "hosted");
    expect(result.ok).toBe(true);
    expect(store.size()).toBe(0);
  });

  it("cleans up the temporary probe even when the round-trip fails", async () => {
    // A store that "loses" the write: read always returns null.
    const rows = new Map<string, ConnectivityProbe>();
    const lossy: ConnectivityStore = {
      write: (p) => {
        rows.set(p.id, p);
        return Promise.resolve();
      },
      read: () => Promise.resolve(null),
      remove: (id) => {
        rows.delete(id);
        return Promise.resolve();
      },
    };
    const result = await checkConnectivity(lossy, "local");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no record/);
    }
    expect(rows.size).toBe(0);
  });

  it("fails with a mismatch error when the read-back value differs", async () => {
    const corrupt: ConnectivityStore = {
      write: () => Promise.resolve(),
      read: (id) => Promise.resolve({ id, value: "tampered" }),
      remove: () => Promise.resolve(),
    };
    const result = await checkConnectivity(corrupt, "hosted");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/value mismatch/);
    }
  });

  it("returns a structured error when the write rejects (no throw escapes)", async () => {
    const failing: ConnectivityStore = {
      write: () => Promise.reject(new Error("connection refused")),
      read: () => Promise.resolve(null),
      remove: () => Promise.resolve(),
    };
    const result = await checkConnectivity(failing, "hosted");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("connection refused");
    }
  });

  it("does not let a cleanup failure mask a successful round-trip", async () => {
    const rows = new Map<string, ConnectivityProbe>();
    const cleanupFails: ConnectivityStore = {
      write: (p) => {
        rows.set(p.id, p);
        return Promise.resolve();
      },
      read: (id) => Promise.resolve(rows.get(id) ?? null),
      remove: () => Promise.reject(new Error("delete failed")),
    };
    const result = await checkConnectivity(cleanupFails, "local");
    expect(result.ok).toBe(true);
  });
});

/**
 * Integration-style round-trip against a real Supabase instance. Guarded: it
 * only runs when a Supabase target is fully configured in the environment
 * (Requirement 17.2 — the same check runs against local and hosted). Without a
 * configured instance it is skipped so the offline test suite stays green.
 *
 * A concrete Supabase-backed ConnectivityStore adapter arrives with the storage
 * schema (task 2.1); until then this documents the guard and stays skipped.
 */
const supabaseConfigured = tryLoadSupabaseConfig().ok;

describe.skipIf(!supabaseConfigured)(
  "checkConnectivity — live Supabase round-trip (Req 6.4, 17.2)",
  () => {
    it.skip(
      "round-trips a probe against the configured Supabase target",
      () => {
        // Requires the Supabase adapter from task 2.1. Intentionally skipped
        // until the storage schema/migrations exist.
      },
    );
  },
);
