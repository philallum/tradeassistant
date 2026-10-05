import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import {
  SupabaseReadClient,
  SupabaseReadError,
} from "./supabaseReadClient.js";
import type { ReadProxyConfig } from "./config.js";

// Feature: dashboard-ui, Property 14: Credential values never appear in responses or logs
//
// *For any* generated read credential / publishable key values and any Supabase response
// (including error responses with non-2xx status and arbitrary body text), the
// SupabaseReadClient never includes the credential value in: (a) the parsed/returned
// result, (b) any thrown error's message or properties, and (c) anything written to the
// console. The credential must only ever travel in the request headers
// (apikey / Authorization: Bearer).
//
// **Validates: Requirements 3.6, 3.7, 5.9, 14.2**

const NUM_RUNS = 200; // >= 100 iterations required by the task.

/**
 * Console methods we capture to prove nothing secret is ever written to a log sink.
 */
const CONSOLE_METHODS = [
  "log",
  "warn",
  "error",
  "info",
  "debug",
] as const;

/**
 * Non-trivial secret strings over the realistic credential alphabet (the characters
 * a Supabase/PostgREST publishable key or a signed `dashboard_reader` JWT is built
 * from: letters, digits, `.`, `-`, `_`). A real read credential is never a lone
 * punctuation character, so we require length >= 8 — otherwise a one-character
 * "secret" like `"` or `!` would spuriously "match" the error formatter's own
 * punctuation (e.g. the quotes the message puts around the view name) and report a
 * leak that is not a credential leak. Within that alphabet the generator stays fully
 * adversarial: it freely covers JWT-shaped (`header.payload.signature`) values.
 */
const secretArb: fc.Arbitrary<string> = fc.stringMatching(
  /^[A-Za-z0-9._-]{8,80}$/,
);

/**
 * A resolved read config whose readKey/apiKey are the two generated secrets. We cover
 * both the hosted shape (distinct publishable apiKey) and the local shape (apiKey
 * omitted, so the client falls back to readKey for both headers).
 */
const configArb: fc.Arbitrary<{
  config: ReadProxyConfig;
  secrets: readonly string[];
}> = fc
  .record({
    url: fc.constantFrom(
      "http://127.0.0.1:54321",
      "https://proj.supabase.co",
      "https://proj.supabase.co/",
    ),
    readKey: secretArb,
    apiKey: fc.option(secretArb, { nil: undefined }),
    target: fc.constantFrom("local" as const, "hosted" as const),
  })
  .map(({ url, readKey, apiKey, target }) => {
    const config: ReadProxyConfig =
      apiKey === undefined
        ? { target, url, readKey }
        : { target, url, readKey, apiKey };
    // The effective apikey header value is apiKey when present, else readKey.
    const effectiveApiKey = apiKey ?? readKey;
    const secrets = Array.from(new Set([readKey, effectiveApiKey]));
    return { config, secrets };
  });

/**
 * A credential-free response the stub returns. The body text is arbitrary (including
 * text that looks like it could echo a payload), but by construction it NEVER contains
 * either secret — we are proving the CLIENT does not leak the secret it was configured
 * with, so the fixture must not seed the secret into the body.
 */
interface ResponsePlan {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
}

function responsePlanArb(
  secrets: readonly string[],
): fc.Arbitrary<ResponsePlan> {
  const safeText = fc
    .string({ maxLength: 120 })
    // Guarantee the body never itself contains a secret substring.
    .filter((s) => secrets.every((sec) => !s.includes(sec)));

  const success = fc
    .array(
      fc.record({
        id: fc.integer(),
        label: safeText,
      }),
      { maxLength: 5 },
    )
    .map(
      (rows): ResponsePlan => ({
        ok: true,
        status: 200,
        body: JSON.stringify(rows),
      }),
    );

  const failure = fc
    .record({
      status: fc.constantFrom(400, 401, 403, 404, 409, 429, 500, 502, 503),
      body: safeText,
    })
    .map(
      ({ status, body }): ResponsePlan => ({
        ok: false,
        status,
        body,
      }),
    );

  return fc.oneof(success, failure);
}

