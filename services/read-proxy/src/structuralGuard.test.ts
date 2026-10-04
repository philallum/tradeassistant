// dashboard-ui Read_Proxy — structural / architecture guard test (task 4.6).
//
// This test locks the serving-layer invariants structurally rather than
// behaviorally, so a regression that re-introduces a write path, a non-GET route,
// or a web framework fails CI immediately:
//
//   1. SELECT-only  — `SupabaseReadClient` exposes EXACTLY one public method,
//      `select`, and NO write-verb method (upsert/insert/update/delete/rpc/…)
//      exists anywhere on the instance or its prototype chain (Req 3.4, 3.5).
//   2. GET-only     — the hand-written router (`createHandler`) answers any
//      non-GET request (POST/PUT/PATCH/DELETE) to an allowlisted path with `405`
//      (Req 3.4). Driven in-process with a stub `IncomingMessage` /
//      `ServerResponse`, so no port is bound.
//   3. No framework — `services/read-proxy/package.json` declares NO web
//      framework in dependencies or devDependencies (Req 3.1 posture / 5.5).
//   4. Built-in http — `main.ts` imports from `node:http`, and neither `main.ts`
//      nor `app.ts` imports any web-framework package.
//
// _Requirements: 3.4, 3.5, 5.5_

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type * as http from "node:http";

import { describe, expect, it } from "vitest";

import { createHandler, type ReadResponseBody } from "./app.js";
import { ResponseCacheStore } from "./cache.js";
import { RateLimiterStore } from "./rateLimit.js";
import { SupabaseReadClient } from "./supabaseReadClient.js";
import type { ReadProxyConfig } from "./config.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The write-verb names that MUST NOT exist on the read client. If any of these
 * appear as a method, the SELECT-only guarantee (Req 3.4/3.5) is broken.
 */
const FORBIDDEN_WRITE_VERBS = [
  "upsert",
  "insert",
  "update",
  "delete",
  "remove",
  "rpc",
  "post",
  "put",
  "patch",
  "create",
  "write",
] as const;

/**
 * Web-framework package names the proxy must never depend on or import. The
 * proxy is built on the Node built-in `http` module + a hand-written router.
 */
const FORBIDDEN_FRAMEWORKS = [
  "express",
  "fastify",
  "koa",
  "hapi",
  "@hapi/hapi",
  "restify",
  "connect",
  "polka",
  "micro",
  "nest",
  "@nestjs/core",
  "@nestjs/common",
  "@nestjs/platform-express",
  "sails",
  "hono",
  "h3",
] as const;

/** Enumerate the public (non-`#private`, non-`constructor`) method names of an instance. */
function publicMethodNames(instance: object): string[] {
  const names = new Set<string>();
  // Own enumerable + non-enumerable keys (e.g. class fields that are functions).
  for (const key of Object.getOwnPropertyNames(instance)) {
    if (key === "constructor") continue;
    if (typeof (instance as Record<string, unknown>)[key] === "function") {
      names.add(key);
    }
  }
  // Walk the prototype chain up to (but excluding) Object.prototype.
  let proto: object | null = Object.getPrototypeOf(instance);
  while (proto !== null && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc === undefined) continue;
      // A method (value fn) or an accessor both count as a reachable member.
      if (typeof desc.value === "function" || typeof desc.get === "function") {
        names.add(key);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return [...names];
}

/** A minimal, non-secret config so the client constructs without touching the env. */
const STUB_CONFIG: ReadProxyConfig = {
  target: "local",
  url: "http://supabase.local",
  readKey: "stub-read-key",
};

/** A stub fetch that never actually runs (structural test issues no requests). */
const stubFetch: typeof fetch = async () =>
  new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });

