// OperationalSafety guard — pure decision logic (spec Req 6.1, 6.4, 6.5, 6.6,
// 3.7; design Component 7).
//
// This file holds the cross-cutting guard every `Live_Cloud_Command` passes
// through. It performs no I/O itself: project/account reconciliation reads the
// active gcloud settings through an injected `GcloudRunner` (the only I/O seam),
// and operator approval goes through an injected `ConfirmCallback`. Both are
// injectable so the logic is unit-testable without live gcloud or a live prompt.

import type {
  CommandPresentation,
  ConfirmCallback,
  GcloudRunner,
  OperationalSafety,
  ReconcileResult,
} from "./types.js";

/** Argv that reads the active project from gcloud config (non-secret). */
export const GET_PROJECT_ARGV: readonly string[] = [
  "config",
  "get-value",
  "project",
];

/** Argv that reads the active account from gcloud config (non-secret). */
export const GET_ACCOUNT_ARGV: readonly string[] = [
  "config",
  "get-value",
  "account",
];

/**
 * Default approval callback: refuses by default. A real interactive prompt can
 * be injected in its place; refusing-by-default guarantees nothing runs without
 * an explicit, deliberate approval mechanism (spec Req 6.1).
 */
export const denyByDefault: ConfirmCallback = () => Promise.resolve(false);

/**
 * `gcloud config get-value` prints the value on stdout, sometimes with trailing
 * whitespace/newlines and occasionally the sentinel `(unset)`. Normalize to a
 * clean comparable string ("" when unset/empty).
 */
function normalizeConfigValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "(unset)") return "";
  return trimmed;
}

/**
 * Concrete {@link OperationalSafety} guard.
 *
 * @param runner  The gcloud choke point, used to read the active project and
 *                account. The guard never passes a secret through it.
 * @param confirm An operator-approval callback; defaults to {@link denyByDefault}
 *                so approval is never implicitly granted.
 */
export class DefaultOperationalSafety implements OperationalSafety {
  private readonly confirmCallback: ConfirmCallback;

  constructor(
    private readonly runner: GcloudRunner,
    confirm: ConfirmCallback = denyByDefault,
  ) {
    this.confirmCallback = confirm;
  }

  /**
   * Permit a command only when BOTH the active gcloud project AND the active
   * account match the expected target. On any mismatch, return
   * `{ ok: false, mismatch }` naming the discrepancy; on match `{ ok: true }`
   * (spec Req 6.4, 6.6, 3.7).
   *
   * The account need only be present (a non-empty authenticated identity); the
   * project must equal `expectedProject` (`GCP_PROJECT_ID`).
   */
  async reconcileTarget(expectedProject: string): Promise<ReconcileResult> {
    const expected = expectedProject.trim();
    if (expected === "") {
      return {
        ok: false,
        mismatch:
          "expected project (GCP_PROJECT_ID) is empty — refusing to run against an unknown target",
      };
    }

    const [projectOut, accountOut] = await Promise.all([
      this.runner.run(GET_PROJECT_ARGV),
      this.runner.run(GET_ACCOUNT_ARGV),
    ]);

    const activeProject = normalizeConfigValue(projectOut.stdout);
    const activeAccount = normalizeConfigValue(accountOut.stdout);

    if (activeProject !== expected) {
      return {
        ok: false,
        mismatch:
          `active gcloud project "${activeProject || "(unset)"}" does not match ` +
          `expected "${expected}"`,
      };
    }

    if (activeAccount === "") {
      return {
        ok: false,
        mismatch:
          "no active gcloud account is authenticated — cannot reconcile against expected target",
      };
    }

    return { ok: true };
  }

  /**
   * Present the exact (already-redacted) command and gate on operator approval.
   * For a destructive/overwriting op the presentation carries a distinguishable
   * warning naming the affected resource; approval is never returned until the
   * injected callback approves (spec Req 6.1, 6.5).
   */
  confirm(presentation: CommandPresentation): Promise<boolean> {
    return this.confirmCallback(presentation);
  }
}

/**
 * Build the human-facing message for a {@link CommandPresentation}. Pure and
 * exported so both the default prompt and tests can assert on it. For a
 * destructive op it prepends a distinguishable, named warning (spec Req 6.5).
 *
 * The `displayCommand` must already be redacted by the caller
 * (see `redaction.ts`); this function only frames it.
 */
export function formatPresentation(presentation: CommandPresentation): string {
  const lines: string[] = [];
  if (presentation.destructive) {
    const resource = presentation.affectedResource ?? "(unnamed resource)";
    lines.push(
      `⚠️  DESTRUCTIVE/OVERWRITING OPERATION — affects: ${resource}`,
    );
  }
  lines.push(`About to run: ${presentation.displayCommand}`);
  lines.push(presentation.destructive ? "Approve this destructive command? [y/N]" : "Approve? [y/N]");
  return lines.join("\n");
}
