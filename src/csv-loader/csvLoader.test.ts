// Unit tests for CsvLoader delegation to OhlcIngestion (spec Req 1.4, 1.7).
//
// These verify the WIRING only: the loader parses then hands the batch to a
// real OhlcIngestion over an InMemoryCandleStore, surfaces the IngestReport
// unchanged, and emits the ingestion coverage summary verbatim. It re-implements
// no validation/dedup/normalization of its own.

import { describe, expect, it } from "vitest";

import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import { InMemoryCandleStore, PAIRS } from "../ingestion/types.js";
import type { FileReader } from "./types.js";
import { CsvLoader, CSV_EMPTY_REASON, csvFileNameFor } from "./csvLoader.js";

const HEADER = "Time\tOpen\tHigh\tLow\tClose\tVolume";

/** Build a valid tab-separated data row (7 cols: 6 named + tick count). */
function row(
  time: string,
  o: number,
  h: number,
  l: number,
  c: number,
  vol = 1000,
  ticks = 5,
): string {
  return [time, o, h, l, c, vol, ticks].join("\t");
}

/** A FileReader backed by an in-memory map of path -> contents. */
function fakeReader(files: Record<string, string>): FileReader {
  return (path) => {
    const contents = files[path];
    if (contents === undefined) {
      return Promise.reject(new Error(`ENOENT: ${path}`));
    }
    return Promise.resolve(contents);
  };
}

describe("CsvLoader.loadFile", () => {
  it("parses then delegates to OhlcIngestion.ingest and surfaces the report", async () => {
    const contents = [
      HEADER,
      row("2010-09-01 00:00:00", 1.28, 1.29, 1.27, 1.285),
      row("2010-09-02 00:00:00", 1.285, 1.3, 1.28, 1.295),
    ].join("\n");

    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    const loader = new CsvLoader(
      ingestion,
      fakeReader({ "/data/EURUSD_D1.csv": contents }),
    );

    const result = await loader.loadFile("/data/EURUSD_D1.csv", "EURUSD", "backfill");

    expect("ingest" in result).toBe(true);
    if (!("ingest" in result)) return;
    expect(result.file).toBe("EURUSD_D1.csv");
    expect(result.pair).toBe("EURUSD");
    expect(result.parsed).toBe(2);
    // IngestReport surfaced unchanged.
    expect(result.ingest.pair).toBe("EURUSD");
    expect(result.ingest.totalReceived).toBe(2);
    expect(result.ingest.accepted).toBe(2);
    expect(result.ingest.rejected).toBe(0);
  });

  it("lets ingestion reject an OHLC-invalid row (loader does not validate)", async () => {
    // high < low is structurally valid for the parser but rejected by ingestion.
    const contents = [
      HEADER,
      row("2010-09-01 00:00:00", 1.28, 1.27, 1.29, 1.285), // high < low
    ].join("\n");

    const ingestion = new OhlcIngestion(new InMemoryCandleStore());
    const loader = new CsvLoader(
      ingestion,
      fakeReader({ "/data/EURUSD_D1.csv": contents }),
    );

    const result = await loader.loadFile("/data/EURUSD_D1.csv", "EURUSD", "backfill");

    expect("ingest" in result).toBe(true);
    if (!("ingest" in result)) return;
    // Parser mapped the row; ingestion rejected it. Loader added no validation.
    expect(result.parsed).toBe(1);
    expect(result.ingest.rejected).toBe(1);
    expect(result.ingest.accepted).toBe(0);
  });

  it("aborts and feeds nothing on a malformed header", async () => {
    const contents = ["Time\tOpen\tHigh\tLow\tClose", row("2010-09-01 00:00:00", 1, 2, 0.5, 1.5)].join(
      "\n",
    );
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    const loader = new CsvLoader(
      ingestion,
      fakeReader({ "/data/EURUSD_D1.csv": contents }),
    );

    const result = await loader.loadFile("/data/EURUSD_D1.csv", "EURUSD", "backfill");

    expect("ingest" in result).toBe(false);
    if ("ingest" in result) return;
    expect(result.file).toBe("EURUSD_D1.csv");
    expect(result.reason).toMatch(/header mismatch/);
    // Nothing was fed.
    const coverage = await ingestion.coverageSummary();
    expect(coverage.every((c) => c.count === 0)).toBe(true);
  });

  it("reports a header-only file as empty and feeds nothing (Req 1.10)", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    const loader = new CsvLoader(
      ingestion,
      fakeReader({ "/data/EURUSD_D1.csv": HEADER }),
    );

    const result = await loader.loadFile("/data/EURUSD_D1.csv", "EURUSD", "backfill");

    expect("ingest" in result).toBe(false);
    if ("ingest" in result) return;
    expect(result.reason).toBe(CSV_EMPTY_REASON);
    const coverage = await ingestion.coverageSummary();
    expect(coverage.every((c) => c.count === 0)).toBe(true);
  });

  it("returns an unreadable error and does not ingest when the file cannot be read", async () => {
    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    const loader = new CsvLoader(ingestion, fakeReader({}));

    const result = await loader.loadFile("/data/missing.csv", "EURUSD", "backfill");

    expect("ingest" in result).toBe(false);
    if ("ingest" in result) return;
    expect(result.reason).toMatch(/unreadable/);
  });
});

