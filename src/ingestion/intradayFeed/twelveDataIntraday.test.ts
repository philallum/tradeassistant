import { describe, expect, it } from "vitest";

import {
  parseUtcDatetime,
  TwelveDataIntradayClient,
} from "./twelveDataIntraday.js";

// Task 1: isolated Twelve Data 4H client. URL/param shape, full-timestamp parse,
// numeric coercion, fail-safe typed errors, key read by name only.

const API_KEY = "test-key-should-never-be-logged";

/** A fetch stub capturing the URL and returning a given JSON body / status. */
function stubFetch(
  body: unknown,
  status = 200,
  captured?: { url: string | null },
): typeof fetch {
  return ((url: string | URL): Promise<Response> => {
    if (captured) captured.url = String(url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

const OK_BODY = {
  status: "ok",
  values: [
    { datetime: "2026-11-06 04:00:00", open: "1.1000", high: "1.1050", low: "1.0980", close: "1.1040" },
    { datetime: "2026-11-06 00:00:00", open: "1.0950", high: "1.1010", low: "1.0940", close: "1.1000" },
  ],
};

describe("parseUtcDatetime", () => {
  it("treats a zoneless `YYYY-MM-DD HH:mm:ss` as UTC and keeps the time", () => {
    expect(parseUtcDatetime("2026-11-06 04:00:00")).toBe("2026-11-06T04:00:00.000Z");
  });

  it("passes through an explicit-Z / T form", () => {
    expect(parseUtcDatetime("2026-11-06T04:00:00Z")).toBe("2026-11-06T04:00:00.000Z");
  });

  it("returns null for an empty / unparseable value", () => {
    expect(parseUtcDatetime(undefined)).toBeNull();
    expect(parseUtcDatetime("")).toBeNull();
    expect(parseUtcDatetime("nope")).toBeNull();
  });
});

describe("TwelveDataIntradayClient", () => {
  it("requests interval=4h with UTC timezone and the symbol slash form, and does NOT slice the time", async () => {
    const captured: { url: string | null } = { url: null };
    const client = new TwelveDataIntradayClient({ apiKey: API_KEY }, stubFetch(OK_BODY, 200, captured));
    const result = await client.fetch4h("EURUSD");

    expect(captured.url).toContain("/time_series?");
    expect(captured.url).toContain("interval=4h");
    expect(captured.url).toContain("timezone=UTC");
    expect(captured.url).toContain(`symbol=${encodeURIComponent("EUR/USD")}`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The intraday time is preserved (NOT collapsed to a calendar day).
      expect(result.value[0]?.openTimeUtc).toBe("2026-11-06T04:00:00.000Z");
      expect(result.value[0]?.open).toBe(1.1);
      expect(result.value[0]?.currentPrice).toBe(1.104);
    }
  });

  it("carries the API key in the query by name only (never thrown back in errors)", async () => {
    const captured: { url: string | null } = { url: null };
    const client = new TwelveDataIntradayClient({ apiKey: API_KEY }, stubFetch(OK_BODY, 200, captured));
    await client.fetch4h("GBPUSD");
    expect(captured.url).toContain(`apikey=${API_KEY}`);
  });

  it("maps HTTP non-200 to an `unavailable` secret-free error", async () => {
    const client = new TwelveDataIntradayClient({ apiKey: API_KEY }, stubFetch({}, 503));
    const result = await client.fetch4h("EURUSD");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.mode).toBe("unavailable");
      expect(result.error.message).not.toContain(API_KEY);
    }
  });

  it("maps `{ status: error }` to an `invalid` error", async () => {
    const client = new TwelveDataIntradayClient(
      { apiKey: API_KEY },
      stubFetch({ status: "error", code: 400, message: "bad" }),
    );
    const result = await client.fetch4h("EURUSD");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.mode).toBe("invalid");
  });

  it("maps empty values to an `empty` error", async () => {
    const client = new TwelveDataIntradayClient({ apiKey: API_KEY }, stubFetch({ status: "ok", values: [] }));
    const result = await client.fetch4h("EURUSD");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.mode).toBe("empty");
  });

  it("drops a row with non-finite OHLC; an all-dropped response is `empty`", async () => {
    const client = new TwelveDataIntradayClient(
      { apiKey: API_KEY },
      stubFetch({ status: "ok", values: [{ datetime: "2026-11-06 04:00:00", open: "x", high: "y", low: "z", close: "w" }] }),
    );
    const result = await client.fetch4h("EURUSD");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.mode).toBe("empty");
  });

  it("maps a network throw to an `unavailable` error (never throws)", async () => {
    const throwing = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    const client = new TwelveDataIntradayClient({ apiKey: API_KEY }, throwing);
    const result = await client.fetch4h("EURUSD");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.mode).toBe("unavailable");
  });

  it("rejects an empty API key at construction", () => {
    expect(() => new TwelveDataIntradayClient({ apiKey: "" })).toThrow();
  });
});
