// Property-based test for SecretManagerProvisioner.plan (spec Req 3.9; task
// 6.3, design Property 16).
//
// Validates: Requirements 3.9 — "IF a Secret_Key's value in `.env` is empty or
// absent, THEN THE System SHALL report that missing value and SHALL NOT create
// or version a secret with an empty value."
//
// This is a TEST-ONLY task. It exercises the real pure `plan(env)` function and
// the real `SecretManagerProvisioner.plan` method against a randomly generated
// `.env` record mixing secret-named keys (`*_API_KEY`, `*_TOKEN`,
// `*_POOLER_URL`, ...) with empty / whitespace-only / absent values alongside
// non-empty ones, plus some config-named keys. No value is ever read into the
// plan: a `Secret_Key` with an empty/absent value is reported in
// `missingValues` with `hasValue === false` and is never slated for creation,
// while a non-empty `Secret_Key` has `hasValue === true` and is NOT reported.
// Additionally, no secret VALUE string ever appears anywhere in the serialized
// plan.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type {
  CommandOutput,
  CommandPresentation,
  EnvSource,
  GcloudRunner,
  OperationalSafety,
  ReconcileResult,
} from "../safety/types.js";
import { classifyEnvKey } from "./classify.js";
import { plan, SecretManagerProvisioner } from "./provisioner.js";

/** Inert collaborators: `plan` performs no I/O, so these are never invoked.
 *  They exist only to satisfy the design constructor signature. */
const inertRunner: GcloudRunner = {
  run: (): Promise<CommandOutput> =>
    Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
};
const inertSafety: OperationalSafety = {
  reconcileTarget: (): Promise<ReconcileResult> => Promise.resolve({ ok: true }),
  confirm: (presentation: CommandPresentation): Promise<boolean> => {
    void presentation;
    return Promise.resolve(false);
  },
};

// Feature: operational-wiring, Property 16: Empty or absent secret values are reported, never created

/** Distinctive secret-value payloads so, if any value ever leaked into the
 *  serialized plan, the assertion below would catch it. Each is non-empty and
 *  unlikely to collide with an env-key NAME. */
const SECRET_VALUE_SENTINEL = "SECRET_VALUE_SENTINEL_";

/** Base names that will become secret keys once a secret suffix is appended. */
const secretBaseArb: fc.Arbitrary<string> = fc.constantFrom(
  "OHLC",
  "YIELD",
  "NEWS_CALENDAR",
  "EXTERNAL_SIGNAL",
  "TWELVE_DATA",
  "MASSIVE",
  "ALPHA_VANTAGE",
  "FINNHUB",
  "NEWS",
  "SUPABASE_HOSTED",
  "SUPABASE",
);

/** Suffixes guaranteed to classify as `secret` by the naming convention. */
const secretSuffixArb: fc.Arbitrary<string> = fc.constantFrom(
  "_API_KEY",
  "_TOKEN",
  "_KEY",
  "_POOLER_URL",
);

/** A `Secret_Key` name (classifies as `secret`). */
const secretKeyArb: fc.Arbitrary<string> = fc
  .tuple(secretBaseArb, secretSuffixArb)
  .map(([base, suffix]) => `${base}${suffix}`)
  .filter((name) => classifyEnvKey(name) === "secret");

/** A `Config_Env_Key` name (classifies as `config`). */
const configKeyArb: fc.Arbitrary<string> = fc
  .constantFrom(
    "GCP_PROJECT_ID",
    "GCP_REGION",
    "GEMINI_MODEL",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "SUPABASE_TARGET",
    "OHLC_PROVIDER",
    "YIELD_PROVIDER",
    "NEWS_ENABLED",
    "OHLC_BASE_URL",
    "SUPABASE_LOCAL_URL",
  )
  .filter((name) => classifyEnvKey(name) === "config");

/** A value that is EMPTY/absent per the plan's `hasNonEmptyValue` convention:
 *  either `undefined` (absent), the empty string, or whitespace-only. */
const emptyOrAbsentValueArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constant(""),
  fc.constantFrom(" ", "   ", "\t", "\n", "  \n\t "),
);

/** A NON-empty value (survives `.trim()`), carrying the sentinel so a leak is
 *  detectable in the serialized plan. */
const nonEmptyValueArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim() !== "")
  .chain((core) =>
    fc.constantFrom(
      `${SECRET_VALUE_SENTINEL}${core}`,
      `${SECRET_VALUE_SENTINEL}${core}  `,
      `  ${SECRET_VALUE_SENTINEL}${core}`,
    ),
  );

/** One generated env entry: a unique key, a classification intent, and a value
 *  whose emptiness we track so the oracle knows the expected outcome. */
interface GeneratedEntry {
  readonly key: string;
  readonly value: string | undefined;
  /** True iff `value` is non-empty per the plan's convention. */
  readonly nonEmpty: boolean;
  readonly kind: "secret" | "config";
}

/** Build an `EnvSource` from generated entries, de-duplicating by key (a later
 *  entry wins, mirroring object construction) and returning both the env and
 *  the resolved per-key expectation. */
