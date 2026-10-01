// Property-based test for `Env_Key` classification by naming convention
// (spec Req 3.1; task 6.2, design Property 12).
//
// Validates: Requirements 3.1 — "THE System SHALL classify each Env_Key ... as
// either a Secret_Key or a Config_Env_Key using the convention: every
// *_API_KEY, *_KEY, *_TOKEN, service-account credential, and credential-bearing
// connection string or URL is a Secret_Key; project id, region, model id,
// provider *names*, and boolean toggles (*_ENABLED, GOOGLE_GENAI_USE_VERTEXAI)
// are Config_Env_Keys."
//
// This is a TEST-ONLY task. It exercises the real `classifyEnvKey` from
// classify.ts (implemented in task 6.1). Rather than enumerate fixed names, it
// GENERATES env-key names from the convention via fast-check arbitraries — a
// random base joined to a known secret/config suffix, plus the explicitly-named
// keys — and asserts the returned class matches the convention's expected class.
// Style follows the property tests in src/ops/safety/ (fast-check + Vitest,
// numRuns >= 100, a single tagged property).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { classifyEnvKey } from "./classify.js";

// Feature: operational-wiring, Property 12: Env-key classification follows the naming convention

/**
 * A random, convention-neutral BASE segment for a synthesised env-key name:
 * uppercase letters, digits, and underscores, starting with a letter. It is
 * deliberately constrained so that it does NOT itself end in a classifying
 * suffix (e.g. `_KEY`, `_ENABLED`) and is not one of the explicitly-named keys,
 * so the suffix we append is the sole deciding factor.
 */
const EXPLICIT_CONFIG_NAMES: readonly string[] = [
  "GCP_PROJECT_ID",
  "GCP_REGION",
  "GEMINI_MODEL",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "SUPABASE_TARGET",
  "RUN_DECISION_DATE",
  "SUPABASE_LOCAL_URL",
  // Public Supabase URLs: project REST URL (project-ref only) and the public
  // JWKS endpoint — neither embeds a credential, so both stay config
  // (spec Req 3.1).
  "SUPABASE_URL",
  "SUPABASE_JWKS_URL",
];

const EXPLICIT_SECRET_NAMES: readonly string[] = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  // Credential-bearing Postgres connection strings — embed username:password,
  // so they are Secret_Keys by name despite carrying no credential suffix
  // (spec Req 3.1).
  "SUPABASE_POOLER",
  "SUPABASE_DIRECT_CONNECTION",
];

/** Suffixes that make a name a Secret_Key by convention (spec Req 3.1). */
const SECRET_SUFFIXES: readonly string[] = [
  "_API_KEY",
  "_KEY",
  "_TOKEN",
  "_POOLER_URL",
  "_HOSTED_URL",
];

/** Suffixes that make a name a Config_Env_Key by convention (spec Req 3.1). */
const CONFIG_SUFFIXES: readonly string[] = [
  "_PROVIDER",
  "_ENABLED",
  "_BASE_URL",
];

/**
 * Any classifying suffix (secret or config). Used to ensure a generated base
 * does not accidentally end in one, which would otherwise make the appended
 * suffix non-deciding.
 */
const ALL_SUFFIXES: readonly string[] = [...SECRET_SUFFIXES, ...CONFIG_SUFFIXES];

/**
 * A base segment that is safe to prefix onto a classifying suffix: it does not
 * end in any classifying suffix and is not one of the explicitly-named keys.
 */
const baseArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Z][A-Z0-9_]{0,20}$/)
  .filter((base) => {
    if (EXPLICIT_CONFIG_NAMES.includes(base)) return false;
    if (EXPLICIT_SECRET_NAMES.includes(base)) return false;
    return !ALL_SUFFIXES.some((suffix) => base.endsWith(suffix));
  });

describe("Property 12: env-key classification follows the naming convention (spec Req 3.1)", () => {
  it("classifies any *_API_KEY / *_KEY / *_TOKEN / credential-bearing URL name as a secret", () => {
    fc.assert(
      fc.property(
        baseArb,
        fc.constantFrom(...SECRET_SUFFIXES),
        (base, suffix) => {
          expect(classifyEnvKey(`${base}${suffix}`)).toBe("secret");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("classifies any provider-name / boolean-toggle / base-URL name as config", () => {
    fc.assert(
      fc.property(
        baseArb,
        fc.constantFrom(...CONFIG_SUFFIXES),
        (base, suffix) => {
          expect(classifyEnvKey(`${base}${suffix}`)).toBe("config");
        },
      ),
      { numRuns: 200 },
    );
  });

  it("classifies the explicitly-named config keys as config", () => {
    fc.assert(
      fc.property(fc.constantFrom(...EXPLICIT_CONFIG_NAMES), (name) => {
        expect(classifyEnvKey(name)).toBe("config");
      }),
      { numRuns: 100 },
    );
  });

  it("classifies the service-account credential JSON key as a secret", () => {
    fc.assert(
      fc.property(fc.constantFrom(...EXPLICIT_SECRET_NAMES), (name) => {
        expect(classifyEnvKey(name)).toBe("secret");
      }),
      { numRuns: 100 },
    );
  });

  it("classifies credential-bearing connection strings as secret and public Supabase URLs as config (spec Req 3.1)", () => {
    // Credential-bearing Postgres connection strings embed a username:password
    // credential, so they must be Secret_Keys even though they carry no
    // credential suffix.
    expect(classifyEnvKey("SUPABASE_POOLER")).toBe("secret");
    expect(classifyEnvKey("SUPABASE_DIRECT_CONNECTION")).toBe("secret");
    // Public Supabase URLs carry no embedded credential, so they stay config.
    expect(classifyEnvKey("SUPABASE_JWKS_URL")).toBe("config");
    expect(classifyEnvKey("SUPABASE_URL")).toBe("config");
  });
});
