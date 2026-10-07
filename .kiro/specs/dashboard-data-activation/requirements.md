# Requirements Document

## Introduction

The FX Daily Pattern Trading Assistant's deterministic core, its hosted Supabase backend, and its read-only serving layer are all built and deployed. The `dashboard-ui` serving stack is live — the Read_Proxy is deployed as the Cloud Run service `dashboard-read-proxy`, Firebase Hosting serves `https://trade-assistant-508806.web.app` and the custom domain `https://app.teamhandso.me`, the `/api/**` rewrite reaches the proxy, and the hosted history has been seeded (≈20,916 `pattern_vectors` and ≈62,733 matured `analogue_outcomes` extending to 2026-09). What is missing is a single thing: **no pair can fire**, so `firing_setups` stays empty, the `v_decision_dates` view returns nothing, and `dashboard-ui` Task 17 (the post-deploy read-only smoke verification) has no real Decision_Date to verify against.

The findings in `dashboard-ui/TASK-17-BLOCKERS-FINDINGS.md` trace this to a structural gap, not a data gap. The dashboard's `fires()` predicate (`src/dashboard/dashboard.ts`) requires `gatePassing && !newsSuppressed && direction !== "FLAT" && earnedConfidence >= threshold`. The pipeline's `evaluatePair` (`src/pipeline/dailyPipeline.ts`) resolves gate-passing through the injected `deps.gatePassing ?? resolveGatePassingDefault`, and `resolveGatePassingDefault = () => false`. Production wiring (`src/scheduled-run/main.ts` → `makePipelineLoader(buildSupabaseStores(supabase))`) injects no `GatePassingResolver`, so every pair resolves `gatePassing = false`, nothing fires, and the dashboard is correctly but permanently silent.

Beneath that single missing resolver is an unfinished chain of core-pipeline production wiring: no Supabase adapters exist for `GateVerdictStore` or `FeatureRegistryStore` (only the port interfaces and their in-memory references); the Backtest_Stage composes and logs verdicts to `RESEARCH-LOG.md` but never persists them (`persistGateVerdict` / `evaluateAndRecordVerdict` are defined and tested but never called in production); and no `GatePassingResolver` implementation has ever been written or injected. So `gate_verdicts` is expected empty, and no code path would populate it.

This spec closes that chain end-to-end so a real firing Decision_Date appears on the hosted dashboard and `dashboard-ui` Task 17 can finally run. It is deliberately scoped to **wiring, integration, and operational/security hardening**: it persists, reads back, injects, and provisions around the already-built deterministic modules. It MUST NOT re-implement any gate math, scoring, confidence, encoding, or pipeline logic — every requirement either persists an existing module's output, reads a recorded value back, injects an existing seam, runs an existing path against hosted infrastructure, or hardens an operational posture. Each requirement cross-references the existing component, port, or sibling-spec requirement it serves.

The in-scope concerns and their dependency structure:

- **Persistence + storage half** (a strict chain):
  - **Supabase storage adapters** (Requirement 1) — implement `GateVerdictStore` and `FeatureRegistryStore` Supabase adapters mirroring `src/storage/supabase/*`, so verdicts and feature-registry rows can reach hosted at all.
  - **Gate-verdict persistence** (Requirement 2) — wire a gate/research run to persist aggregate + per-fold verdicts through the new `GateVerdictStore`, not only append to the Research_Log.
  - **Gate-passing resolver + injection** (Requirement 3) — implement a `GatePassingResolver` that reads recorded PASS verdicts and inject it into the production `makePipelineLoader` wiring, replacing `resolveGatePassingDefault`.
- **Live-activation half** (depends on the persistence half and on the already-seeded hosted data):
  - **Hosted gate run + daily re-run** (Requirement 4) — run the gate/backtest against the seeded hosted data to produce real PASS/CUT verdicts, then re-run `scheduled-daily-run` so `firing_setups` fills and `v_decision_dates` returns a Decision_Date.
