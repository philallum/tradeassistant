import { describe, expect, it } from "vitest";

import { FcsExternalSignalProvider } from "../external-signal/fcsProvider.js";
import { FcsOhlcFeedProvider } from "./ohlcFeed/fcsOhlcProvider.js";
import { MassiveOhlcFeedProvider } from "./ohlcFeed/massiveOhlcProvider.js";
import { TwelveDataOhlcFeedProvider } from "./ohlcFeed/twelveDataOhlcProvider.js";
import { TwelveDataIntradayClient } from "./intradayFeed/twelveDataIntraday.js";
import type { OhlcProviderConfig } from "./ohlcFeed/types.js";

// Provider API keys travel in the REQUEST URL query string. A failure message that embeds the
// underlying error text (or the provider's own error body) can therefore carry the key. These
// tests drive each client through the failure paths with a hostile fetch - one that throws an
// error containing the FULL request URL, and one whose body echoes the key - and assert the
// typed error the client returns never contains the key, in raw or URL-encoded form.

const KEY = "SECRETKEY_abc123XYZ";
const DECISION_DATE = "2024-03-15";

/** A fetch that fails the way some runtimes do: the error text contains the whole URL. */
const throwingFetch: typeof fetch = (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return Promise.reject(new TypeError(`request to ${url} failed, reason: socket hang up`));
};

/** A fetch that answers 200 with a non-JSON body that echoes the rejected key. */
const echoingFetch: typeof fetch = (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return Promise.resolve(new Response(`not json - rejected request ${url}`, { status: 200 }));
};

/** A fetch that answers 200 with a JSON error whose message echoes the key. */
const jsonEchoFetch: typeof fetch = () =>
  Promise.resolve(
    new Response(JSON.stringify({ status: false, code: 101, msg: `Invalid access_key=${KEY}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

const ohlcConfig = (provider: string): OhlcProviderConfig => ({
  provider,
  keyEnvName: "TEST_KEY",
  apiKey: KEY,
  baseUrl: "https://provider.invalid",
});

function expectNoKey(text: string): void {
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(encodeURIComponent(KEY));
}

/** Collect every error message produced by an OHLC feed `fetchLatest` map. */
async function ohlcMessages(
  provider: FcsOhlcFeedProvider | MassiveOhlcFeedProvider | TwelveDataOhlcFeedProvider,
): Promise<string[]> {
  const results = await provider.fetchLatest(["EURUSD", "GBPUSD"], DECISION_DATE);
  const messages: string[] = [];
  for (const result of results.values()) {
    if (!result.ok) messages.push(result.error.message);
  }
  return messages;
}

describe("provider failure messages never carry the API key", () => {
  const fetches: Array<[string, typeof fetch]> = [
    ["a fetch error that embeds the request URL", throwingFetch],
    ["a non-JSON body that echoes the request URL", echoingFetch],
  ];

  for (const [label, fetchImpl] of fetches) {
    it(`FCS external-signal client: ${label}`, async () => {
      const provider = new FcsExternalSignalProvider(
        { provider: "FCS", apiKey: KEY, baseUrl: "https://provider.invalid" },
        fetchImpl,
      );
      const result = await provider.fetchReference("EURUSD", DECISION_DATE);
      expect(result.ok).toBe(false);
      if (!result.ok) expectNoKey(result.error.message);
    });

    it(`FCS OHLC client: ${label}`, async () => {
      const messages = await ohlcMessages(new FcsOhlcFeedProvider(ohlcConfig("FCS"), fetchImpl));
      expect(messages.length).toBeGreaterThan(0);
      for (const m of messages) expectNoKey(m);
    });

    it(`Massive OHLC client: ${label}`, async () => {
      const messages = await ohlcMessages(new MassiveOhlcFeedProvider(ohlcConfig("Massive"), fetchImpl));
      expect(messages.length).toBeGreaterThan(0);
      for (const m of messages) expectNoKey(m);
    });

    it(`Twelve Data OHLC client: ${label}`, async () => {
      const messages = await ohlcMessages(
        new TwelveDataOhlcFeedProvider(ohlcConfig("TwelveData"), fetchImpl),
      );
      expect(messages.length).toBeGreaterThan(0);
      for (const m of messages) expectNoKey(m);
    });

    it(`Twelve Data intraday client: ${label}`, async () => {
      const client = new TwelveDataIntradayClient(
        { apiKey: KEY, baseUrl: "https://provider.invalid" },
        fetchImpl,
      );
      const result = await client.fetch4h("EURUSD");
      expect(result.ok).toBe(false);
      if (!result.ok) expectNoKey(result.error.message);
    });
  }

  it("FCS external-signal client: a provider error body that echoes the key", async () => {
    const provider = new FcsExternalSignalProvider(
      { provider: "FCS", apiKey: KEY, baseUrl: "https://provider.invalid" },
      jsonEchoFetch,
    );
    const result = await provider.fetchReference("EURUSD", DECISION_DATE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expectNoKey(result.error.message);
      expect(result.error.message).toContain("Invalid"); // the useful part is kept
    }
  });

  it("FCS OHLC client: a provider error body that echoes the key", async () => {
    const messages = await ohlcMessages(new FcsOhlcFeedProvider(ohlcConfig("FCS"), jsonEchoFetch));
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) expectNoKey(m);
  });
});
