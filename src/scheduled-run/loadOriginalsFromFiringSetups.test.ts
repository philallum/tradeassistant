import { describe, expect, it, vi } from "vitest";

import { SupabaseRestClient } from "../storage/supabase/client.js";
import { loadOriginalsFromFiringSetups } from "./intradayMain.js";

// The fallback read of the original (daily) predictions is fail-safe: any read error yields
// `[]`. That empty result must be distinguishable from "nothing fired", so the error is
// reported through `onError`.

const CONFIG = { target: "hosted", url: "https://example.invalid", key: "test-key" } as const;

function client(fetchImpl: typeof fetch): SupabaseRestClient {
  return new SupabaseRestClient(CONFIG, fetchImpl);
}

const json = (rows: unknown, status = 200): Response =>
  new Response(JSON.stringify(rows), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("loadOriginalsFromFiringSetups", () => {
  it("maps stored confidence to percentage points for fired pairs", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        json([{ decision_date: "2024-03-15", pair: "EURUSD", direction: "UP", earned_confidence: 0.6234 }]),
      ),
    ) as unknown as typeof fetch;

    const out = await loadOriginalsFromFiringSetups(client(fetchImpl), "2024-03-15");

    expect(out).toEqual([{ pair: "EURUSD", direction: "UP", confidence: 62.34 }]);
  });

  it("returns [] AND reports the error when the read fails (not silent)", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("boom", { status: 500 })),
    ) as unknown as typeof fetch;
    const seen: unknown[] = [];

    const out = await loadOriginalsFromFiringSetups(client(fetchImpl), "2024-03-15", (err) => {
      seen.push(err);
    });

    expect(out).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Error);
  });

  it("does not report an error for a successful but empty read", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(json([]))) as unknown as typeof fetch;
    const seen: unknown[] = [];

    const out = await loadOriginalsFromFiringSetups(client(fetchImpl), "2024-03-15", (err) => {
      seen.push(err);
    });

    expect(out).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("still returns [] when no onError is supplied (behaviour unchanged)", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response("boom", { status: 500 })),
    ) as unknown as typeof fetch;

    await expect(loadOriginalsFromFiringSetups(client(fetchImpl), "2024-03-15")).resolves.toEqual([]);
  });
});