describe("CsvLoader.loadAll", () => {
  it("loads all five PAIRS and emits the ingestion coverage summary verbatim (Req 1.7)", async () => {
    const files: Record<string, string> = {};
    for (const pair of PAIRS) {
      files[`/data/${csvFileNameFor(pair)}`] = [
        HEADER,
        row("2010-09-01 00:00:00", 1.28, 1.29, 1.27, 1.285),
        row("2010-09-02 00:00:00", 1.285, 1.3, 1.28, 1.295),
      ].join("\n");
    }

    const store = new InMemoryCandleStore();
    const ingestion = new OhlcIngestion(store);
    const loader = new CsvLoader(ingestion, fakeReader(files));

    const { reports, coverage } = await loader.loadAll("/data", "backfill");

    expect(reports).toHaveLength(PAIRS.length);
    expect(reports.every((r) => "ingest" in r)).toBe(true);

    // Coverage is the ingestion module's summary, surfaced unchanged.
    const expected = await ingestion.coverageSummary();
    expect(coverage).toEqual(expected);
    for (const c of coverage) {
      expect(c.count).toBe(2);
      expect(c.earliestDate).toBe("2010-09-01");
      expect(c.latestDate).toBe("2010-09-02");
    }
  });

  it("collects a per-file parse error without aborting the other pairs", async () => {
    const files: Record<string, string> = {};
    for (const pair of PAIRS) {
      files[`/data/${csvFileNameFor(pair)}`] = [
        HEADER,
        row("2010-09-01 00:00:00", 1.28, 1.29, 1.27, 1.285),
      ].join("\n");
    }
    // Corrupt one pair's header.
    files["/data/USDJPY_D1.csv"] = ["Time\tOpen", "bad\trow"].join("\n");

    const ingestion = new OhlcIngestion(new InMemoryCandleStore());
    const loader = new CsvLoader(ingestion, fakeReader(files));

    const { reports, coverage } = await loader.loadAll("/data", "backfill");

    const errors = reports.filter((r) => !("ingest" in r));
    expect(errors).toHaveLength(1);
    // The other four pairs still ingested one candle each.
    const jpy = coverage.find((c) => c.pair === "USDJPY");
    expect(jpy?.count).toBe(0);
    const others = coverage.filter((c) => c.pair !== "USDJPY");
    expect(others.every((c) => c.count === 1)).toBe(true);
  });

  it("idempotent re-run leaves coverage unchanged (dedup owned by ingestion, Req 1.6)", async () => {
    const files: Record<string, string> = {};
    for (const pair of PAIRS) {
      files[`/data/${csvFileNameFor(pair)}`] = [
        HEADER,
        row("2010-09-01 00:00:00", 1.28, 1.29, 1.27, 1.285),
      ].join("\n");
    }
    const ingestion = new OhlcIngestion(new InMemoryCandleStore());
    const loader = new CsvLoader(ingestion, fakeReader(files));

    await loader.loadAll("/data", "backfill");
    const { coverage } = await loader.loadAll("/data", "backfill");

    expect(coverage.every((c) => c.count === 1)).toBe(true);
  });
});
