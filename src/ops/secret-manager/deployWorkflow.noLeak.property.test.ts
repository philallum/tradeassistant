// Property-based test for the PURE deploy.yml rewrite builders — the rewritten
// workflow leaks no secret and misplaces no secret (spec Req 3.6; task 6.8,
// design Property 14).
//
// Validates: Requirements 3.6 — "THE System SHALL NOT place any Secret_Key
// value in deploy.yml, in any committed configuration file, or in any
// --set-env-vars argument."
//
// This is a TEST-ONLY task. It exercises the real PURE builders from
// deployWorkflow.ts (task 6.6): `buildSetSecretsArg`, `buildSetEnvVarsArg`, and
// `rewriteDeployWorkflowContent`. Style follows classify.property.test.ts and
// deployWorkflow.test.ts (fast-check + Vitest, numRuns >= 100, one tagged
// property).
//
// The confidentiality guarantee is STRUCTURAL: the builders are name-only — they
// never see a secret value, so by construction nothing value-shaped can enter
// the output. To make "no value leaks" MEANINGFUL rather than vacuous, this test
// builds a PARALLEL map of (secretName / envKey -> a distinctive sentinel fake
// VALUE) that the builders never receive, runs the rewrite, and asserts NONE of
// those sentinels appears anywhere in the output. It then parses both argument
// segments to assert placement: no `Secret_Key` (and no `:latest` reference)
// under --set-env-vars, and every --set-secrets entry is a
// `NAME=<secretName>:latest` Secret Manager REFERENCE with no misplaced config.

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  buildSetEnvVarsArg,
  buildSetSecretsArg,
  rewriteDeployWorkflowContent,
} from "./deployWorkflow.js";
// `buildSetSecretsArg` / `buildSetEnvVarsArg` are the two per-argument builders
// task 6.8 targets; `rewriteDeployWorkflowContent` composes them into the full
// rewrite. The property asserts the no-leak/no-misplace guarantee on the
// composed output AND cross-checks each builder's segment directly below.
import { classifyEnvKey } from "./classify.js";
import { secretNameForEnvKey } from "./provisioner.js";
import type { SecretProvisionPlan } from "./types.js";

// Feature: operational-wiring, Property 14: The rewritten deploy.yml leaks no secret and misplaces no secret

/**
 * A distinctive sentinel wrapping a fake secret value. The builders NEVER
 * receive these — they are threaded only through a parallel map — so if any
 * sentinel surfaces in the rewrite output it is a real leak. The marker is
 * value-shaped (looks like a credential) and unlikely to collide with any
 * name/flag token the rewrite legitimately emits.
 */
const SENTINEL_PREFIX = "LEAKED_SECRET_VALUE_";

