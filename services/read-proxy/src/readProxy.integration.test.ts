// dashboard-ui Read_Proxy — local-Supabase integration test (task 4.7).
//
// Exercises the REAL serving path end to end against a reachable LOCAL Supabase:
// the hand-written router (`createHandler` from app.ts) wired to a REAL
// `SupabaseReadClient` (built from the read-proxy's own `loadReadProxyConfig()`),
// driven in-process with stub `IncomingMessage`/`ServerResponse` objects — no
// port binding and no web framework. It proves, with 1–3 requests per endpoint
// (an INTEGRATION test, not a property test):
//
//   1. Valid read   — GET /decision-dates and GET /firing-setups?decisionDate=…
//      return 200 with a `{ rows, lastUpdated }` body (rows may be empty).
//   2. Allowlist     — an unknown path ⇒ 404 and a missing/bad required param ⇒
//      400, both rejected BEFORE any DB round-trip (Req 5.5).
//   3. GET-only      — a POST to an allowlisted path ⇒ 405 (Req 3.4; there is no
//      write path on the serving side).
//   4. RLS/grants    — using the `dashboard_reader` credential directly, a SELECT
//      against a BASE table (`firing_setups`) is DENIED while the corresponding
//      VIEW (`v_firing_setups`) is permitted (Req 4.1, 4.4).
//
// GATING (mirrors src/storage/supabase/supabaseStores.integration.test.ts):
// the suite runs ONLY when the resolved target is `local` AND the local Supabase
// REST endpoint is reachable AND the companion read views/role are present. The
// `beforeAll` probe selects the `v_decision_dates` view; if the backend is down,
// or the companion migration 20260916000003 (views + `dashboard_reader` role) is
// not applied, the probe fails and the whole suite SKIPs cleanly so the offline
// suite stays green. It is structured to run in full when a backend is available.
//
// _Requirements: 3.4, 4.1, 4.4, 5.5_

import type * as http from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createHandler, type ReadResponseBody } from "./app.js";
import { ResponseCacheStore } from "./cache.js";
import { RateLimiterStore } from "./rateLimit.js";
import {
  loadReadProxyConfig,
  tryLoadReadProxyConfig,
  type ReadProxyConfig,
} from "./config.js";
import {
  SupabaseReadClient,
  SupabaseReadError,
} from "./supabaseReadClient.js";

// --- Gate: only run against a configured, reachable LOCAL Supabase ----------

const cfgResult = tryLoadReadProxyConfig();
const isLocalTarget = cfgResult.ok && cfgResult.config.target === "local";

/** Probe once in beforeAll; the whole suite skips unless this is true. */
let reachable = false;
let config: ReadProxyConfig | undefined;
let client: SupabaseReadClient | undefined;

beforeAll(async () => {
  if (!isLocalTarget) {
    return;
  }
  config = loadReadProxyConfig();
  const probe = new SupabaseReadClient(config);
  try {
    // A trivial SELECT against a dashboard VIEW proves two things at once: the
    // REST endpoint is up AND the companion read views/role are present. If the
    // migration 20260916000003 has not been applied the view is absent and this
    // throws, so we skip cleanly rather than fail.
    await probe.select("v_decision_dates", "limit=1");
    reachable = true;
    client = probe;
  } catch {
    reachable = false;
  }
});

afterAll(() => {
  // READ-ONLY suite: nothing is written, so there is nothing to clean up.
});

const shouldRun = (): boolean => isLocalTarget && reachable;

// --- In-process stub req/res (no port binding, no framework) ----------------

interface CapturedResponse {
  res: http.ServerResponse;
  statusCode: number;
  headers: Record<string, string | string[] | number>;
  body: string;
  ended: boolean;
  headersSent: boolean;
}

/** A stub ServerResponse that captures status/headers/body without a socket. */
function makeResponse(): CapturedResponse {
  const captured: CapturedResponse = {
    statusCode: 0,
    headers: {},
    body: "",
    ended: false,
    headersSent: false,
    res: {} as http.ServerResponse,
  };
  const res = {
    get headersSent() {
      return captured.headersSent;
    },
    writeHead(
      status: number,
      headers?: Record<string, string | string[] | number>,
    ) {
      captured.statusCode = status;
      if (headers !== undefined) captured.headers = { ...headers };
      captured.headersSent = true;
      return this;
    },
    end(chunk?: string) {
      if (chunk !== undefined) captured.body += chunk;
      captured.ended = true;
      return this;
    },
  } as unknown as http.ServerResponse;
  captured.res = res;
  return captured;
}

