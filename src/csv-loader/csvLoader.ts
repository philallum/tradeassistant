// CSV Loader — tab-separated parser and RawCandle mapping (Requirement 1).
//
// This module performs PARSING and MAPPING only (spec Req 1.4): it does NO OHLC
// validation, NO (Asset, Date) dedup, and NO session-boundary normalization.
// Those remain the responsibility of the ingestion module (`OhlcIngestion`).

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { OhlcIngestion } from "../ingestion/ohlcIngestion.js";
import { PAIRS } from "../ingestion/types.js";
import type { Pair, PerPairCoverage, RawCandle } from "../ingestion/types.js";
import type {
  CsvLoadReport,
  CsvParseError,
  DataSourceRole,
  FileReader,
} from "./types.js";

/**
 * The exact 6-column header a CSV_Candle_File must present on line 1, in this
 * order (spec Req 1.1).
 */
export const CSV_HEADER = ["Time", "Open", "High", "Low", "Close", "Volume"] as const;

/**
 * The number of tab-separated columns every data row must contain: the 6 named
 * fields plus a trailing per-candle tick count (spec Req 1.1, 1.2).
 */
export const CSV_DATA_COLUMNS = 7;

/**
 * Distinct reason string for a valid-header, zero-data-rows file (spec Req 1.10).
 * Callers can compare against this to tell an EMPTY file apart from a malformed
 * one.
 */
export const CSV_EMPTY_REASON = "empty";

/**
 * Parse one tab-separated CSV_Candle_File into `RawCandle[]`.
 *
 * Behavior:
 * - Accepts both CRLF and LF line endings; a trailing `\r` is stripped from each
 *   line (spec Req 1.1).
 * - Line 1 must be exactly the 6-column {@link CSV_HEADER} in order, else the
 *   whole file is aborted and nothing is fed (spec Req 1.5).
 * - Each subsequent NON-EMPTY line must be exactly {@link CSV_DATA_COLUMNS} tab
 *   columns; blank/empty lines (including trailing blank lines) are ignored.
 * - Maps `[Time, Open, High, Low, Close, Volume, tickCount]` to a `RawCandle`
 *   using only `Time` (verbatim string), `Open`/`High`/`Low`/`Close`
 *   (`Number(...)`), and `source: "csv"`. Volume (col 6) and tick count (col 7)
 *   are dropped (spec Req 1.2). `asset`/`date` are NOT populated.
 * - The `Time` string is passed UNALTERED so ingestion normalizes it to the
 *   Session_Close boundary (spec Req 1.3).
 * - Any data row that is not exactly 7 columns, or whose `Time` is empty or
 *   whose `Open`/`High`/`Low`/`Close` is not a finite number, aborts the file
 *   and reports the 1-based data row index (spec Req 1.9). A structurally valid
 *   `high < low` row is ACCEPTED here — ingestion rejects it later.
 * - A valid header with zero data rows returns `ok: false` with reason
 *   {@link CSV_EMPTY_REASON} so nothing is fed (spec Req 1.10).
 *
 * Result is all-or-nothing: on any failure NO candles are returned.
 */
export function parseCsvCandles(
  file: string,
  contents: string,
  pair: Pair,
): { ok: true; candles: RawCandle[] } | { ok: false; error: CsvParseError } {
  // Normalize line endings: split on \n and strip any trailing \r (CRLF or LF).
  const rawLines = contents.split("\n").map((line) =>
    line.endsWith("\r") ? line.slice(0, -1) : line,
  );

  if (rawLines.length === 0) {
    return { ok: false, error: { file, reason: "unreadable: no content" } };
  }

  // Line 1 is the header. It must equal the 6 expected columns in order.
  const headerCols = rawLines[0]?.split("\t") ?? [];
  const headerValid =
    headerCols.length === CSV_HEADER.length &&
    CSV_HEADER.every((expected, i) => headerCols[i] === expected);

  if (!headerValid) {
    return {
      ok: false,
      error: {
        file,
        reason: `header mismatch: expected [${CSV_HEADER.join(", ")}]`,
      },
    };
  }

  const candles: RawCandle[] = [];
  let dataRowIndex = 0; // 1-based index over non-empty data rows.

  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i] ?? "";
    // Ignore blank/empty lines (including trailing blank lines).
    if (line.length === 0) {
      continue;
    }

    dataRowIndex++;
    const cols = line.split("\t");

    if (cols.length !== CSV_DATA_COLUMNS) {
      return {
        ok: false,
        error: {
          file,
          reason: `bad row: expected ${String(CSV_DATA_COLUMNS)} columns, got ${String(cols.length)}`,
          offendingRow: dataRowIndex,
        },
      };
    }

    const time = cols[0] ?? "";
    if (time.length === 0) {
      return {
        ok: false,
        error: { file, reason: "bad row: empty Time", offendingRow: dataRowIndex },
      };
    }

    const open = Number(cols[1]);
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      return {
        ok: false,
        error: {
          file,
          reason: "bad row: unparsable Open/High/Low/Close",
          offendingRow: dataRowIndex,
        },
      };
    }

    candles.push({
      pair,
      timestamp: time, // verbatim "YYYY-MM-DD 00:00:00" — UNALTERED (spec Req 1.3)
      open,
      high,
      low,
      close,
      source: "csv",
      // cols[5] (Volume) and cols[6] (tick count) intentionally dropped (spec Req 1.2)
    });
  }

  if (candles.length === 0) {
    // Valid header, zero data rows: report empty, feed nothing (spec Req 1.10).
    return { ok: false, error: { file, reason: CSV_EMPTY_REASON } };
  }

  return { ok: true, candles };
}