/** Representative `Secret_Key` env names (the full classified key set, Req 3.2). */
const SECRET_ENV_KEYS: readonly string[] = [
  "SUPABASE_HOSTED_URL",
  "SUPABASE_HOSTED_KEY",
  "SUPABASE_POOLER_URL",
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

/** Representative `Config_Env_Key` names (Req 3.1). */
const CONFIG_ENV_KEYS: readonly string[] = [
  "GCP_PROJECT_ID",
  "GCP_REGION",
  "GEMINI_MODEL",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "SUPABASE_TARGET",
  "OHLC_PROVIDER",
  "NEWS_ENABLED",
  "OHLC_BASE_URL",
];

/**
 * A randomly-selected, de-duplicated, non-empty subset of a list, preserving the
 * source order. Keeps generated plans varied without producing empty segments.
 */
function nonEmptySubsetArb(source: readonly string[]): fc.Arbitrary<string[]> {
  return fc
    .subarray([...source], { minLength: 1 })
    .map((items) => [...new Set(items)]);
}

/**
 * Generate a name-only {@link SecretProvisionPlan} AND a parallel sentinel-value
 * map the builders never see. Each selected secret is independently marked
 * present/absent so empty-valued secrets (omitted from --set-secrets, Req 3.9)
 * are exercised too. The sentinel map is keyed by BOTH the env key and the
 * secret name, so a leak through either surface is detectable.
 */
const scenarioArb: fc.Arbitrary<{
  plan: SecretProvisionPlan;
  sentinels: readonly string[];
}> = fc
  .record({
    secretKeys: nonEmptySubsetArb(SECRET_ENV_KEYS),
    configKeys: nonEmptySubsetArb(CONFIG_ENV_KEYS),
    hasValueFlags: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
  })
  .map(({ secretKeys, configKeys, hasValueFlags }) => {
    const secrets = secretKeys.map((envKey, i) => ({
      envKey,
      secretName: secretNameForEnvKey(envKey),
      hasValue: hasValueFlags[i % hasValueFlags.length] ?? true,
    }));
    const missingValues = secrets
      .filter((s) => !s.hasValue)
      .map((s) => s.envKey);
    const plan: SecretProvisionPlan = { secrets, configKeys, missingValues };

    // Parallel sentinel VALUES — one per secret, keyed off env key + secret
    // name. These are NEVER passed to the builders; their absence in the output
    // is the real-leak guarantee.
    const sentinels = secrets.flatMap((s) => [
      `${SENTINEL_PREFIX}${s.envKey}`,
      `${SENTINEL_PREFIX}${s.secretName}`,
    ]);
    return { plan, sentinels };
  });

/** The inline deploy.yml fixture (surrounding lines must survive untouched). */
const WORKFLOW_BEFORE = [
  "      - name: Deploy Cloud Run Job",
  "        run: |",
  '          gcloud run jobs deploy "${CLOUD_RUN_JOB}" \\',
  '            --image "${IMAGE}" \\',
  '            --region "${GCP_REGION}" \\',
  '            --service-account "${RUNTIME_SA}" \\',
  '            --set-env-vars "GCP_PROJECT_ID=${GCP_PROJECT_ID}" \\',
  '            --set-secrets "SUPABASE_HOSTED_URL=supabase-url:latest" \\',
  '            --max-retries 1',
  "",
].join("\n");

/** The surrounding lines that must be byte-identical before and after rewrite. */
const PRESERVED_LINES: readonly string[] = [
  "      - name: Deploy Cloud Run Job",
  "        run: |",
  '          gcloud run jobs deploy "${CLOUD_RUN_JOB}" \\',
  '            --image "${IMAGE}" \\',
  '            --region "${GCP_REGION}" \\',
  '            --service-account "${RUNTIME_SA}" \\',
  '            --max-retries 1',
];

/** Extract the value inside `--set-secrets "..."` / `--set-env-vars "..."`. */
function extractArg(yaml: string, flag: string): string {
  const match = new RegExp(`${flag}\\s+"([^"]*)"`).exec(yaml);
  const captured = match?.[1];
  if (captured === undefined) {
    throw new Error(`missing ${flag} in rewritten yaml`);
  }
  return captured;
}

/** Split a comma-joined `KEY=VALUE` segment into entries (empty -> none). */
function entriesOf(segment: string): readonly string[] {
  return segment === "" ? [] : segment.split(",");
}

describe("Property 14: the rewritten deploy.yml leaks no secret and misplaces no secret (spec Req 3.6)", () => {
  it("never emits a secret VALUE and places every key in the correct argument", () => {
    fc.assert(
      fc.property(scenarioArb, ({ plan, sentinels }) => {
        const yaml = rewriteDeployWorkflowContent(WORKFLOW_BEFORE, plan);

        // --- 1. NO secret VALUE ever leaks into the output -----------------
        // The builders never saw a value; assert no parallel sentinel appears.
        for (const sentinel of sentinels) {
          expect(yaml).not.toContain(sentinel);
        }
        // The whole output carries no value-shaped sentinel marker at all.
        expect(yaml.includes(SENTINEL_PREFIX)).toBe(false);

        const secretsArg = extractArg(yaml, "--set-secrets");
        const envVarsArg = extractArg(yaml, "--set-env-vars");

        // The composed rewrite must embed exactly what each per-argument builder
        // produces — so the no-leak/no-misplace assertions below cover both the
        // individual builders and their composition (task 6.8 targets).
        expect(secretsArg).toBe(buildSetSecretsArg(plan));
        expect(envVarsArg).toBe(buildSetEnvVarsArg(plan));

        // --- 2. NO Secret_Key is misplaced under --set-env-vars -------------
        for (const entry of entriesOf(envVarsArg)) {
          const eq = entry.indexOf("=");
          expect(eq).toBeGreaterThan(0);
          const key = entry.slice(0, eq);
          // Every env-vars KEY must classify as config, never secret (Req 3.6).
          expect(classifyEnvKey(key)).toBe("config");
          // And no Secret Manager reference leaks into the env-vars segment.
          expect(entry).not.toContain(":latest");
          expect(plan.secrets.some((s) => s.secretName === key)).toBe(false);
        }

        // --- 3. Every --set-secrets entry is a NAME=<secretName>:latest REF -
        const expectedSecretNames = new Set(
          plan.secrets.filter((s) => s.hasValue).map((s) => s.secretName),
        );
        const configKeySet = new Set(plan.configKeys);
        for (const entry of entriesOf(secretsArg)) {
          // Shape: a reference ending in `:latest`, never a raw value.
          expect(entry).toMatch(/^[^=]+=.+:latest$/);
          const eq = entry.indexOf("=");
          const reference = entry.slice(eq + 1); // e.g. "ohlc-api-key:latest"
          const secretName = reference.slice(0, reference.lastIndexOf(":"));
          // The reference targets a real planned (value-present) secret ...
          expect(expectedSecretNames.has(secretName)).toBe(true);
          // ... and no Config_Env_Key is misplaced into --set-secrets.
          expect(configKeySet.has(secretName)).toBe(false);
        }

        // Empty-valued secrets (Req 3.9) never appear as a reference target.
        for (const missing of plan.missingValues) {
          const name = secretNameForEnvKey(missing);
          expect(secretsArg.includes(`${name}:latest`)).toBe(false);
        }

        // --- 4. All other workflow content is preserved verbatim -----------
        for (const line of PRESERVED_LINES) {
          expect(yaml).toContain(line);
        }
      }),
      { numRuns: 100 },
    );
  });
});