- **Operational / security hardening** (independent, can proceed in parallel):
  - **Seed Job timeout hardening** (Requirement 5) — raise the `dashboard-seed-run` `--task-timeout` so a re-run exits SUCCESS.
  - **Service-role-key diagnostic policy** (Requirement 6) — establish a least-privilege read-only diagnostic path so routine verification does not depend on the service-role key.
  - **allUsers run.invoker review** (Requirement 7) — evaluate and, if preferred, replace the `allUsers` invoker grant on `dashboard-read-proxy` with a least-privilege identity.
  - **Deploy-record provenance** (Requirement 8) — commit the dashboard deployment record so the live deployment state is reproducible in version control.
- **Governance + success criterion**:
  - **Operational Safety** (Requirement 9) — governs every live command in Requirements 4–7, mirroring `operational-wiring` Requirement 6.
  - **End-to-end success criterion** (Requirement 10) — `dashboard-ui` Task 17's read-only smoke checks pass against real hosted data.

## Glossary

Terms defined in the parent spec (`fx-daily-pattern-assistant/requirements.md`) are reused as-is and referenced here rather than redefined: **System**, **Pair / Asset**, **Decision_Date**, **Session_Close / NY_Close**, **Matured_Outcome**, **Pattern_Vector**, **Kill_Gate**, **Gate_1 / Gate_2**, **Walk_Forward_Window / Walk_Forward_Fold**, **Out_Of_Sample_Test**, **Earned_Confidence**, **Direction_Class**, **Horizon**, **Confidence_Threshold**, **Feature_Registry**, **Research_Log**, **Row-Level Security (RLS)**.

Terms defined in the sibling specs are reused as-is and referenced rather than redefined. From `operational-wiring/requirements.md`: **Backtest_Stage**, **Backfill_Stage**, **Forward_Look_Stage**, **Staged_Runner**, **Hosted_Candle_Seeding**, **Cloud_Run_Job**, **Scheduler_Job**, **Live_Cloud_Command**, **Secret_Manager**, **Runtime_Service_Account**, **Pipeline_Writer_Role**, **Scoped_Write_Credential**, **Service_Role_Key**. From `dashboard-ui/requirements.md`: **Read_Proxy**, **Allowlist**, **Firebase_Hosting**, **CSP**.

New terms introduced by this spec:

- **Gate_Verdict**: An aggregate `GateVerdict` (`src/kill-gate/types.ts`) — `{ configId, foldVerdicts, gate1, gate2, sampleSize, verdict: "PASS" | "CUT", metrics }` — produced by `composeGateVerdict` over the Walk_Forward_Folds, together with its per-fold `FoldVerdict` rows. Persisted as one `gate_verdicts` row plus its `gate_fold_verdicts` rows.
- **Gate_Verdict_Store**: The existing `GateVerdictStore` PORT (`src/kill-gate/types.ts`): `persistVerdict(verdict, split) -> { verdictId, foldRows }` and `getVerdict(verdictId)`. Append-only, mirroring the Research_Log semantics; the in-memory reference is `InMemoryGateVerdictStore`.
- **Feature_Registry_Store**: The existing `FeatureRegistryStore` PORT (`src/feature-registry/types.ts`): `upsert(row)` (keyed by `feature_id`), `get(featureId)`, `all()`, over the `feature_registry` table whose `status` is one of `candidate | included | cut` and whose `verdictId` references the justifying `gate_verdicts.id`. The in-memory reference is `InMemoryFeatureRegistryStore`.
- **Gate_Passing_Resolver**: An implementation of the existing `GatePassingResolver` type (`src/pipeline/types.ts`): `(pair, decisionDate) => Promise<boolean> | boolean`, returning `true` only when a recorded PASS Gate_Verdict backs the pair's active configuration, read from `gate_verdicts` / `feature_registry`. It consumes recorded outcomes; it does NOT re-run the Walk_Forward_Window backtest on the daily path.
- **Supabase_Rest_Client**: The existing shared transport `SupabaseRestClient` (`src/storage/supabase/client.ts`) over the IPv4 PostgREST endpoint, providing idempotent `upsert(table, rows, onConflict)` (merge-duplicates) and a paginated `select(table, query)` that pages via `Range` / `Content-Range` so reads are no longer silently truncated at ~1000 rows.
- **Gate_Run**: The operator-run operation that evaluates the Kill_Gate over the Walk_Forward_Folds on the seeded hosted history and persists the resulting Gate_Verdicts to hosted — the Backtest_Stage (or a dedicated gate/research Job) wired to persist through the Gate_Verdict_Store, not only `logGateVerdict`.
- **Seed_Job**: The existing `dashboard-seed-run` Cloud_Run_Job (`src/ops/seed-run/main.ts`) that runs `backfill → resolveHistoricalOutcomes` against hosted via the Scoped_Write_Credential; its writes are idempotent.
- **Diagnostic_Read_Path**: A durable, least-privilege, read-only means of obtaining exact hosted row counts for routine verification (for example a read-only diagnostic Postgres role, or a counts endpoint on the Read_Proxy) that does NOT require the Service_Role_Key.
- **Invoker_Identity**: The IAM principal permitted to invoke the `dashboard-read-proxy` Cloud Run service for the Firebase_Hosting `/api` rewrite path — currently `allUsers` with `roles/run.invoker`, under review for replacement by a least-privilege identity.
- **Deployment_Record**: The committed dashboard deployment record (in `web/README.md` or an equivalent version-controlled file) capturing the live public URLs (including the custom domain `app.teamhandso.me`), the proxy revision, and the invoker posture, so the deployed state is reproducible from version control.

