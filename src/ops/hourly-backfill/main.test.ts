import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { FileHourlyBarStore } from "../../hourly-store/fileHourlyStore.js";
import { InMemoryHourlyBarStore } from "../../hourly-store/types.js";
import type { HourlyBar } from "../../ingestion/sessionAggregation.js";
import { parseArgs, runHourlyBackfill, type HourlyFetcherPort } from "./main.js";

const dir = mkdtempSync(join(tmpdir(), "hourly-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const H = 3_600_000;
const barAt = (ms: number): HourlyBar => ({ openMs: ms, open: 1.1, high: 1.101, low: 1.099, close: 1.1 });

function fetcher(plan: (pair: string, from: string, to: string) => HourlyBar[] | "fail"): HourlyFetcherPort {
  return {
    fetchHourlyBars: (pair, from, to) => {
      const r = plan(pair, from, to);
      return Promise.resolve(
        r === "fail" ? ({ ok: false, error: { mode: "unavailable", message: "boom" } } as const) : ({ ok: true, value: r } as const),
      );
    },
  };
}
const options = { from: "2024-01-01", to: "2024-01-10", pairs: ["EURUSD", "GBPUSD"] as const, dir, chunkDays: 4, pauseSeconds: 0 };

describe("runHourlyBackfill", () => {
  it("fetches every chunk for every pair, archives the bars and paces requests", async () => {
    const calls: string[] = [];
    const store = new InMemoryHourlyBarStore();
    const sleeps: number[] = [];
    const results = await runHourlyBackfill({ ...options, pairs: [...options.pairs], pauseSeconds: 2 }, {
      fetcher: fetcher((pair, from, to) => (calls.push(`${pair}:${from}:${to}`), [barAt(Date.parse(`${from}T00:00:00Z`))])),
      store,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      log: () => undefined,
    });
    expect(calls).toEqual([
      "EURUSD:2024-01-01:2024-01-05", "EURUSD:2024-01-06:2024-01-10",
      "GBPUSD:2024-01-01:2024-01-05", "GBPUSD:2024-01-06:2024-01-10",
    ]);
    expect(results.map((r) => r.bars)).toEqual([2, 2]);
    expect(store.size).toBe(4);
    expect(sleeps).toEqual([2000, 2000, 2000]); // no pause before the very first request
  });

  it("counts failed chunks and reports the first error without throwing", async () => {
    const results = await runHourlyBackfill({ ...options, pairs: ["EURUSD"] }, {
      fetcher: fetcher((_p, from) => (from === "2024-01-01" ? "fail" : [barAt(0)])),
      store: new InMemoryHourlyBarStore(),
      sleep: () => Promise.resolve(),
      log: () => undefined,
    });
    expect(results[0]).toMatchObject({ chunks: 2, failedChunks: 1, bars: 1, firstChunkError: "unavailable: boom" });
  });

  it("round-trips through the file store, sorted, de-duplicated and range-filtered", async () => {
    const store = new FileHourlyBarStore(dir);
    await store.upsert([
      { pair: "EURUSD", openMs: 3 * H, open: 1, high: 2, low: 0.5, close: 1.5, source: "t" },
      { pair: "EURUSD", openMs: 1 * H, open: 1, high: 2, low: 0.5, close: 1.5, source: "t" },
      { pair: "EURUSD", openMs: 1 * H, open: 9, high: 9, low: 9, close: 9, source: "t" }, // overwrite
    ]);
    const reopened = new FileHourlyBarStore(dir);
    const rows = await reopened.getRange("EURUSD", 0, 4 * H);
    expect(rows.map((r) => r.openMs)).toEqual([1 * H, 3 * H]);
    expect(rows[0]?.open).toBe(9);
    expect(await reopened.getRange("EURUSD", 2 * H, 4 * H)).toHaveLength(1);
    expect(await reopened.getRange("GBPUSD", 0, 4 * H)).toEqual([]);
  });

  it("parses strict arguments", () => {
    expect(parseArgs(["--from", "2024-01-01", "--to", "2024-02-01", "--pairs", "EURUSD"]).pairs).toEqual(["EURUSD"]);
    expect(() => parseArgs(["--from", "2024-01-01"])).toThrow();
    expect(() => parseArgs(["--from", "2024-01-01", "--to", "2024-02-01", "--pairs", "XXXYYY"])).toThrow(/unknown pair/);
    expect(() => parseArgs(["--from", "2024-01-01", "--to", "2024-02-01", "--chunk-days", "999"])).toThrow();
  });
});
