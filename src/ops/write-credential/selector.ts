// Job write-credential selector (task 12.2, spec Req 8.3, 8.4, 8.5, 8.8;
// design Component 9, Property 26).
//
// The deployed Cloud_Run_Job's write path MUST authenticate with the
// Scoped_Write_Credential (a signed JWT whose `role` claim selects the
// Pipeline_Writer_Role) and MUST NEVER authenticate with the Service_Role_Key
// (`sb_secret_...`, RLS-bypassing, operator-only) or the publishable (anon) key
// (read-only, serving-layer-only). This module encodes that selection as a PURE
// function over candidate credential sources described by NAME + KIND only.
//
// Secret confidentiality (spec Req 8.8, 6.2, 6.3): the selector never reads,
// receives, returns, or logs a `Secret_Key` *value*. It resolves WHICH source
// the Job uses — identified by its env-key name and credential kind — not the
// value. The value is injected into the Job from Secret Manager at runtime
// (`--set-secrets`), outside this module entirely.

import type {
  WriteCredentialCandidate,
  WriteCredentialResult,
  SupabaseCredentialKind,
} from "./types.js";

/**
 * The only credential kind the deployed Job's write path is permitted to use
 * (spec Req 8.3). Named here so the invariant is explicit and reused by both
 * the selector and its property test's oracle.
 */
export const JOB_WRITE_CREDENTIAL_KIND = "scoped-write" as const;

/**
 * Credential kinds the Job's write path MUST NEVER resolve to:
 *   - `service-role` — RLS-bypassing, over-privileged, operator-only (Req 8.4).
 *   - `publishable`  — read-only anon key, serving-layer-only (Req 8.5).
 */
const FORBIDDEN_WRITE_KINDS: ReadonlySet<SupabaseCredentialKind> = new Set([
  "service-role",
  "publishable",
]);

/**
 * Resolve the credential source the deployed Cloud_Run_Job authenticates with
 * on its write path (spec Req 8.3, 8.4, 8.5).
 *
 * Behaviour, purely over the candidate NAMES/KINDS (no value is read):
 *   - Selects the single candidate whose kind is `scoped-write`
 *     (the Scoped_Write_Credential) — this is the ONLY permitted write
 *     credential for the Job (Req 8.3).
 *   - NEVER selects a `service-role` (Req 8.4) or `publishable` (Req 8.5)
 *     candidate, even if it is the only candidate present: in that case the
 *     result is `ok:false` with a specific name-only reason, so a caller
 *     surfaces a prerequisite rather than silently authenticating the Job with
 *     an over-privileged or read-only credential.
 *   - If no `scoped-write` candidate is present, returns `ok:false`.
 *   - If more than one `scoped-write` candidate is present, returns `ok:false`
 *     (an ambiguous configuration must be made explicit, never guessed).
 *
 * The function performs NO I/O and holds NO secret value (spec Req 8.8); it is
 * a pure function of the candidate descriptors, so it is unit- and property-
 * testable in isolation (Property 26).
 *
 * @param candidates The credential sources available to the Job, by name/kind.
 */
export function selectJobWriteCredential(
  candidates: readonly WriteCredentialCandidate[],
): WriteCredentialResult {
  const scopedWrite = candidates.filter(
    (c) => c.kind === JOB_WRITE_CREDENTIAL_KIND,
  );

  if (scopedWrite.length === 0) {
    const forbidden = candidates.filter((c) => FORBIDDEN_WRITE_KINDS.has(c.kind));
    const detail =
      forbidden.length > 0
        ? ` only non-write credentials are present (${forbidden
            .map((c) => `${c.envKeyName}:${c.kind}`)
            .join(", ")}); the Job's write path must never use the ` +
          `service-role or publishable key.`
        : " no credential candidates were provided.";
    return {
      ok: false,
      reason:
        `No Scoped_Write_Credential available for the Job's write path:${detail}`,
    };
  }

  if (scopedWrite.length > 1) {
    return {
      ok: false,
      reason:
        `Ambiguous Scoped_Write_Credential: ${scopedWrite.length} scoped-write ` +
        `candidates present (${scopedWrite
          .map((c) => c.envKeyName)
          .join(", ")}); exactly one is required.`,
    };
  }

  const chosen = scopedWrite[0]!;
  return {
    ok: true,
    selection: { envKeyName: chosen.envKeyName, kind: JOB_WRITE_CREDENTIAL_KIND },
  };
}
