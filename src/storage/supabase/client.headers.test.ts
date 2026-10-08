// Unit test for the SupabaseRestClient header split (spec Req 8.3, 8.5).
//
// Under the new asymmetric-key model the gateway `apikey` header must carry the
// publishable (anon) key, while the role credential (the Scoped_Write_Credential
// JWT) travels in `Authorization: Bearer`. When no separate `apiKey` is
// configured the client falls back to using `key` for both headers (legacy
// anon/service-key behavior). This test exercises both shapes via an injected
// fetch stub that captures the request headers — no network, no real secret.
//
// It also pins the ROLE-NAME AGNOSTIC property (spec Req 4.6, 9.3): the client
// carries whatever Bearer JWT it is given through unchanged, so swapping the
// JWT's embedded `role` claim from `pipeline_writer` to `fx_writer` is a secret
// rotation, not a code edit. The client never parses the JWT or branches on any
// role name — the role is resolved server-side by PostgREST.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

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

/**
 * Build a syntactically-valid (unverified) JWT with the given `role` claim.
 * The signature is a fixed placeholder — the client never verifies or decodes
 * it, which is exactly the property under test.
 */
function jwtWithRole(role: string): string {
  const b64 = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = b64({ alg: "ES256", typ: "JWT" });
  const payload = b64({ role, iss: "supabase", iat: 0, exp: 9999999999 });
  return `${header}.${payload}.sig_placeholder`;
}

describe("SupabaseRestClient is role-name agnostic (spec Req 4.6, 9.3)", () => {
  it("carries the Bearer JWT through verbatim regardless of its embedded role claim", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Any role name — the current `pipeline_writer`, the target `fx_writer`,
        // or an arbitrary identifier — must be treated identically.
        fc.oneof(
          fc.constantFrom("pipeline_writer", "fx_writer", "anon", "authenticated"),
          fc
            .string({ minLength: 1, maxLength: 24 })
            .filter((s) => /^[a-z_][a-z0-9_]*$/i.test(s)),
        ),
        async (role) => {
          const jwt = jwtWithRole(role);
          const cfg: SupabaseConfig = {
            target: "hosted",
            url: "https://proj.supabase.co",
            key: jwt,
            apiKey: "sb_publishable_anon",
          };
          const cap = capturingFetch();
          const client = new SupabaseRestClient(cfg, cap.fetch);
          await client.select("candles", "select=asset&limit=1");

          const h = cap.lastHeaders();
          // The exact JWT is forwarded byte-for-byte; the apikey is the
          // publishable key and does NOT change with the role.
          expect(h.Authorization).toBe(`Bearer ${jwt}`);
          expect(h.apikey).toBe("sb_publishable_anon");
        },
      ),
      { numRuns: 50 },
    );
  });

  it("produces identical request headers for a pipeline_writer vs an fx_writer JWT (same apikey, only the Bearer value differs)", async () => {
    const base: Omit<SupabaseConfig, "key"> = {
      target: "hosted",
      url: "https://proj.supabase.co",
      apiKey: "sb_publishable_anon",
    };
    const run = async (role: string): Promise<Record<string, string>> => {
      const cap = capturingFetch();
      const client = new SupabaseRestClient(
        { ...base, key: jwtWithRole(role) },
        cap.fetch,
      );
      await client.select("candles", "select=asset&limit=1");
      return cap.lastHeaders();
    };

    const pw = await run("pipeline_writer");
    const fx = await run("fx_writer");

    // apikey + static headers are identical; only the Bearer JWT value differs.
    expect(fx.apikey).toBe(pw.apikey);
    expect(fx["Content-Type"]).toBe(pw["Content-Type"]);
    expect(fx.Authorization).not.toBe(pw.Authorization);
    expect(fx.Authorization).toBe(`Bearer ${jwtWithRole("fx_writer")}`);
  });

  it("hardcodes no Postgres role name in the client/config source (cutover is a secret rotation, not a code edit)", () => {
    const read = (relFromThisFile: string): string =>
      readFileSync(
        fileURLToPath(new URL(relFromThisFile, import.meta.url)),
        "utf8",
      );
    // Strip line/block comments so illustrative role names in documentation do
    // not count — only *executable* source may not couple to a role name.
    const stripComments = (src: string): string =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");

    const clientCode = stripComments(read("./client.ts"));
    const configCode = stripComments(read("../supabaseConfig.ts"));

    for (const [name, code] of [
      ["client.ts", clientCode],
      ["supabaseConfig.ts", configCode],
    ] as const) {
      expect(code, `${name} must not hardcode the pipeline_writer role`).not.toMatch(
        /pipeline_writer/i,
      );
      expect(code, `${name} must not hardcode the fx_writer role`).not.toMatch(
        /fx_writer/i,
      );
    }
  });
});
