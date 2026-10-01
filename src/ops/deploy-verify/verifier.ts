// DeployVerifier — success + prerequisite predicates (task 7.1, spec Req 4;
// design Component 5).
//
// This module is PURE LOGIC ONLY: it contains the deterministic decision
// predicates that classify a Cloud_Run_Job execution as success/failure and
// that gate verification on its Secret_Manager prerequisites. The live
// `gcloud` calls (execute the Job, describe the execution, read Cloud Logging)
// are task 7.5 and live elsewhere — nothing here performs I/O.
//
// Secret confidentiality (spec Req 4.6, 6.2): no function here reads, carries,
// or emits a `Secret_Key` value. Inputs are task counts, elapsed time, failure
// flags, and name-only presence booleans; outputs carry only an execution id
// and a Cloud Logging reference.

import {
  DEPLOY_VERIFY_TIMEOUT_MS,
  MISSING_ACCESSOR_GRANT,
  MISSING_REQUIRED_SECRETS,
  type DeployVerifyResult,
  type ExecutionStatus,
  type PrerequisiteCheck,
  type PrerequisiteStatus,
} from "./types.js";

/**
 * PURE success predicate (spec Req 4.2, 4.4; design Property 17/18).
 *
 * An execution is treated as successful IF AND ONLY IF it did not itself
 * report a failure, its `succeededTaskCount` equals its `taskCount`, AND it
 * completed within the 300-second window ({@link DEPLOY_VERIFY_TIMEOUT_MS},
 * spec Req 4.2). Any other state — the execution reported a failure, the wait
 * exceeded 300 seconds, or the succeeded count is below the task count — maps
 * to a failing {@link DeployVerifyResult} with `ok:false`.
 *
 * Every result (success or failure) carries the execution id and the Cloud
 * Logging reference so a failed run is locatable (spec Req 4.4); failures also
 * carry a short, non-secret `failureReason`. No `Secret_Key` value is ever
 * read or emitted (spec Req 4.6).
 *
 * Failure precedence when several conditions hold at once is: an explicit
 * execution failure first, then a timeout, then a short succeeded count — the
 * most fundamental blocker is reported, so the operator is not misled by a
 * secondary symptom.
 */
export function evaluateExecution(status: ExecutionStatus): DeployVerifyResult {
  const {
    executionId,
    succeededTaskCount,
    taskCount,
    elapsedMs,
    executionFailed,
    logReference,
  } = status;

  const base = {
    executionId,
    succeededTaskCount,
    taskCount,
    logReference,
  } as const;

  if (executionFailed) {
    return {
      ...base,
      ok: false,
      failureReason: `execution ${executionId} reported a failure`,
    };
  }

  if (elapsedMs > DEPLOY_VERIFY_TIMEOUT_MS) {
    return {
      ...base,
      ok: false,
      failureReason:
        `execution ${executionId} exceeded the ${DEPLOY_VERIFY_TIMEOUT_MS}ms ` +
        `completion window (took ${elapsedMs}ms)`,
    };
  }

  if (succeededTaskCount !== taskCount) {
    return {
      ...base,
      ok: false,
      failureReason:
        `execution ${executionId} succeeded ${succeededTaskCount} of ` +
        `${taskCount} tasks`,
    };
  }

  return { ...base, ok: true };
}

/**
 * PURE prerequisite predicate (spec Req 4.5; design Property 19).
 *
 * Deploy_Verification depends on successful Secret_Manager provisioning: the
 * Cloud_Run_Job pulls its `Secret_Key`s at runtime (spec Req 3). This blocks
 * verification whenever the required secrets OR the
 * `roles/secretmanager.secretAccessor` grant for the `Runtime_Service_Account`
 * is absent, and surfaces the SPECIFIC missing item (`"required secrets"` or
 * `"accessor grant"`) rather than an ambiguous execution failure (spec Req 4.5).
 *
 * When both are absent, the missing secrets are reported first: without the
 * secrets there is nothing for the accessor grant to apply to, so that is the
 * more fundamental blocker to surface.
 *
 * No `Secret_Key` value is read here — only name-only presence flags
 * (spec Req 4.6, 6.2).
 */
export function checkPrerequisites(
  status: PrerequisiteStatus,
): PrerequisiteCheck {
  if (!status.requiredSecretsPresent) {
    return { ok: false, missing: MISSING_REQUIRED_SECRETS };
  }
  if (!status.accessorGrantPresent) {
    return { ok: false, missing: MISSING_ACCESSOR_GRANT };
  }
  return { ok: true };
}
