// SecretManagerProvisioner — plan construction + pure command planning
// (spec Req 3.1, 3.2, 3.8, 3.9; design Component 4). Scope here is task 6.1
// (`classifyEnvKey` in classify.ts, the name-only `plan(env)`) and task 6.4
// (the PURE idempotent create-or-version command planner,
// `planProvisionCommands`). Accessor grant (6.9), deploy.yml rewrite (6.6), and
// the LIVE execution of `provision(env)` (6.10) are later subtasks and are NOT
// built here.
//
// Secret confidentiality (spec Req 3.3, 6.2, 6.3): `plan` reads `.env` by NAME
// only. A `Secret_Key` value is never copied into the plan — `hasValue` records
// presence/non-emptiness alone, and empty/absent values are surfaced in
// `missingValues` (spec Req 3.9), never a value.

import type {
  EnvSource,
  GcloudRunner,
  OperationalSafety,
} from "../safety/types.js";
import { readFile, writeFile } from "node:fs/promises";
import { classifyEnvKey } from "./classify.js";
import { rewriteDeployWorkflowContent } from "./deployWorkflow.js";
import { grantAndVerifyAccessor as grantAndVerifyAccessorImpl } from "./grantVerify.js";
import type {
  GrantVerifyResult,
  PlannedCommand,
  PlannedSecret,
  SecretProvisionPlan,
} from "./types.js";

/**
 * Map a `Secret_Key` env name to its Secret Manager secret name.
 *
 * The three Supabase secrets already referenced by `deploy.yml` keep their
 * established names (spec Req 3.2); every other key is kebab-cased from its env
 * name (uppercase + underscores → lowercase + hyphens), e.g.
 * `OHLC_API_KEY` -> `ohlc-api-key`.
 */
export function secretNameForEnvKey(envKey: string): string {
  const DEPLOY_YML_NAMES: Readonly<Record<string, string>> = {
    SUPABASE_HOSTED_URL: "supabase-url",
    SUPABASE_HOSTED_KEY: "supabase-key",
    SUPABASE_POOLER_URL: "supabase-pooler-url",
    // The real `.env` key is `SUPABASE_POOLER` (not `SUPABASE_POOLER_URL`). Map
    // it to the ESTABLISHED secret name `supabase-pooler-url` so provisioning
    // reuses the existing Secret Manager secret the Job already references, and
    // so the Job's runtime env var resolves to `SUPABASE_POOLER_URL` via
    // deployWorkflow's SUPABASE_RUNTIME_ENV_BY_SECRET (spec Req 3.2).
    SUPABASE_POOLER: "supabase-pooler-url",
  };
  const established = DEPLOY_YML_NAMES[envKey];
  if (established !== undefined) return established;
  return envKey.toLowerCase().replace(/_/g, "-");
}

/** True when a raw `.env` value is present and non-empty (whitespace-only is
 *  treated as empty, matching the project's env-reading convention). Presence
 *  is all that is recorded — the value itself is never returned or stored. */
function hasNonEmptyValue(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== "";
}

/**
 * Build the {@link SecretProvisionPlan} from `.env` by NAME only (spec Req 3.1,
 * 3.9). Each env key is classified via {@link classifyEnvKey}; `Secret_Key`s
 * become name-only {@link PlannedSecret} entries, `Config_Env_Key`s are listed
 * by name, and any `Secret_Key` with an empty/absent value is reported in
 * `missingValues` and never slated for creation (spec Req 3.9).
 *
 * No secret value is ever read into the returned plan (spec Req 3.3, 6.2).
 */
export function plan(env: EnvSource): SecretProvisionPlan {
  const secrets: PlannedSecret[] = [];
  const configKeys: string[] = [];
  const missingValues: string[] = [];

  for (const envKey of Object.keys(env)) {
    if (classifyEnvKey(envKey) === "config") {
      configKeys.push(envKey);
      continue;
    }
    const hasValue = hasNonEmptyValue(env[envKey]);
    secrets.push({ envKey, secretName: secretNameForEnvKey(envKey), hasValue });
    if (!hasValue) missingValues.push(envKey);
  }

  return { secrets, configKeys, missingValues };
}

