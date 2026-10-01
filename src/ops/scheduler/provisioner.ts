// SchedulerProvisioner — SchedulerPlan + the verify-gate predicate and command
// planning (task 8.1, spec Req 5.1, 5.2, 5.3, 5.6, 5.7; design Component 6).
//
// Scope here is task 8.1: the name-only `SchedulerPlan`, the PURE command
// planners (`planGrantInvokerCommand`, `planCreateJobCommand`), the PURE
// verify-gate predicate (`gateCreate`), and the thin class wiring of `create`
// through the OperationalSafety guard. The committed IaC artifact
// (`writeArtifact`) is task 8.4, and the LIVE operator-approved job creation is
// task 8.5 — neither is implemented here beyond the scaffolded method shape.
//
// Secret confidentiality (spec Req 6.2, 6.3): a service-account identity, a cron
// expression, a timezone, and GCP resource names are NOT `Secret_Key` values;
// nothing here reads, carries, or emits a secret value. Every command places
// only names/flags on argv.

import type { DeployVerifyResult } from "../deploy-verify/types.js";
import type { GcloudRunner, OperationalSafety } from "../safety/types.js";
import { writeFile } from "node:fs/promises";
import {
  DAILY_SESSION_CLOSE_SCHEDULE,
  RUN_INVOKER_ROLE,
  SCHEDULER_MAX_RETRY_ATTEMPTS,
  SESSION_CLOSE_TIME_ZONE,
  type SchedulerArtifactApproach,
  type SchedulerCommand,
  type SchedulerCreateResult,
  type SchedulerPlan,
  type SchedulerTarget,
} from "./types.js";

/** The IAM-member prefix for a service-account principal in a binding/argv. */
const SERVICE_ACCOUNT_MEMBER_PREFIX = "serviceAccount:";

/**
 * Normalize an invoker `invokerServiceAccount` into the `serviceAccount:<email>`
 * member string used in the `roles/run.invoker` grant argv. Accepts either a
 * bare email or an already-prefixed member; the result always carries exactly
 * one prefix. Mirrors `serviceAccountMember` in the secret-manager module.
 */
export function serviceAccountMember(invokerServiceAccount: string): string {
  const trimmed = invokerServiceAccount.trim();
  if (trimmed.startsWith(SERVICE_ACCOUNT_MEMBER_PREFIX)) return trimmed;
  return `${SERVICE_ACCOUNT_MEMBER_PREFIX}${trimmed}`;
}

/**
 * The Cloud Run Admin API URI the Scheduler_Job calls to trigger a one-off
 * execution of the Cloud_Run_Job (`jobs.run`). This is a non-secret resource
 * URL; the invoker identity authenticates to it via its OAuth token (which is
 * why it is granted `roles/run.invoker`, spec Req 5.7).
 */
export function runJobTriggerUri(target: SchedulerTarget): string {
  return (
    `https://${target.region}-run.googleapis.com/v2/projects/` +
    `${target.projectId}/locations/${target.region}/jobs/` +
    `${target.jobName}:run`
  );
}

/**
 * PURE planner for the least-privilege invoker grant (spec Req 5.7). Builds the
 * names-only argv that grants the invoker identity ONLY `roles/run.invoker` on
 * the Cloud_Run_Job — no broader or additional role:
 *
 *   gcloud run jobs add-iam-policy-binding <job>
 *     --member=serviceAccount:<invoker> --role=roles/run.invoker
 *     --project=<project> --region=<region>
 *
 * (the leading `gcloud` is implicit — the {@link GcloudRunner} prepends it).
 * No secret VALUE is ever present (spec Req 6.2).
 */
export function planGrantInvokerCommand(
  plan: SchedulerPlan,
  target: SchedulerTarget,
): SchedulerCommand {
  const argv: string[] = [
    "run",
    "jobs",
    "add-iam-policy-binding",
    target.jobName,
    `--member=${serviceAccountMember(plan.invokerServiceAccount)}`,
    `--role=${RUN_INVOKER_ROLE}`,
    `--project=${target.projectId}`,
    `--region=${target.region}`,
  ];
  return {
    kind: "grant-invoker",
    argv,
    affectedResource: `Cloud Run Job "${target.jobName}" (grant ${RUN_INVOKER_ROLE} to ${plan.invokerServiceAccount})`,
  };
}

