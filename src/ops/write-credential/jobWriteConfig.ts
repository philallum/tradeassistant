// Job write-path config wiring (task 12.3, spec Req 8.5, 8.6; design Component 9).
//
// This module WIRES the pure write-credential selector (task 12.2) to the
// deployed Cloud_Run_Job's resolved hosted storage configuration. It encodes —
// by NAME and KIND only, never by value — which env-key the Job's write path
// authenticates from, and asserts via `selectJobWriteCredential` that it is the
// Scoped_Write_Credential and never the Service_Role_Key (spec Req 8.4) or the
// publishable (anon) key (spec Req 8.5).
//
// How this connects the existing pieces (no logic is re-implemented):
//   - `src/storage/supabaseConfig.ts` resolves the Job's connection for the
//     `hosted` target by reading `SUPABASE_HOSTED_KEY` into `SupabaseConfig.key`.
//     That configured credential IS the Job's Bearer credential (design
//     Component 9: `SupabaseRestClient` sends the key as `apikey` +
//     `Authorization: Bearer`).
//   - The `supabase-key` Secret Manager secret maps to `SUPABASE_HOSTED_KEY` in
//     `.github/workflows/deploy.yml`'s `--set-secrets`, and holds the
//     Scoped_Write_Credential value (set live in task 12.4; spec Req 8.6).
//   - This module declares the Job's hosted credential candidates by NAME/KIND
//     and runs them through `selectJobWriteCredential` so the write path is
//     resolved to `SUPABASE_HOSTED_KEY` as the scoped-write source — a pure,
//     value-free selection (spec Req 8.8).
//
// Secret confidentiality (spec Req 8.8, 6.2, 6.3): nothing here reads, receives,
// returns, or logs a `Secret_Key` value. The value is injected into the Job from
// Secret Manager at runtime (`--set-secrets`), entirely outside this module.

import { SUPABASE_ENV } from "../../storage/supabaseConfig.js";
import type { SupabaseConfig } from "../../storage/supabaseConfig.js";

import { selectJobWriteCredential } from "./selector.js";
import type {
  WriteCredentialCandidate,
  WriteCredentialResult,
} from "./types.js";

/**
 * The env-key NAME the deployed Job reads its write credential from on the
 * `hosted` target — the value of the `supabase-key` Secret Manager secret
 * (spec Req 8.6). Taken from the single source of truth in `supabaseConfig.ts`
 * so the two never drift.
 */
export const JOB_HOSTED_WRITE_ENV_KEY = SUPABASE_ENV.hosted.key;

/**
 * The env-key NAME reserved for the publishable (anon) read-only credential of
 * the future serving layer (spec Req 8.5, parent Req 17.3). It is declared here
 * only so it can be modelled as a `publishable` candidate and thereby PROVEN to
 * never be routed into the Job's write path. There is no runtime read of it.
 */
export const SERVING_LAYER_PUBLISHABLE_ENV_KEY = "SUPABASE_PUBLISHABLE_KEY";

/**
 * The env-key NAME reserved for the operator-only Service_Role_Key (spec
 * Req 8.4). Declared here only to be modelled as a `service-role` candidate and
 * thereby PROVEN to never be routed into the Job's write path. There is no
 * runtime read of it, and it is never stored as the Job's `supabase-key` secret
 * nor committed.
 */
export const OPERATOR_SERVICE_ROLE_ENV_KEY = "SUPABASE_SERVICE_ROLE_KEY";

/**
 * The deployed Job's candidate credential sources, described by NAME + KIND only
 * (spec Req 8.8 — no value field exists). The hosted write-path env-key
 * (`SUPABASE_HOSTED_KEY`) is the `scoped-write` candidate; the publishable and
 * service-role keys are present as FORBIDDEN candidates so the selector can
 * prove it never falls back to them for the write path (spec Req 8.4, 8.5).
 */
export const JOB_HOSTED_CREDENTIAL_CANDIDATES: readonly WriteCredentialCandidate[] =
  [
    { envKeyName: JOB_HOSTED_WRITE_ENV_KEY, kind: "scoped-write" },
    { envKeyName: SERVING_LAYER_PUBLISHABLE_ENV_KEY, kind: "publishable" },
    { envKeyName: OPERATOR_SERVICE_ROLE_ENV_KEY, kind: "service-role" },
  ];

/**
 * Resolve — purely, by name/kind — the env-key the deployed Cloud_Run_Job's
 * write path authenticates from (spec Req 8.3, 8.4, 8.5). Delegates to the
 * task-12.2 selector over {@link JOB_HOSTED_CREDENTIAL_CANDIDATES}, so the write
 * path is always the Scoped_Write_Credential (`SUPABASE_HOSTED_KEY`) and never
 * the service-role or publishable key. No secret value is read (spec Req 8.8).
 */
export function resolveJobWriteCredential(): WriteCredentialResult {
  return selectJobWriteCredential(JOB_HOSTED_CREDENTIAL_CANDIDATES);
}

/**
 * Assert, from a resolved Job {@link SupabaseConfig}, that the Job's write path
 * is wired to the Scoped_Write_Credential and not the publishable/service-role
 * key — a NAME/CONFIG-only check that never inspects the secret value.
 *
 * The check is twofold and pure:
 *   1. The Job must run against the `hosted` target (the only target that writes
 *      to hosted Supabase under the scoped credential).
 *   2. The write-credential selector must resolve to the hosted write env-key
 *      (`SUPABASE_HOSTED_KEY`), i.e. the scoped-write source — never falling
 *      back to the publishable (read-only) or service-role (operator-only) key.
 *
 * `config.key` (a `Secret_Key` value) is deliberately NOT read here; only
 * `config.target` (non-secret) and the credential NAMES are consulted
 * (spec Req 8.8). Returns a discriminated result so a caller surfaces a specific
 * prerequisite rather than silently deploying an over-privileged or read-only
 * credential.
 *
 * @param config The Job's resolved Supabase connection config (hosted).
 */
export function assertJobWriteCredentialScoped(
  config: SupabaseConfig,
):
  | { readonly ok: true; readonly envKeyName: string }
  | { readonly ok: false; readonly reason: string } {
  if (config.target !== "hosted") {
    return {
      ok: false,
      reason:
        `The deployed Job's write path requires the "hosted" target, but the ` +
        `resolved config selects "${config.target}". The Scoped_Write_Credential ` +
        `is only used against hosted Supabase.`,
    };
  }

  const selected = resolveJobWriteCredential();
  if (!selected.ok) {
    return { ok: false, reason: selected.reason };
  }

  if (selected.selection.envKeyName !== JOB_HOSTED_WRITE_ENV_KEY) {
    return {
      ok: false,
      reason:
        `The Job's write path resolved to "${selected.selection.envKeyName}", ` +
        `but the hosted scoped-write credential is "${JOB_HOSTED_WRITE_ENV_KEY}".`,
    };
  }

  return { ok: true, envKeyName: selected.selection.envKeyName };
}
