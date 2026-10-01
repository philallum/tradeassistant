// Property-based test for deploy.yml COVERAGE (spec Req 3.5; task 6.7,
// design Property 13). TEST-ONLY: it exercises the real PURE builders from
// deployWorkflow.ts (implemented in task 6.6) over a randomly generated
// name-only `SecretProvisionPlan`.
//
// Validates: Requirements 3.5 — "THE System SHALL update the `deploy.yml`
// `--set-secrets` argument so that every Secret_Key the Cloud_Run_Job requires
// is injected from its Secret_Manager secret, and SHALL update the
// `--set-env-vars` argument so that every Config_Env_Key the Job requires is
// passed as a plain environment variable."
//
// The coverage oracle: for a random plan, EVERY `Secret_Key` with
// `hasValue === true` must appear in `--set-secrets` as
// `RUNTIME_ENV_NAME=<secretName>:latest` (the Supabase three map to their
// established runtime env names, every other secret maps under its `.env` key
// name); EVERY `Config_Env_Key` must appear in `--set-env-vars`; and secrets
// with `hasValue === false` must NOT appear in `--set-secrets`. The same
// coverage is then asserted END-TO-END by parsing the two argument values back
// out of a rewritten deploy.yml fixture. Style follows the property tests in
// src/ops/secret-manager/ (fast-check + Vitest, numRuns >= 100, tagged).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  buildSetEnvVarsArg,
  buildSetSecretsArg,
  rewriteDeployWorkflowContent,
} from "./deployWorkflow.js";
import { secretNameForEnvKey } from "./provisioner.js";
import type { PlannedSecret, SecretProvisionPlan } from "./types.js";

// Feature: operational-wiring, Property 13: The rewritten deploy.yml covers every required key

/**
 * The runtime env-var NAME each secret is injected as, mirroring the SAME
 * convention `deployWorkflow.ts` encodes (do NOT hardcode a competing map): the
 * three established Supabase secrets keep the Job's runtime env names; every
 * other secret is injected under its `.env` key name.
 */
const SUPABASE_RUNTIME_ENV_BY_SECRET: Readonly<Record<string, string>> = {
  "supabase-url": "SUPABASE_HOSTED_URL",
  "supabase-key": "SUPABASE_HOSTED_KEY",
  "supabase-pooler-url": "SUPABASE_POOLER_URL",
};

function expectedRuntimeEnvName(secret: PlannedSecret): string {
  return SUPABASE_RUNTIME_ENV_BY_SECRET[secret.secretName] ?? secret.envKey;
}

/** The three established Supabase `Secret_Key`s, by `.env` key name. */
const SUPABASE_ENV_KEYS: readonly string[] = [
  "SUPABASE_HOSTED_URL",
  "SUPABASE_HOSTED_KEY",
  "SUPABASE_POOLER_URL",
];

/** Third-party provider `Secret_Key`s mapped under their own `.env` key name. */
const PROVIDER_ENV_KEYS: readonly string[] = [
  "OHLC_API_KEY",
  "YIELD_API_KEY",
  "NEWS_CALENDAR_API_KEY",
  "EXTERNAL_SIGNAL_API_KEY",
  "TWELVE_DATA_API_KEY",
  "MASSIVE_API_KEY",
  "ALPHA_VANTAGE_API_KEY",
  "FINNHUB_API_KEY",
  "NEWS_API_KEY",
];

/** The realistic `Secret_Key` universe: the Supabase three + provider keys. */
const SECRET_ENV_KEYS: readonly string[] = [
  ...SUPABASE_ENV_KEYS,
  ...PROVIDER_ENV_KEYS,
];

/**
 * The `Config_Env_Key` universe. `SUPABASE_TARGET` is a fixed literal in
 * deploy.yml; the rest resolve to the GitHub interpolation form. Coverage only
 * requires the KEY be present under `--set-env-vars`, regardless of its value.
 */
const CONFIG_ENV_KEYS: readonly string[] = [
  "GCP_PROJECT_ID",
  "GCP_REGION",
  "GEMINI_MODEL",
  "AR_REPOSITORY",
  "SUPABASE_TARGET",
];

/** A single generated `PlannedSecret`: a known env key, its derived secret
 *  name (via the real `secretNameForEnvKey`), and whether a value is present. */
const plannedSecretArb: fc.Arbitrary<PlannedSecret> = fc
  .tuple(fc.constantFrom(...SECRET_ENV_KEYS), fc.boolean())
  .map(([envKey, hasValue]) => ({
    envKey,
    secretName: secretNameForEnvKey(envKey),
    hasValue,
  }));

/** A name-only `SecretProvisionPlan`. `secrets` is de-duplicated by `envKey`
 *  (a real `.env`-derived plan lists each key once); a random, possibly empty,
 *  subset of `Config_Env_Key`s is chosen so coverage over 0..all keys is
 *  exercised. `missingValues` mirrors the empty-value secret keys for realism. */
