// CSV Loader Types (Requirement 1).

import type { IngestReport, Pair, RawCandle } from "../ingestion/types.js";

/**
 * How the CSV_Candle_Files are used relative to the live API providers
 * (spec Req 1.8). Recorded in a committed operational config file, never in
 * `.env`. The loader runs once for `backfill` and only on the recurring cadence
 * for `feed`.
 */
export type DataSourceRole = "backfill" | "feed";

/**
 * A parse/structural failure encountered while reading a CSV_Candle_File.
 * Identifies the file by name and, when applicable, the 1-based data row that
 * caused the abort. Parsing NEVER partially feeds a file that produced this
 * error (spec Req 1.5, 1.9, 1.10).
 */
export interface CsvParseError {
  /** The file the error came from, identified by name (spec Req 1.5, 1.9). */
  readonly file: string;
  /** Human-readable reason: header mismatch | bad row | empty | unreadable. */
  readonly reason: string;
  /** 1-based data row index when the failure is a specific data row (spec Req 1.9). */
  readonly offendingRow?: number;
}

/**
 * Report of a successfully parsed and ingested CSV_Candle_File. The `ingest`
 * field is the `IngestReport` returned verbatim by `OhlcIngestion.ingest`
 * (spec Req 1.4); the loader adds no validation of its own.
 */
export interface CsvLoadReport {
  readonly file: string;
  readonly pair: Pair;
  /** Number of rows the loader mapped to a `RawCandle` before ingestion. */
  readonly parsed: number;
  /** The ingestion module's report, surfaced unchanged (spec Req 1.4). */
  readonly ingest: IngestReport;
}

/**
 * File-reading seam so `CsvLoader` stays testable without touching disk. The
 * default implementation reads a UTF-8 file via `node:fs/promises`; unit tests
 * inject an in-memory map instead. Rejects when the file cannot be read.
 */
export type FileReader = (path: string) => Promise<string>;

/** Re-export for callers of the loader that build `RawCandle[]` batches. */
export type { RawCandle };