/** The `--data-file=-` flag that makes `gcloud` read the secret VALUE from
 *  stdin, so the value never appears in `argv` (spec Req 3.3, 6.2, 6.3). */
export const DATA_FILE_STDIN_FLAG = "--data-file=-";

/** Repo-relative path of the delivery workflow rewritten by
 *  {@link SecretManagerProvisioner.updateDeployWorkflow} (task 6.6). */
export const DEFAULT_DEPLOY_YML_PATH = ".github/workflows/deploy.yml";

/**
 * Build the `gcloud secrets create <name> --data-file=-` argv for an ABSENT
 * secret. Names and flags only — the value is supplied on stdin.
 */
function createArgv(secretName: string, projectId?: string): string[] {
  const argv = ["secrets", "create", secretName, DATA_FILE_STDIN_FLAG];
  if (projectId !== undefined && projectId.trim() !== "") {
    argv.push(`--project=${projectId}`);
  }
  return argv;
}

/**
 * Build the `gcloud secrets versions add <name> --data-file=-` argv for an
 * EXISTING secret. Names and flags only — the value is supplied on stdin.
 */
function addVersionArgv(secretName: string, projectId?: string): string[] {
  const argv = [
    "secrets",
    "versions",
    "add",
    secretName,
    DATA_FILE_STDIN_FLAG,
  ];
  if (projectId !== undefined && projectId.trim() !== "") {
    argv.push(`--project=${projectId}`);
  }
  return argv;
}

/**
 * PURE idempotent create-or-version command planner (spec Req 3.2, 3.8; design
 * Component 4, task 6.4).
 *
 * Given a name-only {@link SecretProvisionPlan} and the set of secret NAMES that
 * already exist in Secret Manager, produce the ordered list of
 * {@link PlannedCommand}s to run — WITHOUT any I/O, so it is unit- and
 * property-testable in isolation (Property 15 verifies "version-add over
 * duplicate-create").
 *
 * Per `Secret_Key` with a NON-EMPTY value (`hasValue === true`):
 *  - if its `secretName` is in `existingSecretNames` → `"add-version"`
 *    (`gcloud secrets versions add`), never a duplicate create (spec Req 3.8);
 *  - otherwise → `"create"` (`gcloud secrets create`).
 *
 * Secret_Keys with an empty/absent value are SKIPPED here — they are already
 * surfaced in `plan.missingValues` (task 6.1 / spec Req 3.9) and must never be
 * created or versioned. Every emitted command sets `valueOnStdin: true` and
 * carries the `--data-file=-` flag; the value is NEVER placed in `argv`
 * (spec Req 3.3, 6.2, 6.3).
 *
 * @param plan                The name-only plan from {@link plan}.
 * @param existingSecretNames The Secret Manager secret NAMES that already exist.
 * @param projectId           Optional `GCP_PROJECT_ID`; when provided a
 *                            `--project=<id>` flag is appended (names only).
 */
export function planProvisionCommands(
  plan: SecretProvisionPlan,
  existingSecretNames: ReadonlySet<string>,
  projectId?: string,
): PlannedCommand[] {
  const commands: PlannedCommand[] = [];
  for (const secret of plan.secrets) {
    // Empty/absent values are reported in `missingValues`, never provisioned.
    if (!secret.hasValue) continue;

    const exists = existingSecretNames.has(secret.secretName);
    const action: PlannedCommand["action"] = exists ? "add-version" : "create";
    const argv = exists
      ? addVersionArgv(secret.secretName, projectId)
      : createArgv(secret.secretName, projectId);

    commands.push({
      action,
      envKey: secret.envKey,
      secretName: secret.secretName,
      argv,
      valueOnStdin: true,
    });
  }
  return commands;
}

/**
 * SecretManagerProvisioner (design Component 4). This subtask implements the
 * name-only `plan` (6.1) and exposes the PURE command planner via
 * {@link planProvisionCommands} (6.4). The LIVE `provision(env)` wiring (6.10),
 * `grantAndVerifyAccessor` (6.9), and `updateDeployWorkflow` (6.6) arrive in
 * later subtasks.
 *
 * The constructor matches the design signature so the live-execution and grant
 * subtasks can wire the injected {@link GcloudRunner} / {@link OperationalSafety}
 * without changing the public shape; the pure planner above needs neither.
 */