/**
 * PURE planner for the single daily Scheduler_Job (spec Req 5.1, 5.2, 5.6).
 * Builds the names-only `gcloud scheduler jobs create http` argv configuring
 * EXACTLY ONE daily job: the `0 17 * * *` schedule in the `America/New_York`
 * timezone (so DST resolves automatically), an HTTP POST to the Cloud Run
 * Admin API `jobs.run` endpoint authenticated as the least-privilege invoker
 * identity, and `--max-retry-attempts=3` for retry-on-trigger-failure:
 *
 *   gcloud scheduler jobs create http <scheduler-job>
 *     --schedule="0 17 * * *" --time-zone="America/New_York"
 *     --uri=<run jobs.run URI> --http-method=POST
 *     --oauth-service-account-email=<invoker>
 *     --max-retry-attempts=3
 *     --project=<project> --location=<region>
 *
 * (the leading `gcloud` is implicit — the {@link GcloudRunner} prepends it).
 * No secret VALUE is ever present (spec Req 6.2).
 */
export function planCreateJobCommand(
  plan: SchedulerPlan,
  target: SchedulerTarget,
): SchedulerCommand {
  const argv: string[] = [
    "scheduler",
    "jobs",
    "create",
    "http",
    target.schedulerJobName,
    `--schedule=${plan.schedule}`,
    `--time-zone=${plan.timeZone}`,
    `--uri=${runJobTriggerUri(target)}`,
    "--http-method=POST",
    `--oauth-service-account-email=${plan.invokerServiceAccount}`,
    `--max-retry-attempts=${SCHEDULER_MAX_RETRY_ATTEMPTS}`,
    `--project=${target.projectId}`,
    `--location=${target.region}`,
  ];
  return {
    kind: "create-job",
    argv,
    affectedResource: `Cloud Scheduler job "${target.schedulerJobName}"`,
  };
}

/**
 * The result of the PURE verify gate (spec Req 5.3). When the Deploy_
 * Verification prerequisite was met the gate `allow`s and carries the ordered
 * commands to run; otherwise it refuses, carrying the unmet-prerequisite
 * indication so the caller surfaces WHY the Scheduler_Job was not created.
 */
export type GateDecision =
  | { readonly allow: true; readonly commands: readonly SchedulerCommand[] }
  | { readonly allow: false; readonly prerequisiteUnmet: string };

/**
 * PURE verify-gate predicate (spec Req 5.3; design Property 20).
 *
 * Decide WHETHER to construct the Scheduler provisioning commands based solely
 * on the recorded {@link DeployVerifyResult}. The commands are built IF AND
 * ONLY IF `verify.ok === true`; otherwise the gate refuses WITHOUT constructing
 * any command, surfacing an indication that the Deploy_Verification prerequisite
 * was not met (spec Req 5.3). The surfaced indication reuses `verify.failureReason`
 * when present so the operator sees the real blocker.
 *
 * This function performs NO I/O and is a pure function of the plan, target, and
 * verify result — so the gate is unit- and property-testable in isolation
 * (Property 20 verifies "scheduler creation is gated on a successful verify").
 */
export function gateCreate(
  plan: SchedulerPlan,
  target: SchedulerTarget,
  verify: DeployVerifyResult,
): GateDecision {
  if (!verify.ok) {
    const detail =
      verify.failureReason !== undefined && verify.failureReason.trim() !== ""
        ? `: ${verify.failureReason}`
        : "";
    return {
      allow: false,
      prerequisiteUnmet:
        `Deploy_Verification prerequisite not met${detail} — refusing to ` +
        `create Scheduler job "${target.schedulerJobName}" (spec Req 5.3)`,
    };
  }
  // Grant the least-privilege invoker role FIRST, then create the job that uses
  // that identity.
  return {
    allow: true,
    commands: [
      planGrantInvokerCommand(plan, target),
      planCreateJobCommand(plan, target),
    ],
  };
}

