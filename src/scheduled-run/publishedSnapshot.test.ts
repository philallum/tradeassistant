import { describe, expect, it } from "vitest";

import {
  fetchPublishedSnapshot,
  originalsFromPublished,
  publishedSnapshotUrl,
} from "./publishedSnapshot.js";

// Read-back of the published daily snapshot: URL, fail-safe fetch, and extraction of
// the original prediction for EVERY evaluated pair.

function stubFetch(body: unknown, status = 200, captured?: { url: string | null }): typeof fetch {
  return ((url: string | URL): Promise<Response> => {
    if (captured) captured.url = String(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
}

describe("publishedSnapshotUrl", () => {
  it("is the public GCS object URL", () => {
    expect(publishedSnapshotUrl("my-bucket")).toBe(
      "https://storage.googleapis.com/my-bucket/dashboard.json",
    );
  });
});

describe("fetchPublishedSnapshot", () => {
  it("returns the parsed object and cache-busts the request", async () => {
    const captured: { url: string | null } = { url: null };
    const snap = await fetchPublishedSnapshot("b", stubFetch({ decisionDate: "2026-11-06" }, 200, captured), () => "n1");
    expect(snap).toEqual({ decisionDate: "2026-11-06" });
    expect(captured.url).toBe("https://storage.googleapis.com/b/dashboard.json?_r=n1");
  });

  it("returns null (never throws) for an unset bucket, non-2xx, non-object, or a network error", async () => {
    expect(await fetchPublishedSnapshot(undefined, stubFetch({}))).toBeNull();
    expect(await fetchPublishedSnapshot("  ", stubFetch({}))).toBeNull();
    expect(await fetchPublishedSnapshot("b", stubFetch({}, 404))).toBeNull();
    expect(await fetchPublishedSnapshot("b", stubFetch([1, 2]))).toBeNull();
    const throwing = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    expect(await fetchPublishedSnapshot("b", throwing)).toBeNull();
  });
});

describe("originalsFromPublished", () => {
  const row = (pair: string, direction: string, conf: unknown, date = "2026-11-06") => ({
    decision_date: date,
    pair,
    direction,
    earned_confidence: conf,
  });

  it("extracts every pair for the date (incl. FLAT), as percentage points rounded to 2dp", () => {
    const out = originalsFromPublished(
      {
        pairEvaluations: [
          row("EURUSD", "UP", 0.55000000000000004),
          row("USDJPY", "FLAT", 0.5),
          row("GBPUSD", "DOWN", 0.583333333333333),
        ],
      },
      "2026-11-06",
    );
    expect(out).toEqual([
      { pair: "EURUSD", direction: "UP", confidence: 55 },
      { pair: "USDJPY", direction: "FLAT", confidence: 50 },
      { pair: "GBPUSD", direction: "DOWN", confidence: 58.33 },
    ]);
  });

  it("ignores other dates and skips malformed rows rather than fabricating", () => {
    const out = originalsFromPublished(
      {
        pairEvaluations: [
          row("EURUSD", "UP", 0.5, "2026-11-05"),
          row("XXXYYY", "UP", 0.5),
          row("EURUSD", "SIDEWAYS", 0.5),
          row("EURUSD", "UP", "0.5"),
          row("EURUSD", "UP", Number.NaN),
          "garbage",
        ],
      },
      "2026-11-06",
    );
    expect(out).toEqual([]);
  });

  it("returns [] for a null snapshot or a missing pairEvaluations", () => {
    expect(originalsFromPublished(null, "2026-11-06")).toEqual([]);
    expect(originalsFromPublished({}, "2026-11-06")).toEqual([]);
  });
});