export class SecretManagerProvisioner {
  constructor(
    private readonly runner: GcloudRunner,
    private readonly safety: OperationalSafety,
  ) {}

  /** Build the plan from `.env` WITHOUT reading any value into the plan. */
  plan(env: EnvSource): SecretProvisionPlan {
    return plan(env);
  }

  /**
   * PURE command planning for provisioning (task 6.4). Delegates to
   * {@link planProvisionCommands}; exposed as a method so callers holding a
   * provisioner instance can plan without reaching for the free function. The
   * LIVE execution that pipes values on stdin is task 6.10.
   */
  planCommands(
    env: EnvSource,
    existingSecretNames: ReadonlySet<string>,
    projectId?: string,
  ): PlannedCommand[] {
    return planProvisionCommands(
      this.plan(env),
      existingSecretNames,
      projectId,
    );
  }

  /**
   * Grant `roles/secretmanager.secretAccessor` to the `Runtime_Service_Account`
   * on each secret in the `.env`-derived plan, then read the IAM policy back and
   * treat provisioning complete ONLY when the grant is actually present
   * (task 6.9, spec Req 3.4). Wires the PURE {@link planGrantCommand} /
   * {@link verifyAccessorGranted} pieces (in `grantVerify.ts`) to the injected
   * {@link GcloudRunner} and {@link OperationalSafety}; it reads no secret value
   * (a service-account identity and a role are not confidential — spec Req 3.3,
   * 6.2). Returns `{ ok, verified, missing }` where `ok` is false if any
   * targeted secret's read-back policy lacks the grant.
   */
  grantAndVerifyAccessor(
    env: EnvSource,
    runtimeServiceAccount: string,
    projectId?: string,
  ): Promise<GrantVerifyResult> {
    return grantAndVerifyAccessorImpl(
      this.runner,
      this.safety,
      this.plan(env),
      runtimeServiceAccount,
      projectId,
    );
  }

  /**
   * Rewrite `.github/workflows/deploy.yml` so the Cloud Run Job deploy step's
   * `--set-secrets` injects every required `Secret_Key` from its Secret Manager
   * secret and `--set-env-vars` covers every `Config_Env_Key` (task 6.6, spec
   * Req 3.5, 3.6).
   *
   * This method does ONLY the file read/replace/write; the content transform is
   * the pure {@link rewriteDeployWorkflowContent}, which rewrites exactly the two
   * argument values and preserves all other workflow bytes. NO secret value ever
   * enters the file — the plan is name-only and secrets are referenced solely as
   * `<secretName>:latest` (spec Req 3.6, 6.2). The default path is the
   * repository workflow; `deployYmlPath` is injectable for tests.
   */
  async updateDeployWorkflow(
    plan: SecretProvisionPlan,
    deployYmlPath: string = DEFAULT_DEPLOY_YML_PATH,
  ): Promise<void> {
    const current = await readFile(deployYmlPath, "utf8");
    const rewritten = rewriteDeployWorkflowContent(current, plan);
    if (rewritten !== current) {
      await writeFile(deployYmlPath, rewritten, "utf8");
    }
  }

  /**
   * LIVE provisioning (design Component 4) — NOT implemented in this subtask.
   * The injected {@link GcloudRunner} and {@link OperationalSafety} collaborators
   * are stored for the LIVE execution subtask (6.10), which will: build the
   * plan, reconcile the target via `safety`, discover existing secrets, call the
   * pure {@link planProvisionCommands}, and run each command through `runner`
   * piping the `.env` value on stdin. It is scaffolded here as a guarded stub so
   * the constructor signature matches the design without performing any I/O.
   */
  provision(env: EnvSource): Promise<never> {
    // Reference the collaborators and arg so the scaffolded wiring is explicit;
    // the actual gcloud execution is deferred to task 6.10.
    void env;
    void this.runner;
    void this.safety;
    return Promise.reject(
      new Error(
        "SecretManagerProvisioner.provision is not implemented yet (LIVE execution is task 6.10)",
      ),
    );
  }
}
