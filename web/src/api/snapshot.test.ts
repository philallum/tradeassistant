// Unit tests for the Public_Read_Path snapshot loader (simplify-to-cloud-minimal R5.1,
// R5.3, R5.4, R5.5, R4.4).
//
// These verify that `loadSnapshot()`:
//   - fetches the same-origin static `/dashboard.json` with NO credential and NO proxy
//     (R4.4, R5.1), appending a cache-bust nonce only when asked,
//   - parses a well-formed snapshot and fills every absent slice with an empty array so a
//     consumer never sees `undefined` (R5.5),
//   - surfaces a missing snapshot (404) as a `SnapshotError` with status 404, and other
//     failures as fixed, non-secret messages (never a raw body / stack trace),
// using an injected `fetchImpl` so no real network is touched.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_CONFLUENCE,
  EMPTY_INTRADAY_VALIDATION,
  EMPTY_EVENT_FLAGS,
  EMPTY_RUN_HEALTH,
  EMPTY_SIGNAL_SCORECARD,
  EMPTY_TRACK_RECORD,
  loadSnapshot,
  parseSnapshot,
  resolveSnapshotPath,
  SnapshotError,
  SNAPSHOT_PATH,
  type DashboardSnapshot,
  type SnapshotDeps,
} from "./snapshot";

/** A capturing fetch that records the URL + init and returns the given response. */
function capturingFetch(
  response: Response,
  captured: Array<{ url: string; init: RequestInit | undefined }>,
): typeof fetch {
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captured.push({ url: typeof input === "string" ? input : input.toString(), init });
    return response;
  };
  return fake as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FULL_SNAPSHOT: DashboardSnapshot = {
  schemaVersion: 1,
  decisionDate: "2024-03-15",
  generatedAt: "2024-03-15T21:00:00.000Z",
  decisionDates: ["2024-03-14", "2024-03-15"],
  firingSetups: [],
  pairEvaluations: [],
  analogueOutcomes: [],
  realizedOutcomes: [],
  candles: [],
  aiRationale: [],
  dailyCommentary: { decision_date: "", note_text: "", generated: false },
  externalComparison: [],
  evaluationReports: [],
  tradeLedgerSummary: { window: null, strategies: [] },
  calibration: { bands: [], monotonic: null, wellCalibrated: null },
  exposure: { perCurrency: [], concentrated: false, strongestPair: null },
  provenance: [],
  validationStatus: [],
  // A v1 (pre-v5) fixture carries no real confluence slice; the loader defaults a pre-v5
  // snapshot to EMPTY_CONFLUENCE, so the fixture mirrors that fail-safe empty value.
  confluence: EMPTY_CONFLUENCE,
  trackRecord: EMPTY_TRACK_RECORD,
  signalScorecard: EMPTY_SIGNAL_SCORECARD,
  intradayValidation: EMPTY_INTRADAY_VALIDATION,
  runHealth: EMPTY_RUN_HEALTH,
  eventFlags: EMPTY_EVENT_FLAGS,
};

describe("loadSnapshot — same-origin static fetch (R5.1, R4.4)", () => {
  it("GETs the same-origin /dashboard.json with no credential and no cache-bust by default", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const deps: SnapshotDeps = { fetchImpl: capturingFetch(jsonResponse(FULL_SNAPSHOT), captured) };

    const snapshot = await loadSnapshot({}, deps);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe(SNAPSHOT_PATH);
    expect(captured[0]!.url).not.toContain("_r=");
    // No credential header of any kind is attached.
    const headers = (captured[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.apikey).toBeUndefined();
    expect(snapshot.decisionDates).toEqual(["2024-03-14", "2024-03-15"]);
  });

  it("appends a distinct _r nonce + no-cache header when bustCache is set", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const deps: SnapshotDeps = {
      fetchImpl: capturingFetch(jsonResponse(FULL_SNAPSHOT), captured),
      nonce: () => "NONCE1",
    };

    await loadSnapshot({ bustCache: true }, deps);

    // The nonce uses the right separator for the (same-origin, no-query) default path.
    const separator = SNAPSHOT_PATH.includes("?") ? "&" : "?";
    expect(captured[0]!.url).toBe(`${SNAPSHOT_PATH}${separator}_r=NONCE1`);
    const headers = (captured[0]!.init?.headers ?? {}) as Record<string, string>;
    expect(headers["Cache-Control"]).toBe("no-cache");
    expect(captured[0]!.init?.cache).toBe("no-store");
  });
});

