import { describe, expect, it } from "vitest";
import type { DirectionClass } from "../retrieval/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import {
  fetchAllReferences,
  fetchReferenceForPair,
  toReferenceDisplays,
  compareToOwn,
  REFERENCE_UNAVAILABLE,
  type ExternalSignalClock,
} from "./externalSignal.js";
import { InMemoryExternalSignalProvider } from "./inMemoryProvider.js";
import {
  externalSignalConfigFromEnv,
  type ExternalSignalConfig,
  type ExternalSignalProvider,
} from "./types.js";
import { err, ok, type Result } from "../guard/types.js";
import type { ExternalReferenceSignal, ExternalSignalError } from "./types.js";

// External Signal Cross-Reference SHAPE / fail-safe SMOKE coverage (task 11.3;
// Requirement 23). These are minimal build-green smoke checks only — the full
// boundary and fail-safe property tests are task 11.4. They exercise the
// swappable provider, the ExternalReferenceSignal shape, the fail-safe path, and
// the outward-only display projection.

const DECISION_DATE = "2026-03-16";
const fixedClock: ExternalSignalClock = { now: () => "2026-03-16T12:00:00.000Z" };
const CONFIG: ExternalSignalConfig = { provider: "test-provider", timeoutMs: 1_000 };

describe("ExternalReferenceSignal shape (Requirement 23.1, 23.4)", () => {
  it("wraps a provider recommendation with provenance and a fetch timestamp", async () => {
    const provider = new InMemoryExternalSignalProvider("test-provider", {
      EURUSD: { direction: "BUY", score: 0.7 },
    });

    const outcome = await fetchReferenceForPair(provider, "EURUSD", DECISION_DATE, CONFIG, fixedClock);

    expect(outcome.available).toBe(true);
    if (!outcome.available) throw new Error("expected available");
    expect(outcome.signal.pair).toBe("EURUSD");
    expect(outcome.signal.direction).toBe("BUY");
    expect(outcome.signal.score).toBe(0.7);
    expect(outcome.signal.provider).toBe("test-provider");
    expect(outcome.signal.fetchedAt).toBe("2026-03-16T12:00:00.000Z");
    expect(outcome.signal.decisionDate).toBe(DECISION_DATE);
  });

  it("fetches one outcome per pair in canonical order", async () => {
    const provider = new InMemoryExternalSignalProvider("test-provider", {
      EURUSD: { direction: "BUY" },
      GBPUSD: { direction: "SELL" },
      USDJPY: { direction: "HOLD" },
    });

    const outcomes = await fetchAllReferences(provider, DECISION_DATE, CONFIG, fixedClock);

    expect(outcomes.map((o) => o.pair)).toEqual([...PAIRS]);
  });
});

describe("fail-safe: unavailable / timeout / invalid (Requirement 23.5)", () => {
  it.each(["unavailable", "timeout", "invalid"] as const)(
    "marks the reference unavailable on a %s failure",
    async (mode) => {
      const provider = new InMemoryExternalSignalProvider("test-provider", {
        EURUSD: { failure: mode },
      });

      const outcome = await fetchReferenceForPair(provider, "EURUSD", DECISION_DATE, CONFIG, fixedClock);

      expect(outcome.available).toBe(false);
      if (outcome.available) throw new Error("expected unavailable");
      expect(outcome.error.mode).toBe(mode);
      expect(outcome.error.pair).toBe("EURUSD");
    },
  );

  it("treats a provider that rejects as unavailable and never throws", async () => {
    const throwing: ExternalSignalProvider = {
      fetchReference(): Promise<Result<ExternalReferenceSignal, ExternalSignalError>> {
        return Promise.reject(new Error("network down"));
      },
    };

    const outcome = await fetchReferenceForPair(throwing, "EURUSD", DECISION_DATE, CONFIG, fixedClock);

    expect(outcome.available).toBe(false);
    if (outcome.available) throw new Error("expected unavailable");
    expect(outcome.error.mode).toBe("unavailable");
  });

  it("treats a slow provider as a timeout", async () => {
    const slow: ExternalSignalProvider = {
      fetchReference(pair: Pair): Promise<Result<ExternalReferenceSignal, ExternalSignalError>> {
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                ok<ExternalReferenceSignal>({
                  pair,
                  decisionDate: DECISION_DATE,
                  direction: "BUY",
                  provider: "slow",
                  fetchedAt: "x",
                }),
              ),
            50,
          );
        });
      },
    };

    const outcome = await fetchReferenceForPair(
      slow,
      "EURUSD",
      DECISION_DATE,
      { provider: "slow", timeoutMs: 5 },
      fixedClock,
    );

    expect(outcome.available).toBe(false);
    if (outcome.available) throw new Error("expected timeout");
    expect(outcome.error.mode).toBe("timeout");
  });

  it("rejects an invalid provider direction", async () => {
    const bad: ExternalSignalProvider = {
      fetchReference(pair: Pair): Promise<Result<ExternalReferenceSignal, ExternalSignalError>> {
        return Promise.resolve(
          ok({
            pair,
            decisionDate: DECISION_DATE,
            direction: "LONG" as unknown as "BUY",
            provider: "bad",
            fetchedAt: "x",
          }),
        );
      },
    };

    const outcome = await fetchReferenceForPair(bad, "EURUSD", DECISION_DATE, CONFIG, fixedClock);

    expect(outcome.available).toBe(false);
    if (outcome.available) throw new Error("expected invalid");
    expect(outcome.error.mode).toBe("invalid");
  });

  it("isolates failures: one failing pair does not affect another", async () => {
    const provider = new InMemoryExternalSignalProvider("test-provider", {
      EURUSD: { direction: "BUY" },
      GBPUSD: { failure: "timeout" },
    });

    const outcomes = await fetchAllReferences(provider, DECISION_DATE, CONFIG, fixedClock);
    const eur = outcomes.find((o) => o.pair === "EURUSD");
    const gbp = outcomes.find((o) => o.pair === "GBPUSD");

    expect(eur?.available).toBe(true);
    expect(gbp?.available).toBe(false);
  });
});