## Requirements

### Requirement 1: Supabase Gate-Verdict and Feature-Registry Storage Adapters

**User Story:** As the system owner, I want Supabase adapters for the gate-verdict and feature-registry ports, so that recorded Kill_Gate verdicts and feature-registry rows can be written to and read back from the hosted backend instead of only existing in memory.

#### Acceptance Criteria

1. THE System SHALL implement a Supabase `GateVerdictStore` adapter and a Supabase `FeatureRegistryStore` adapter that satisfy the existing PORT interfaces in `src/kill-gate/types.ts` and `src/feature-registry/types.ts` without altering those interfaces.
2. THE Gate_Verdict_Store adapter and the Feature_Registry_Store adapter SHALL be constructed from a shared Supabase_Rest_Client, mirroring the existing `src/storage/supabase/*` adapter pattern (for example `SupabasePatternVectorStore`), and SHALL reach storage only through that client.
3. WHEN the Gate_Verdict_Store adapter persists a Gate_Verdict, THE adapter SHALL write one aggregate row to the `gate_verdicts` table and one row per `FoldVerdict` to the `gate_fold_verdicts` table, and SHALL return a `PersistVerdictReport` whose `foldRows` equals the number of persisted per-fold rows, matching the `InMemoryGateVerdictStore` reference semantics.
4. WHEN the Gate_Verdict_Store adapter reads a verdict by `verdictId`, THE adapter SHALL return the persisted aggregate verdict and its recorded `GateVerdictSplit`, or `null` when no row with that `verdictId` exists.
5. WHEN the Feature_Registry_Store adapter upserts a `FeatureRegistryRow`, THE adapter SHALL perform an idempotent upsert keyed on `feature_id` in the `feature_registry` table so that re-upserting the same `feature_id` replaces that row rather than inserting a duplicate, matching the `InMemoryFeatureRegistryStore` reference semantics.
6. THE Feature_Registry_Store adapter SHALL persist the `status` value as exactly one of `candidate`, `included`, or `cut`, and SHALL persist the justifying `verdictId` as the `gate_verdicts` id or as `null` when the feature is still a candidate.
7. WHEN either adapter reads rows that exceed one PostgREST page, THE adapter SHALL retrieve the complete result set via the Supabase_Rest_Client's paginated `select`, and SHALL NOT rely on a single unbounded GET that the hosted gateway would truncate at ~1000 rows.
8. THE adapters SHALL NOT re-implement any gate math, verdict composition, or feature-admission logic, and SHALL persist and read back only the values produced by the existing `composeGateVerdict` and Feature_Registry modules.
9. IF a persist or read operation returns a non-success PostgREST status, THEN THE adapter SHALL surface a secret-free error identifying the affected table and status, and SHALL NOT include the Supabase key in the error.

