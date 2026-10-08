// Firebase Hosting config unit test (simplify-to-cloud-minimal R4.1, R4.4, R5.1).
//
// This is an EXAMPLE / unit test (NOT a property test). It reads and parses the committed
// `web/firebase.json` from disk and asserts the Public_Read_Path invariants after the
// read-proxy removal:
//
//   - there is NO `/api/**` rewrite to a Cloud Run service — the SPA fetches the static
//     `dashboard.json` snapshot same-origin, with no proxy (R4.1, R5.1),
//   - the SPA catch-all fallback rewrite (`**` → `/index.html`) still exists, and
//   - the strict CSP + security headers remain under `headers` for source `**`, with
//     `connect-src` widened to allow the public GCS origin so the SPA can fetch the
//     `dashboard.json` snapshot CROSS-ORIGIN from the public-read bucket (R5.1, Option A).
//
// It parses the real file so it genuinely validates the committed `firebase.json` — if the
// deployed config regresses (e.g. a proxy rewrite is reintroduced) THIS test breaks.
//
// Validates: Requirements 4.1, 4.4, 5.1

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

describe("web/firebase.json hosting config (Public_Read_Path)", () => {
  it("parses as valid JSON with a hosting block", () => {
    const config = loadFirebaseConfig();
    expect(config.hosting).toBeDefined();
    expect(Array.isArray(config.hosting.rewrites)).toBe(true);
    expect(Array.isArray(config.hosting.headers)).toBe(true);
  });

  // --- NO proxy rewrite remains (R4.1, R5.1) -------------------------------

  it("has NO /api/** rewrite (the read-proxy is removed; the SPA reads a static snapshot)", () => {
    const config = loadFirebaseConfig();
    const apiRewrite = config.hosting.rewrites.find((r) => r.source === "/api/**");
    expect(apiRewrite, "the /api/** proxy rewrite must be gone").toBeUndefined();
  });

  it("has NO rewrite that targets any Cloud Run service", () => {
    const config = loadFirebaseConfig();
    const runRewrite = config.hosting.rewrites.find((r) => r.run !== undefined);
    expect(runRewrite, "no rewrite may route to a Cloud Run service").toBeUndefined();
  });

  // --- SPA catch-all fallback still present (R5.1) -------------------------

  it("has a SPA catch-all fallback rewrite ** → /index.html", () => {
    const config = loadFirebaseConfig();
    const fallback = config.hosting.rewrites.find((r) => r.source === "**");
    expect(fallback, "a catch-all rewrite with source '**' must exist").toBeDefined();
    expect(fallback!.destination).toBe("/index.html");
  });

  // --- strict CSP + security headers for source ** retained ----------------

  describe("strict CSP + security headers under headers for source **", () => {
    const EXPECTED_HEADERS: Record<string, string> = {
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self' https://storage.googleapis.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
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

    it("the CSP connect-src allows same-origin AND the public GCS origin, so the SPA can fetch the snapshot cross-origin", () => {
      const headers = headerMapForAllSources();
      const csp = headers.get("Content-Security-Policy") ?? "";
      // Same-origin stays allowed (dev/preview fallback) and the public bucket origin is
      // added for the cross-origin snapshot fetch (Option A).
      expect(csp).toContain("connect-src 'self' https://storage.googleapis.com");
    });
  });
});
