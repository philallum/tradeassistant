// SecretManagerProvisioner — accessor grant + read-back verification
// (task 6.9, spec Req 3.4; design Component 4).
//
// Two PURE pieces plus a thin class-method wiring:
//   - `planGrantCommand(...)`      builds the names-only argv for the
//     `gcloud secrets add-iam-policy-binding` grant command (no secret value).
//   - `verifyAccessorGranted(...)` is a pure predicate over a parsed IAM policy
//     (the shape `gcloud secrets get-iam-policy <secret> --format=json` returns)
//     that is true iff the accessor role binding includes the runtime SA.
//
// Secret confidentiality (spec Req 3.3, 6.2, 6.3): a service-account identity
// and an IAM role are NOT `Secret_Key` values; nothing here reads, carries, or
// emits a secret value. The grant command places only names/flags on argv.

import type { GcloudRunner, OperationalSafety } from "../safety/types.js";
import {
  SECRET_ACCESSOR_ROLE,
  type GrantVerifyResult,
  type IamPolicy,
  type SecretProvisionPlan,
} from "./types.js";

/** The IAM-member prefix for a service-account principal in a binding/argv. */
const SERVICE_ACCOUNT_MEMBER_PREFIX = "serviceAccount:";

/**
 * Normalize a `Runtime_Service_Account` into the `serviceAccount:<email>` member
 * string used both in the grant argv and when matching an IAM-policy binding.
 * Accepts either a bare email (`sa@project.iam.gserviceaccount.com`) or an
 * already-prefixed member; the result is always exactly one prefix.
 */
export function serviceAccountMember(runtimeServiceAccount: string): string {
  const trimmed = runtimeServiceAccount.trim();
  if (trimmed.startsWith(SERVICE_ACCOUNT_MEMBER_PREFIX)) return trimmed;
  return `${SERVICE_ACCOUNT_MEMBER_PREFIX}${trimmed}`;
}

/**
 * Build the PURE, names-only `gcloud` command that grants
 * `roles/secretmanager.secretAccessor` to the `Runtime_Service_Account` on one
 * secret (spec Req 3.4). The resulting argv is:
 *
 *   gcloud secrets add-iam-policy-binding <secret>
 *     --member=serviceAccount:<sa> --role=roles/secretmanager.secretAccessor
 *     [--project=<project>]
 *
 * (the leading `gcloud` is implicit — the {@link GcloudRunner} prepends it).
 * No secret VALUE is ever present: a service-account identity and a role are
 * not confidential (spec Req 3.3, 6.2). `--project` is included when provided,
 * consistent with the other provisioning commands in this module.
 *
 * This is a grant command (not a secret create/version), so unlike a
 * `PlannedCommand` it carries no stdin value; it is returned as a plain argv to
 * keep it clearly distinct from the value-piping secret commands.
 */
export function planGrantCommand(
  secretName: string,
  runtimeServiceAccount: string,
  project?: string,
): readonly string[] {
  const argv: string[] = [
    "secrets",
    "add-iam-policy-binding",
    secretName,
    `--member=${serviceAccountMember(runtimeServiceAccount)}`,
    `--role=${SECRET_ACCESSOR_ROLE}`,
  ];
  const trimmedProject = project?.trim();
  if (trimmedProject !== undefined && trimmedProject !== "") {
    argv.push(`--project=${trimmedProject}`);
  }
  return argv;
}

/**
 * Build the PURE, names-only `gcloud` command that reads one secret's IAM
 * policy back as JSON for verification (spec Req 3.4):
 *
 *   gcloud secrets get-iam-policy <secret> --format=json [--project=<project>]
 */
export function planGetIamPolicyCommand(
  secretName: string,
  project?: string,
): readonly string[] {
  const argv: string[] = [
    "secrets",
    "get-iam-policy",
    secretName,
    "--format=json",
  ];
  const trimmedProject = project?.trim();
  if (trimmedProject !== undefined && trimmedProject !== "") {
    argv.push(`--project=${trimmedProject}`);
  }
  return argv;
}

