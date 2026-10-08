// Types for the fx_writer scoped-write check (spec simplify-to-cloud-minimal
// task 5.2a.4; Req 4.5, 4.6, 8.4).
//
// This check proves the Cloud_Run_Job's write identity — the `fx_writer`
// Scoped_Write_Credential carried in the `supabase-key` secret — can INSERT and
// UPDATE the retained tables through PostgREST, and that DELETE is REFUSED
// (fx_writer holds SELECT/INSERT/UPDATE but no DELETE grant). No secret value
// ever appears in any shape here; outcomes are names/booleans/status codes only.

/** The three write operations probed against a retained table. */
export type WriteOp = "insert" | "update" | "delete";

/** Outcome of a single probed operation. Carries no secret material. */
export interface OpOutcome {
  readonly op: WriteOp;
  /** Did the REST call succeed (2xx)? */
  readonly ok: boolean;
  /** HTTP status when the call failed (undefined on success / transport error). */
  readonly status?: number;
}

/**
 * The classified verdict of a write-check run. GREEN only when INSERT and
 * UPDATE both succeeded AND DELETE was refused (a non-2xx, specifically a
 * permission denial). Anything else is not green and blocks task 5.3.
 */
export interface FxWriterCheckVerdict {
  readonly insertSucceeded: boolean;
  readonly updateSucceeded: boolean;
  readonly deleteRefused: boolean;
  readonly green: boolean;
  /** Human-readable, secret-free reasons (for logging / the task record). */
  readonly reasons: readonly string[];
}
