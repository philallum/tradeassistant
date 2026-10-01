// SecretManagerProvisioner — shared types (spec Req 3, design Component 4).
//
// Secret confidentiality (spec Req 3.3, 6.2): NO shape in this module carries a
// `Secret_Key` *value*. The plan is built from `.env` by NAME only; a secret
// value is never read into any shape here. `hasValue` records presence/non-
// emptiness only — never the value itself. The actual value travels only on
// stdin into `gcloud` via `--data-file=-` (handled later by provision()).

/** A single `Secret_Key` entry in a {@link SecretProvisionPlan}. Name-only:
 *  carries the env-key name, its Secret Manager secret name, and whether a
 *  non-empty value is present in `.env` — never the value (spec Req 3.3). */
export interface PlannedSecret {
  /** The `.env` env-key NAME (e.g. `OHLC_API_KEY`). */
  readonly envKey: string;
  /** The Secret Manager secret NAME this key maps to (e.g. `ohlc-api-key`). */
  readonly secretName: string;
  /** Whether `.env` holds a non-empty value for this key. Presence only — the
   *  value itself is never recorded (spec Req 3.3, 6.2). */
  readonly hasValue: boolean;
}

/**
 * The name-only provisioning plan built from `.env` (design Component 4).
 *
 * No `Secret_Key` value is ever stored here (spec Req 3.3, 6.2). `missingValues`
 * lists the `Secret_Key`s whose `.env` value is empty or absent, which are
 * reported and never created/versioned (spec Req 3.9).
 */
export interface SecretProvisionPlan {
  /** Every classified `Secret_Key`, by name, with presence of a value. */
  readonly secrets: readonly PlannedSecret[];
  /** Every classified `Config_Env_Key` name (passed via `--set-env-vars`). */
  readonly configKeys: readonly string[];
  /** `Secret_Key`s with an empty/absent value (spec Req 3.9). */
  readonly missingValues: readonly string[];
}

/**
 * The gcloud action a {@link PlannedCommand} performs for a single `Secret_Key`
 * (spec Req 3.2, 3.8):
 *  - `"create"`      — the secret is ABSENT; create it then set its first
 *                      version from stdin.
 *  - `"add-version"` — the secret ALREADY EXISTS; add a new version from stdin
 *                      rather than creating a duplicate, so re-running
 *                      provisioning is idempotent (spec Req 3.8).
 */
export type PlannedCommandAction = "create" | "add-version";

/**
 * A single planned `gcloud` command for provisioning one `Secret_Key`
 * (spec Req 3.2, 3.3, 3.8; design Component 4).
 *
 * NAME-ONLY, like every shape in this module: `argv` holds only the secret
 * NAME, flags, and the `--data-file=-` stdin marker — never a secret value
 * (spec Req 3.3, 6.2, 6.3). The value is supplied exclusively on stdin, which
 * `valueOnStdin` records so the executor knows to pipe it from `.env`.
 */
export interface PlannedCommand {
  /** Whether this creates the secret or adds a version to an existing one. */
  readonly action: PlannedCommandAction;
  /** The `.env` env-key NAME whose value will be piped on stdin. */
  readonly envKey: string;
  /** The Secret Manager secret NAME this command targets. */
  readonly secretName: string;
  /** The exact `gcloud` argument vector — NAMES AND FLAGS ONLY, no secret
   *  value (the value travels on stdin via `--data-file=-`). */
  readonly argv: readonly string[];
  /** Always `true`: the secret value is supplied on stdin, never in `argv`
   *  (spec Req 3.3, 6.2, 6.3). */
  readonly valueOnStdin: true;
}

// ---------------------------------------------------------------------------
// Task 6.9 — accessor grant + read-back verification (spec Req 3.4).
//
// Provisioning is treated complete ONLY when the
// `roles/secretmanager.secretAccessor` grant for the `Runtime_Service_Account`
// is actually PRESENT in each secret's IAM policy (spec Req 3.4). These shapes
// stay NAME-ONLY like the rest of the module: a service-account identity and a
// role are not `Secret_Key` values, and no secret value is ever read here.
// ---------------------------------------------------------------------------

/** The IAM role granted so the runtime SA can read secret values at runtime. */
export const SECRET_ACCESSOR_ROLE = "roles/secretmanager.secretAccessor" as const;

/**
 * One binding in a Secret Manager IAM policy, matching the shape returned by
 * `gcloud secrets get-iam-policy <secret> --format=json`: a `role` and the list
 * of `members` holding it. Members are prefixed identities such as
 * `serviceAccount:sa@project.iam.gserviceaccount.com`.
 */
export interface IamPolicyBinding {
  readonly role: string;
  readonly members?: readonly string[];
}

/**
 * The parsed IAM policy for a single secret, as returned by
 * `gcloud secrets get-iam-policy <secret> --format=json`. Only `bindings` is
 * consulted by the verify predicate; `etag`/`version` are accepted but ignored.
 */
export interface IamPolicy {
  readonly bindings?: readonly IamPolicyBinding[];
  readonly etag?: string;
  readonly version?: number;
}

/**
 * The outcome of {@link grantAndVerifyAccessor} across all secrets in a plan
 * (spec Req 3.4). `ok` is true ONLY when every targeted secret's read-back IAM
 * policy actually contains the accessor grant for the `Runtime_Service_Account`
 * — a grant that failed to land leaves its secret name in `missing` and forces
 * `ok:false`, so provisioning is never reported complete on an absent grant.
 *
 * NAME-ONLY: carries secret NAMES only, never a `Secret_Key` value
 * (spec Req 3.3, 6.2).
 */
export interface GrantVerifyResult {
  /** True iff every targeted secret has the verified accessor grant. */
  readonly ok: boolean;
  /** Secret NAMES whose read-back policy confirmed the grant is present. */
  readonly verified: readonly string[];
  /** Secret NAMES whose read-back policy did NOT contain the grant. */
  readonly missing: readonly string[];
}