/**
 * PURE verify predicate (spec Req 3.4). Returns `true` iff the parsed IAM
 * `policy` contains a binding for `roles/secretmanager.secretAccessor` whose
 * members include the `Runtime_Service_Account` (compared as a
 * `serviceAccount:<email>` member).
 *
 * Treats a missing/empty `bindings` array, a policy with the role but without
 * the SA, or the SA present only under a different role as NOT granted — the
 * grant counts only when it is actually present on the accessor role, so
 * provisioning is never reported complete on an absent grant.
 *
 * The `secretName` parameter is accepted for call-site symmetry with
 * {@link planGrantCommand}; a single `get-iam-policy` response already scopes to
 * one secret, so the predicate only inspects the policy and the member.
 */
export function verifyAccessorGranted(
  policy: IamPolicy,
  _secretName: string,
  runtimeServiceAccount: string,
): boolean {
  const bindings = policy.bindings;
  if (bindings === undefined || bindings.length === 0) return false;

  const wantMember = serviceAccountMember(runtimeServiceAccount);
  for (const binding of bindings) {
    if (binding.role !== SECRET_ACCESSOR_ROLE) continue;
    const members = binding.members ?? [];
    if (members.includes(wantMember)) return true;
  }
  return false;
}

/**
 * Parse a `gcloud secrets get-iam-policy --format=json` stdout string into an
 * {@link IamPolicy}. Returns an empty policy (treated as "not granted") when the
 * output is empty or not valid JSON, so a verification read-back failure never
 * masquerades as a present grant.
 */
export function parseIamPolicy(stdout: string): IamPolicy {
  const trimmed = stdout.trim();
  if (trimmed === "") return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Wire the pure grant/verify pieces to a live {@link GcloudRunner} for every
 * secret-with-a-value in a {@link SecretProvisionPlan} (spec Req 3.4):
 * reconcile the target, then per secret grant the accessor role, read the IAM
 * policy back, and run {@link verifyAccessorGranted}. Provisioning is reported
 * complete (`ok:true`) ONLY when every targeted secret's read-back policy
 * actually contains the grant; any secret whose grant is absent lands in
 * `missing` and forces `ok:false`.
 *
 * Only secrets with `hasValue` are targeted — a secret that was never created
 * (empty/absent `.env` value, spec Req 3.9) has no policy to grant on.
 */
export async function grantAndVerifyAccessor(
  runner: GcloudRunner,
  safety: OperationalSafety,
  plan: SecretProvisionPlan,
  runtimeServiceAccount: string,
  project?: string,
): Promise<GrantVerifyResult> {
  const verified: string[] = [];
  const missing: string[] = [];

  const targets = plan.secrets.filter((s) => s.hasValue);

  if (project !== undefined && project.trim() !== "") {
    const reconcile = await safety.reconcileTarget(project);
    if (!reconcile.ok) {
      // Target mismatch: nothing is granted; every target is unverified.
      return {
        ok: targets.length === 0,
        verified: [],
        missing: targets.map((s) => s.secretName),
      };
    }
  }

  for (const secret of targets) {
    const grantArgv = planGrantCommand(
      secret.secretName,
      runtimeServiceAccount,
      project,
    );
    const approved = await safety.confirm({
      displayCommand: `gcloud ${grantArgv.join(" ")}`,
      destructive: true,
      affectedResource: secret.secretName,
    });
    if (!approved) {
      missing.push(secret.secretName);
      continue;
    }

    await runner.run(grantArgv);

    const readArgv = planGetIamPolicyCommand(secret.secretName, project);
    const policyOut = await runner.run(readArgv);
    const policy = parseIamPolicy(policyOut.stdout);

    if (verifyAccessorGranted(policy, secret.secretName, runtimeServiceAccount)) {
      verified.push(secret.secretName);
    } else {
      missing.push(secret.secretName);
    }
  }

  return { ok: missing.length === 0, verified, missing };
}