/**
 * The per-pair CSV_Candle_File name inside the data directory (e.g.
 * `EURUSD_D1.csv`). The five files in `data/` follow this daily convention.
 */
export function csvFileNameFor(pair: Pair): string {
  return `${pair}_D1.csv`;
}

/** Default {@link FileReader}: read a UTF-8 file from disk. */
const readFileUtf8: FileReader = (path) => readFile(path, "utf8");

/**
 * CsvLoader — wires CSV parsing to the existing ingestion module (spec Req 1.4,
 * 1.7).
 *
 * It owns NONE of ingestion's responsibilities: OHLC-validity rejection
 * (parent Req 7.3), `(Asset, Date)` dedup/upsert (parent Req 7.4), and
 * session-boundary normalization (parent Req 7.7/7.8) all remain inside
 * `OhlcIngestion.ingest`, whose `IngestReport` this loader surfaces unchanged.
 */
export class CsvLoader {
  constructor(
    private readonly ingestion: OhlcIngestion,
    /** Injectable file reader; defaults to reading UTF-8 files from disk. */
    private readonly read: FileReader = readFileUtf8,
  ) {}

  /**
   * Load one CSV_Candle_File: read → parse → ingest.
   *
   * On ANY parse error (unreadable file, malformed header, malformed row, or a
   * valid-header/zero-data-rows empty file) it aborts and returns the
   * {@link CsvParseError} WITHOUT calling ingestion — nothing is fed
   * (spec Req 1.5, 1.9, 1.10). Otherwise it calls
   * `OhlcIngestion.ingest(pair, candles)` and returns a {@link CsvLoadReport}
   * carrying the ingestion module's report verbatim (spec Req 1.4).
   *
   * The `role` is accepted for cadence bookkeeping by callers; it does not alter
   * parse or ingest behavior here.
   */
  async loadFile(
    path: string,
    pair: Pair,
    role: DataSourceRole,
  ): Promise<CsvLoadReport | CsvParseError> {
    // `role` (backfill | feed) governs run cadence at the caller (spec Req 1.8,
    // task 1.10); it does not change parse or ingest behavior here.
    void role;
    const file = basename(path);

    let contents: string;
    try {
      contents = await this.read(path);
    } catch (e) {
      return {
        file,
        reason: `unreadable: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const parsed = parseCsvCandles(file, contents, pair);
    if (!parsed.ok) {
      // Abort: feed nothing (spec Req 1.5, 1.9, 1.10).
      return parsed.error;
    }

    // Delegate validity/dedup/normalization to ingestion; surface its report
    // unchanged (spec Req 1.4).
    const ingest = await this.ingestion.ingest(pair, parsed.candles);

    return {
      file,
      pair,
      parsed: parsed.candles.length,
      ingest,
    };
  }

  /**
   * Load all five {@link PAIRS} from a directory, then emit the ingestion
   * module's per-pair coverage summary (count, earliest date, latest date per
   * pair — spec Req 1.7).
   *
   * Each pair is loaded from `<dir>/<PAIR>_D1.csv`. Per-file parse errors are
   * collected into `reports` (they never abort the other pairs), and the
   * coverage summary always reflects whatever the ingestion module actually
   * stored.
   */
  async loadAll(
    dir: string,
    role: DataSourceRole,
  ): Promise<{
    reports: readonly (CsvLoadReport | CsvParseError)[];
    coverage: readonly PerPairCoverage[];
  }> {
    const reports: (CsvLoadReport | CsvParseError)[] = [];

    for (const pair of PAIRS) {
      const path = join(dir, csvFileNameFor(pair));
      reports.push(await this.loadFile(path, pair, role));
    }

    // Emit the coverage summary from the ingestion module verbatim (spec Req 1.7).
    const coverage = await this.ingestion.coverageSummary();

    return { reports, coverage };
  }
}

/** Basename of a path (POSIX or Windows separators), for file-name reporting. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}
