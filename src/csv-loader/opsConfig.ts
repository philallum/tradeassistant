// Operational config for the CSV loader — records the Data_Source_Role and
// enforces the run cadence (spec Req 1.8, task 1.10).
//
// The Data_Source_Role is recorded in a COMMITTED operational config file
// (`ops.config.json`), NEVER in `.env` (design "Data Models"). It classifies the
// CSV_Candle_Files as exactly one of:
//   - "backfill": a one-time historical backfill source — the loader runs ONCE.
//   - "feed":     an ongoing feed alongside the live API providers — the loader
//                 runs only on the recurring cadence.
//
// This module performs NO parsing/ingestion; it only reads + validates the
// recorded role and gates how often the loader may run in accordance with it.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { DataSourceRole } from "./types.js";

/**
 * The two valid `Data_Source_Role` values, in a runtime-checkable set so an
 * unrecognized value in `ops.config.json` is rejected rather than silently
 * accepted (spec Req 1.8: "exactly one of").
 */
export const DATA_SOURCE_ROLES = ["backfill", "feed"] as const;

/** The committed operational config file name, resolved against a base dir. */
export const OPS_CONFIG_FILE = "ops.config.json";

/** The shape of the `csv` section of the operational config. */
export interface CsvOpsConfig {
  /** The recorded Data_Source_Role (spec Req 1.8). */
  readonly role: DataSourceRole;
}

/** The parsed operational config (only the `csv` section is used here). */
export interface OpsConfig {
  readonly csv: CsvOpsConfig;
}

/** Raised when the operational config is missing, unreadable, or invalid. */
export class OpsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsConfigError";
  }
}

/** File-reading seam so config loading stays testable without touching disk. */
export type ConfigFileReader = (path: string) => Promise<string>;

const readFileUtf8: ConfigFileReader = (path) => readFile(path, "utf8");

/**
 * Narrow an arbitrary string to a {@link DataSourceRole}. Returns `true` only
 * for exactly `"backfill"` or `"feed"` (spec Req 1.8).
 */
export function isDataSourceRole(value: unknown): value is DataSourceRole {
  return (
    typeof value === "string" &&
    (DATA_SOURCE_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Validate an already-parsed object as an {@link OpsConfig}. Throws
 * {@link OpsConfigError} naming exactly what is wrong (missing `csv.role`, or a
 * role that is not one of the two allowed values).
 */
export function validateOpsConfig(parsed: unknown): OpsConfig {
  if (typeof parsed !== "object" || parsed === null) {
    throw new OpsConfigError(
      `Invalid ${OPS_CONFIG_FILE}: expected a JSON object at the top level.`,
    );
  }

  const csv = (parsed as { csv?: unknown }).csv;
  if (typeof csv !== "object" || csv === null) {
    throw new OpsConfigError(
      `Invalid ${OPS_CONFIG_FILE}: missing required "csv" section.`,
    );
  }

  const role = (csv as { role?: unknown }).role;
  if (!isDataSourceRole(role)) {
    throw new OpsConfigError(
      `Invalid ${OPS_CONFIG_FILE}: "csv.role" must be exactly one of ` +
        `[${DATA_SOURCE_ROLES.join(", ")}], got ${JSON.stringify(role)}.`,
    );
  }

  return { csv: { role } };
}

/**
 * Read and validate the operational config from `<baseDir>/ops.config.json`
 * (defaults to the current working directory). Returns the parsed
 * {@link OpsConfig}; throws {@link OpsConfigError} if the file is missing,
 * unreadable, not valid JSON, or does not record a valid `csv.role`.
 *
 * The reader is injectable so unit tests exercise validation without disk I/O.
 */
export async function loadOpsConfig(
  baseDir: string = process.cwd(),
  read: ConfigFileReader = readFileUtf8,
): Promise<OpsConfig> {
  const path = join(baseDir, OPS_CONFIG_FILE);

  let contents: string;
  try {
    contents = await read(path);
  } catch (e) {
    throw new OpsConfigError(
      `Cannot read ${OPS_CONFIG_FILE} at ${path}: ` +
        `${e instanceof Error ? e.message : String(e)}.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (e) {
    throw new OpsConfigError(
      `Cannot parse ${OPS_CONFIG_FILE}: ` +
        `${e instanceof Error ? e.message : String(e)}.`,
    );
  }

  return validateOpsConfig(parsed);
}

/**
 * Convenience: read the operational config and return only the recorded
 * `Data_Source_Role` (spec Req 1.8).
 */
export async function loadDataSourceRole(
  baseDir: string = process.cwd(),
  read: ConfigFileReader = readFileUtf8,
): Promise<DataSourceRole> {
  const config = await loadOpsConfig(baseDir, read);
  return config.csv.role;
}

/**
 * Enforces the CSV loader run cadence in accordance with the recorded
 * `Data_Source_Role` (spec Req 1.8):
 *
 * - `backfill` — a ONE-TIME historical backfill source: the loader may run
 *   exactly once. A second attempt is refused.
 * - `feed` — an ongoing feed alongside the live API providers: the loader may
 *   run on the recurring cadence, so repeated runs are always permitted.
 *
 * This gate holds no parsing/ingestion logic; it only tracks whether a run is
 * allowed to proceed given the role. A caller wraps each intended loader run in
 * {@link CadenceGuard.beginRun}.
 */
export class CadenceGuard {
  private runs = 0;

  constructor(private readonly role: DataSourceRole) {}

  /** The role this guard enforces. */
  get dataSourceRole(): DataSourceRole {
    return this.role;
  }

  /** Number of runs this guard has permitted so far. */
  get runCount(): number {
    return this.runs;
  }

  /**
   * Whether another loader run is permitted right now, WITHOUT recording one.
   * `feed` is always permitted (recurring cadence); `backfill` is permitted only
   * while no run has yet occurred (run-once).
   */
  canRun(): boolean {
    return this.role === "feed" || this.runs === 0;
  }

  /**
   * Attempt to begin a loader run. Records and permits the run when the cadence
   * allows it (`true`); otherwise refuses without recording (`false`).
   *
   * For `backfill` this returns `true` for the first call and `false` for every
   * subsequent call (run-once). For `feed` it always returns `true` (recurring).
   */
  beginRun(): boolean {
    if (!this.canRun()) {
      return false;
    }
    this.runs++;
    return true;
  }
}