const viewArb: fc.Arbitrary<string> = fc.constantFrom(
  "v_decision_dates",
  "v_firing_setups",
  "v_candles",
);

const queryArb: fc.Arbitrary<string> = fc.constantFrom(
  "",
  "limit=5",
  "decision_date=eq.2026-01-02&limit=10",
);

/** Minimal Response-like stub (only the members the client touches). */
function makeResponse(plan: ResponsePlan): Response {
  return {
    ok: plan.ok,
    status: plan.status,
    json: async () => JSON.parse(plan.body) as unknown,
    text: async () => plan.body,
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Property 14: credential values never appear in responses or logs", () => {
  it("keeps the secret in request headers only — never in results, errors, or console output", async () => {
    // Chain the response plan off the config so the generated body is guaranteed
    // credential-free for the specific secrets under test (and shrinks together).
    const caseArb = configArb.chain((cfg) =>
      fc.record({
        cfg: fc.constant(cfg),
        view: viewArb,
        query: queryArb,
        plan: responsePlanArb(cfg.secrets),
      }),
    );

    await fc.assert(
      fc.asyncProperty(
        caseArb,
        async ({ cfg, view, query, plan }) => {
          const { config, secrets } = cfg;

          // Capture everything written to any console sink.
          const captured: string[] = [];
          for (const name of CONSOLE_METHODS) {
            vi.spyOn(console, name).mockImplementation(
              (...args: unknown[]) => {
                captured.push(args.map((a) => String(a)).join(" "));
              },
            );
          }

          // Stub fetch: assert the secret DOES travel in headers, then return the
          // (credential-free) planned response.
          let headerSawReadKey = false;
          let headerSawApiKey = false;
          const stubFetch = (async (
            _url: string | URL | Request,
            init?: RequestInit,
          ): Promise<Response> => {
            const headers = (init?.headers ?? {}) as Record<string, string>;
            const apikey = headers["apikey"] ?? "";
            const auth = headers["Authorization"] ?? "";
            // The read key must appear as the Bearer token.
            headerSawReadKey = auth === `Bearer ${config.readKey}`;
            // The apikey header must carry the effective gateway key (apiKey or readKey).
            const effectiveApiKey = config.apiKey ?? config.readKey;
            headerSawApiKey = apikey === effectiveApiKey;
            return makeResponse(plan);
          }) as unknown as typeof fetch;

          const client = new SupabaseReadClient(config, stubFetch);

          let returned = "";
          let thrownStr = "";
          try {
            const rows = await client.select<unknown>(view, query);
            returned = JSON.stringify(rows);
            // On success the stub returned a 2xx plan.
            expect(plan.ok).toBe(true);
          } catch (err) {
            // On failure the client must throw a secret-free SupabaseReadError.
            expect(err).toBeInstanceOf(SupabaseReadError);
            const e = err as SupabaseReadError;
            thrownStr = [
              e.message,
              e.name,
              String(e.status),
              e.view,
              // Serialize own-enumerable props too, in case any secret leaked onto one.
              JSON.stringify({ ...e }),
              e.stack ?? "",
            ].join("\n");
            expect(plan.ok).toBe(false);
            expect(e.status).toBe(plan.status);
          }

          // (header proof) The secret travelled in BOTH credential headers.
          expect(headerSawReadKey).toBe(true);
          expect(headerSawApiKey).toBe(true);

          const consoleBlob = captured.join("\n");
          for (const secret of secrets) {
            // (a) not in the returned result
            expect(returned.includes(secret)).toBe(false);
            // (b) not in any thrown error's message / props / stack
            expect(thrownStr.includes(secret)).toBe(false);
            // (c) not in anything written to the console
            expect(consoleBlob.includes(secret)).toBe(false);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
