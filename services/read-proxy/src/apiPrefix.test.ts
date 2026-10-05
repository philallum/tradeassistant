// dashboard-ui Read_Proxy — `/api` path-prefix normalization unit test.
//
// Firebase Hosting's `/api/**` rewrite forwards the FULL matched path to Cloud
// Run, so a browser request to `/api/decision-dates` arrives at the proxy as
// `/api/decision-dates`. The fixed allowlist (allowlist.ts) registers un-prefixed
// paths (e.g. `/decision-dates`), and the router does an EXACT path match, so
// without normalization every `/api/*` request would 404 ("Unknown endpoint").
//
// This test locks the prefix contract: the handler strips a single leading `/api`
// segment BEFORE allowlist resolution, so a `/api`-prefixed request resolves to
// the same endpoint as the un-prefixed one. It also pins the boundary cases —
// `/api` and `/api/` collapse to `/` (still a 404, but NOT because the prefix
// leaked), and a longer segment like `/apixyz` is left untouched (NOT `/xyz`).
//
// Driven in-process with a stub IncomingMessage / ServerResponse (matching
// structuralGuard.test.ts), so no port is bound and no network is reached.
//
// _Requirements: 3.1 (serving via proxy), 5.5 (fixed allowlist resolution)_

import type * as http from "node:http";

import { describe, expect, it } from "vitest";

import { createHandler, type ReadResponseBody } from "./app.js";
import { ResponseCacheStore } from "./cache.js";
import { RateLimiterStore } from "./rateLimit.js";
import type { SupabaseReadClient } from "./supabaseReadClient.js";

/** Capture a ServerResponse's status / headers / body without a socket. */
interface CapturedResponse {
  res: http.ServerResponse;
  statusCode: number;
  headers: Record<string, string | string[] | number>;
  body: string;
  ended: boolean;
  headersSent: boolean;
}

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

/** Build a stub IncomingMessage for a GET to `url`. */
function makeGet(url: string): http.IncomingMessage {
  return {
    method: "GET",
    url,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as http.IncomingMessage;
}

/**
 * A fresh handler whose read client records every `(view, query)` it is asked to
 * SELECT, so a test can assert whether the allowlist resolved (the client is
 * reached) or rejected (it is not).
 */
function freshHandler() {
  const calls: Array<{ view: string; query: string }> = [];
  const readClient: Pick<SupabaseReadClient, "select"> = {
    select: async <T>(view: string, query: string) => {
      calls.push({ view, query });
      return [] as T[];
    },
  };
  const cache = new ResponseCacheStore<ReadResponseBody>();
  const rateLimiter = new RateLimiterStore();
  const handler = createHandler({ readClient, cache, rateLimiter });
  return { handler, calls };
}

async function run(url: string) {
  const { handler, calls } = freshHandler();
  const cap = makeResponse();
  await handler(makeGet(url), cap.res);
  return { cap, calls };
}

describe("`/api` prefix normalization — Firebase rewrite forwards the full path", () => {
  it("resolves `/api/decision-dates` to the same endpoint as `/decision-dates`", async () => {
    const prefixed = await run("/api/decision-dates");
    const bare = await run("/decision-dates");

    // Both reach the SELECT-only client (allowlist resolved) — i.e. NOT a 404.
    expect(prefixed.cap.statusCode).not.toBe(404);
    expect(bare.cap.statusCode).not.toBe(404);
    expect(prefixed.cap.statusCode).toBe(200);
    expect(bare.cap.statusCode).toBe(200);

    // The same view is queried in both cases: the prefix is transparent.
    expect(prefixed.calls).toHaveLength(1);
    expect(bare.calls).toHaveLength(1);
    expect(prefixed.calls[0]?.view).toBe(bare.calls[0]?.view);
    expect(prefixed.calls[0]?.view).toBe("v_decision_dates");
  });

  it("resolves `/api/decision-dates` with a query identically to the un-prefixed path", async () => {
    const prefixed = await run("/api/confidence-trend?pair=EURUSD");
    const bare = await run("/confidence-trend?pair=EURUSD");

    expect(prefixed.cap.statusCode).toBe(200);
    expect(bare.cap.statusCode).toBe(200);
    expect(prefixed.calls[0]?.view).toBe(bare.calls[0]?.view);
    expect(prefixed.calls[0]?.query).toBe(bare.calls[0]?.query);
  });

  it("maps `/api` (bare prefix) to `/`", async () => {
    const prefixed = await run("/api");
    const root = await run("/");

    // `/` is not an allowlisted endpoint, so both are a 404 — but critically the
    // `/api` form behaves EXACTLY like `/`, proving the prefix was stripped to `/`
    // rather than leaking through as the literal path `/api`.
    expect(prefixed.cap.statusCode).toBe(404);
    expect(prefixed.cap.statusCode).toBe(root.cap.statusCode);
    expect(prefixed.calls).toHaveLength(0);
  });

  it("maps `/api/` (trailing slash) to `/`", async () => {
    const prefixed = await run("/api/");
    const root = await run("/");

    expect(prefixed.cap.statusCode).toBe(404);
    expect(prefixed.cap.statusCode).toBe(root.cap.statusCode);
    expect(prefixed.calls).toHaveLength(0);
  });

  it("does NOT strip `/api` when it is part of a longer segment (`/apixyz`)", async () => {
    // `/apixyz` must NOT become `/xyz`; it stays `/apixyz`, which is an unknown
    // endpoint ⇒ 404, and the read client is never reached.
    const result = await run("/apixyz");
    expect(result.cap.statusCode).toBe(404);
    expect(result.calls).toHaveLength(0);

    // Belt-and-braces: `/apixyz` must not accidentally resolve like `/xyz` either
    // (both happen to be 404 here, but the client-call count proves no resolution).
    const bareXyz = await run("/xyz");
    expect(bareXyz.calls).toHaveLength(0);
  });

  it("leaves an already un-prefixed allowlisted path untouched", async () => {
    const result = await run("/decision-dates");
    expect(result.cap.statusCode).toBe(200);
    expect(result.calls[0]?.view).toBe("v_decision_dates");
  });
});