### Requirement 2: Gate-Verdict Persistence to Hosted

**User Story:** As a researcher, I want the gate evaluation to persist its verdicts to the hosted backend, so that a recorded PASS verdict exists for the daily run to read, rather than the verdict existing only as a Research_Log entry.

#### Acceptance Criteria

1. THE System SHALL wire the Gate_Run (the Backtest_Stage of `src/staged-runner/stagedRunner.ts`, or a dedicated gate/research run) to persist each composed Gate_Verdict through the Gate_Verdict_Store adapter of Requirement 1, in addition to the existing `logGateVerdict` append to the Research_Log.
2. THE System SHALL effect this persistence by calling the already-defined `persistGateVerdict` or `evaluateAndRecordVerdict` (`src/kill-gate/verdict.ts`), which are implemented and tested but currently never invoked in production, and SHALL NOT re-implement verdict composition or persistence.
3. WHEN the Gate_Run composes a Gate_Verdict for a configuration, THE System SHALL persist the aggregate verdict and all of its per-fold verdicts with the recorded `GateVerdictSplit` (`trainEnd`, `testStart`, `testEnd`, and the optional `selectedHorizon`), preserving the append-only research-history semantics of the `gate_verdicts` table.
4. WHERE a configuration earns a PASS Gate_Verdict and the Feature_Registry admits it, THE System SHALL upsert the corresponding `feature_registry` row through the Feature_Registry_Store adapter with `status = included` and the justifying `verdictId`, consistent with parent Requirement 13.
5. THE System SHALL preserve the existing Research_Log behaviour, so that `logGateVerdict` still appends the aggregate and per-fold verdicts and the accuracy-vs-baseline / risk-adjusted-vs-baseline metrics, and persistence is additive rather than a replacement.
6. IF persisting a Gate_Verdict through the Gate_Verdict_Store fails, THEN THE System SHALL surface the failure identifying the affected configuration and SHALL NOT silently proceed as though the verdict were recorded.

### Requirement 3: Gate-Passing Resolver and Pipeline Injection

**User Story:** As a trader, I want the daily run to resolve gate-passing from recorded PASS verdicts, so that a pair backed by a passing Kill_Gate verdict can actually fire instead of being hardwired to non-firing.

#### Acceptance Criteria

1. THE System SHALL implement a Gate_Passing_Resolver satisfying the existing `GatePassingResolver` type contract in `src/pipeline/types.ts`: `(pair, decisionDate) => Promise<boolean> | boolean`.
2. WHEN the Gate_Passing_Resolver is invoked for a Pair and Decision_Date, THE resolver SHALL read recorded PASS verdicts from `gate_verdicts` / `feature_registry` through the Requirement 1 adapters and SHALL return `true` only when a PASS Gate_Verdict backs that Pair's active configuration, and `false` otherwise.
3. THE Gate_Passing_Resolver SHALL consume recorded verdict outcomes only and SHALL NOT re-run the Walk_Forward_Window backtest, re-evaluate Gate_1 or Gate_2, or re-compute any gate math on the daily path.
4. THE System SHALL inject the Gate_Passing_Resolver into the production pipeline wiring (`src/scheduled-run/main.ts`, via `makePipelineLoader`), so that `evaluatePair` uses the injected resolver through `deps.gatePassing ?? resolveGatePassingDefault` rather than the `resolveGatePassingDefault = () => false` fallback.
5. THE System SHALL leave the firing precondition unchanged — a pair fires only when `gatePassing && !newsSuppressed && direction !== "FLAT" && earnedConfidence >= confidenceThreshold`, as implemented by `fires()` in `src/dashboard/dashboard.ts` — and SHALL NOT re-implement or relax that predicate.
6. WHILE no PASS Gate_Verdict backs a Pair's active configuration, THE Gate_Passing_Resolver SHALL return `false` for that Pair, so that an un-passed pair is never displayed, consistent with parent Requirement 16.5.
7. WHEN the production pipeline runs with identical stored inputs, the same recorded verdicts, and the same Decision_Date, THE System SHALL produce an identical set of per-pair evaluations, preserving the deterministic-computation guarantee (parent Requirement 3.1) and the equivalent-unattended-run guarantee (parent Requirement 16.7).
8. IF the Gate_Passing_Resolver cannot read the recorded verdicts (for example the backing store is unreachable), THEN THE System SHALL surface the read failure and SHALL NOT silently coerce gate-passing to `true` for any Pair.

