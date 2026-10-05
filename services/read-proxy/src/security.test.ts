import { describe, expect, it } from "vitest";
import {
  STATIC_SECURITY_HEADERS,
  cacheControlFor,
  securityHeaders,
} from "./security.js";

// Feature: dashboard-ui, task 4.4 — example/unit tests asserting that the CSP and
// security headers are present and correctly valued on a representative proxy
// response, and that the per-endpoint `Cache-Control` is derived correctly.
//
// _Requirements: 5.6 (CSP + security headers on every response; per-endpoint Cache-Control)_

/** The exact static security headers every proxy response must carry (Req 5.6). */
const EXPECTED_STATIC: Record<string, string> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

describe("securityHeaders — CSP and security headers on proxy responses (Req 5.6)", () => {
  it("sets exactly the required header values on a representative cacheable response", () => {
    const headers = securityHeaders({ cacheTtlMs: 120_000, bypass: false });

    expect(headers).toEqual({
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Cache-Control": "public, max-age=120",
    });
  });

  it("derives the decision-dates TTL into Cache-Control: public, max-age=300", () => {
    const headers = securityHeaders({ cacheTtlMs: 300_000, bypass: false });

    expect(headers["Cache-Control"]).toBe("public, max-age=300");
    // The static security set is unaffected by the TTL.
    for (const [name, value] of Object.entries(EXPECTED_STATIC)) {
      expect(headers[name]).toBe(value);
    }
  });

  it("marks a bypass (refresh) response no-store while keeping every static security header", () => {
    const headers = securityHeaders({ cacheTtlMs: 120_000, bypass: true });

    expect(headers["Cache-Control"]).toBe("no-store");
    for (const [name, value] of Object.entries(EXPECTED_STATIC)) {
      expect(headers[name]).toBe(value);
    }
  });

  it("degrades a non-positive or non-finite TTL to no-store (not a bogus max-age)", () => {
    expect(cacheControlFor({ cacheTtlMs: 0, bypass: false })).toBe("no-store");
    expect(cacheControlFor({ cacheTtlMs: -1_000, bypass: false })).toBe("no-store");
    expect(cacheControlFor({ cacheTtlMs: Number.NaN, bypass: false })).toBe("no-store");
    expect(cacheControlFor({ cacheTtlMs: Number.POSITIVE_INFINITY, bypass: false })).toBe(
      "no-store",
    );

    // The same degraded values surface through the full header map, with the
    // static security headers still present.
    const headers = securityHeaders({ cacheTtlMs: 0, bypass: false });
    expect(headers["Cache-Control"]).toBe("no-store");
    for (const [name, value] of Object.entries(EXPECTED_STATIC)) {
      expect(headers[name]).toBe(value);
    }
  });

  it("returns a fresh object each call so mutation never leaks to the shared static set", () => {
    const first = securityHeaders({ cacheTtlMs: 120_000, bypass: false });

    // Mutating the returned map must not corrupt the shared static headers...
    first["Content-Security-Policy"] = "tampered";
    first["Cache-Control"] = "tampered";
    delete first["X-Frame-Options"];

    expect(STATIC_SECURITY_HEADERS["Content-Security-Policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(STATIC_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");

    // ...nor a subsequent call's result.
    const second = securityHeaders({ cacheTtlMs: 120_000, bypass: false });
    expect(second).not.toBe(first);
    expect(second["Content-Security-Policy"]).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(second["X-Frame-Options"]).toBe("DENY");
    expect(second["Cache-Control"]).toBe("public, max-age=120");
  });
});