const planArb: fc.Arbitrary<SecretProvisionPlan> = fc
  .tuple(
    fc.array(plannedSecretArb, {
      minLength: 0,
      maxLength: SECRET_ENV_KEYS.length,
    }),
    fc.subarray([...CONFIG_ENV_KEYS]),
  )
  .map(([secrets, configKeys]) => {
    const byKey = new Map<string, PlannedSecret>();
    for (const s of secrets) byKey.set(s.envKey, s);
    const deduped = [...byKey.values()];
    return {
      secrets: deduped,
      configKeys,
      missingValues: deduped.filter((s) => !s.hasValue).map((s) => s.envKey),
    } satisfies SecretProvisionPlan;
  });

/** Split a `--set-secrets` / `--set-env-vars` argument value into its
 *  comma-separated `KEY=VALUE` entries (empty string -> no entries). */
function entriesOf(arg: string): string[] {
  return arg === "" ? [] : arg.split(",");
}

/** The KEY (left of the first `=`) of each entry in an argument value. */
function keysOf(arg: string): string[] {
  return entriesOf(arg).map((entry) => entry.slice(0, entry.indexOf("=")));
}

/** A representative deploy.yml fixture carrying the two argument lines the
 *  rewrite targets, embedded among other content that must be preserved. */
const DEPLOY_YML_FIXTURE = [
  "      - name: Deploy SHA-pinned image to Cloud Run Job",
  "        run: |",
  '          gcloud run jobs deploy "${CLOUD_RUN_JOB}" \\',
  '            --project "${GCP_PROJECT_ID}" \\',
  '            --region "${GCP_REGION}" \\',
  '            --image "${{ steps.image.outputs.uri }}" \\',
  '            --service-account "${RUNTIME_SERVICE_ACCOUNT}" \\',
  '            --set-env-vars "GCP_PROJECT_ID=${GCP_PROJECT_ID},SUPABASE_TARGET=hosted" \\',
  '            --set-secrets "SUPABASE_HOSTED_URL=supabase-url:latest"',
  "",
].join("\n");

/** Extract the quoted value of a `--set-X "..."` argument from rewritten yaml. */
function extractArg(yaml: string, flag: string): string {
  const match = new RegExp(`${flag}\\s+"([^"]*)"`).exec(yaml);
  expect(match).not.toBeNull();
  return match![1]!;
}

describe("Property 13: the rewritten deploy.yml covers every required key (spec Req 3.5)", () => {
  it("--set-secrets covers every Secret_Key with a value, omits valueless ones; --set-env-vars covers every Config_Env_Key", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const secretsArg = buildSetSecretsArg(plan);
        const envVarsArg = buildSetEnvVarsArg(plan);
        const secretEntries = entriesOf(secretsArg);
        const envVarKeys = keysOf(envVarsArg);

        // --- Secret coverage: every hasValue secret -> correct reference ---
        for (const secret of plan.secrets) {
          const reference = `${expectedRuntimeEnvName(secret)}=${secret.secretName}:latest`;
          if (secret.hasValue) {
            // Present as RUNTIME_ENV_NAME=<secretName>:latest.
            expect(secretEntries).toContain(reference);
          } else {
            // Valueless secrets are omitted from --set-secrets entirely.
            expect(secretsArg).not.toContain(`${secret.secretName}:latest`);
          }
        }

        // No MORE entries than valued secrets (exact coverage, no extras).
        const valuedCount = plan.secrets.filter((s) => s.hasValue).length;
        expect(secretEntries).toHaveLength(valuedCount);

        // --- Config coverage: every Config_Env_Key present under env-vars ---
        for (const configKey of plan.configKeys) {
          expect(envVarKeys).toContain(configKey);
        }
        expect(envVarKeys).toHaveLength(plan.configKeys.length);
      }),
      { numRuns: 100 },
    );
  });

  it("end-to-end: parsing --set-secrets / --set-env-vars back out of the rewritten deploy.yml shows the same full coverage", () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const rewritten = rewriteDeployWorkflowContent(DEPLOY_YML_FIXTURE, plan);

        const secretsArg = extractArg(rewritten, "--set-secrets");
        const envVarsArg = extractArg(rewritten, "--set-env-vars");
        const secretEntries = entriesOf(secretsArg);
        const envVarKeys = keysOf(envVarsArg);

        // Every valued Secret_Key is injected from its Secret Manager secret;
        // valueless ones never appear.
        for (const secret of plan.secrets) {
          const reference = `${expectedRuntimeEnvName(secret)}=${secret.secretName}:latest`;
          if (secret.hasValue) {
            expect(secretEntries).toContain(reference);
          } else {
            expect(secretsArg).not.toContain(`${secret.secretName}:latest`);
          }
        }
        expect(secretEntries).toHaveLength(
          plan.secrets.filter((s) => s.hasValue).length,
        );

        // Every Config_Env_Key is passed as a plain environment variable.
        for (const configKey of plan.configKeys) {
          expect(envVarKeys).toContain(configKey);
        }
        expect(envVarKeys).toHaveLength(plan.configKeys.length);

        // The surrounding workflow bytes survive the surgical rewrite.
        expect(rewritten).toContain(
          'gcloud run jobs deploy "${CLOUD_RUN_JOB}"',
        );
        expect(rewritten).toContain('--image "${{ steps.image.outputs.uri }}"');
      }),
      { numRuns: 100 },
    );
  });
});