describe("display projection & agreement/divergence (Requirement 23.7)", () => {
  it("classifies agreement, divergence, neutral, and unavailable", () => {
    expect(compareToOwn("UP", "BUY")).toBe("agree");
    expect(compareToOwn("DOWN", "SELL")).toBe("agree");
    expect(compareToOwn("UP", "SELL")).toBe("diverge");
    expect(compareToOwn("DOWN", "BUY")).toBe("diverge");
    expect(compareToOwn("FLAT", "BUY")).toBe("neutral");
    expect(compareToOwn("UP", "HOLD")).toBe("neutral");
    expect(compareToOwn("UP", null)).toBe("unavailable");
  });

  it("renders a display row beside each pair's own output", async () => {
    const provider = new InMemoryExternalSignalProvider("test-provider", {
      EURUSD: { direction: "BUY", score: 0.7 },
      GBPUSD: { failure: "unavailable" },
    });
    const outcomes = await fetchAllReferences(provider, DECISION_DATE, CONFIG, fixedClock);
    const own = new Map<Pair, DirectionClass>([
      ["EURUSD", "DOWN"],
      ["GBPUSD", "UP"],
    ]);

    const displays = toReferenceDisplays(outcomes, own);
    const eur = displays.find((d) => d.pair === "EURUSD");
    const gbp = displays.find((d) => d.pair === "GBPUSD");

    expect(eur?.comparison).toBe("diverge");
    expect(eur?.display).toContain("BUY");
    expect(gbp?.available).toBe(false);
    expect(gbp?.display).toContain(REFERENCE_UNAVAILABLE);
  });
});

describe("env-var config contract", () => {
  it("returns null when EXTERNAL_SIGNAL_PROVIDER is unset (optional slot)", () => {
    expect(externalSignalConfigFromEnv({})).toBeNull();
  });

  it("reads the provider and optional key/url/timeout", () => {
    const config = externalSignalConfigFromEnv({
      EXTERNAL_SIGNAL_PROVIDER: "fcs-api",
      EXTERNAL_SIGNAL_API_KEY: "k",
      EXTERNAL_SIGNAL_BASE_URL: "https://example.test",
      EXTERNAL_SIGNAL_TIMEOUT_MS: "2500",
    });

    expect(config).not.toBeNull();
    expect(config?.provider).toBe("fcs-api");
    expect(config?.apiKey).toBe("k");
    expect(config?.baseUrl).toBe("https://example.test");
    expect(config?.timeoutMs).toBe(2500);
  });
});

// Reference the `err` import in a trivial assertion so lint's no-unused rule is
// satisfied while keeping the helper available for future boundary tests (11.4).
describe("guard Result helpers are importable", () => {
  it("constructs an error result", () => {
    const e = err<ExternalSignalError>({
      reason: "external_signal_error",
      mode: "invalid",
      pair: "EURUSD",
      message: "smoke",
    });
    expect(e.ok).toBe(false);
  });
});