describe("resolveSnapshotPath — build-time URL from VITE_SNAPSHOT_URL (Option A)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured cross-origin bucket URL when VITE_SNAPSHOT_URL is set", () => {
    vi.stubEnv(
      "VITE_SNAPSHOT_URL",
      "https://storage.googleapis.com/fx-dashboard-public/dashboard.json",
    );
    expect(resolveSnapshotPath()).toBe(
      "https://storage.googleapis.com/fx-dashboard-public/dashboard.json",
    );
  });

  it("falls back to the same-origin /dashboard.json when VITE_SNAPSHOT_URL is unset", () => {
    vi.stubEnv("VITE_SNAPSHOT_URL", "");
    expect(resolveSnapshotPath()).toBe("/dashboard.json");
  });

  it("trims whitespace and falls back when the value is blank", () => {
    vi.stubEnv("VITE_SNAPSHOT_URL", "   ");
    expect(resolveSnapshotPath()).toBe("/dashboard.json");
  });
});

describe("loadSnapshot — parsing + empty slices (R5.5)", () => {
  it("fills every absent slice with an empty array (never undefined)", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    // A partial body missing most slices.
    const partial = { schemaVersion: 1, decisionDate: "2024-03-15", generatedAt: "t" };
    const deps: SnapshotDeps = { fetchImpl: capturingFetch(jsonResponse(partial), captured) };

    const snapshot = await loadSnapshot({}, deps);

    expect(snapshot.firingSetups).toEqual([]);
    expect(snapshot.analogueOutcomes).toEqual([]);
    expect(snapshot.realizedOutcomes).toEqual([]);
    expect(snapshot.candles).toEqual([]);
    expect(snapshot.aiRationale).toEqual([]);
    expect(snapshot.externalComparison).toEqual([]);
    expect(snapshot.evaluationReports).toEqual([]);
    expect(snapshot.pairEvaluations).toEqual([]);
    expect(snapshot.dailyCommentary).toEqual({ decision_date: "", note_text: "", generated: false });
    expect(snapshot.decisionDates).toEqual([]);
  });

  it("carries present slices through verbatim", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const body = {
      ...FULL_SNAPSHOT,
      firingSetups: [
        {
          decision_date: "2024-03-15",
          pair: "EURUSD",
          strategy_id: "system",
          direction: "UP",
          horizon: 2,
          earned_confidence: 0.9,
          stop_loss_pips: 15,
          take_profit_pips: 40,
          surfaced: true,
          suppression_reason: null,
        },
      ],
    };
    const deps: SnapshotDeps = { fetchImpl: capturingFetch(jsonResponse(body), captured) };

    const snapshot = await loadSnapshot({}, deps);
    expect(snapshot.firingSetups).toHaveLength(1);
    expect(snapshot.firingSetups[0]!.pair).toBe("EURUSD");
  });
});

describe("loadSnapshot — failures surface as non-secret SnapshotError", () => {
  it("maps a 404 (snapshot not written yet) to a SnapshotError with status 404 (R5.5)", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const deps: SnapshotDeps = {
      fetchImpl: capturingFetch(new Response("not found", { status: 404 }), captured),
    };

    await expect(loadSnapshot({}, deps)).rejects.toMatchObject({
      name: "SnapshotError",
      status: 404,
    });
  });

  it("maps a 500 to a non-secret SnapshotError (no raw body)", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const deps: SnapshotDeps = {
      fetchImpl: capturingFetch(new Response("stack trace leak", { status: 500 }), captured),
    };

    const err = await loadSnapshot({}, deps).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SnapshotError);
    expect((err as SnapshotError).status).toBe(500);
    expect((err as SnapshotError).message).not.toContain("stack trace leak");
  });

  it("maps a transport failure to a non-secret SnapshotError", async () => {
    const failing = (() => Promise.reject(new Error("DNS boom"))) as unknown as typeof fetch;
    const err = await loadSnapshot({}, { fetchImpl: failing }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(SnapshotError);
    expect((err as SnapshotError).message).not.toContain("DNS boom");
  });

  it("rejects a malformed (non-JSON) body with a non-secret SnapshotError", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const deps: SnapshotDeps = {
      fetchImpl: capturingFetch(
        new Response("<<not json>>", { status: 200, headers: { "Content-Type": "application/json" } }),
        captured,
      ),
    };
    await expect(loadSnapshot({}, deps)).rejects.toBeInstanceOf(SnapshotError);
  });
});