### Requirement 4: Hosted Gate Run and Daily Re-Run to Produce a Firing Decision_Date

**User Story:** As the system owner, I want the gate evaluation and the daily run actually executed against the seeded hosted data, so that a real firing Decision_Date is persisted and the hosted dashboard has data to serve.

#### Acceptance Criteria

1. THE System SHALL reconcile the resolved storage target against the hosted backend and the active gcloud project/account against `GCP_PROJECT_ID` before running any hosted operation, and IF the resolved target is not the hosted backend THEN THE System SHALL abort and surface the discrepancy, consistent with Requirement 9.
2. WHEN the Gate_Run executes, THE System SHALL evaluate the existing Kill_Gate over the Walk_Forward_Folds on the already-seeded hosted history (the ≈20,916 `pattern_vectors` and the matured `analogue_outcomes`) and SHALL persist the resulting PASS/CUT Gate_Verdicts to the hosted `gate_verdicts` and `gate_fold_verdicts` tables via Requirements 1 and 2, without re-implementing the gate math.
3. THE System SHALL present each Live_Cloud_Command for the Gate_Run and the daily re-run to the operator for approval before execution, SHALL source every secret from Secret_Manager or stdin, SHALL NOT echo any secret value, and SHALL record only non-secret references, following the Live Cloud Execution Protocol used by `operational-wiring` Requirement 6 and `dashboard-ui` Tasks 13–17, consistent with Requirement 9.
4. WHEN the Gate_Run completes, THE System SHALL confirm that at least one PASS Gate_Verdict is recorded in the hosted `gate_verdicts` table for an active pair configuration, because without a recorded PASS the Gate_Passing_Resolver returns `false` for every pair and nothing can fire.
5. WHEN the Gate_Run has recorded verdicts, THE System SHALL re-run the deployed `scheduled-daily-run` Cloud_Run_Job through the production wiring (with the Requirement 3 resolver injected) for the current or most-recent matured Decision_Date.
6. WHEN the re-run completes, THE System SHALL confirm the run persisted its view, and WHERE a pair passes the gate, is non-FLAT, is non-suppressed, and meets the Confidence_Threshold, THE System SHALL confirm that one or more rows are written to the hosted `firing_setups` table and that the `v_decision_dates` view returns at least one Decision_Date.
7. IF the re-run completes with zero firing setups, THEN THE System SHALL report whether the cause is no recorded PASS verdict, a FLAT direction, a news suppression, or an Earned_Confidence below the Confidence_Threshold, and SHALL NOT alter the `fires()` predicate or the gate math to force a firing.
8. WHEN a firing Decision_Date is present in `v_decision_dates`, THE System SHALL treat the end state as leaving `dashboard-ui` Task 17 able to run its read-only smoke verification against real hosted data (Requirement 10).

### Requirement 5: Seed Job Timeout Hardening

**User Story:** As the system owner, I want the seed Job's task timeout raised, so that a re-run exits with a SUCCESS status instead of being killed at the limit as its writes finish.

#### Acceptance Criteria

