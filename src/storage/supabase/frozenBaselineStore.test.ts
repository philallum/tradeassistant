// Supabase FrozenBaselineStore adapter — unit tests over a no-network fetch stub
// (trader-edge-validation Stage D, task 9; design R11). Proves the write issues
// an idempotent upsert on `id`, the reads round-trip, and the reads are FAIL-SAFE
// (any error — including a missing table — degrades to null/empty with a
// secret-free warning, never throwing).

import { describe, expect, it } from "vitest";

import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";
import {
  SupabaseFrozenBaselineStore,
  type FrozenBaselineLogger,
} from "./frozenBaselineStore.js";
import {
  captureFrozenBaseline,
  type FrozenBaseline,
} from "../../walk-forward/parameterSet.js";

const CONFIG: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

const BASELINE: FrozenBaseline = captureFrozenBaseline({
  id: "params-v1",
  now: () => new Date("2026-02-01T00:00:00.000Z"),
});

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Build a fetch stub that stores upserted rows and serves them back on GET
 * selects, honouring `id=eq.<id>`. Replies 200 with a bounded `Content-Range`
 * so the paginated `select` terminates after a single short page.
 */
function fakeBackend() {
  const requests: RecordedRequest[] = [];
  const store = new Map<string, Record<string, unknown>>();

  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    const u = url.toString();
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push({
      url: u,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
    });

    if (method === "POST") {
      const rows = JSON.parse(body) as Record<string, unknown>[];
      for (const row of rows) store.set(String(row.id), row);
      return Promise.resolve(
        new Response(null, { status: 201, headers: { "Content-Type": "application/json" } }),
      );
    }

    // GET select
    let rows = [...store.values()];
    const idMatch = /id=eq\.([^&]+)/.exec(u);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1] ?? "");
      rows = rows.filter((r) => String(r.id) === id);
    }
    rows.sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
    const last = Math.max(0, rows.length - 1);
    return Promise.resolve(
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Range": `0-${last}/${rows.length}`,
        },
      }),
    );
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, requests };
}

/** A fetch stub that always rejects — exercises the fail-safe read path. */
function failingFetch(): typeof fetch {
  return () => Promise.reject(new Error("ECONNREFUSED"));
}

describe("SupabaseFrozenBaselineStore — write + round-trip (R11.1, R11.2)", () => {
  it("upserts on the id primary key and reads the capture back", async () => {
    const backend = fakeBackend();
    const store = new SupabaseFrozenBaselineStore(new SupabaseRestClient(CONFIG, backend.fetch));

    await store.append([BASELINE]);

    const post = backend.requests.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    expect(post!.url).toContain("frozen_baselines");
    expect(post!.url).toContain("on_conflict=id");

    const got = await store.getById("params-v1");
    expect(got).toEqual(BASELINE);

    const all = await store.getAll();
    expect(all).toEqual([BASELINE]);
  });

  it("getById returns null for an unknown id", async () => {
    const backend = fakeBackend();
    const store = new SupabaseFrozenBaselineStore(new SupabaseRestClient(CONFIG, backend.fetch));
    await store.append([BASELINE]);
    expect(await store.getById("no-such-id")).toBeNull();
  });

  it("append is a no-op issuing no request for empty input", async () => {
    const backend = fakeBackend();
    const store = new SupabaseFrozenBaselineStore(new SupabaseRestClient(CONFIG, backend.fetch));
    await store.append([]);
    expect(backend.requests).toHaveLength(0);
  });

  it("preserves the full ParameterSet through the jsonb round-trip", async () => {
    const backend = fakeBackend();
    const store = new SupabaseFrozenBaselineStore(new SupabaseRestClient(CONFIG, backend.fetch));
    await store.append([BASELINE]);
    const got = await store.getById("params-v1");
    expect(got!.params).toEqual(BASELINE.params);
  });
});

describe("SupabaseFrozenBaselineStore — fail-safe reads (Stage D deploy-safety)", () => {
  it("getAll degrades to [] with a secret-free warning on error", async () => {
    const warnings: string[] = [];
    const logger: FrozenBaselineLogger = { warn: (m) => warnings.push(m) };
    const store = new SupabaseFrozenBaselineStore(
      new SupabaseRestClient(CONFIG, failingFetch()),
      logger,
    );

    const all = await store.getAll();
    expect(all).toEqual([]);
    expect(warnings).toHaveLength(1);
    const msg = warnings[0]!;
    expect(msg).toContain("fail-safe");
    expect(msg).not.toContain(CONFIG.key);
    expect(msg).not.toContain(CONFIG.apiKey);
  });

  it("getById degrades to null with a secret-free warning on error", async () => {
    const warnings: string[] = [];
    const logger: FrozenBaselineLogger = { warn: (m) => warnings.push(m) };
    const store = new SupabaseFrozenBaselineStore(
      new SupabaseRestClient(CONFIG, failingFetch()),
      logger,
    );

    const got = await store.getById("params-v1");
    expect(got).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!).not.toContain(CONFIG.key);
  });
});