describe("parseSnapshot — v4 slices (trader-edge-validation R10.1–10.3)", () => {
  const EMPTY_V4 = {
    tradeLedgerSummary: { window: null, strategies: [] },
    calibration: { bands: [], monotonic: null, wellCalibrated: null },
    exposure: { perCurrency: [], concentrated: false, strongestPair: null },
    provenance: [],
    validationStatus: [],
  };

  it("defaults every v4 slice when parsing a v3 snapshot", () => {
    const v3 = { schemaVersion: 3, decisionDate: "2024-03-15", generatedAt: "t", firingSetups: [] };
    const parsed = parseSnapshot(v3);
    expect(parsed.schemaVersion).toBe(3);
    expect(parsed).toMatchObject(EMPTY_V4);
  });

  it("defaults v4 slices when they are malformed", () => {
    const parsed = parseSnapshot({
      tradeLedgerSummary: "x",
      calibration: [],
      exposure: 5,
      provenance: {},
      validationStatus: null,
    });
    expect(parsed).toMatchObject(EMPTY_V4);
  });

  it("carries populated v4 slices through", () => {
    const body = {
      schemaVersion: 4,
      tradeLedgerSummary: { window: { from: "2024-01-01", to: "2024-03-15" }, strategies: [{ role: "system" }] },
      calibration: { bands: [{ lo: 0.5, hi: 0.6 }], monotonic: true, wellCalibrated: false },
      exposure: { perCurrency: [{ currency: "USD", net: 2 }], concentrated: true, strongestPair: "EURUSD" },
      provenance: [{ pair: "EURUSD" }],
      validationStatus: [{ decision_date: "2024-03-15", pair: "EURUSD", status: "unvalidated" }],
    };
    const parsed = parseSnapshot(body);
    expect(parsed.tradeLedgerSummary.window).toEqual({ from: "2024-01-01", to: "2024-03-15" });
    expect(parsed.tradeLedgerSummary.strategies).toHaveLength(1);
    expect(parsed.calibration).toMatchObject({ monotonic: true, wellCalibrated: false });
    expect(parsed.exposure).toEqual(body.exposure);
    expect(parsed.provenance).toHaveLength(1);
    expect(parsed.validationStatus[0]!.status).toBe("unvalidated");
  });
});

describe("parseSnapshot — v8 intradayValidation slice", () => {
  const ROW = {
    pair: "EURUSD",
    decisionDate: "2026-11-06",
    originalDirection: "UP",
    originalConfidence: 58,
    validationState: "SUPPORTS",
    confidenceDelta: 5,
    currentConfidence: 63,
    reason: "bullish bar supports the up forecast",
    barOpenUtc: "2026-11-06T04:00:00.000Z",
    h4: { open: 1.0, high: 1.1, low: 0.99, currentPrice: 1.08 },
  };

  it("defaults to the empty slice for a pre-v8 (or version-less) snapshot", () => {
    // Pre-v8 but v5+, so a valid (empty) confluence slice is required by the strict parse.
    const v7 = {
      schemaVersion: 7,
      decisionDate: "2026-11-06",
      generatedAt: "t",
      firingSetups: [],
      confluence: EMPTY_CONFLUENCE,
    };
    const parsed = parseSnapshot(v7);
    expect(parsed.intradayValidation).toEqual(EMPTY_INTRADAY_VALIDATION);
  });

  it("carries a well-formed v8 slice through", () => {
    const parsed = parseSnapshot({
      schemaVersion: 8,
      confluence: EMPTY_CONFLUENCE,
      intradayValidation: { observedAt: "2026-11-06T08:00:00.000Z", validationLabel: "unvalidated", rows: [ROW] },
    });
    expect(parsed.intradayValidation.observedAt).toBe("2026-11-06T08:00:00.000Z");
    expect(parsed.intradayValidation.rows).toHaveLength(1);
    expect(parsed.intradayValidation.rows[0]!.validationState).toBe("SUPPORTS");
    expect(parsed.intradayValidation.rows[0]!.h4.currentPrice).toBe(1.08);
  });

  it("DROPS a defective row (unknown state / bad OHLC) but keeps the valid ones", () => {
    const parsed = parseSnapshot({
      schemaVersion: 8,
      confluence: EMPTY_CONFLUENCE,
      intradayValidation: {
        observedAt: "t",
        validationLabel: "unvalidated",
        rows: [
          ROW,
          { ...ROW, pair: "GBPUSD", validationState: "WAT" },
          { ...ROW, pair: "USDJPY", h4: { open: 1 } },
        ],
      },
    });
    expect(parsed.intradayValidation.rows.map((r) => r.pair)).toEqual(["EURUSD"]);
  });

  it("defaults a malformed slice to empty rather than failing the whole snapshot", () => {
    expect(
      parseSnapshot({ schemaVersion: 8, confluence: EMPTY_CONFLUENCE, intradayValidation: "nope" })
        .intradayValidation,
    ).toEqual(EMPTY_INTRADAY_VALIDATION);
  });
});