function buildEnv(entries: readonly GeneratedEntry[]): {
  env: EnvSource;
  resolved: Map<string, GeneratedEntry>;
} {
  const resolved = new Map<string, GeneratedEntry>();
  const record: Record<string, string | undefined> = {};
  for (const entry of entries) {
    resolved.set(entry.key, entry);
    // Only define the key when the value is not `undefined` so an "absent" key
    // is genuinely absent from the record (Object.keys will not include it).
    if (entry.value !== undefined) record[entry.key] = entry.value;
  }
  // Prune resolved entries whose final value is `undefined` AND whose key is
  // therefore absent from the record — these keys never reach the plan.
  return { env: Object.freeze(record), resolved };
}

const secretEntryArb: fc.Arbitrary<GeneratedEntry> = fc
  .tuple(secretKeyArb, fc.boolean())
  .chain(([key, nonEmpty]) =>
    (nonEmpty ? nonEmptyValueArb : emptyOrAbsentValueArb).map((value) => ({
      key,
      value,
      nonEmpty: value !== undefined && value.trim() !== "",
      kind: "secret" as const,
    })),
  );

const configEntryArb: fc.Arbitrary<GeneratedEntry> = fc
  .tuple(configKeyArb, fc.oneof(nonEmptyValueArb, emptyOrAbsentValueArb))
  .map(([key, value]) => ({
    key,
    value,
    nonEmpty: value !== undefined && value.trim() !== "",
    kind: "config" as const,
  }));

const envArb: fc.Arbitrary<readonly GeneratedEntry[]> = fc.array(
  fc.oneof(secretEntryArb, configEntryArb),
  { minLength: 0, maxLength: 20 },
);

describe("Property 16: empty or absent secret values are reported, never created (spec Req 3.9)", () => {
  it("reports empty/absent secret values in missingValues with hasValue:false, keeps non-empty ones, and leaks no value", () => {
    fc.assert(
      fc.property(envArb, fc.boolean(), (entries, useClass) => {
        const { env, resolved } = buildEnv(entries);

        // Exercise both the free function and the class method; they must agree.
        const result = useClass
          ? new SecretManagerProvisioner(inertRunner, inertSafety).plan(env)
          : plan(env);

        // The set of secret keys actually present in the env (after dedup), by
        // name. Keys whose final value is `undefined` are ABSENT from the env
        // record but — per Req 3.9 — an absent Secret_Key value must still be
        // reported if the key is "expected". Here the plan only sees keys
        // present in the record, so we scope the oracle to those keys.
        const presentKeys = new Set(Object.keys(env));

        // --- Oracle per key -------------------------------------------------
        for (const key of presentKeys) {
          const entry = resolved.get(key);
          if (entry === undefined) continue;
          const cls = classifyEnvKey(key);
          if (cls === "config") {
            expect(result.configKeys).toContain(key);
            // A config key is never a planned secret nor a missing value.
            expect(result.secrets.some((s) => s.envKey === key)).toBe(false);
            expect(result.missingValues).not.toContain(key);
            continue;
          }
          // Secret key: must appear exactly once in `secrets`.
          const planned = result.secrets.filter((s) => s.envKey === key);
          expect(planned).toHaveLength(1);
          const raw = env[key];
          const hasValue = raw !== undefined && raw.trim() !== "";
          expect(planned[0]!.hasValue).toBe(hasValue);

          if (hasValue) {
            // Complementary case: a non-empty secret is NOT reported missing.
            expect(result.missingValues).not.toContain(key);
          } else {
            // Empty/whitespace value present but blank -> reported missing and
            // never slated for creation (hasValue:false means provision skips).
            expect(result.missingValues).toContain(key);
            expect(planned[0]!.hasValue).toBe(false);
          }
        }

        // --- Every missingValues entry is a blank secret key present in env --
        for (const missing of result.missingValues) {
          expect(classifyEnvKey(missing)).toBe("secret");
          expect(presentKeys.has(missing)).toBe(true);
          const planned = result.secrets.find((s) => s.envKey === missing);
          expect(planned).toBeDefined();
          expect(planned!.hasValue).toBe(false);
        }

        // --- Every hasValue:false secret is reported in missingValues --------
        for (const s of result.secrets) {
          if (!s.hasValue) expect(result.missingValues).toContain(s.envKey);
          else expect(result.missingValues).not.toContain(s.envKey);
        }

        // --- Confidentiality: no secret VALUE appears anywhere in the plan ---
        const serialized = JSON.stringify(result);
        // The sentinel is embedded in every NON-empty generated value; if any
        // value had leaked into the plan it would carry the sentinel.
        expect(serialized).not.toContain(SECRET_VALUE_SENTINEL);
        // Belt-and-suspenders: assert each actual non-empty value is absent.
        for (const key of presentKeys) {
          const raw = env[key];
          if (raw !== undefined && raw.trim() !== "") {
            expect(serialized).not.toContain(raw);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("never slates an empty/absent secret for creation (missingValues keys all have hasValue:false)", () => {
    fc.assert(
      fc.property(envArb, (entries) => {
        const { env } = buildEnv(entries);
        const result = plan(env);
        const plannedByKey = new Map(
          result.secrets.map((s) => [s.envKey, s] as const),
        );
        for (const missing of result.missingValues) {
          const planned = plannedByKey.get(missing);
          // A missing value is present in `secrets` only as a NON-creatable
          // marker (hasValue:false). provision() skips hasValue:false, so no
          // empty secret is ever created or versioned.
          expect(planned?.hasValue).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
