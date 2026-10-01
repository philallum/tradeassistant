// Sanity unit test for the PURE deploy.yml rewrite builders (task 6.6, spec
// Req 3.5, 3.6). The exhaustive property tests are tasks 6.7 (Property 13 —
// covers every required key) and 6.8 (Property 14 — leaks/misplaces no secret);
// this covers representative cases: the Supabase runtime-env mapping, provider
// keys mapped under their own name, empty-valued secrets omitted, config under
// --set-env-vars only, and a surgical rewrite that preserves other content.

import { describe, expect, it } from "vitest";

import {
  buildSetEnvVarsArg,
  buildSetSecretsArg,
  rewriteDeployWorkflowContent,
} from "./deployWorkflow.js";
import type { SecretProvisionPlan } from "./types.js";

const PLAN: SecretProvisionPlan = {
  secrets: [
    // Supabase three keep the Job's established RUNTIME env names.
    { envKey: "SUPABASE_HOSTED_URL", secretName: "supabase-url", hasValue: true },
    { envKey: "SUPABASE_HOSTED_KEY", secretName: "supabase-key", hasValue: true },
    { envKey: "SUPABASE_POOLER_URL", secretName: "supabase-pooler-url", hasValue: true },
    // Provider keys map under their own .env key name.
    { envKey: "OHLC_API_KEY", secretName: "ohlc-api-key", hasValue: true },
    { envKey: "TWELVE_DATA_API_KEY", secretName: "twelve-data-api-key", hasValue: true },
    // Empty value -> omitted from --set-secrets (reported in missingValues).
    { envKey: "YIELD_API_KEY", secretName: "yield-api-key", hasValue: false },
  ],
  configKeys: ["GCP_PROJECT_ID", "GCP_REGION", "GEMINI_MODEL", "SUPABASE_TARGET"],
  missingValues: ["YIELD_API_KEY"],
};

describe("buildSetSecretsArg (pure)", () => {
  it("maps the Supabase runtime env names and provider keys, omitting empty values", () => {
    const arg = buildSetSecretsArg(PLAN);

    // Supabase three use the established runtime env var names.
    expect(arg).toContain("SUPABASE_HOSTED_URL=supabase-url:latest");
    expect(arg).toContain("SUPABASE_HOSTED_KEY=supabase-key:latest");
    expect(arg).toContain("SUPABASE_POOLER_URL=supabase-pooler-url:latest");
    // Provider keys map under their own env-key name.
    expect(arg).toContain("OHLC_API_KEY=ohlc-api-key:latest");
    expect(arg).toContain("TWELVE_DATA_API_KEY=twelve-data-api-key:latest");
    // Empty-valued secret is omitted entirely (spec Req 3.9).
    expect(arg).not.toContain("yield-api-key");
  });

  it("is deterministically sorted by runtime env name (idempotent output)", () => {
    const names = buildSetSecretsArg(PLAN)
      .split(",")
      .map((entry) => entry.slice(0, entry.indexOf("=")));
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

describe("buildSetEnvVarsArg (pure)", () => {
  it("emits every Config_Env_Key with no Secret_Key present", () => {
    const arg = buildSetEnvVarsArg(PLAN);

    expect(arg).toContain("GCP_PROJECT_ID=${GCP_PROJECT_ID}");
    expect(arg).toContain("GCP_REGION=${GCP_REGION}");
    expect(arg).toContain("GEMINI_MODEL=${GEMINI_MODEL}");
    expect(arg).toContain("SUPABASE_TARGET=hosted");
    // No Secret_Key appears under --set-env-vars (spec Req 3.6).
    expect(arg).not.toContain("API_KEY");
    expect(arg).not.toContain("supabase-url");
  });
});

describe("rewriteDeployWorkflowContent (pure)", () => {
  const WORKFLOW = [
    "          gcloud run jobs deploy \"${CLOUD_RUN_JOB}\" \\",
    "            --image \"${IMAGE}\" \\",
    '            --set-env-vars "GCP_PROJECT_ID=${GCP_PROJECT_ID},SUPABASE_TARGET=hosted" \\',
    '            --set-secrets "SUPABASE_HOSTED_URL=supabase-url:latest"',
    "",
  ].join("\n");

  it("rewrites only the two argument lines and preserves other content", () => {
    const out = rewriteDeployWorkflowContent(WORKFLOW, PLAN);

    expect(out).toContain('gcloud run jobs deploy "${CLOUD_RUN_JOB}"');
    expect(out).toContain('--image "${IMAGE}"');
    expect(out).toContain(`--set-env-vars "${buildSetEnvVarsArg(PLAN)}"`);
    expect(out).toContain(`--set-secrets "${buildSetSecretsArg(PLAN)}"`);
  });

  it("is idempotent — rewriting the output again yields identical text", () => {
    const once = rewriteDeployWorkflowContent(WORKFLOW, PLAN);
    const twice = rewriteDeployWorkflowContent(once, PLAN);
    expect(twice).toBe(once);
  });

  it("throws when an expected argument line is missing", () => {
    expect(() => rewriteDeployWorkflowContent("no args here", PLAN)).toThrow();
  });
});
