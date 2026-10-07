// Unit tests for SupabaseRestClient.insertReturning() (dashboard-data-activation
// Task 1.1; design Component 1).
//
// `insertReturning` is the additive read-back path the SupabaseGateVerdictStore
// needs: a plain insert issued with `Prefer: return=representation` so the
// DB-generated `gen_random_uuid()` primary key is read back from the response
// body. `upsert` keeps its `Prefer: resolution=merge-duplicates,return=minimal`
// behaviour (verified below). These tests inject a stub `fetch` via the
// constructor — no network, no real secret — and assert:
//   1. the request sends `Prefer: return=representation` (not the upsert prefer);
//   2. the inserted rows, including a stub-minted generated id, are returned;
//   3. empty input is a no-op that issues no request;
//   4. apikey + Authorization still travel in headers;
//   5. a non-success status raises a secret-free SupabaseRestError;
//   6. `upsert` is unchanged — it still sends the merge-duplicates/minimal prefer.

import { describe, expect, it } from "vitest";

import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient, SupabaseRestError } from "./client.js";

const CONFIG: SupabaseConfig = {
  target: "hosted",
  url: "https://proj.supabase.co",
  key: "scoped-write-jwt",
  apiKey: "sb_publishable_anon",
};

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/**
 * Build a fetch stub that models PostgREST `return=representation`: it echoes the
 * posted rows back, minting a `gen_random_uuid()`-style `id` for each row that
 * lacks one (exactly as the DB default would). Every request is recorded.
 */
function insertFetch(status = 201): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  let seq = 0;

  const fetchImpl = ((url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const bodyText = typeof init?.body === "string" ? init.body : "[]";
    const parsed = JSON.parse(bodyText) as Record<string, unknown>[];
    requests.push({
      url: String(url),
      method: String(init?.method ?? "GET"),
      headers,
      body: parsed,
    });

    const returned = parsed.map((row) => ({
      id: row.id ?? `generated-uuid-${(seq += 1)}`,
      ...row,
    }));

    return Promise.resolve(
      new Response(JSON.stringify(returned), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;

  return { fetch: fetchImpl, requests };
}

describe("SupabaseRestClient.insertReturning() (return=representation read-back)", () => {
  it("issues a POST with Prefer: return=representation and reads the generated id back", async () => {
    const stub = insertFetch();
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    const inserted = await client.insertReturning<{ id: string; config_id: string }>(
      "gate_verdicts",
      [{ config_id: "EURUSD-active", sample_size: 500 }],
    );

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.id).toBe("generated-uuid-1");
    expect(inserted[0]?.config_id).toBe("EURUSD-active");

    expect(stub.requests).toHaveLength(1);
    const req = stub.requests[0];
    expect(req?.method).toBe("POST");
    expect(req?.headers.Prefer).toBe("return=representation");
    // Not the upsert prefer — this is a plain insert.
    expect(req?.headers.Prefer).not.toContain("merge-duplicates");
    expect(req?.url).toBe("https://proj.supabase.co/rest/v1/gate_verdicts");
    expect(req?.body).toEqual([{ config_id: "EURUSD-active", sample_size: 500 }]);
  });

  it("returns every inserted row for a multi-row insert", async () => {
    const stub = insertFetch();
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    const inserted = await client.insertReturning<{ id: string }>("gate_fold_verdicts", [
      { verdict_id: "v1", fold_index: 0 },
      { verdict_id: "v1", fold_index: 1 },
    ]);

    expect(inserted).toHaveLength(2);
    expect(inserted[0]?.id).toBe("generated-uuid-1");
    expect(inserted[1]?.id).toBe("generated-uuid-2");
  });

  it("is a no-op that issues no request for empty input", async () => {
    const stub = insertFetch();
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    const inserted = await client.insertReturning("gate_verdicts", []);

    expect(inserted).toEqual([]);
    expect(stub.requests).toHaveLength(0);
  });

  it("carries apikey + Authorization in headers", async () => {
    const stub = insertFetch();
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    await client.insertReturning("gate_verdicts", [{ config_id: "x" }]);

    const req = stub.requests[0];
    expect(req?.headers.apikey).toBe("sb_publishable_anon");
    expect(req?.headers.Authorization).toBe("Bearer scoped-write-jwt");
  });

  it("raises a secret-free SupabaseRestError on a non-success status", async () => {
    const stub = insertFetch(403);
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    await expect(
      client.insertReturning("gate_verdicts", [{ config_id: "x" }]),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SupabaseRestError);
      const restErr = err as SupabaseRestError;
      expect(restErr.status).toBe(403);
      expect(restErr.table).toBe("gate_verdicts");
      // The secret must never leak into the error message.
      expect(restErr.message).not.toContain("scoped-write-jwt");
      expect(restErr.message).not.toContain("sb_publishable_anon");
      return true;
    });
  });

  it("leaves upsert's merge-duplicates/minimal prefer unchanged", async () => {
    const stub = insertFetch(201);
    const client = new SupabaseRestClient(CONFIG, stub.fetch);

    await client.upsert("feature_registry", [{ feature_id: "f1" }], "feature_id");

    const req = stub.requests[0];
    expect(req?.headers.Prefer).toBe("resolution=merge-duplicates,return=minimal");
  });
});
