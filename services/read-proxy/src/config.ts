// dashboard-ui Read_Proxy — read-credential configuration (Secret Manager env).
//
// This module resolves the connection configuration the Read_Proxy uses to issue
// SELECT-only reads against the curated Read_Only_View set. It mirrors the core's
// `src/storage/supabaseConfig.ts` pattern — `SUPABASE_TARGET` selection
// (local|hosted, default local), per-target env var map, VERBATIM env reads, an
// injectable `EnvSource` for tests, and a dedicated config error — but is
// reimplemented here so `services/read-proxy/` stays standalone and imports
// nothing from `src/`.
//
// CREDENTIAL BOUNDARY (spec Req 3.3, 3.5, 5.9): the read credential is a SEPARATE
// `dashboard_reader` key held in Secret Manager. This loader reads it from
// `SUPABASE_READ_KEY` (Secret Manager secret `supabase-read-key`) on the hosted
// target and NEVER reads `SUPABASE_HOSTED_KEY` (the Scoped_Write_Credential) or
// any service-role key. There is no code path by which the write credential can
// be resolved here. Secrets are read verbatim and never fabricated or defaulted
// (mirrors Req 6.3 posture); they travel only in request headers and never in a
// response or log (enforced by the read client).

/** The two supported deployment targets (mirrors the core's SupabaseTarget). */
export type SupabaseTarget = "local" | "hosted";

/**
 * A fully-resolved read-only Supabase connection the {@link SupabaseReadClient}
 * consumes. It carries ONLY the read credential and (optionally) the publishable
 * gateway key — never the Scoped_Write_Credential or a service-role key.
 */
export interface ReadProxyConfig {
  /** Which target this configuration selects. */
  readonly target: SupabaseTarget;
  /** Base API URL for the selected Supabase instance. */
  readonly url: string;
  /**
   * The `dashboard_reader` read credential, sent as `Authorization: Bearer` and,
   * on the local target, also as the gateway `apikey`. On hosted this is the
   * scoped read key (`supabase-read-key`) — never the write credential.
   */
  readonly readKey: string;
  /**
   * Optional gateway `apikey` value (the publishable/anon key), distinct from
   * {@link readKey}. On hosted the publishable key is the gateway-admission
   * credential; the `dashboard_reader` role comes from the Bearer JWT. When
   * absent (local), the client falls back to using {@link readKey} for both
   * headers.
   */
  readonly apiKey?: string;
}

/** A minimal read-only view over environment variables (injectable for tests). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Per-target environment variable names.
 *
 * `SUPABASE_TARGET` selects the active target. Each target reads its own
 * URL/read-key pair so a single environment can hold both a local and a hosted
 * read configuration side by side. The hosted read key env is DELIBERATELY
 * `SUPABASE_READ_KEY` (the dashboard read key), NOT `SUPABASE_HOSTED_KEY` (the
 * Scoped_Write_Credential): the proxy must never resolve the write credential
 * (spec Req 3.5).
 */
export const READ_PROXY_ENV = {
  target: "SUPABASE_TARGET",
  local: {
    url: "SUPABASE_LOCAL_URL",
    // Local Supabase accepts the anon key as both apikey and Bearer, so a single
    // local read key suffices and no separate gateway apikey is needed.
    readKey: "SUPABASE_LOCAL_KEY",
    apiKey: undefined,
  },
  hosted: {
    url: "SUPABASE_HOSTED_URL",
    // The dashboard read credential (Secret Manager `supabase-read-key`). This is
    // NOT SUPABASE_HOSTED_KEY — the write credential is never read here.
    readKey: "SUPABASE_READ_KEY",
    // Gateway apikey for the hosted target: the publishable (anon) key. Required
    // alongside the dashboard_reader Bearer JWT so the gateway admits the request
    // before PostgREST resolves the read role.
    apiKey: "SUPABASE_PUBLISHABLE_KEY",
  },
} as const;

/**
 * Env var names that MUST NEVER be used to resolve the read credential: the
 * hosted write credential (Scoped_Write_Credential) and any service-role key.
 * Exported so a structural/guard test can assert the loader never reads them.
 */
export const FORBIDDEN_CREDENTIAL_ENV = [
  "SUPABASE_HOSTED_KEY", // Scoped_Write_Credential (pipeline_writer)
  "SUPABASE_SERVICE_ROLE_KEY", // service-role key
  "SUPABASE_SERVICE_KEY", // service-role key (alternate name)
] as const;

/** Error thrown when the environment does not describe a valid read target. */
export class ReadProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadProxyConfigError";
  }
}

const VALID_TARGETS: readonly SupabaseTarget[] = ["local", "hosted"];

function isSupabaseTarget(value: string): value is SupabaseTarget {
  return (VALID_TARGETS as readonly string[]).includes(value);
}

function requireValue(
  env: EnvSource,
  name: string,
  target: SupabaseTarget,
  kind: "URL" | "read key",
): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new ReadProxyConfigError(
      `Missing Supabase ${kind} for target "${target}": environment variable ${name} is not set.`,
    );
  }
  return raw;
}

/**
 * Resolve the read-proxy configuration from the environment (spec Req 3.3, 5.9).
 *
 * Selection is driven by `SUPABASE_TARGET` (defaults to `local` when absent).
 * The selected target's URL and read key must both be present and non-empty;
 * otherwise a {@link ReadProxyConfigError} is thrown naming exactly which
 * variable is missing. Values are read VERBATIM — no secret is ever synthesized —
 * and the write credential / service-role key are never consulted.
 *
 * @param env Environment source (defaults to `process.env`); injectable so
 *            parsing/selection is unit-testable without mutating the process.
 */
export function loadReadProxyConfig(
  env: EnvSource = process.env,
): ReadProxyConfig {
  const rawTarget = env[READ_PROXY_ENV.target];
  const target =
    rawTarget === undefined || rawTarget.trim() === ""
      ? "local"
      : rawTarget.trim();

  if (!isSupabaseTarget(target)) {
    throw new ReadProxyConfigError(
      `Invalid ${READ_PROXY_ENV.target} "${rawTarget ?? ""}": expected one of ${VALID_TARGETS.join(", ")}.`,
    );
  }

  const names = READ_PROXY_ENV[target];
  const url = requireValue(env, names.url, target, "URL");
  const readKey = requireValue(env, names.readKey, target, "read key");

  // Optional gateway apikey (publishable key on hosted). Read verbatim; when the
  // env var is unset/empty the field is omitted so the client falls back to using
  // the read key for both headers (local behavior).
  const apiKeyName = names.apiKey;
  const rawApiKey = apiKeyName === undefined ? undefined : env[apiKeyName];
  const apiKey =
    rawApiKey === undefined || rawApiKey.trim() === "" ? undefined : rawApiKey;

  return apiKey === undefined
    ? { target, url, readKey }
    : { target, url, readKey, apiKey };
}

/**
 * Non-throwing variant of {@link loadReadProxyConfig}. Returns a discriminated
 * result so a startup connectivity/health check can react to a missing/invalid
 * environment without exception handling.
 */
export type ReadProxyConfigResult =
  | { readonly ok: true; readonly config: ReadProxyConfig }
  | { readonly ok: false; readonly error: string };

export function tryLoadReadProxyConfig(
  env: EnvSource = process.env,
): ReadProxyConfigResult {
  try {
    return { ok: true, config: loadReadProxyConfig(env) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
