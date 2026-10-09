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
  loadSnapshot,
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
