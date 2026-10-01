// updateDeployWorkflow — rewrite `.github/workflows/deploy.yml` to the full
// classified key set (spec Req 3.5, 3.6; design Component 4, task 6.6).
//
// The Cloud Run Job pulls every `Secret_Key` at RUNTIME from Secret Manager via
// `--set-secrets`, and every `Config_Env_Key` via `--set-env-vars`. This module
// rewrites exactly those two argument lines of the deploy step from a name-only
// {@link SecretProvisionPlan}, surgically preserving all other workflow content.
//
// Secret confidentiality (spec Req 3.6, 6.2): NO secret VALUE ever enters this
// file. The plan is name-only (`envKey`/`secretName`/`hasValue`), so the
// rewritten `--set-secrets` references each value only as `<secretName>:latest`
// — a Secret Manager REFERENCE, never the credential — and no `Secret_Key` name
// is ever placed under `--set-env-vars`.
//
// The pure builders (`buildSetSecretsArg`, `buildSetEnvVarsArg`,
// `rewriteDeployWorkflowContent`) do no I/O so they are unit- and property-
// testable in isolation (Properties 13 and 14). Output is deterministically
// sorted so re-running the rewrite is idempotent.

import type { SecretProvisionPlan } from "./types.js";

/**
 * The runtime env-var NAME the Cloud Run Job reads for each of the three
 * established Supabase secrets. The Job reads `SUPABASE_HOSTED_URL` /
 * `SUPABASE_HOSTED_KEY` / `SUPABASE_POOLER_URL` at runtime, each sourced from
 * its differently-named Secret Manager secret (`supabase-url`, `supabase-key`,
 * `supabase-pooler-url`) — the mapping already encoded in the existing
 * `deploy.yml`. For every other `Secret_Key`, the runtime env-var name equals
 * the `.env` key name (e.g. `OHLC_API_KEY` reads from `ohlc-api-key`).
 */
const SUPABASE_RUNTIME_ENV_BY_SECRET: Readonly<Record<string, string>> = {
  "supabase-url": "SUPABASE_HOSTED_URL",
  "supabase-key": "SUPABASE_HOSTED_KEY",
  "supabase-pooler-url": "SUPABASE_POOLER_URL",
};

/**
 * `Config_Env_Key`s whose deploy.yml value is a fixed literal rather than a
 * GitHub `${...}` interpolation. `SUPABASE_TARGET` selects the hosted backend
 * for the deployed Job (the local/hosted switch; see `deploy.yml`).
 */
const CONFIG_LITERALS: Readonly<Record<string, string>> = {
  SUPABASE_TARGET: "hosted",
};

/**
 * The runtime env-var NAME a secret is injected as. The three established
 * Supabase secrets keep the Job's existing runtime names; every other secret is
 * injected under its `.env` key name (spec Req 3.5).
 */
function runtimeEnvNameForSecret(envKey: string, secretName: string): string {
  return SUPABASE_RUNTIME_ENV_BY_SECRET[secretName] ?? envKey;
}

/**
 * Build the `--set-secrets` ARGUMENT VALUE (the string inside the quotes) from a
 * name-only {@link SecretProvisionPlan} (spec Req 3.5).
 *
 * Each `Secret_Key` present with a value (`hasValue === true`) becomes a
 * `RUNTIME_ENV_NAME=<secretName>:latest` mapping — a Secret Manager REFERENCE,
 * never a value (spec Req 3.6). Secrets whose value is empty/absent are omitted
 * (they are reported in `plan.missingValues`, never provisioned — spec Req 3.9).
 * Entries are sorted by runtime env-var name so the output is deterministic and
 * re-running the rewrite is idempotent.
 */
export function buildSetSecretsArg(plan: SecretProvisionPlan): string {
  return plan.secrets
    .filter((secret) => secret.hasValue)
    .map((secret) => ({
      runtimeEnv: runtimeEnvNameForSecret(secret.envKey, secret.secretName),
      secretName: secret.secretName,
    }))
    .sort((a, b) => a.runtimeEnv.localeCompare(b.runtimeEnv))
    .map(({ runtimeEnv, secretName }) => `${runtimeEnv}=${secretName}:latest`)
    .join(",");
}

/**
 * Build the `--set-env-vars` ARGUMENT VALUE from a name-only
 * {@link SecretProvisionPlan} (spec Req 3.5, 3.6).
 *
 * Each `Config_Env_Key` becomes a `KEY=VALUE` entry whose value is NON-secret:
 * a fixed literal where one is defined (e.g. `SUPABASE_TARGET=hosted`), else the
 * GitHub interpolation form `KEY=${KEY}` matching the existing deploy.yml style
 * (the value is resolved from a GitHub `vars`/env reference at deploy time, not
 * baked in). NO `Secret_Key` is ever emitted here (spec Req 3.6). Entries are
 * sorted by key so the output is deterministic / idempotent.
 */
export function buildSetEnvVarsArg(plan: SecretProvisionPlan): string {
  return [...plan.configKeys]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const literal = CONFIG_LITERALS[key];
      const value = literal !== undefined ? literal : `\${${key}}`;
      return `${key}=${value}`;
    })
    .join(",");
}

/** Matches the `--set-env-vars "..."` argument line of the deploy step. */
const SET_ENV_VARS_LINE = /(--set-env-vars\s+")[^"]*(")/;
/** Matches the `--set-secrets "..."` argument line of the deploy step. */
const SET_SECRETS_LINE = /(--set-secrets\s+")[^"]*(")/;

/**
 * PURE string transform (task 6.6): rewrite ONLY the `--set-env-vars` and
 * `--set-secrets` argument values in a `deploy.yml` text, from a name-only
 * {@link SecretProvisionPlan}, preserving every other byte of the workflow
 * (spec Req 3.5, 3.6). No I/O — unit/property testable in isolation.
 *
 * Throws if either argument line is missing, so a malformed workflow fails loud
 * rather than silently leaving stale wiring in place.
 */
export function rewriteDeployWorkflowContent(
  yaml: string,
  plan: SecretProvisionPlan,
): string {
  if (!SET_ENV_VARS_LINE.test(yaml)) {
    throw new Error(
      "deploy.yml: could not find a --set-env-vars \"...\" argument to rewrite",
    );
  }
  if (!SET_SECRETS_LINE.test(yaml)) {
    throw new Error(
      "deploy.yml: could not find a --set-secrets \"...\" argument to rewrite",
    );
  }
  const envVars = buildSetEnvVarsArg(plan);
  const secrets = buildSetSecretsArg(plan);
  return yaml
    .replace(SET_ENV_VARS_LINE, `$1${envVars}$2`)
    .replace(SET_SECRETS_LINE, `$1${secrets}$2`);
}
