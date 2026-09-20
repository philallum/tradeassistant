// Scheduled-run runtime configuration (Requirement 16.7).
//
// The unattended GCP-scheduled daily refresh runs the SAME deterministic
// `dailyRun` entry point as the local dashboard, so its only job is to read
// its runtime configuration from the environment and hand it to the shared
// pipeline. This module parses that configuration; it performs no I/O and holds
// no secrets in code — every value is read verbatim from the environment
// (Requirement 6.3), consistent with the project's `.env` conventions.
//
// NON-SECRET config (GCP project/region, model, decision date) arrives via
// plain environment variables. SECRET config (Supabase URL/keys) is resolved by
// `loadSupabaseConfig` from variables that Cloud Run injects at runtime from
// Google Secret Manager (`--set-secrets`), never baked into the image.

import type { EnvSource, SupabaseConfig } from "../storage/supabaseConfig.js";
import { loadSupabaseConfig } from "../storage/supabaseConfig.js";
import type { TradingDate } from "../guard/types.js";
import { formatTradingDate, isValidTradingDateFormat } from "../guard/tradingDate.js";

/** Environment variable names read by the scheduled run (non-secret unless noted). */
export const SCHEDULED_RUN_ENV = {
  /** Optional explicit Decision_Date (YYYY-MM-DD). Defaults to today (UTC). */
  decisionDate: "RUN_DECISION_DATE",
  /** GCP project id (non-secret). */
  gcpProject: "GCP_PROJECT_ID",
  /** GCP region (non-secret). */
  gcpRegion: "GCP_REGION",
  /** Selected LLM model id (non-secret; display/rationale role only). */
  geminiModel: "GEMINI_MODEL",
  /**
   * Optional override for the IPv4-reachable Supabase connection endpoint used
   * from Cloud Run. Cloud Run has no IPv6 egress, so the direct database host
   * (IPv6-only) is unreachable; the run connects via the IPv4 pooler/REST URL
   * instead. When set, this replaces the resolved Supabase URL at runtime.
   */
  supabasePoolerUrl: "SUPABASE_POOLER_URL",
} as const;

/**
 * The fully-resolved runtime configuration for one scheduled daily run.
 * Everything here is deterministic given the environment, so a scheduled run
 * reproduces an equivalent local run (Requirement 16.7).
 */
export interface ScheduledRunConfig {
  /** The Decision_Date this run evaluates. */
  readonly decisionDate: TradingDate;
  /** Supabase connection config, routed over the IPv4-reachable endpoint. */
  readonly supabase: SupabaseConfig;
  /** Non-secret GCP project id, when provided. */
  readonly gcpProject: string | undefined;
  /** Non-secret GCP region, when provided. */
  readonly gcpRegion: string | undefined;
  /** Non-secret selected model id, when provided. */
  readonly geminiModel: string | undefined;
}

/** Error raised when the environment does not describe a valid scheduled run. */
export class ScheduledRunConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduledRunConfigError";
  }
}

function optional(env: EnvSource, name: string): string | undefined {
  const raw = env[name];
  return raw === undefined || raw.trim() === "" ? undefined : raw.trim();
}

/**
 * Resolve the Decision_Date for this run. An explicit `RUN_DECISION_DATE`
 * (YYYY-MM-DD) is validated and used verbatim so an unattended run is exactly
 * reproducible; otherwise the current UTC date is used (Cloud Scheduler fires
 * the run on the daily cadence).
 */
export function resolveDecisionDate(
  env: EnvSource,
  now: Date = new Date(),
): TradingDate {
  const explicit = optional(env, SCHEDULED_RUN_ENV.decisionDate);
  if (explicit !== undefined) {
    if (!isValidTradingDateFormat(explicit)) {
      throw new ScheduledRunConfigError(
        `Invalid ${SCHEDULED_RUN_ENV.decisionDate} "${explicit}": expected an ISO YYYY-MM-DD date.`,
      );
    }
    return explicit;
  }
  return formatTradingDate(now);
}

/**
 * Resolve the Supabase connection over the IPv4-reachable path. Cloud Run has
 * no IPv6 egress, so the IPv6-only direct database host is never used; when
 * `SUPABASE_POOLER_URL` is set it overrides the resolved URL to point at the
 * connection pooler / REST endpoint. The key (secret) is unchanged.
 */
export function resolveSupabaseOverIpv4(env: EnvSource): SupabaseConfig {
  const base = loadSupabaseConfig(env);
  const poolerUrl = optional(env, SCHEDULED_RUN_ENV.supabasePoolerUrl);
  return poolerUrl === undefined ? base : { ...base, url: poolerUrl };
}

/**
 * Parse the complete scheduled-run configuration from the environment
 * (defaults to `process.env`). Injectable so parsing is unit-testable without
 * mutating the process. Throws {@link ScheduledRunConfigError} /
 * `SupabaseConfigError` describing exactly what is missing or invalid.
 */
export function loadScheduledRunConfig(
  env: EnvSource = process.env,
  now: Date = new Date(),
): ScheduledRunConfig {
  const decisionDate = resolveDecisionDate(env, now);
  const supabase = resolveSupabaseOverIpv4(env);
  return {
    decisionDate,
    supabase,
    gcpProject: optional(env, SCHEDULED_RUN_ENV.gcpProject),
    gcpRegion: optional(env, SCHEDULED_RUN_ENV.gcpRegion),
    geminiModel: optional(env, SCHEDULED_RUN_ENV.geminiModel),
  };
}
