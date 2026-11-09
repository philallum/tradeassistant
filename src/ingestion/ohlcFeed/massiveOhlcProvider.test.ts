import { describe, expect, it } from "vitest";
import { MassiveOhlcFeedProvider, toMassiveTicker } from "./massiveOhlcProvider.js";
import type { OhlcProviderConfig } from "./types.js";

// Unit tests for the Massive adapter. It fetches HOURLY aggregates (`t` = bar start, epoch ms)
// and builds the system's own 17:00 America/New_York daily candles from them (closed + complete
// sessions only); each failure mode maps to the right Result and no key appears in any error.

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

/** 24 hourly aggregates for the Thursday 2026-11-05 session: Wed 22:00 UTC .. Thu 21:00 UTC. */
function thursdayResults(skipHours: readonly number[] = []): Array<Record<string, number>> {
  const start = Date.parse("2026-11-04T22:00:00Z");
  const rows: Array<Record<string, number>> = [];
  for (let i = 0; i < 24; i += 1) {
    if (skipHours.includes(i)) continue;
    rows.push({
      t: start + i * 3_600_000,
      o: 1.1 + i * 0.001,
      h: 1.1 + i * 0.001 + 0.0005,
      l: 1.1 + i * 0.001 - 0.0002,
      c: 1.1 + (i + 1) * 0.001,
    });
  }
  return rows;
}
const BODY = { status: "OK", results: thursdayResults() };
const AFTER_CLOSE = () => new Date("2026-11-06T22:30:00Z");

describe("MassiveOhlcFeedProvider", () => {
  it("declares the latest + range capability", () => {
    const { fetchImpl } = recordingJsonFetch(BODY);
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    expect(provider.name).toBe("Massive");
    expect(provider.supportsLatest).toBe(true);
    expect(provider.supportsRange).toBe(true);
  });

  it("maps the EURUSD form to the C:EURUSD ticker", () => {
    expect(toMassiveTicker("EURUSD")).toBe("C:EURUSD");
  });

  it("fetchRange builds the NY-close daily candle from hourly aggregates", async () => {
    const { fetchImpl, urls } = recordingJsonFetch(BODY);
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      const c = result.value[0]!;
      expect(c).toMatchObject({ asset: "EURUSD", date: "2026-11-05", source: "Massive" });
      expect(c.open).toBeCloseTo(1.1, 10);
      expect(c.close).toBeCloseTo(1.124, 10);
    }
    expect(urls[0]).toContain("/v2/aggs/ticker/C%3AEURUSD/range/1/hour/");
    expect(urls[0]).toContain("sort=asc");
  });

  it("tolerates a couple of missing hours inside the session", async () => {
    const { fetchImpl } = recordingJsonFetch({ status: "OK", results: thursdayResults([5, 6]) });
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok).toBe(true);
  });

  it("fetchLatest returns only the newest closed complete session before asOf", async () => {
    const { fetchImpl } = recordingJsonFetch(BODY);
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchLatest(["EURUSD"], "2026-11-06");
    const eur = result.get("EURUSD");
    expect(eur?.ok).toBe(true);
    if (eur?.ok) {
      expect(eur.value).toHaveLength(1);
      expect(eur.value[0]).toMatchObject({ date: "2026-11-05" });
    }
  });

  it("never emits a session that has not closed yet (forming bar)", async () => {
    const { fetchImpl } = recordingJsonFetch(BODY);
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl, () => new Date("2026-11-05T21:30:00Z"));
    const eur = (await provider.fetchLatest(["EURUSD"], "2026-11-06")).get("EURUSD");
    expect(eur?.ok).toBe(false);
  });

  it("maps a network error to unavailable", async () => {
    const provider = new MassiveOhlcFeedProvider(config(), networkErrorFetch(), AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok === false && result.error.mode).toBe("unavailable");
    if (!result.ok) expect(result.error.message).not.toContain(API_KEY);
  });

  it("maps a non-200 to unavailable", async () => {
    const { fetchImpl } = recordingJsonFetch(BODY, 403);
    const provider = new MassiveOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok === false && result.error.mode).toBe("unavailable");
  });

  it("maps a non-JSON body to invalid", async () => {
    const provider = new MassiveOhlcFeedProvider(config(), textFetch("not json"), AFTER_CLOSE);
    const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
    expect(result.ok === false && result.error.mode).toBe("invalid");
  });

  it("maps absent or empty results to empty", async () => {
    for (const body of [{ status: "OK" }, { status: "OK", results: [] }]) {
      const { fetchImpl } = recordingJsonFetch(body);
      const provider = new MassiveOhlcFeedProvider(config(), fetchImpl, AFTER_CLOSE);
      const result = await provider.fetchRange("EURUSD", "2026-11-05", "2026-11-05");
      expect(result.ok === false && result.error.mode).toBe("empty");
    }
  });
});