describe("parseRunHealth (schema v9)", () => {
  it("defaults an absent or malformed slice to the empty value", async () => {
    const { parseRunHealth, EMPTY_RUN_HEALTH } = await import("./snapshot");
    expect(parseRunHealth(undefined)).toBe(EMPTY_RUN_HEALTH);
    expect(parseRunHealth("nope")).toBe(EMPTY_RUN_HEALTH);
  });

  it("keeps well-formed rows, drops defective ones, never fabricates", async () => {
    const { parseRunHealth } = await import("./snapshot");
    const parsed = parseRunHealth({
      rows: [
        { pair: "EURUSD", analogue_count: 120, data_behind: false, silence_reason: null },
        { pair: "GBPUSD", analogue_count: null, data_behind: true, silence_reason: "DATA_BEHIND" },
        { pair: "USDJPY", analogue_count: 5, data_behind: false, silence_reason: "NOT_A_REASON" },
        { pair: 7, analogue_count: 1, data_behind: false, silence_reason: null },
      ],
      degradedPairs: ["GBPUSD", 3],
      confidenceThreshold: 0.6,
    });
    expect(parsed.rows.map((r) => r.pair)).toEqual(["EURUSD", "GBPUSD"]);
    expect(parsed.degradedPairs).toEqual(["GBPUSD"]);
    expect(parsed.confidenceThreshold).toBe(0.6);
  });

  it("an older snapshot without the key parses to the empty run health", async () => {
    const { parseSnapshot, EMPTY_RUN_HEALTH } = await import("./snapshot");
    expect(parseSnapshot({ schemaVersion: 1, decisionDate: "2026-11-10" }).runHealth).toEqual(EMPTY_RUN_HEALTH);
  });
});

describe("parseEventFlags (schema v9)", () => {
  it("defaults an absent or malformed slice to one that claims nothing", async () => {
    const { parseEventFlags, EMPTY_EVENT_FLAGS } = await import("./snapshot");
    expect(parseEventFlags(undefined)).toBe(EMPTY_EVENT_FLAGS);
    expect(parseEventFlags({ events: [] })).toBe(EMPTY_EVENT_FLAGS);
    expect(EMPTY_EVENT_FLAGS.calendarCovers).toBe(false);
  });

  it("keeps well-formed events and drops defective ones", async () => {
    const { parseEventFlags } = await import("./snapshot");
    const parsed = parseEventFlags({
      decisionDate: "2026-12-09",
      calendarCovers: true,
      events: [
        { kind: "FOMC", label: "US Federal Reserve rate decision", basis: "official" },
        { kind: "NOPE", label: "x", basis: "official" },
        { kind: "ECB", label: "ECB rate decision", basis: "guess" },
      ],
    });
    expect(parsed.events.map((e) => e.kind)).toEqual(["FOMC"]);
    expect(parsed.calendarCovers).toBe(true);
  });
});
