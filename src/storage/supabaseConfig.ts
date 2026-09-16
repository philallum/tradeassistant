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

/** The two supported deployment targets (Requirement 17.2). */
export type SupabaseTarget = "local" | "hosted";

/** A fully-resolved Supabase connection configuration. */
export interface SupabaseConfig {
  /** Which target this configuration selects. */
  readonly target: SupabaseTarget;
  /** Base API URL for the selected Supabase instance. */
  readonly url: string;
  /** Service/API key for the selected Supabase instance (secret). */
  readonly key: string;
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
  },
  hosted: {
    url: "SUPABASE_HOSTED_URL",
    key: "SUPABASE_HOSTED_KEY",
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

  return { target, url, key };
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