/** A stub IncomingMessage for a given method + url (fresh IP per request). */
function makeRequest(method: string, url: string): http.IncomingMessage {
  return {
    method,
    url,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as http.IncomingMessage;
}

/**
 * Build a handler wired to the REAL SELECT-only client (fresh cache + limiter so
 * cross-test state never leaks). This is the production request path minus the
 * port.
 */
function makeHandler() {
  if (config === undefined) {
    throw new Error("config must be resolved before building a handler");
  }
  const readClient = new SupabaseReadClient(config);
  const cache = new ResponseCacheStore<ReadResponseBody>();
  const rateLimiter = new RateLimiterStore();
  return createHandler({ readClient, cache, rateLimiter });
}

/** Parse a captured JSON body (empty string ⇒ undefined). */
function parseBody(cap: CapturedResponse): unknown {
  return cap.body === "" ? undefined : JSON.parse(cap.body);
}

describe.skipIf(!isLocalTarget)(
  "Read_Proxy integration against local Supabase (Req 3.4, 4.1, 4.4, 5.5)",
  () => {
    it("valid read: GET /decision-dates returns 200 with { rows, lastUpdated }", async () => {
      if (!shouldRun()) return;
      const handler = makeHandler();
      const cap = makeResponse();

      await handler(makeRequest("GET", "/decision-dates"), cap.res);

      expect(cap.statusCode).toBe(200);
      const body = parseBody(cap) as ReadResponseBody;
      expect(Array.isArray(body.rows)).toBe(true);
      // `lastUpdated` is an ISO 8601 instant the proxy stamps on the response.
      expect(typeof body.lastUpdated).toBe("string");
      expect(Number.isNaN(Date.parse(body.lastUpdated))).toBe(false);
    });

    it("valid read: GET /firing-setups?decisionDate=<date> returns 200 with a well-shaped body", async () => {
      if (!shouldRun() || client === undefined) return;
      const handler = makeHandler();

      // Discover a real Decision_Date if the view has data; otherwise use a
      // syntactically valid date that simply yields an empty row set. Either way
      // the endpoint must answer 200 with the `{ rows, lastUpdated }` shape.
      const dates = await client.select<{ decision_date?: string }>(
        "v_decision_dates",
        "limit=1",
      );
      const decisionDate = dates[0]?.decision_date ?? "2026-01-02";

      const cap = makeResponse();
      await handler(
        makeRequest("GET", `/firing-setups?decisionDate=${decisionDate}`),
        cap.res,
      );

      expect(cap.statusCode).toBe(200);
      const body = parseBody(cap) as ReadResponseBody;
      expect(Array.isArray(body.rows)).toBe(true);
      // The /firing-setups endpoint caps responses at 5 rows (allowlist Req 5.4).
      expect(body.rows.length).toBeLessThanOrEqual(5);
      expect(typeof body.lastUpdated).toBe("string");
    });

    it("disallowed query: unknown path ⇒ 404 (allowlist rejects before any DB round-trip, Req 5.5)", async () => {
      if (!shouldRun()) return;
      const handler = makeHandler();
      const cap = makeResponse();

      await handler(makeRequest("GET", "/not-an-endpoint"), cap.res);

      expect(cap.statusCode).toBe(404);
      const body = parseBody(cap) as { error: string };
      expect(typeof body.error).toBe("string");
    });

    it("disallowed query: missing required param ⇒ 400 (Req 5.5)", async () => {
      if (!shouldRun()) return;
      const handler = makeHandler();

      // /firing-setups requires `decisionDate`; omitting it is a 400.
      const missing = makeResponse();
      await handler(makeRequest("GET", "/firing-setups"), missing.res);
      expect(missing.statusCode).toBe(400);

      // A syntactically invalid date for a present param is also a 400.
      const bad = makeResponse();
      await handler(
        makeRequest("GET", "/firing-setups?decisionDate=not-a-date"),
        bad.res,
      );
      expect(bad.statusCode).toBe(400);
    });

    it("non-GET ⇒ 405: a POST to an allowlisted path is rejected (GET-only, no write path, Req 3.4)", async () => {
      if (!shouldRun()) return;
      const handler = makeHandler();
      const cap = makeResponse();

      await handler(makeRequest("POST", "/firing-setups?decisionDate=2026-01-02"), cap.res);

      expect(cap.statusCode).toBe(405);
      expect(cap.headers.Allow).toBe("GET");
    });

    it("RLS/grants: dashboard_reader may SELECT the view but is DENIED the base table (Req 4.1, 4.4)", async () => {
      if (!shouldRun() || client === undefined) return;

      // The curated VIEW is granted to dashboard_reader ⇒ a select succeeds.
      await expect(
        client.select("v_firing_setups", "limit=1"),
      ).resolves.toBeInstanceOf(Array);

      // The underlying BASE table is NOT granted to dashboard_reader and sits
      // under default-deny RLS ⇒ a direct base-table select must be rejected.
      // PostgREST surfaces this as a non-2xx, which the client raises as a
      // SupabaseReadError. (If an environment unexpectedly grants base-table
      // access this assertion fails, correctly flagging a weakened posture.)
      await expect(
        client.select("firing_setups", "limit=1"),
      ).rejects.toBeInstanceOf(SupabaseReadError);
    });
  },
);
