// Env_Key classification by NAME only (spec Req 3.1, 6.3; design Component 4).
//
// Compute/storage separation (parent Req 17) + secret confidentiality
// (spec Req 6.2, 6.3): this is a pure function over the env-key *name*. It never
// reads, receives, or inspects a value — classification depends solely on the
// naming convention, so no `Secret_Key` value can ever leak through it.
//
// Convention (spec Req 3.1):
//   secret <- every *_API_KEY, *_KEY, *_TOKEN, a service-account credential
//             (credential JSON), any credential-bearing connection string or
//             URL by suffix (e.g. SUPABASE_*_KEY, SUPABASE_POOLER_URL,
//             *_HOSTED_URL which embeds a credential), AND the explicitly-named
//             credential-bearing connection strings that carry no such suffix
//             (SUPABASE_POOLER, SUPABASE_DIRECT_CONNECTION).
//   config <- project id, region, model id, provider *names*, and boolean
//             toggles (*_ENABLED, GOOGLE_GENAI_USE_VERTEXAI), plus other
//             non-credential URLs/base URLs and target selectors.

/** The two classes an `Env_Key` can fall into (design Component 4). */
export type EnvKeyClass = "secret" | "config";

/**
 * Config_Env_Keys that would otherwise be caught by a broad credential pattern
 * (or that must be pinned explicitly) — project id, region, model, toggles, and
 * selectors. Matched before the generic secret patterns so they win.
 */
const EXPLICIT_CONFIG = new Set<string>([
  "GCP_PROJECT_ID",
  "GCP_REGION",
  "GEMINI_MODEL",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "SUPABASE_TARGET",
  "RUN_DECISION_DATE",
  // SUPABASE_URL is the project REST URL (project-ref only, NO embedded
  // credential), so it is public config. Pinned here so a future credential
  // rule can never accidentally sweep it into `secret` (spec Req 3.1).
  "SUPABASE_URL",
  // SUPABASE_JWKS_URL is a PUBLIC JWKS endpoint publishing public key material
  // (no embedded credential), so it is public config. Pinned so it stays
  // `config` regardless of any future rule (spec Req 3.1).
  "SUPABASE_JWKS_URL",
]);

/**
 * Credential-bearing URL/connection-string suffixes (spec Req 3.1). A hosted or
 * pooler endpoint embeds credentials, so by name it is a `Secret_Key`. Plain
 * local URLs and provider `*_BASE_URL` overrides do NOT embed a credential and
 * remain Config_Env_Keys.
 */
const CREDENTIAL_URL_SUFFIXES: readonly string[] = [
  "_POOLER_URL",
  "_HOSTED_URL",
];

/** Service-account credential (credential JSON) env keys (spec Req 3.1). */
const CREDENTIAL_JSON_KEYS = new Set<string>([
  "GOOGLE_APPLICATION_CREDENTIALS",
]);

/**
 * Known credential-bearing CONNECTION-STRING env-key NAMES (spec Req 3.1).
 *
 * These keys hold a connection string/URL that embeds a `username:password`
 * credential, so by name they are `Secret_Key`s. They carry none of the
 * credential suffixes (`_KEY`/`_TOKEN`/`_POOLER_URL`/`_HOSTED_URL`), so without
 * this explicit allow-list they would wrongly default to `config`. This is
 * deliberately an EXPLICIT allow-list of exact names — NOT a broad suffix —
 * so no unrelated key is ever swept in.
 *
 *   SUPABASE_POOLER            — Postgres pooler connection string
 *                                (`postgresql://postgres.<ref>:<password>@...`)
 *                                embedding the DB credential.
 *   SUPABASE_DIRECT_CONNECTION — direct Postgres connection string
 *                                (`postgresql://postgres:<password>@db...`)
 *                                embedding the DB credential.
 */
const CREDENTIAL_CONNECTION_KEYS = new Set<string>([
  "SUPABASE_POOLER",
  "SUPABASE_DIRECT_CONNECTION",
]);

/** Non-credential config suffixes checked before the generic `*_KEY` rule. */
function isConfigByConvention(name: string): boolean {
  if (EXPLICIT_CONFIG.has(name)) return true;
  // Provider *names* (e.g. OHLC_PROVIDER) are config, not secrets.
  if (name.endsWith("_PROVIDER")) return true;
  // Boolean toggles (spec Req 3.1).
  if (name.endsWith("_ENABLED")) return true;
  // Base-URL overrides are plain config, not credential-bearing.
  if (name.endsWith("_BASE_URL")) return true;
  // Local (non-credential) Supabase URL.
  if (name === "SUPABASE_LOCAL_URL") return true;
  return false;
}

function isSecretByConvention(name: string): boolean {
  if (CREDENTIAL_JSON_KEYS.has(name)) return true;
  // Known credential-bearing connection strings (spec Req 3.1) — exact names.
  if (CREDENTIAL_CONNECTION_KEYS.has(name)) return true;
  if (name.endsWith("_API_KEY")) return true;
  if (name.endsWith("_TOKEN")) return true;
  if (name.endsWith("_KEY")) return true;
  for (const suffix of CREDENTIAL_URL_SUFFIXES) {
    if (name.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Classify one `Env_Key` by name only (spec Req 3.1).
 *
 * Config conventions are checked FIRST so a name that is both a known config
 * key and would match a broad credential pattern (none currently, but e.g. a
 * future `*_PROVIDER_KEY`-style edge) resolves deterministically. A name that
 * matches no secret pattern defaults to `config`: the fallback is safe because
 * a non-secret value passed via `--set-env-vars` leaks nothing, whereas the
 * explicit secret patterns capture every credential-bearing key.
 */
export function classifyEnvKey(name: string): EnvKeyClass {
  if (isConfigByConvention(name)) return "config";
  if (isSecretByConvention(name)) return "secret";
  return "config";
}
