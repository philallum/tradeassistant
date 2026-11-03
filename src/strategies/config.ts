// Environment configuration for the Confluence_Engine — the ONE and ONLY env
// reader in `src/strategies` (Design "8. Environment configuration";
// Requirements 8.4, 8.5, 8.6, 8.9, 9.6, 9.7).
//
// The Confluence_Engine itself is a pure function that reads no environment
// (Requirement 8.9 / 9.9). This module is the single boundary that turns three
// optional environment variables into a plain `Partial` configuration object
// suitable to hand straight to `createConfluenceEngine(partial)`. The engine
// performs the AUTHORITATIVE range validation (thresholds within `[0, 1]`,
// weights finite and non-negative); this module only parses and guards that
// the shapes are sane (valid JSON, known Strategy_Ids, finite numbers), so a
// malformed env var is rejected early with the offending parameter named and
// the engine's defaults can be kept unchanged downstream (Requirements 8.6,
// 9.7 — "reject and keep previous").
//
// Reading `process.env` is permitted ONLY here. `env` is still a parameter so
// the function stays pure and testable; the import-boundary scan (task 13.2)
// exempts this file for its `process.env` reference.

import { ok, err } from "../guard/types.js";
import type { Result } from "../guard/types.js";
import {
  STRATEGY_IDS,
  isStrategyId,
  type ConfigError,
} from "./types.js";
import type { ConfluenceWeights } from "./confluenceEngine.js";

/** The environment variable carrying the JSON Confluence_Weights override. */
export const CONFLUENCE_WEIGHTS_ENV = "CONFLUENCE_WEIGHTS" as const;
/** The environment variable carrying the Conflict_Threshold override. */
export const CONFLUENCE_CONFLICT_THRESHOLD_ENV =
  "CONFLUENCE_CONFLICT_THRESHOLD" as const;
/** The environment variable carrying the alignment-threshold override. */
export const CONFLUENCE_ALIGNMENT_THRESHOLD_ENV =
  "CONFLUENCE_ALIGNMENT_THRESHOLD" as const;

/**
 * The partial configuration this module produces. Every field is optional: a
 * field is present ONLY when its environment variable was set, so an absent
 * variable leaves the engine's default in force downstream (Requirement 8.4,
 * 9.6). It is shaped to be passed directly to `createConfluenceEngine`.
 */
export type ConfluenceConfigPartial = Partial<{
  weights?: Partial<ConfluenceWeights>;
  conflictThreshold?: number;
  alignmentThreshold?: number;
}>;

const configError = (parameter: string, message: string): ConfigError => ({
  reason: "invalid_config",
  parameter,
  message,
});

/**
 * Parse the `CONFLUENCE_WEIGHTS` JSON object into a `Partial<ConfluenceWeights>`.
 *
 * Rejects (with the offending parameter/key named):
 *   - invalid JSON — parameter `CONFLUENCE_WEIGHTS`;
 *   - a non-object / array / null top level — parameter `CONFLUENCE_WEIGHTS`;
 *   - any key that is not one of {@link STRATEGY_IDS} — parameter = that key;
 *   - any value that is not a finite number — parameter = that key.
 *
 * Deeper weight-range validation (non-negativity) is intentionally LEFT to the
 * engine (Requirement 8.6 / 9.6).
 */
function parseWeights(
  raw: string,
): Result<Partial<ConfluenceWeights>, ConfigError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return err(
      configError(
        CONFLUENCE_WEIGHTS_ENV,
        `${CONFLUENCE_WEIGHTS_ENV} must be valid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
      ),
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(
      configError(
        CONFLUENCE_WEIGHTS_ENV,
        `${CONFLUENCE_WEIGHTS_ENV} must be a JSON object mapping Strategy_Id to a number`,
      ),
    );
  }

  const weights: Partial<Record<(typeof STRATEGY_IDS)[number], number>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isStrategyId(key)) {
      return err(
        configError(
          key,
          `${CONFLUENCE_WEIGHTS_ENV} has unknown Strategy_Id "${key}"; ` +
            `allowed ids are ${STRATEGY_IDS.join(", ")}`,
        ),
      );
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return err(
        configError(
          key,
          `${CONFLUENCE_WEIGHTS_ENV} weight for "${key}" must be a finite number`,
        ),
      );
    }
    weights[key] = value;
  }

  return ok(weights);
}

/**
 * Parse a threshold environment variable into a finite number. Returns a
 * {@link ConfigError} naming `parameter` when the value is present but is not a
 * finite number. Range validation (`[0, 1]`) is the engine's job (Req 9.7).
 */
function parseThreshold(
  parameter: string,
  raw: string,
): Result<number, ConfigError> {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return err(
      configError(parameter, `${parameter} must be a finite number`),
    );
  }
  return ok(value);
}

/**
 * Build a `Partial` Confluence_Engine configuration from the environment.
 *
 * Reads three optional variables ({@link CONFLUENCE_WEIGHTS_ENV},
 * {@link CONFLUENCE_CONFLICT_THRESHOLD_ENV},
 * {@link CONFLUENCE_ALIGNMENT_THRESHOLD_ENV}). An absent/undefined variable is
 * OMITTED from the result so the engine's defaults apply downstream. The first
 * parsing failure short-circuits with a {@link ConfigError} that names the
 * offending parameter (or the offending weight key). The returned partial is
 * intended to be passed to `createConfluenceEngine(partial)`, which performs
 * the authoritative range validation (Requirements 8.6, 9.7).
 *
 * `env` defaults to `process.env`; reading it is allowed ONLY in this file. It
 * is a parameter so the function stays pure and testable.
 */
export function confluenceConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Result<ConfluenceConfigPartial, ConfigError> {
  const partial: {
    weights?: Partial<ConfluenceWeights>;
    conflictThreshold?: number;
    alignmentThreshold?: number;
  } = {};

  const rawWeights = env[CONFLUENCE_WEIGHTS_ENV];
  if (rawWeights !== undefined) {
    const result = parseWeights(rawWeights);
    if (!result.ok) {
      return result;
    }
    partial.weights = result.value;
  }

  const rawConflict = env[CONFLUENCE_CONFLICT_THRESHOLD_ENV];
  if (rawConflict !== undefined) {
    const result = parseThreshold(
      CONFLUENCE_CONFLICT_THRESHOLD_ENV,
      rawConflict,
    );
    if (!result.ok) {
      return result;
    }
    partial.conflictThreshold = result.value;
  }

  const rawAlignment = env[CONFLUENCE_ALIGNMENT_THRESHOLD_ENV];
  if (rawAlignment !== undefined) {
    const result = parseThreshold(
      CONFLUENCE_ALIGNMENT_THRESHOLD_ENV,
      rawAlignment,
    );
    if (!result.ok) {
      return result;
    }
    partial.alignmentThreshold = result.value;
  }

  return ok(partial);
}
