import { describe, expect, it } from "vitest";
import { MassiveOhlcFeedProvider, toMassiveTicker } from "./massiveOhlcProvider.js";
import type { OhlcProviderConfig } from "./types.js";

// Unit tests for the Massive adapter (Task 4.1; Requirements 1.2, 1.3, 1.6).
//
// With an injected `fetch` stub: `fetchLatest` (prev) and `fetchRange`
// (aggregates) map a representative body to RawCandle(s) with OHLC preserved and
// `source="Massive"`; the epoch-ms `t` becomes a YYYY-MM-DD date; each failure
// mode maps to the right Result; and no api-key value appears in any error.

const API_KEY = "massive-secret-def456";
const BASE_URL = "https://massive.example";

function config(): OhlcProviderConfig {
  return { provider: "Massive", keyEnvName: "MASSIVE_API_KEY", apiKey: API_KEY, baseUrl: BASE_URL };
}

function recordingJsonFetch(
  body: unknown,
  status = 200,
): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = (url) => {
    urls.push(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetchImpl, urls };
}

function textFetch(text: string): typeof fetch {
  return () => Promise.resolve(new Response(text, { status: 200 }));
}

function networkErrorFetch(): typeof fetch {
  return () => Promise.reject(new Error("socket hang up"));
}

// 2026-09-15T00:00:00Z = 1789516800000 ms; 2026-09-14T00:00:00Z = 1789430400000.
const T_20260915 = Date.UTC(2026, 8, 15);
const T_20260914 = Date.UTC(2026, 8, 14);

const RANGE_BODY = {
  status: "OK",
  results: [
    { o: 1.1, h: 1.12, l: 1.09, c: 1.11, t: T_20260914 },
    { o: 1.11, h: 1.13, l: 1.1, c: 1.12, t: T_20260915 },
  ],
};

describe("MassiveOhlcFeedProvider", () => {
  it("declares the latest + range capability", () => {
    const { fetchImpl } = recordingJsonFetch(RANGE_BODY);
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl);
    expect(provider.name).toBe("Massive");
    expect(provider.supportsLatest).toBe(true);
    expect(provider.supportsRange).toBe(true);
  });

  it("maps the EURUSD form to the C:EURUSD ticker", () => {
    expect(toMassiveTicker("EURUSD")).toBe("C:EURUSD");
  });

  it("fetchRange maps results to RawCandles preserving OHLC and deriving the date from t", async () => {
    const { fetchImpl, urls } = recordingJsonFetch(RANGE_BODY);
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl);
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toMatchObject({
        asset: "EURUSD",
        date: "2026-09-14",
        open: 1.1,
        high: 1.12,
        low: 1.09,
        close: 1.11,
        source: "Massive",
      });
      expect(result.value[1]?.date).toBe("2026-09-15");
    }
    expect(urls[0]).toContain("/v2/aggs/ticker/C%3AEURUSD/range/1/day/2026-09-14/2026-09-15");
    expect(urls[0]).toContain("sort=asc");
  });

  it("fetchLatest uses the prev endpoint and maps results[0]", async () => {
    const { fetchImpl, urls } = recordingJsonFetch({
      status: "OK",
      results: [{ o: 1.2, h: 1.25, l: 1.19, c: 1.24, t: T_20260915 }],
    });
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl);
    const result = await provider.fetchLatest(["EURUSD"], "2026-09-16");
    const eur = result.get("EURUSD");
    expect(eur?.ok).toBe(true);
    if (eur?.ok) {
      expect(eur.value[0]).toMatchObject({ date: "2026-09-15", open: 1.2, close: 1.24 });
    }
    expect(urls[0]).toContain("/v2/aggs/ticker/C%3AEURUSD/prev");
  });

  it("maps a network error to unavailable", async () => {
    const provider = new MassiveOhlcFeedProvider(config(), networkErrorFetch());
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");
    expect(result.ok === false && result.error.mode).toBe("unavailable");
    if (!result.ok) expect(result.error.message).not.toContain(API_KEY);
  });

  it("maps a non-200 to unavailable", async () => {
    const { fetchImpl } = recordingJsonFetch(RANGE_BODY, 500);
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl);
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");
    expect(result.ok === false && result.error.mode).toBe("unavailable");
  });

  it("maps a non-JSON body to invalid", async () => {
    const provider = new MassiveOhlcFeedProvider(config(), textFetch("gateway timeout"));
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");
    expect(result.ok === false && result.error.mode).toBe("invalid");
  });

  it("maps absent/empty results to empty", async () => {
    const { fetchImpl } = recordingJsonFetch({ status: "OK", results: [] });
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl);
    const result = await provider.fetchRange("EURUSD", "2026-09-14", "2026-09-15");
    expect(result.ok === false && result.error.mode).toBe("empty");
    if (!result.ok) expect(result.error.message).not.toContain(API_KEY);
  });
});
