// dashboard-ui Read_Proxy — the single serving-side HTTP listener (entry point).
//
// This is the ONLY serving-side process that binds a port and the ONLY one that
// touches Supabase. It uses the Node 22 BUILT-IN `http` module — there is NO
// Express / Fastify / Koa / any web framework (spec Req 3.1). It constructs the
// production dependency graph:
//
//   loadReadProxyConfig(process.env) — resolve the read-only connection (read
//                                      credential + optional publishable key);
//                                      NEVER the write / service-role credential.
//   SupabaseReadClient               — the SELECT-only transport (Node `fetch`).
//   RateLimiterStore                 — per-IP + global admission (real `Date.now`).
//   ResponseCacheStore               — short-TTL response cache (real `Date.now`).
//
// then delegates every request to the hand-written router in app.ts
// (`createHandler`). All request-handling logic lives in app.ts so it stays
// testable without binding a port; main.ts only does process wiring + listen.
//
// _Requirements: 3.1 (serving via the proxy), 3.4 (GET/SELECT-only), 5.6 (security
//  headers on every response — enforced in app.ts)_

import * as http from "node:http";

import { createHandler, type ReadResponseBody } from "./app.js";
import { ResponseCacheStore } from "./cache.js";
import { loadReadProxyConfig } from "./config.js";
import { RateLimiterStore } from "./rateLimit.js";
import { SupabaseReadClient } from "./supabaseReadClient.js";

/** Default listen port when `PORT` is unset (Cloud Run injects `PORT`, usually 8080). */
const DEFAULT_PORT = 8080;

/**
 * Resolve the listen port from the environment. Cloud Run sets `PORT`; a clean
 * positive integer is used, otherwise the default. An invalid value falls back
 * rather than crashing the container at boot.
 */
function resolvePort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

/**
 * Build the production HTTP server: resolve config, construct the SELECT-only
 * client + rate limiter + cache store (all on the real clock), and bind the
 * hand-written router. Exported so a smoke/integration harness can start the
 * real server on an ephemeral port without re-deriving the wiring.
 */
export function createServer(
  env: NodeJS.ProcessEnv = process.env,
): http.Server {
  const config = loadReadProxyConfig(env);
  const readClient = new SupabaseReadClient(config);
  const rateLimiter = new RateLimiterStore();
  const cache = new ResponseCacheStore<ReadResponseBody>();

  const handler = createHandler({ readClient, cache, rateLimiter });

  // The built-in http server adapts the (req, res) => void|Promise<void> handler.
  // Any rejected promise is swallowed by the handler's own last-resort guard, but
  // we also attach a catch so an unhandled rejection never crashes the process.
  return http.createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Internal error" }));
      } else {
        res.end();
      }
    });
  });
}

/**
 * Start the listener. Separated from {@link createServer} so tests can construct
 * the server without binding a port. Logs only a non-secret startup line.
 */
export function start(env: NodeJS.ProcessEnv = process.env): http.Server {
  const port = resolvePort(env);
  const server = createServer(env);
  server.listen(port, () => {
    // Credential-free startup log: the port only, never config/secret values.
    console.log(`read-proxy listening on port ${port}`);
  });
  return server;
}

// Start only when run as the entry module (not when imported by a test). Under
// NodeNext ESM, compare the resolved module URL to the invoked script.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  start();
}