/**
 * Build the canonical {@link SchedulerPlan} for the daily Session_Close trigger
 * (spec Req 5.1, 5.2, 5.7). Pins the `0 17 * * *` schedule and the
 * `America/New_York` timezone; the caller supplies the committed-artifact
 * approach (spec Req 5.4) and the least-privilege invoker identity (spec Req 5.7).
 */
export function buildSchedulerPlan(
  artifactApproach: SchedulerPlan["artifactApproach"],
  invokerServiceAccount: string,
): SchedulerPlan {
  return {
    schedule: DAILY_SESSION_CLOSE_SCHEDULE,
    timeZone: SESSION_CLOSE_TIME_ZONE,
    artifactApproach,
    invokerServiceAccount,
  };
}

/** Repo-relative path of the single committed, version-controlled Scheduler_Job
 *  IaC artifact written by {@link SchedulerProvisioner.writeArtifact} (task 8.4,
 *  spec Req 5.4). Injectable via a parameter for tests. */
export const DEFAULT_SCHEDULER_ARTIFACT_PATH = "ops/scheduler-job.config.json";

/**
 * Human-readable label for each committed-artifact approach (spec Req 5.4). The
 * artifact records BOTH the machine key (`plan.artifactApproach`) and this label
 * so a reader sees WHICH of the three approaches was used.
 */
const ARTIFACT_APPROACH_LABEL: Readonly<
  Record<SchedulerArtifactApproach, string>
> = {
  "workflow-step": "gcloud scheduler step in the CI workflow",
  "committed-config": "committed configuration or Terraform file",
  "documented-command": "documented manual command committed to the repository",
};

/**
 * PURE builder for the single committed IaC artifact's JSON content (spec Req
 * 5.4) — no I/O, so it is unit-testable in isolation.
 *
 * Records (a) WHICH of the three approaches was used — the machine key from
 * `plan.artifactApproach` plus a human-readable label — and (b) the EXACT
 * provisioning commands. The exact commands are reconstructed from the SAME pure
 * planners the live path uses ({@link planGrantInvokerCommand} and
 * {@link planCreateJobCommand}), so the artifact and the executed commands share
 * a single source of truth. The displayed string mirrors the operator-approval
 * form (`"gcloud " + argv.join(" ")`).
 *
 * NO secret VALUE appears in the content — only names, flags, the cron schedule,
 * the timezone, the approach label, the least-privilege `roles/run.invoker`
 * grant, and `--max-retry-attempts=3` (spec Req 5.4, 6.2).
 */
export function buildArtifactContent(
  plan: SchedulerPlan,
  target: SchedulerTarget,
): string {
  const grant = planGrantInvokerCommand(plan, target);
  const createJob = planCreateJobCommand(plan, target);
  const content = {
    description:
      "Single committed, version-controlled artifact provisioning the daily " +
      "Session_Close Scheduler_Job that triggers the Cloud_Run_Job (spec Req 5.4).",
    artifactApproach: plan.artifactApproach,
    artifactApproachLabel: ARTIFACT_APPROACH_LABEL[plan.artifactApproach],
    schedulerJobName: target.schedulerJobName,
    schedule: plan.schedule,
    timeZone: plan.timeZone,
    maxRetryAttempts: SCHEDULER_MAX_RETRY_ATTEMPTS,
    invokerServiceAccount: plan.invokerServiceAccount,
    invokerRole: RUN_INVOKER_ROLE,
    commands: [
      {
        kind: grant.kind,
        affectedResource: grant.affectedResource,
        command: `gcloud ${grant.argv.join(" ")}`,
      },
      {
        kind: createJob.kind,
        affectedResource: createJob.affectedResource,
        command: `gcloud ${createJob.argv.join(" ")}`,
      },
    ],
  };
  return `${JSON.stringify(content, null, 2)}\n`;
}