1. THE System SHALL raise the `dashboard-seed-run` Cloud_Run_Job `--task-timeout` from its current 3600 seconds to a value in the range 5400–7200 seconds, so that a clean run completes before the task-timeout rather than being terminated as outcomes finish writing.
2. THE System SHALL express the raised task-timeout as a version-controlled, recorded change (a committed deploy/config artifact or a documented committed command), so that the Seed_Job's timeout is reproducible from version control.
3. WHEN the Seed_Job is re-run with the raised task-timeout, THE System SHALL cause the execution to report a SUCCESS status.
4. THE System SHALL rely on the Seed_Job's existing idempotent writes so that a re-run produces no duplicated rows and no re-seed of unchanged data is required, consistent with the `(Asset, Date)` upsert idempotence (parent Requirement 7.4, `operational-wiring` Requirement 7.4).
5. THE System SHALL present the task-timeout change command to the operator for approval before execution, consistent with Requirement 9.

### Requirement 6: Service-Role-Key Diagnostic Policy

**User Story:** As the system owner, I want a least-privilege read-only path for routine hosted verification, so that checking row counts does not depend on the over-privileged service-role key.

#### Acceptance Criteria

1. THE System SHALL establish a durable Diagnostic_Read_Path (for example a read-only diagnostic Postgres role, or a counts endpoint on the Read_Proxy) that returns exact hosted row counts for routine read-only verification without requiring the Service_Role_Key.
2. THE System SHALL document the Diagnostic_Read_Path as a version-controlled policy that identifies which credential or endpoint is used for routine read-only diagnostics and records why the publishable (anon) key (RLS-limited to 0 rows) and the scoped read key (401 on raw PostgREST) are insufficient for raw count reads.
3. WHILE routine read-only verification is performed, THE System SHALL use the Diagnostic_Read_Path and SHALL NOT use the Service_Role_Key.
4. WHERE the Service_Role_Key is used for an operator one-off, THE System SHALL use it strictly for read-only diagnostics, only with operator approval, and SHALL NOT echo, log, or commit the key, consistent with `operational-wiring` Requirement 8.4 and Requirement 9.
5. THE Diagnostic_Read_Path SHALL be granted only the read access required to return row counts and SHALL NOT be granted write access or any RLS-bypassing capability.

### Requirement 7: allUsers Run-Invoker Review

**User Story:** As the system owner, I want the public invoker grant on the Read_Proxy reviewed, so that the Hosting-to-Cloud-Run path uses the least privilege sufficient to work while preserving the app-level protections.

#### Acceptance Criteria

1. THE System SHALL evaluate the existing `roles/run.invoker` grant to `allUsers` on the `dashboard-read-proxy` Cloud Run service, which was granted during `dashboard-ui` Task 16 so the Firebase_Hosting `/api` rewrite could reach the authenticated-only service.
2. WHERE a least-privilege Invoker_Identity is preferred, THE System SHALL replace the `allUsers` grant with that scoped identity for the Firebase_Hosting-to-Cloud-Run path and SHALL grant that identity only `roles/run.invoker` on `dashboard-read-proxy` and no broader role.
3. THE System SHALL preserve the Read_Proxy's app-level protections — the Allowlist (read-only, select-only), the rate limit, and the CSP / security headers — regardless of which invoker posture is chosen, so that invoker changes do not weaken request-level enforcement.
4. THE System SHALL record the invoker decision (retain `allUsers` with documented justification, or replace with a named least-privilege identity) in the version-controlled Deployment_Record of Requirement 8.
5. IF the review changes the invoker posture, THEN THE System SHALL present the IAM change command to the operator for approval before execution and SHALL confirm after the change that the public `/api` path still returns a successful response end-to-end, consistent with Requirement 9.
6. IF changing the invoker posture would break the Firebase_Hosting `/api` rewrite path, THEN THE System SHALL retain a working invoker configuration rather than leaving the public path unreachable.

### Requirement 8: Deployment-Record Provenance

**User Story:** As the system owner, I want the dashboard deployment record committed, so that the live deployment state is reproducible from version control rather than living as an uncommitted edit.

#### Acceptance Criteria

