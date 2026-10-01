// DeployVerifier — shared types (spec Req 4, design Component 5).
//
// Compute/storage separation (parent Req 17) and secret confidentiality
// (spec Req 4.6, 6.2): NO shape in this module carries a `Secret_Key` *value*.
// The pure predicates in `verifier.ts` operate only over execution-status and
// prerequisite-presence inputs — task counts, elapsed time, failure flags, and
// name-only presence booleans — and the recorded `DeployVerifyResult` carries
// only an execution id and a Cloud Logging reference, never a secret value
// (spec Req 4.6). The live `gcloud` calls (task 7.5) live elsewhere; everything
// here is pure, deterministic, and injectable.

/**
 * The 300-second completion window a Deploy_Verification waits on
 * (spec Req 4.2). An execution whose `elapsedMs` exceeds this threshold is a
 * timeout failure even if its task counts would otherwise match.
 */
export const DEPLOY_VERIFY_TIMEOUT_MS = 300_000 as const;

/**
 * The recorded outcome of a Deploy_Verification (design Component 5,
 * spec Req 4.4, 4.6).
 *
 * NAME-ONLY / reference-only: carries the execution id and the Cloud Logging
 * reference so the operator can inspect a run, but NEVER a `Secret_Key` value
 * (spec Req 4.6). On a failure, `ok` is `false` and the identifiers
 * (`executionId`, `logReference`) are present so the failed run is locatable
 * (spec Req 4.4); `failureReason` carries a short, non-secret description of
 * why the run was treated as a failure.
 *
 * Fields are `null` (rather than absent) when the corresponding datum is
 * unknown — e.g. a prerequisite-blocked verification never produces an
 * execution id or task counts.
 */
export interface DeployVerifyResult {
  /** True iff the execution succeeded within the completion window
   *  (spec Req 4.2). */
  readonly ok: boolean;
  /** The Cloud Run Job execution id, or `null` when no execution ran. */
  readonly executionId: string | null;
  /** The execution's succeeded task count, or `null` when unknown. */
  readonly succeededTaskCount: number | null;
  /** The execution's total task count, or `null` when unknown. */
  readonly taskCount: number | null;
  /** The Cloud Logging reference for the execution (spec Req 4.4, 4.6), or
   *  `null` when no execution ran. Never a `Secret_Key` value (spec Req 4.6). */
  readonly logReference: string | null;
  /** A short, non-secret description of why the run was treated as a failure.
   *  Absent on success. */
  readonly failureReason?: string;
}

/**
 * The PURE input to the success predicate (design Component 5, spec Req 4.2,
 * 4.4). It carries only the facts the live `gcloud run jobs executions
 * describe` / `--wait` surface would yield — the execution id, its task counts,
 * how long the completion wait took, whether the execution itself reported a
 * failure, and the Cloud Logging reference — and NO `Secret_Key` value
 * (spec Req 4.6). The predicate is a pure function of this shape.
 */
export interface ExecutionStatus {
  /** The Cloud Run Job execution id (spec Req 4.4). */
  readonly executionId: string;
  /** Tasks that reported success for this execution. */
  readonly succeededTaskCount: number;
  /** Total tasks the execution was expected to run. */
  readonly taskCount: number;
  /** Elapsed time (ms) spent waiting for the execution to complete; a value
   *  greater than {@link DEPLOY_VERIFY_TIMEOUT_MS} is a timeout failure
   *  (spec Req 4.2). */
  readonly elapsedMs: number;
  /** Whether the execution itself reported a failure (as opposed to a short
   *  succeeded count or a timeout) — e.g. a non-zero exit / `Failed` condition
   *  on the execution (spec Req 4.4). */
  readonly executionFailed: boolean;
  /** The Cloud Logging reference for the execution (spec Req 4.4, 4.6). Never a
   *  `Secret_Key` value. */
  readonly logReference: string;
}

/**
 * The PURE input to {@link checkPrerequisites} (design Component 5,
 * spec Req 4.5). Presence FLAGS only — whether the required secrets exist and
 * whether the `roles/secretmanager.secretAccessor` grant for the
 * `Runtime_Service_Account` is present — and the SA identity by name. No secret
 * value is ever carried here (spec Req 4.6, 6.2).
 */
export interface PrerequisiteStatus {
  /** The `Runtime_Service_Account` the Cloud_Run_Job runs as (name/email
   *  only). */
  readonly runtimeServiceAccount: string;
  /** Whether every required `Secret_Key` secret exists in Secret Manager
   *  (spec Req 3.2, 4.5). Presence only — never a value. */
  readonly requiredSecretsPresent: boolean;
  /** Whether the `roles/secretmanager.secretAccessor` grant for the
   *  `Runtime_Service_Account` is present (spec Req 3.4, 4.5). */
  readonly accessorGrantPresent: boolean;
}

/**
 * The outcome of {@link checkPrerequisites} (design Component 5, spec Req 4.5).
 * When a prerequisite is absent, `ok` is `false` and `missing` names the
 * SPECIFIC missing item (`"required secrets"` or `"accessor grant"`) so the
 * operator sees the real blocker rather than an ambiguous execution failure
 * (spec Req 4.5). On success `ok` is `true` and `missing` is absent.
 */
export interface PrerequisiteCheck {
  /** True iff every verification prerequisite is present. */
  readonly ok: boolean;
  /** The specific missing prerequisite, when `ok` is `false` (spec Req 4.5). */
  readonly missing?: string;
}

/** The specific missing-prerequisite labels surfaced by
 *  {@link checkPrerequisites} (spec Req 4.5). Named constants keep the surfaced
 *  item identifiable and stable for callers and tests. */
export const MISSING_REQUIRED_SECRETS = "required secrets" as const;
export const MISSING_ACCESSOR_GRANT = "accessor grant" as const;