/**
 * SchedulerProvisioner (design Component 6). Creates EXACTLY ONE daily Cloud
 * Scheduler job that triggers the deployed Cloud_Run_Job, gated on a successful
 * Deploy_Verification (spec Req 5.3). This subtask (8.1) implements the plan,
 * the pure command planners, and the verify-gate wiring of `create`; the
 * committed IaC artifact (`writeArtifact`) is task 8.4 and the live
 * operator-approved creation beyond the guard flow is task 8.5.
 *
 * The constructor matches the design signature so the later subtasks can wire
 * the injected {@link GcloudRunner} / {@link OperationalSafety} without changing
 * the public shape.
 */
export class SchedulerProvisioner {
  constructor(
    private readonly runner: GcloudRunner,
    private readonly safety: OperationalSafety,
  ) {}

  /**
   * Refuse to create the Scheduler_Job unless DeployVerifier reported success,
   * surfacing the unmet prerequisite otherwise (spec Req 5.3). When the gate
   * allows, each planned `Live_Cloud_Command` passes through the
   * {@link OperationalSafety} guard — reconcile the target, then present each
   * command for operator approval — before the injected {@link GcloudRunner}
   * runs it (spec Req 6.1, 6.4). The command-construction / verify-gate decision
   * is the PURE {@link gateCreate}, so it stays testable in isolation.
   *
   * No secret value is ever read or passed through the runner — every argv is
   * names/flags only (spec Req 6.2).
   */
  async create(
    plan: SchedulerPlan,
    verify: DeployVerifyResult,
    target: SchedulerTarget,
  ): Promise<SchedulerCreateResult> {
    const decision = gateCreate(plan, target, verify);

    // Verify gate refused: NO command is constructed or run (spec Req 5.3).
    if (!decision.allow) {
      return {
        ok: false,
        created: false,
        schedulerJobName: null,
        prerequisiteUnmet: decision.prerequisiteUnmet,
      };
    }

    // Reconcile the active project/account against the target before any
    // Live_Cloud_Command (spec Req 6.4).
    const reconcile = await this.safety.reconcileTarget(target.projectId);
    if (!reconcile.ok) {
      return {
        ok: false,
        created: false,
        schedulerJobName: null,
        refusedReason: `target reconciliation failed: ${reconcile.mismatch}`,
      };
    }

    // Present each command for approval, then run it. Any decline halts before
    // running (spec Req 6.1).
    for (const command of decision.commands) {
      const approved = await this.safety.confirm({
        displayCommand: `gcloud ${command.argv.join(" ")}`,
        destructive: true,
        affectedResource: command.affectedResource,
      });
      if (!approved) {
        return {
          ok: false,
          created: false,
          schedulerJobName: null,
          refusedReason: `operator declined the ${command.kind} command`,
        };
      }
      await this.runner.run(command.argv);
    }

    return {
      ok: true,
      created: true,
      schedulerJobName: target.schedulerJobName,
    };
  }

  /**
   * Emit EXACTLY ONE committed, version-controlled IaC artifact recording WHICH
   * of the three approaches was used and the EXACT provisioning command (task
   * 8.4, spec Req 5.4). The default path is the repository artifact
   * ({@link DEFAULT_SCHEDULER_ARTIFACT_PATH}); `artifactPath` is injectable for
   * tests.
   *
   * This method does ONLY the file write; the content is the pure
   * {@link buildArtifactContent}, which reuses the SAME planners the live path
   * uses so the recorded command is a single source of truth. NO secret value
   * ever enters the file — the content is names/flags only (spec Req 5.4, 6.2).
   */
  async writeArtifact(
    plan: SchedulerPlan,
    target: SchedulerTarget,
    artifactPath: string = DEFAULT_SCHEDULER_ARTIFACT_PATH,
  ): Promise<void> {
    const content = buildArtifactContent(plan, target);
    await writeFile(artifactPath, content, "utf8");
  }
}
