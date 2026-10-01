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
   * Optional override for the Supabase PostgREST base URL used from Cloud Run.
   *
   * The storage layer talks to Supabase over PostgREST (HTTPS `fetch` against
   * `<url>/rest/v1`), NOT over a Postgres TCP driver — so it needs an
   * `http(s)://` REST URL (e.g. `https://<ref>.supabase.co`), which already
   * resolves over IPv4 and is reachable from Cloud Run. The IPv6-egress problem
   * only affects direct Postgres TCP connections, which this transport never
   * makes.
   *
   * This override therefore applies ONLY when its value is an `http(s)://` URL.
   * A Postgres connection string (`postgresql://user:password@host:5432/...`,
   * e.g. the Supabase pooler DSN) is NOT a REST endpoint and MUST NOT be fed to
   * the REST client — `fetch` rejects any URL embedding credentials — so such a
   * value is ignored and the resolved `SUPABASE_HOSTED_URL` is kept.
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
 * True iff `value` is an absolute `http://` or `https://` URL — the only shape
 * the PostgREST client can use. A `postgresql://` DSN (or any other scheme) is
 * explicitly NOT an HTTP URL, so it is rejected as a REST override.
 */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
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
 * Resolve the Supabase connection for the Cloud Run (PostgREST/HTTPS) path.
 *
 * The transport is PostgREST over HTTPS, so the resolved `url` must be an
 * `http(s)://` REST endpoint. `SUPABASE_HOSTED_URL` already is one and resolves
 * over IPv4, so it is reachable from Cloud Run without any pooler. The optional
 * `SUPABASE_POOLER_URL` override is honoured ONLY when it too is an `http(s)://`
 * URL; a Postgres connection string (e.g. a `postgresql://user:password@...`
 * pooler/direct DSN) is NOT a REST endpoint — `fetch` rejects URLs that embed
 * credentials — so it is ignored and the resolved REST URL is kept. The key
 * (secret) is unchanged.
 */
export function resolveSupabaseOverIpv4(env: EnvSource): SupabaseConfig {
  const base = loadSupabaseConfig(env);
  const poolerUrl = optional(env, SCHEDULED_RUN_ENV.supabasePoolerUrl);
  if (poolerUrl === undefined || !isHttpUrl(poolerUrl)) {
    return base;
  }
  return { ...base, url: poolerUrl };
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
