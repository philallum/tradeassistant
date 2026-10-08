// Unit tests for the shared snapshot cache (simplify-to-cloud-minimal R5.1).
//
// The whole dashboard renders from ONE snapshot, so `getSnapshot` must memoise a single
// in-flight load across all callers at the same refresh generation, and re-fetch exactly
// once when the generation advances (a refresh). A failed load must clear the cache so a
// later call retries. The real `loadSnapshot` drives `globalThis.fetch`, so these tests
// stub `fetch` and count the calls.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSnapshot, resetSnapshotCache } from "./snapshotCache";
import type { DashboardSnapshot } from "./snapshot";

const SNAPSHOT: DashboardSnapshot = {
  schemaVersion: 1,
  decisionDate: "2024-03-15",
  generatedAt: "2024-03-15T21:00:00.000Z",
  decisionDates: ["2024-03-15"],
  firingSetups: [],
  analogueOutcomes: [],
  realizedOutcomes: [],
  candles: [],
  aiRationale: [],
  externalComparison: [],
  evaluationReports: [],
};

const originalFetch = globalThis.fetch;

function stubFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(SNAPSHOT), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  resetSnapshotCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetSnapshotCache();
});

describe("getSnapshot — shared single-fetch cache", () => {
  it("fetches once and shares the result across concurrent callers at generation 0", async () => {
    const fetchMock = stubFetch();

    const [a, b, c] = await Promise.all([getSnapshot(0), getSnapshot(0), getSnapshot(0)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.decisionDates).toEqual(["2024-03-15"]);
  });

  it("re-fetches exactly once when the generation advances (a refresh)", async () => {
    const fetchMock = stubFetch();

    await getSnapshot(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Same generation reuses the cache — no new fetch.
    await getSnapshot(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A bumped generation forces one fresh (cache-busting) fetch, then shares it.
    await Promise.all([getSnapshot(1), getSnapshot(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The refresh fetch is cache-busting (carries a `_r` nonce).
    const refreshUrl = String((fetchMock.mock.calls[1]?.[0] as string | URL) ?? "");
    expect(refreshUrl).toContain("_r=");
  });

  it("clears the cache on failure so the next call retries", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return new Response(JSON.stringify(SNAPSHOT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await expect(getSnapshot(0)).rejects.toBeTruthy();
    // The failed load did not poison the cache; the retry fetches again and succeeds.
    const retried = await getSnapshot(0);
    expect(retried.decisionDates).toEqual(["2024-03-15"]);
    expect(calls).toBe(2);
  });
});
