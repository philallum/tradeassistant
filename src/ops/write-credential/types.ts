// Job write-credential selector — shared types (spec Req 8, design Component 9).
//
// Compute/storage separation (parent Req 17) + secret confidentiality
// (spec Req 8.8, 6.2, 6.3): every shape in this module is name/config-only. NO
// shape here carries, reads, or emits a `Secret_Key` *value* — the selector
// resolves WHICH credential source the deployed Cloud_Run_Job authenticates
// with, identifying it by its env-key NAME and credential KIND, never by its
// value. The value itself is injected into the Job from Secret Manager at
// runtime (`--set-secrets`), never through this selector.

/**
 * The three distinct Supabase credential KINDS the project holds (spec Req 8):
 *
 *   - `scoped-write`  — the Scoped_Write_Credential: a signed JWT whose `role`
 *                       claim selects the Pipeline_Writer_Role. This is the ONLY
 *                       credential the deployed Job's write path may use
 *                       (spec Req 8.3). It is the value of the `supabase-key`
 *                       Secret Manager secret (spec Req 8.6).
 *   - `service-role`  — the Service_Role_Key (`sb_secret_...`): RLS-bypassing,
 *                       reserved for operator one-offs ONLY; never deployed into
 *                       the Job (spec Req 8.4).
 *   - `publishable`   — the publishable (anon) key: a read-only credential
 *                       reserved for the future read-only serving layer; never
 *                       used for the Job's write path (spec Req 8.5).
 */
export type SupabaseCredentialKind =
  | "scoped-write"
  | "service-role"
  | "publishable";

/**
 * A single candidate credential source the selector may choose among, described
 * by NAME and KIND only (spec Req 8.8). `envKeyName` is the env-key the Job
 * would read the value from (e.g. `SUPABASE_HOSTED_KEY`) — it is a NAME, never a
 * value. `kind` identifies which of the three Supabase credentials it holds.
 *
 * This shape deliberately has NO value field: a selector that cannot hold a
 * secret value cannot leak one (spec Req 8.8).
 */
export interface WriteCredentialCandidate {
  /** The env-key NAME the Job reads the credential value from (never a value). */
  readonly envKeyName: string;
  /** Which of the three Supabase credential kinds this candidate holds. */
  readonly kind: SupabaseCredentialKind;
}

/**
 * The resolved selection for the deployed Job's write path (spec Req 8.3) —
 * name/kind only. Returned by {@link selectJobWriteCredential} on success.
 */
export interface WriteCredentialSelection {
  /** The env-key NAME whose value the Job will authenticate with. */
  readonly envKeyName: string;
  /** The chosen kind — invariantly `"scoped-write"` for the Job (spec Req 8.3). */
  readonly kind: "scoped-write";
}

/**
 * Discriminated result of {@link selectJobWriteCredential}. On `ok:false` the
 * `reason` names WHY no scoped-write credential could be selected (so a caller
 * surfaces a specific prerequisite rather than silently falling back to an
 * over-privileged or read-only credential). The reason text is name-only and
 * carries no secret value (spec Req 8.8).
 */
export type WriteCredentialResult =
  | { readonly ok: true; readonly selection: WriteCredentialSelection }
  | { readonly ok: false; readonly reason: string };
