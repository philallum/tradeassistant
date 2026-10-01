// Unit test for the SupabaseRestClient header split (spec Req 8.3, 8.5).
//
// Under the new asymmetric-key model the gateway `apikey` header must carry the
// publishable (anon) key, while the role credential (the Scoped_Write_Credential
// JWT) travels in `Authorization: Bearer`. When no separate `apiKey` is
// configured the client falls back to using `key` for both headers (legacy
// anon/service-key behavior). This test exercises both shapes via an injected
// fetch stub that captures the request headers — no network, no real secret.

import { describe, expect, it } from "vitest";

import type { SupabaseConfig } from "../supabaseConfig.js";
import { SupabaseRestClient } from "./client.js";

/** A fetch stub that records the headers of the last request. */
function capturingFetch(): {
  fetch: typeof fetch;
  lastHeaders: () => Record<string, string>;
} {
  let captured: Record<string, string> = {};
  const fetchImpl = ((_url: string | URL, init?: RequestInit) => {
    captured = (init?.headers ?? {}) as Record<string, string>;
    return Promise.resolve(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, lastHeaders: () => captured };
}

describe("SupabaseRestClient header split (spec Req 8.3, 8.5)", () => {
  it("sends the publishable apiKey as `apikey` and the Bearer credential as `Authorization`", async () => {
    const cfg: SupabaseConfig = {
      target: "hosted",
      url: "https://proj.supabase.co",
      key: "scoped-write-jwt",
      apiKey: "sb_publishable_anon",
    };
    const cap = capturingFetch();
    const client = new SupabaseRestClient(cfg, cap.fetch);
    await client.select("candles", "select=asset&limit=1");

    const h = cap.lastHeaders();
    expect(h.apikey).toBe("sb_publishable_anon");
    expect(h.Authorization).toBe("Bearer scoped-write-jwt");
  });

  it("falls back to `key` for both headers when no apiKey is configured", async () => {
    const cfg: SupabaseConfig = {
      target: "local",
      url: "http://127.0.0.1:54321",
      key: "local-anon-key",
    };
    const cap = capturingFetch();
    const client = new SupabaseRestClient(cfg, cap.fetch);
    await client.select("candles", "select=asset&limit=1");

    const h = cap.lastHeaders();
    expect(h.apikey).toBe("local-anon-key");
    expect(h.Authorization).toBe("Bearer local-anon-key");
  });
});