1. THE System SHALL commit the dashboard Deployment_Record (currently the uncommitted `web/README.md` Task 16 edit) to version control.
2. THE Deployment_Record SHALL identify the live public URLs, including the Firebase_Hosting default URL and the custom domain `app.teamhandso.me`, the deployed `dashboard-read-proxy` revision, and the invoker posture resulting from Requirement 7.
3. THE System SHALL record only non-secret references in the Deployment_Record and SHALL NOT include any Secret_Key, Scoped_Write_Credential, or Service_Role_Key value, consistent with Requirement 9.
4. WHEN the Deployment_Record is committed, THE System SHALL ensure the committed record reflects the current live deployment state so that the deployment is reproducible from the repository.

### Requirement 9: Operational Safety for Live Cloud Commands

**User Story:** As the system owner, I want every live cloud action in this spec shown to me before it runs and to never expose a secret, so that I retain control over cost-incurring and permission-changing operations and my credentials stay confidential.

#### Acceptance Criteria

1. WHEN the operator is about to run a Live_Cloud_Command that creates, modifies, deploys, executes, or otherwise incurs cost against the GCP project or the hosted Supabase backend (the Gate_Run, the daily re-run, the Seed_Job timeout change, the diagnostic-path provisioning, and any IAM change), THE System SHALL present the exact command to the operator and SHALL NOT execute it until the operator approves.
2. THE System SHALL NOT commit, echo, or log any Secret_Key, Scoped_Write_Credential, or Service_Role_Key value at any point during the operations of Requirements 4–8.
3. WHEN a command handles a secret, THE System SHALL reference that secret by name only and SHALL source its value from Secret_Manager or stdin rather than reproducing the value in command output, chat, or committed files.
4. THE System SHALL reconcile the active gcloud project and account against the expected target (`GCP_PROJECT_ID`) and the resolved Supabase target against the hosted backend before running any Live_Cloud_Command, consistent with `operational-wiring` Requirements 6.4 and 7.1.
5. IF a Live_Cloud_Command would delete, overwrite, or reduce the permissions of an existing cloud resource (for example changing the `dashboard-read-proxy` invoker grant), THEN THE System SHALL present a distinguishable warning identifying the affected resource and effect and SHALL NOT execute the command until the operator approves.
6. IF the active gcloud project or account, or the resolved Supabase target, does not match the expected target, THEN THE System SHALL abort the Live_Cloud_Command and surface the mismatch rather than executing against an unintended project, identity, or backend.
7. THE System SHALL record only non-secret references (verdict counts, firing-setup counts, Decision_Dates, revisions, URLs) from the live operations and SHALL NOT record any secret value.

### Requirement 10: End-to-End Success Criterion — Task 17 Smoke Checks Pass Against Real Data

**User Story:** As the system owner, I want the dashboard-ui read-only smoke verification to pass against real hosted data, so that the whole activation effort is confirmed end-to-end rather than only in parts.

#### Acceptance Criteria

1. WHEN `dashboard-ui` Task 17's read-only smoke verification runs after the operations of Requirements 1–9, THE System SHALL cause the public dashboard URL to serve the latest firing Decision_Date returned by `v_decision_dates`, sourced from the real hosted `firing_setups` data.
2. WHEN the Read_Proxy receives a write request (a non-GET/HEAD method), THE Read_Proxy SHALL reject the request with HTTP 405, preserving the read-only serving guarantee.
3. WHEN the Read_Proxy receives a request for a query or resource outside the Allowlist, THE Read_Proxy SHALL reject the request with HTTP 400 or 404, preserving the select-only / allowlisted-resource guarantee.
4. THE System SHALL treat the activation as complete only WHERE the public URL serves a real Decision_Date AND the Read_Proxy rejects a write with 405 AND the Read_Proxy rejects a disallowed query with 400 or 404.
5. THE System SHALL NOT modify the Read_Proxy's firing logic, gate math, or the `fires()` predicate to make these smoke checks pass; the checks SHALL pass only because real recorded verdicts produced a real firing Decision_Date.
