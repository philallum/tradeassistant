import { describe, expect, it } from "vitest";
import {
  MASSIVE_DEFAULT_BASE_URL,
  TWELVE_DATA_DEFAULT_BASE_URL,
  ohlcFeedConfigFromEnv,
} from "./types.js";

// Unit tests for `ohlcFeedConfigFromEnv` (Task 1.1; Requirements 1.1, 1.5, 1.7).
//
// The reader must: carry only the providers whose keys are present (an absent
// key omits that provider); return an EMPTY provider list when all keys are
// absent (the chain then yields an exhausted result); and never surface a key
// VALUE in its output — only the env-var NAME is retained for provenance.

const FCS_KEY = "fcs-secret-abc123";
const TWELVE_KEY = "twelve-secret-def456";
const MASSIVE_KEY = "massive-secret-ghi789";

describe("ohlcFeedConfigFromEnv", () => {
  it("returns an empty provider list when no provider key is present", () => {
    const config = ohlcFeedConfigFromEnv({});
    expect(config.providers).toEqual([]);
  });

  it("treats blank/whitespace keys as absent", () => {
    const config = ohlcFeedConfigFromEnv({
      EXTERNAL_SIGNAL_API_KEY: "   ",
      TWELVE_DATA_API_KEY: "",
    });
    expect(config.providers).toEqual([]);
  });

  it("never includes FCS: its latest bar is still forming, so it is not a candle source", () => {
    const config = ohlcFeedConfigFromEnv({ EXTERNAL_SIGNAL_API_KEY: FCS_KEY });
    expect(config.providers).toEqual([]);
  });

  it("includes both providers in the fixed TwelveData → Massive order", () => {
    const config = ohlcFeedConfigFromEnv({
      EXTERNAL_SIGNAL_API_KEY: FCS_KEY,
      TWELVE_DATA_API_KEY: TWELVE_KEY,
      MASSIVE_API_KEY: MASSIVE_KEY,
    });
    expect(config.providers.map((p) => p.provider)).toEqual(["TwelveData", "Massive"]);
    expect(config.providers.map((p) => p.baseUrl)).toEqual([
      TWELVE_DATA_DEFAULT_BASE_URL,
      MASSIVE_DEFAULT_BASE_URL,
    ]);
  });

  it("honours explicit base URLs when provided", () => {
    const config = ohlcFeedConfigFromEnv({
      TWELVE_DATA_API_KEY: TWELVE_KEY,
      TWELVE_DATA_BASE_URL: "https://td.example",
      MASSIVE_API_KEY: MASSIVE_KEY,
      MASSIVE_BASE_URL: "https://massive.example",
    });
    expect(config.providers.map((p) => p.baseUrl)).toEqual([
      "https://td.example",
      "https://massive.example",
    ]);
  });

  it("preserves the key value only in the construct-only apiKey field, by-name elsewhere", () => {
    const config = ohlcFeedConfigFromEnv({
      EXTERNAL_SIGNAL_API_KEY: FCS_KEY,
      TWELVE_DATA_API_KEY: TWELVE_KEY,
      MASSIVE_API_KEY: MASSIVE_KEY,
    });
    // The only place a key value lives is the explicit `apiKey` field used to
    // construct the adapter; every provenance field is a NAME, not a value.
    for (const provider of config.providers) {
      expect(provider.keyEnvName).not.toContain(provider.apiKey);
      expect(provider.provider).not.toContain(provider.apiKey);
      expect(provider.baseUrl).not.toContain(provider.apiKey);
    }
  });

  it("never surfaces a key value when the config is stringified for logging (minus apiKey)", () => {
    const config = ohlcFeedConfigFromEnv({
      EXTERNAL_SIGNAL_API_KEY: FCS_KEY,
      TWELVE_DATA_API_KEY: TWELVE_KEY,
      MASSIVE_API_KEY: MASSIVE_KEY,
    });
    // A caller logging only the safe projection (provider + keyEnvName + baseUrl)
    // leaks no secret.
    const safe = config.providers.map((p) => ({
      provider: p.provider,
      keyEnvName: p.keyEnvName,
      baseUrl: p.baseUrl,
    }));
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(FCS_KEY);
    expect(serialized).not.toContain(TWELVE_KEY);
    expect(serialized).not.toContain(MASSIVE_KEY);
  });
});