describe("SupabaseReadClient — SELECT-only, no write verb (Req 3.4, 3.5)", () => {
  const client = new SupabaseReadClient(STUB_CONFIG, stubFetch);

  it("exposes exactly one public method: select", () => {
    const methods = publicMethodNames(client).sort();
    expect(methods).toEqual(["select"]);
  });

  it("has no write-verb method on the instance or its prototype", () => {
    const methods = new Set(publicMethodNames(client));
    for (const verb of FORBIDDEN_WRITE_VERBS) {
      expect(methods.has(verb)).toBe(false);
      // Also assert nothing is reachable by property access (defense in depth).
      expect(
        typeof (client as unknown as Record<string, unknown>)[verb],
      ).not.toBe("function");
    }
  });

  it("exposes select as a callable method", () => {
    expect(typeof client.select).toBe("function");
  });
});

/** Build a stub ServerResponse that captures status/headers/body without a socket. */
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

/** Build a stub IncomingMessage for a given method + url. */
function makeRequest(method: string, url: string): http.IncomingMessage {
  return {
    method,
    url,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as http.IncomingMessage;
}

describe("createHandler — GET-only router; non-GET ⇒ 405 (Req 3.4)", () => {
  function freshHandler() {
    const readClient: Pick<SupabaseReadClient, "select"> = {
      // Should never be reached on a non-GET path; returns [] if it ever is.
      select: async <T>() => [] as T[],
    };
    const cache = new ResponseCacheStore<ReadResponseBody>();
    const rateLimiter = new RateLimiterStore();
    return createHandler({ readClient, cache, rateLimiter });
  }

  const nonGetMethods = ["POST", "PUT", "PATCH", "DELETE"] as const;
  const allowlistedPath = "/firing-setups?decisionDate=2026-01-02";

  for (const method of nonGetMethods) {
    it(`returns 405 with Allow: GET for ${method} on an allowlisted path`, async () => {
      const handler = freshHandler();
      const req = makeRequest(method, allowlistedPath);
      const cap = makeResponse();

      await handler(req, cap.res);

      expect(cap.statusCode).toBe(405);
      expect(cap.headers.Allow).toBe("GET");
      expect(cap.ended).toBe(true);
      // The body is credential-free and never contains rows.
      expect(cap.body).not.toContain("stub-read-key");
    });
  }

  it("returns 405 for a non-GET even on an unknown path (method guard runs first)", async () => {
    const handler = freshHandler();
    const req = makeRequest("DELETE", "/not-a-real-endpoint");
    const cap = makeResponse();

    await handler(req, cap.res);

    expect(cap.statusCode).toBe(405);
    expect(cap.headers.Allow).toBe("GET");
  });
});

describe("package.json declares no web framework (Req 3.1 posture / 5.5)", () => {
  const pkgPath = resolve(HERE, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const declared = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  it("has no web framework in dependencies or devDependencies", () => {
    for (const fw of FORBIDDEN_FRAMEWORKS) {
      expect(
        Object.prototype.hasOwnProperty.call(declared, fw),
        `package.json must not declare "${fw}"`,
      ).toBe(false);
    }
  });

  it("declares no @nestjs/* or @hapi/* scoped framework package", () => {
    for (const name of Object.keys(declared)) {
      expect(name.startsWith("@nestjs/")).toBe(false);
      expect(name.startsWith("@hapi/")).toBe(false);
    }
  });
});

describe("server source uses built-in http, not a web framework (Req 3.1 posture)", () => {
  const mainSrc = readFileSync(resolve(HERE, "main.ts"), "utf8");
  const appSrc = readFileSync(resolve(HERE, "app.ts"), "utf8");

  it("main.ts imports from node:http (or http)", () => {
    const importsNodeHttp =
      /from\s+["']node:http["']/.test(mainSrc) || /from\s+["']http["']/.test(mainSrc);
    expect(importsNodeHttp).toBe(true);
  });

  it("neither main.ts nor app.ts imports a web-framework package", () => {
    // Match an ESM import whose module specifier is a forbidden framework (exact,
    // or a scoped/subpath form like "@nestjs/core" or "koa/router").
    for (const fw of FORBIDDEN_FRAMEWORKS) {
      const specifier = fw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`from\\s+["']${specifier}(?:/[^"']*)?["']`);
      expect(re.test(mainSrc), `main.ts must not import "${fw}"`).toBe(false);
      expect(re.test(appSrc), `app.ts must not import "${fw}"`).toBe(false);
    }
  });
});
