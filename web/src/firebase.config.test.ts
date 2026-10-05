// Feature: dashboard-ui, task 10.2 — Firebase Hosting config unit test.
//
// This is an EXAMPLE / unit test (NOT a property test). It reads and parses the
// committed `web/firebase.json` from disk and asserts the three invariants of the
// hosting config task 10.1 authored:
//
//   - the `/api/**` rewrite targets the `dashboard-read-proxy` Cloud Run service,
//   - a SPA catch-all fallback rewrite (`**` → `/index.html`) exists, and
//   - the strict CSP + security headers are set under `headers` for source `**`.
//
// It parses the real file (relative to this test file) rather than hardcoding the
// expected object, so it genuinely validates the committed `firebase.json` — if the
// deployed config drifts, THIS test breaks.
//
// Validates: Requirements 1.6, 5.7

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// web/src/firebase.config.test.ts → web/firebase.json
const FIREBASE_JSON_PATH = resolve(HERE, "..", "firebase.json");

interface RunRewrite {
  source: string;
  run: { serviceId: string; region?: string };
}
interface DestinationRewrite {
  source: string;
  destination: string;
}
type Rewrite = Partial<RunRewrite & DestinationRewrite> & { source: string };

interface HeaderEntry {
  key: string;
  value: string;
}
interface HeaderBlock {
  source: string;
  headers: HeaderEntry[];
}

interface FirebaseConfig {
  hosting: {
    public?: string;
    rewrites: Rewrite[];
    headers: HeaderBlock[];
  };
}

function loadFirebaseConfig(): FirebaseConfig {
  const raw = readFileSync(FIREBASE_JSON_PATH, "utf8");
  return JSON.parse(raw) as FirebaseConfig;
}

describe("web/firebase.json hosting config (task 10.2)", () => {
  it("parses as valid JSON with a hosting block", () => {
    const config = loadFirebaseConfig();
    expect(config.hosting).toBeDefined();
    expect(Array.isArray(config.hosting.rewrites)).toBe(true);
    expect(Array.isArray(config.hosting.headers)).toBe(true);
  });

  // --- /api/** → dashboard-read-proxy Cloud Run service (Req 1.6, 5.7) -----

  it("routes the /api/** rewrite to the dashboard-read-proxy Cloud Run service", () => {
    const config = loadFirebaseConfig();
    const apiRewrite = config.hosting.rewrites.find((r) => r.source === "/api/**");
    expect(apiRewrite, "a rewrite with source '/api/**' must exist").toBeDefined();
    expect(apiRewrite!.run).toBeDefined();
    expect(apiRewrite!.run!.serviceId).toBe("dashboard-read-proxy");
  });

  // --- SPA catch-all fallback (Req 1.6) ------------------------------------

  it("has a SPA catch-all fallback rewrite ** → /index.html", () => {
    const config = loadFirebaseConfig();
    const fallback = config.hosting.rewrites.find((r) => r.source === "**");
    expect(fallback, "a catch-all rewrite with source '**' must exist").toBeDefined();
    expect(fallback!.destination).toBe("/index.html");
  });

  it("orders the /api/** rewrite before the catch-all so API calls are not swallowed", () => {
    const config = loadFirebaseConfig();
    const apiIndex = config.hosting.rewrites.findIndex((r) => r.source === "/api/**");
    const fallbackIndex = config.hosting.rewrites.findIndex((r) => r.source === "**");
    expect(apiIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackIndex).toBeGreaterThanOrEqual(0);
    expect(apiIndex).toBeLessThan(fallbackIndex);
  });

  // --- strict CSP + security headers for source ** (Req 5.7) ---------------

  describe("strict CSP + security headers under headers for source **", () => {
    const EXPECTED_HEADERS: Record<string, string> = {
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    };

    function headerMapForAllSources(): Map<string, string> {
      const config = loadFirebaseConfig();
      const block = config.hosting.headers.find((h) => h.source === "**");
      expect(block, "a headers block with source '**' must exist").toBeDefined();
      return new Map(block!.headers.map((h) => [h.key, h.value]));
    }

    it("sets a headers block for source **", () => {
      const config = loadFirebaseConfig();
      const block = config.hosting.headers.find((h) => h.source === "**");
      expect(block).toBeDefined();
      expect(block!.headers.length).toBeGreaterThan(0);
    });

    for (const [key, value] of Object.entries(EXPECTED_HEADERS)) {
      it(`sets ${key} to the expected strict value`, () => {
        const headers = headerMapForAllSources();
        expect(headers.has(key), `header '${key}' must be present`).toBe(true);
        expect(headers.get(key)).toBe(value);
      });
    }
  });
});
