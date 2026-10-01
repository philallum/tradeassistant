// OperationalSafety guard — shared types (spec Req 6, design Component 7).
//
// Compute/storage separation (parent Req 17): these are pure in-memory shapes
// and interface declarations only. The sole place that performs I/O is the
// `GcloudRunner` seam (defined here, implemented in `gcloudRunner.ts`); every
// other export in this module is pure, deterministic, and injectable.
//
// Secret confidentiality (spec Req 6.2, 6.3) is a type-level contract here:
// NO shape in this module carries a `Secret_Key` *value*. Secret values travel
// only on stdin into `gcloud` via `--data-file=-`, never through argv, a
// presentation string, a log line, or a recorded outcome.

/** A minimal read-only view over environment variables (injectable for tests).
 *  Mirrors the `EnvSource` pattern from `src/storage/supabaseConfig.ts` for
 *  consistency where an env source is needed. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * The result of running a `gcloud` command through the {@link GcloudRunner}
 * choke point. Carries only process output and exit status — never a secret
 * value, which is supplied exclusively on stdin (spec Req 6.2, 6.3).
 */
export interface CommandOutput {
  /** Captured standard output of the command. */
  readonly stdout: string;
  /** Captured standard error of the command. */
  readonly stderr: string;
  /** Process exit code (0 conventionally indicates success). */
  readonly exitCode: number;
}

/**
 * The single choke point for shelling out to `gcloud` (design Component 7).
 *
 * Secret values are supplied ONLY on stdin (via a `--data-file=-` argv flag),
 * NEVER interpolated into `argv`. The runner itself must never place a secret
 * value into `argv`; callers pass the secret as `opts.stdin` and reference it
 * by name only in the argv/display string (spec Req 6.2, 6.3).
 *
 * The runner is injectable so tests can substitute a fake that records argv and
 * stdin without touching a real `gcloud` binary.
 */
export interface GcloudRunner {
  /**
   * Run a `gcloud` invocation.
   *
   * @param argv  The exact argument vector (e.g. `["secrets", "versions",
   *              "add", "my-secret", "--data-file=-"]`). MUST NOT contain any
   *              secret value.
   * @param opts  Optional stream options; `opts.stdin` is piped to the child
   *              process stdin so a secret value can reach `gcloud` without
   *              ever appearing in `argv`.
   */
  run(
    argv: readonly string[],
    opts?: { stdin?: NodeJS.ReadableStream },
  ): Promise<CommandOutput>;
}

/**
 * A presentation of a command for operator approval (design Component 7,
 * spec Req 6.1, 6.5).
 *
 * `displayCommand` is already redacted — every `Secret_Key` value has been
 * replaced with its `<from .env: NAME>` placeholder (spec Req 6.2, 6.3).
 */
export interface CommandPresentation {
  /** The exact command to show, with secret values redacted. */
  readonly displayCommand: string;
  /** Whether this op creates/deploys/executes/incurs cost OR deletes/
   *  overwrites/reduces permissions (spec Req 6.1, 6.5). */
  readonly destructive: boolean;
  /** For a destructive/overwriting op, the named affected resource so the
   *  warning is distinguishable and specific (spec Req 6.5). */
  readonly affectedResource?: string;
}

/**
 * The outcome of {@link OperationalSafety.reconcileTarget}: `ok:true` when both
 * the active project AND account match the expected target; otherwise
 * `ok:false` with `mismatch` surfacing the discrepancy (spec Req 6.4, 6.6, 3.7).
 */
export type ReconcileResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly mismatch: string };

/**
 * An operator-approval mechanism. Injected so approval gating is unit-testable
 * without a live prompt. Returns `true` only when the operator approves.
 */
export type ConfirmCallback = (
  presentation: CommandPresentation,
) => Promise<boolean>;

/**
 * The cross-cutting guard every `Live_Cloud_Command` passes through
 * (spec Req 6, design Component 7). All methods are pure given their injected
 * collaborators (a {@link GcloudRunner} and a {@link ConfirmCallback}).
 */
export interface OperationalSafety {
  /**
   * Reconcile active gcloud project AND account against `GCP_PROJECT_ID` before
   * any `Live_Cloud_Command`; abort and surface the mismatch otherwise
   * (spec Req 6.4, 6.6, 3.7).
   */
  reconcileTarget(expectedProject: string): Promise<ReconcileResult>;

  /**
   * Present the exact command (with any secret value already redacted) and,
   * for a destructive/overwriting op, a distinguishable warning naming the
   * affected resource; do not return approval until the operator approves
   * (spec Req 6.1, 6.5).
   */
  confirm(presentation: CommandPresentation): Promise<boolean>;
}
