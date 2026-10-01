// SchedulerProvisioner — shared types (spec Req 5, design Component 6).
//
// Compute/storage separation (parent Req 17) and secret confidentiality
// (spec Req 6.2): NO shape in this module carries a `Secret_Key` *value*. The
// SchedulerProvisioner provisions exactly ONE daily Cloud Scheduler job that
// triggers the deployed Cloud_Run_Job, gated on a successful Deploy_Verification
// (spec Req 5.3). Every shape here is a pure, name-only in-memory description —
// a cron expression, a timezone, a committed-artifact approach, and
// service-account / resource identities by name — never a secret value.

/**
 * The single committed, version-controlled artifact approach the Scheduler_Job
 * provisioning is expressed as (spec Req 5.4). Exactly one of:
 *  - `"workflow-step"`      — a `gcloud scheduler` step in a CI workflow;
 *  - `"committed-config"`   — a committed configuration or Terraform file;
 *  - `"documented-command"` — a documented manual command committed to the repo.
 * The same artifact records WHICH approach was used (spec Req 5.4).
 */
export type SchedulerArtifactApproach =
  | "workflow-step"
  | "committed-config"
  | "documented-command";

/**
 * The cron schedule for the single daily trigger (spec Req 5.1, 5.2):
 * `0 17 * * *` — 17:00 every day, interpreted in the plan's `timeZone`.
 */
export const DAILY_SESSION_CLOSE_SCHEDULE = "0 17 * * *" as const;

/**
 * The timezone the schedule is interpreted in (spec Req 5.2). Using the IANA
 * zone `America/New_York` (rather than a fixed UTC offset) lets Cloud Scheduler
 * resolve the fire time automatically across DST — 22:00 UTC during US Eastern
 * Standard Time and 21:00 UTC during US Eastern Daylight Time — so the trigger
 * always lands at the 17:00 America/New_York Session_Close.
 */
export const SESSION_CLOSE_TIME_ZONE = "America/New_York" as const;

/**
 * The number of retry attempts configured on the Scheduler_Job itself when a
 * trigger fails to invoke the Cloud_Run_Job (spec Req 5.6).
 */
export const SCHEDULER_MAX_RETRY_ATTEMPTS = 3 as const;

/**
 * The single role granted to the Scheduler_Job's invoker identity on the
 * Cloud_Run_Job — and the ONLY role it is granted (spec Req 5.7). No broader or
 * additional role is ever granted to that identity.
 */
export const RUN_INVOKER_ROLE = "roles/run.invoker" as const;

/**
 * The name-only plan for the single daily Scheduler_Job (design Component 6,
 * spec Req 5.1, 5.2, 5.4, 5.7).
 *
 * NAME-ONLY: carries a cron expression, an IANA timezone, the chosen committed-
 * artifact approach, and the least-privilege invoker service-account identity
 * by NAME — never a `Secret_Key` value (spec Req 6.2).
 */
export interface SchedulerPlan {
  /** The cron schedule for the single daily trigger — `0 17 * * *`
   *  (spec Req 5.1, 5.2). */
  readonly schedule: string;
  /** The IANA timezone the schedule is interpreted in, pinned to
   *  `America/New_York` so DST resolves automatically (spec Req 5.2). */
  readonly timeZone: typeof SESSION_CLOSE_TIME_ZONE;
  /** Which of the three committed-artifact approaches is used (spec Req 5.4). */
  readonly artifactApproach: SchedulerArtifactApproach;
  /** The least-privilege invoker identity (service-account email) the
   *  Scheduler_Job uses to invoke the Cloud_Run_Job; granted ONLY
   *  `roles/run.invoker` (spec Req 5.7). */
  readonly invokerServiceAccount: string;
}

/**
 * The deployed Cloud_Run_Job the Scheduler_Job triggers, by name only
 * (spec Req 5.1). These are non-secret GCP resource identifiers — the project,
 * region, and Job name — mirroring the identifiers `deploy.yml` already uses.
 */
export interface SchedulerTarget {
  /** The `GCP_PROJECT_ID` the Cloud_Run_Job lives in. */
  readonly projectId: string;
  /** The `GCP_REGION` the Cloud_Run_Job and Scheduler_Job live in. */
  readonly region: string;
  /** The Cloud_Run_Job name to trigger (the `CLOUD_RUN_JOB` from `deploy.yml`). */
  readonly jobName: string;
  /** The Scheduler_Job name to create (defaults derived from `jobName`). */
  readonly schedulerJobName: string;
}

/**
 * A single planned `gcloud` command for Scheduler provisioning (design
 * Component 6). NAME-ONLY like every shape here: `argv` carries only names,
 * flags, and resource references — never a `Secret_Key` value (spec Req 6.2).
 *
 * Two commands make up a Scheduler provisioning:
 *  - `"grant-invoker"` — grant the invoker identity ONLY `roles/run.invoker` on
 *    the Cloud_Run_Job (spec Req 5.7);
 *  - `"create-job"`    — create the single daily `scheduler jobs create http`
 *    job with the America/New_York timezone and `--max-retry-attempts=3`
 *    (spec Req 5.1, 5.2, 5.6).
 */
export type SchedulerCommandKind = "grant-invoker" | "create-job";

/** A name-only planned `gcloud` command for Scheduler provisioning. */
export interface SchedulerCommand {
  /** Which provisioning step this command performs. */
  readonly kind: SchedulerCommandKind;
  /** The exact `gcloud` argument vector — NAMES AND FLAGS ONLY, no secret
   *  value (the leading `gcloud` is implicit; the {@link GcloudRunner} prepends
   *  it). */
  readonly argv: readonly string[];
  /** The named resource this command affects, for the operator-approval
   *  warning (spec Req 6.5). */
  readonly affectedResource: string;
}

/**
 * The outcome of {@link SchedulerProvisioner.create} (design Component 6,
 * spec Req 5.3, 5.6).
 *
 * When the Deploy_Verification prerequisite was NOT met (`verify.ok === false`),
 * `ok` is `false`, `created` is `false`, NO command was constructed or run, and
 * `prerequisiteUnmet` surfaces the unmet-prerequisite indication (spec Req 5.3).
 * NAME-ONLY: carries the Scheduler_Job name and a short, non-secret reason —
 * never a `Secret_Key` value (spec Req 6.2).
 */
export interface SchedulerCreateResult {
  /** True iff the Scheduler_Job was created (which requires `verify.ok`). */
  readonly ok: boolean;
  /** Whether the create command was actually constructed and run. False when
   *  the verify gate refused or the operator declined (spec Req 5.3). */
  readonly created: boolean;
  /** The Scheduler_Job name targeted, or `null` when nothing was created. */
  readonly schedulerJobName: string | null;
  /** The unmet Deploy_Verification prerequisite indication, present ONLY when
   *  `verify.ok` was false (spec Req 5.3). Absent on a met prerequisite. */
  readonly prerequisiteUnmet?: string;
  /** A short, non-secret description of why creation did not proceed (verify
   *  gate refused, target mismatch, or operator declined). Absent on success. */
  readonly refusedReason?: string;
}
