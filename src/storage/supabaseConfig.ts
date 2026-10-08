// Environment-based Supabase connection configuration (Requirements 6.3, 17.2).
//
// Compute/storage separation (Requirement 17): this module only *parses and
// selects* connection configuration from the environment. It performs no I/O
// and holds no client, so the deterministic core never depends on a serving or
// storage layer. The same parsed config is used to run the identical schema
// against a local Supabase instance and the hosted project (Requirement 17.2);
// callers pick the target via `SUPABASE_TARGET`.
//
// Secrets are never fabricated or defaulted — the URL/key values are read
// verbatim from the process environment (Requirement 6.3).
//
// ROLE-NAME AGNOSTIC (spec Req 4.6, 9.3). This module and the companion
// `supabase/client.ts` are deliberately ignorant of the Postgres role the write
// JWT selects. The Bearer credential (`key`, from SUPABASE_HOSTED_KEY /
// `supabase-key`) and the gateway `apikey` (`apiKey`, from
// SUPABASE_PUBLISHABLE_KEY / `supabase-publishable-key`) are read verbatim and
// carried through unchanged — no code here parses the JWT, inspects its `role`
// claim, or hardcodes any role name. PostgREST (not this code) resolves the
// Postgres role from the JWT's `role` claim server-side. Consequently the
// pipeline_writer → fx_writer cutover (tasks 5.2a / 5.3) is a SECRET ROTATION,
// NOT A CODE EDIT: minting a new JWT with `role: fx_writer` and storing it as a
// new `supabase-key` secret version is sufficient; this file and the client
// need no change. The role names appearing in comments below are illustrative
// of the deployment model only and are never matched against at runtime.

/** The two supported deployment targets (Requirement 17.2). */
export type SupabaseTarget = "local" | "hosted";

/** A fully-resolved Supabase connection configuration. */
export interface SupabaseConfig {
  /** Which target this configuration selects. */
  readonly target: SupabaseTarget;
  /** Base API URL for the selected Supabase instance. */
  readonly url: string;
  /**
   * The credential sent as `Authorization: Bearer` and, by default, also as the
   * gateway `apikey` header (secret). On the hosted target under the new
   * asymmetric-key model this is the Scoped_Write_Credential — a signed JWT
   * whose `role` claim selects the Pipeline_Writer_Role (spec Req 8.3).
   */
  readonly key: string;
  /**
   * Optional gateway `apikey` value (secret), distinct from {@link key}.
   *
   * Supabase's API gateway (Kong) authenticates the request by matching the
   * `apikey` header against a recognized publishable/anon key BEFORE PostgREST
   * resolves the Postgres role from the `Authorization: Bearer` JWT. A scoped
   * role JWT (e.g. `pipeline_writer`) is NOT a recognized gateway api key, so it
   * must travel ONLY in `Bearer`, with the publishable (anon) key supplied here
   * as `apikey` (spec Req 8.5 — the publishable key is the gateway-admission
   * credential and never the write path; the write role comes from the Bearer
   * JWT). When absent, the client falls back to using {@link key} for both
   * headers, preserving the legacy anon/service-key behavior unchanged.
   */
  readonly apiKey?: string;
}

/** A minimal read-only view over environment variables (injectable for tests). */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Per-target environment variable names.
 *
 * `SUPABASE_TARGET` selects the active target. Each target reads its own
 * URL/key pair so a single environment can hold both a local and a hosted
 * configuration side by side (Requirement 6.3, 17.2).
 */
export const SUPABASE_ENV = {
  target: "SUPABASE_TARGET",
  local: {
    url: "SUPABASE_LOCAL_URL",
    key: "SUPABASE_LOCAL_KEY",
    // Local Supabase accepts the anon/service key as both apikey and Bearer, so
    // no separate gateway apikey is needed; left undefined.
    apiKey: undefined,
  },
  hosted: {
    url: "SUPABASE_HOSTED_URL",
    key: "SUPABASE_HOSTED_KEY",
    // Gateway apikey for the hosted target: the publishable (anon) key. Required
    // alongside the Scoped_Write_Credential Bearer JWT so the gateway admits the
    // request before PostgREST resolves the pipeline_writer role (spec Req 8.5).
    apiKey: "SUPABASE_PUBLISHABLE_KEY",
  },
} as const;

/** Error thrown when the environment does not describe a valid Supabase target. */
export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigError";
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
  kind: "URL" | "key",
): string {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new SupabaseConfigError(
      `Missing Supabase ${kind} for target "${target}": environment variable ${name} is not set.`,
    );
  }
  return raw;
}

/**
 * Resolve the Supabase configuration from the environment (Requirement 6.3).
 *
 * Selection is driven by `SUPABASE_TARGET` (defaults to `local` when absent,
 * so local development needs no extra wiring). The selected target's URL and
 * key must both be present and non-empty; otherwise a `SupabaseConfigError`
 * is thrown describing exactly which variable is missing. Values are read
 * verbatim — no secret is ever synthesized.
 *
 * @param env  Environment source (defaults to `process.env`); injectable so
 *             parsing/selection is unit-testable without mutating the process.
 */
export function loadSupabaseConfig(
  env: EnvSource = process.env,
): SupabaseConfig {
  const rawTarget = env[SUPABASE_ENV.target];
  const target = rawTarget === undefined || rawTarget.trim() === ""
    ? "local"
    : rawTarget.trim();

  if (!isSupabaseTarget(target)) {
    throw new SupabaseConfigError(
      `Invalid ${SUPABASE_ENV.target} "${rawTarget ?? ""}": expected one of ${VALID_TARGETS.join(", ")}.`,
    );
  }

  const names = SUPABASE_ENV[target];
  const url = requireValue(env, names.url, target, "URL");
  const key = requireValue(env, names.key, target, "key");

  // Optional gateway apikey (publishable key on hosted). Read verbatim; when the
  // env var is unset/empty the field is omitted so the client falls back to
  // using `key` for both headers (legacy anon/service-key behavior).
  const apiKeyName = names.apiKey;
  const rawApiKey = apiKeyName === undefined ? undefined : env[apiKeyName];
  const apiKey =
    rawApiKey === undefined || rawApiKey.trim() === "" ? undefined : rawApiKey;

  return apiKey === undefined
    ? { target, url, key }
    : { target, url, key, apiKey };
}

/**
 * Non-throwing variant of {@link loadSupabaseConfig}. Returns a discriminated
 * result so callers (e.g. a connectivity check) can decide how to react to a
 * missing/invalid environment without exception handling.
 */
export type SupabaseConfigResult =
  | { readonly ok: true; readonly config: SupabaseConfig }
  | { readonly ok: false; readonly error: string };

export function tryLoadSupabaseConfig(
  env: EnvSource = process.env,
): SupabaseConfigResult {
  try {
    return { ok: true, config: loadSupabaseConfig(env) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
