import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CSV_HEADER, CsvLoader, csvFileNameFor } from "./csvLoader.js";
import { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import { InMemoryCandleStore, PAIRS } from "../ingestion/types.js";
import type { Candle } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

// Feature: operational-wiring, Property 5: CSV import is idempotent
//
// Validates: Requirements 1.6.
//
// Requirement 1.6: WHEN the CSV_Loader runs two or more times over an UNCHANGED
// set of CSV_Candle_Files, THE System SHALL produce IDENTICAL stored results
// with NO duplicated candles, relying on the ingestion module's idempotent
// (Asset, Date) upsert (parent Requirement 7.4).
//
// This test drives a REAL `OhlcIngestion` over a REAL `InMemoryCandleStore`
// through the actual `CsvLoader.loadFile` path TWICE over the same unchanged
// content, and asserts the stored candle state after the second run is
// byte-for-byte identical to the state after the first run (same count, no
// duplicated (asset,date) keys). No ingestion mocking — the actual (Asset,Date)
// upsert is exercised.

const EXPECTED_HEADER = [...CSV_HEADER]; // ["Time","Open","High","Low","Close","Volume"]

/**
 * Build the tab-separated text of one VALID 7-column data row for a given
 * calendar date, with OHLC values that satisfy the ingestion validity invariant
 * (high >= low, open/close within [low, high]). The `Time` is the daily
 * `YYYY-MM-DD 00:00:00` form the CSV files use.
 */
function validDataRow(date: string, seed: number): string {
  const base = 1 + (seed % 50) / 100; // 1.00 .. 1.49
  const low = base;
  const high = base + 0.02;
  const open = base + 0.005; // within [low, high]
  const close = base + 0.015; // within [low, high]
  const time = `${date} 00:00:00`;
  const volume = String(1000 + seed);
  const tickCount = String(seed);
  return [time, open, high, low, close, volume, tickCount].join("\t");
}

/**
 * Generate a set of DISTINCT, varied calendar dates in `YYYY-MM-DD` form. Dates
 * are spread across days/months/years so they map to a mix of session dates
 * (some may normalize/merge, some may be dropped) — idempotence must hold
 * regardless of which survive normalization.
 */
const distinctDatesArb: fc.Arbitrary<readonly string[]> = fc
  .uniqueArray(
    fc.record({
      year: fc.integer({ min: 2010, max: 2023 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
    }),
    {
      minLength: 1,
      maxLength: 12,
      selector: (d) => `${String(d.year)}-${String(d.month)}-${String(d.day)}`,
    },
  )
  .map((records) =>
    records.map(
      (d) =>
        `${String(d.year)}-${String(d.month).padStart(2, "0")}-${String(
          d.day,
        ).padStart(2, "0")}`,
    ),
  );

const scenarioArb = fc.record({
  pair: fc.constantFrom<Pair>(...PAIRS),
  dates: distinctDatesArb,
  seeds: fc.array(fc.integer({ min: 0, max: 100000 }), {
    minLength: 1,
    maxLength: 12,
  }),
  // Exercise both CRLF and LF endings — content is still "unchanged" between runs.
  crlf: fc.boolean(),
});

/**
 * Build valid CSV_Candle_File contents (valid header + N valid 7-column data
 * rows with distinct/varied dates) from a scenario.
 */
function buildCsvContents(
  dates: readonly string[],
  seeds: readonly number[],
  crlf: boolean,
): string {
  const eol = crlf ? "\r\n" : "\n";
  const headerLine = EXPECTED_HEADER.join("\t");
  const rows = dates.map((date, i) => validDataRow(date, seeds[i % seeds.length] ?? i));
  return [headerLine, ...rows].join(eol);
}

/**
 * Snapshot the full stored candle state across all pairs into a stable,
 * comparable string. Two snapshots being equal means the store holds the exact
 * same (asset, date) candles with the exact same field values — i.e. IDENTICAL
 * stored results with NO duplicated candles.
 */
async function snapshotStore(ingestion: OhlcIngestion): Promise<string> {
  const all: Candle[] = [];
  for (const pair of PAIRS) {
    const candles = await ingestion.getCandles(pair);
    all.push(...candles);
  }
  // Deterministic ordering by (asset, date) so the snapshot is stable.
  all.sort((a, b) => {
    const d = a.asset.localeCompare(b.asset);
    return d !== 0 ? d : a.date.localeCompare(b.date);
  });
  return JSON.stringify(
    all.map((c) => ({
      asset: c.asset,
      date: c.date,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })),
  );
}

/**
 * Count distinct (asset, date) keys in the store — used to prove there are NO
 * duplicated candles after re-import.
 */
async function distinctKeyCount(ingestion: OhlcIngestion): Promise<number> {
  const keys = new Set<string>();
  for (const pair of PAIRS) {
    const candles = await ingestion.getCandles(pair);
    for (const c of candles) {
      keys.add(`${c.asset}:${c.date}`);
    }
  }
  return keys.size;
}

describe("Property 5: CSV import is idempotent", () => {
  it("re-importing unchanged CSV content yields identical stored results with no duplicates", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ pair, dates, seeds, crlf }) => {
        const contents = buildCsvContents(dates, seeds, crlf);

        // REAL ingestion over a REAL in-memory store — no mocking.
        const store = new InMemoryCandleStore();
        const ingestion = new OhlcIngestion(store);

        // Inject a FileReader that always returns the SAME unchanged content,
        // so loadFile drives the real parse -> ingest -> (Asset,Date) upsert.
        const path = csvFileNameFor(pair);
        const loader = new CsvLoader(ingestion, () => Promise.resolve(contents));

        // First import.
        const first = await loader.loadFile(path, pair, "backfill");
        // The generated content is always a valid file, so this must be a report.
        expect("ingest" in first).toBe(true);

        const snapshotAfterFirst = await snapshotStore(ingestion);
        const keysAfterFirst = await distinctKeyCount(ingestion);

        // Second import over the UNCHANGED content.
        const second = await loader.loadFile(path, pair, "backfill");
        expect("ingest" in second).toBe(true);

        const snapshotAfterSecond = await snapshotStore(ingestion);
        const keysAfterSecond = await distinctKeyCount(ingestion);

        // 1. Stored state is byte-for-byte identical after the second run.
        expect(snapshotAfterSecond).toBe(snapshotAfterFirst);

        // 2. No duplicated candles: the distinct (asset,date) key count is
        //    unchanged, and the total candle count equals the distinct-key count.
        expect(keysAfterSecond).toBe(keysAfterFirst);
        let totalAfterSecond = 0;
        for (const p of PAIRS) {
          totalAfterSecond += (await ingestion.getCandles(p)).length;
        }
        expect(totalAfterSecond).toBe(keysAfterSecond);

        // 3. Every stored (asset,date) is unique after re-import.
        const seenKeys = new Set<string>();
        for (const p of PAIRS) {
          for (const c of await ingestion.getCandles(p)) {
            const key: string = `${c.asset}:${c.date}`;
            expect(seenKeys.has(key)).toBe(false);
            seenKeys.add(key);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
