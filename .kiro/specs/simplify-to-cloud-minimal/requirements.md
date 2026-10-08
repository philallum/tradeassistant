# Requirements Document

## Introduction

The FX Daily Pattern Trading Assistant became a production-grade platform before
its central premise — *do recent candle patterns carry useful 1–3 day
directional information?* — was ever measured. The `PROJECT-SIMPLICITY-AUDIT.md`
(see especially §13 and §14) concluded that the project is substantially more
complex than the original idea requires, and that the complexity lives almost
entirely in surrounding infrastructure, abstraction, and automatic
decision-making — not in the research.

This spec executes the audit's recommendation. It is a **simplification and
de-scope** of the existing, feature-complete system, driven by two decisions the
operator has confirmed:

1. **Measurement, not verdicts.** The software should *measure and report*
   whether the evidence suggests predictive value; it must not auto-decide that
   a strategy is "alive" or "dead." The two-stage kill-gate's measurement math is
   kept and reframed as a **human-read evaluation report**; the automatic
   `PASS`/`CUT` verdict and its dashboard auto-block are removed.
2. **Cloud-minimal, single-user, public-data.** Four binding operator
   constraints apply: execution must be a Cloud Run Job on Cloud Scheduler; the
   dashboard must be reachable from mobile at a public URL; the data is public
   and needs no protection; and GitHub Actions deployment is kept. Everything
   whose only justification was a hostile multi-tenant threat model — the
   read-proxy service, Row-Level Security, the scoped JWT writer role, read
   views, and the diagnostic read path — is removed. The Supabase account is also
   reconciled to a clean, required-only schema: earlier migrations left empty,
   superseded, and orphaned tables, so the system identifies exactly the objects
   it needs and removes everything else, rather than dropping only a known list.

Two execution principles govern this spec:

- **Measure before you rip out.** The kill-gate reframe and the first real
  evaluation report (Requirements 1–2) land *before* the destructive de-scope
  (Requirements 3–9), so the premise is measured against the existing machinery
  before that machinery is simplified.
- **Delete, don't quarantine.** The operator has chosen outright removal over
  branch-quarantine. Removed components are deleted from the codebase, the
  deploy, and the schema; their absence is proven by tests and a green build.

The research-integrity layer is explicitly out of scope for removal and must
survive intact: the look-ahead guard, the weekly-trend baseline, the Gate 1 /
Gate 2 measurement math, sample-size shrinkage, the realized-outcome journal,
the AI-never-scores guard, and the `RESEARCH-LOG`.

## Glossary

Terms from the parent spec (`fx-daily-pattern-assistant/requirements.md`) are
reused as-is: **System**, **Pair / Asset**, **Decision_Date**,
**Session_Close / NY_Close**, **Direction_Class**, **Horizon**,
**Weekly_Trend_Follow baseline**, **MFE/MAE**, **Friction_Penalty**,
**Matured_Outcome**, **Look_Ahead_Safe**, **Earned_Confidence**,
**Out_Of_Sample_Test**, **Research_Log**, **Realized_Outcome_Journal**,
**Choppiness_Metric**, **Choppiness_Guard**, **Currency_Concentration_Guard**,
**External_Reference_Signal**, **LLM_Interface**. New terms for this spec:

- **Measurement_Engine**: The deterministic computation in `src/kill-gate/`
  (`gate1.ts`, `gate2.ts`, walk-forward pooling in `verdict.ts`) that produces
  model-vs-baseline directional accuracy, the accuracy delta, friction-adjusted
  MFE/MAE excursion margins, and sample sizes. This is retained.
- **Evaluation_Report**: The structured output of the Measurement_Engine for a
  configuration over the Out_Of_Sample_Test — a set of *metrics with
  uncertainty* intended for human interpretation. It contains predictions count,
  sample size, directional accuracy, baseline accuracy, delta-vs-baseline,
  friction-adjusted performance, MFE/MAE summary, strength breakdown, and a
  statistical-uncertainty indication for the sample size. It carries **no**
  `PASS`/`CUT`/`KILL` field.
- **Kill_Verdict (removed)**: The former `verdict: "PASS" | "CUT"` collapse in
  `composeGateVerdict` and the `GATE1_MIN_DELTA` / Gate-2-`margin>=0` thresholds
  used as a binary switch. Removed by this spec.
- **Gate_Auto_Block (removed)**: The former live-path enforcement
  (`src/pipeline/gatePassingResolver.ts`, parent Requirement 12.3) that prevented
  a configuration which had not "passed" from driving a displayed signal. Removed
  by this spec.
- **Read_Side_Security (removed)**: The collection of protection mechanisms whose
  sole purpose was guarding read/write access against untrusted parties — the
  read-proxy service (`services/read-proxy/`), Row-Level Security, the
  `pipeline_writer` scoped JWT role, the dashboard read views, and the diagnostic
  read path (migrations `...002`, `...003`, `...005` and related `src/ops`
  tooling). Removed by this spec.
- **Public_Read_Path**: The replacement read path for the dashboard under public
  data — the hosted SPA reads directly from the public-readable datastore, or
  from a JSON snapshot the Cloud_Run_Job writes, with no intermediating proxy and
  no authentication gate.
- **Cloud_Minimal_Spine**: The retained delivery infrastructure the operator
  constraints require — Cloud Run Job, Cloud Scheduler, Secret Manager (for API
  keys and the single DB write credential), Artifact Registry, the hosted
  datastore, the hosted mobile dashboard, and the GitHub Actions deploy.
- **Suppressor (removed)**: A deterministic dashboard-level mechanism that
  silently hides an otherwise-firing setup — specifically the Choppiness_Guard
  and the Currency_Concentration_Guard. Removed as *suppressors* by this spec;
  the Choppiness_Metric is retained only as a **displayed field**.
- **Write_Credential**: The single credential the Cloud_Run_Job uses to write to
  the datastore, stored in Secret Manager and referenced by name only. Under
  public data this replaces the scoped JWT role: public read is open, but the
  write path is not publicly writable.

## Requirements

### Requirement 1: Reframe the Kill-Gate as a Human-Read Evaluation Report

**User Story:** As the operator, I want the system to report whether the evidence
suggests the pattern approach has predictive value, rather than automatically
deciding the research is alive or dead, so that interpretation stays with me.

#### Acceptance Criteria

1. THE System SHALL retain the Measurement_Engine (Gate 1 directional comparison
   and Gate 2 friction-adjusted MFE/MAE comparison) as deterministic,
   look-ahead-safe computation.
2. THE System SHALL produce an Evaluation_Report for a configuration over the
   Out_Of_Sample_Test containing, at minimum: predictions count, sample size,
   model directional accuracy, baseline directional accuracy, delta-vs-baseline,
   friction-adjusted performance, an MFE/MAE summary, a confidence/strength
   breakdown, and an indication of statistical uncertainty appropriate to the
   sample size.
3. THE System SHALL NOT emit a `PASS`, `CUT`, or `KILL` verdict field from the
   evaluation path, and SHALL remove the `Kill_Verdict` collapse from
   `composeGateVerdict` (or its successor).
4. THE System SHALL remove the Gate_Auto_Block so that no configuration is
   prevented from driving a displayed observation on the basis of an automatic
   gate decision (superseding parent Requirement 12.3).
5. WHERE the former `GATE1_MIN_DELTA` (+3pp) or Gate-2 `margin>=0` thresholds are
   retained in any form, THE System SHALL use them only as non-binding
   annotations on the Evaluation_Report (for example "delta exceeds 3pp") and
   SHALL NOT use them to hide, suppress, or block any displayed data.
6. WHEN the evaluation runs twice on identical inputs, THE System SHALL produce
   an identical Evaluation_Report (deterministic computation preserved).
7. THE System SHALL continue to enforce that no LLM output reaches the
   Measurement_Engine or the Evaluation_Report metrics (parent Requirement 2
   AI-never-scores guard is preserved).

### Requirement 2: Record the First Real Evaluation in the Research Log

**User Story:** As the operator, I want the first honest, out-of-sample
evaluation of the shape-only pattern approach recorded in the Research_Log, so
that the central premise is finally measured before any rearchitecting.

#### Acceptance Criteria

1. THE System SHALL run the Measurement_Engine over the backfilled history on a
   fixed, recorded chronological out-of-sample split for the shape-only
   configuration.
2. WHEN that evaluation completes, THE System SHALL append the resulting
   Evaluation_Report to `RESEARCH-LOG.md` as an evaluation entry, recording its
   metrics and sample size.
3. THE System SHALL record the exact split dates used, and IF a later run
   attempts to change the recorded split dates, THEN THE System SHALL reject the
   change and retain the recorded dates (look-ahead integrity preserved).
4. THE System SHALL present the Evaluation_Report entry as evidence for human
   interpretation and SHALL NOT annotate it with an automated alive/dead verdict.
5. IF the matched out-of-sample sample size is below the recorded minimum for a
   meaningful read, THEN THE System SHALL still record the report and SHALL
   explicitly state the sample-size limitation rather than withholding or
   fabricating a result.
6. THE System SHALL complete Requirement 1 (the reframe) before this requirement
   is executed, so the first recorded evaluation is already in report form.

### Requirement 3: Remove the Automatic Decision and Suppression Machinery

**User Story:** As the operator, I want the software to stop silently hiding
setups from me, so that I see the evidence and make the trade/no-trade decision.

#### Acceptance Criteria

1. THE System SHALL remove the Choppiness_Guard as a Suppressor so that it no
   longer silences any otherwise-firing setup.
2. THE System SHALL retain the Choppiness_Metric computation and SHALL expose it
   as a displayed field on the relevant observation rather than as a suppressor.
3. THE System SHALL remove the Currency_Concentration_Guard as a Suppressor so
   that it no longer drops any setup; WHERE same-currency exposure information is
   useful, THE System MAY display it as context but SHALL NOT suppress on it.
4. THE System SHALL remove the Gate_Auto_Block code path
   (`src/pipeline/gatePassingResolver.ts` or its successor) and all callers that
   consult a gate verdict to decide whether to display a setup.
5. WHEN the daily run produces observations after these removals, THE System
   SHALL display every pair's observation (including an explicit "no trade" when
   the deterministic model does not fire) without any suppression step, subject
   only to data availability.
6. THE System SHALL update or remove any test that asserted suppression or
   auto-block behavior, replacing it with a test asserting the absence of
   suppression.

### Requirement 4: Remove the Read-Side Security Layer (Public Data)

**User Story:** As the operator, I want the read-side security apparatus removed
because the data is public and needs no protection, so that the system is far
simpler to run and reason about.

#### Acceptance Criteria

1. THE System SHALL remove the read-proxy service (`services/read-proxy/`) in its
   entirety, including its source, tests, Dockerfile, and any deploy reference.
2. THE System SHALL remove Row-Level Security, the `pipeline_writer` scoped JWT
   role, the dashboard read views, and the diagnostic read path from the schema
   via a new, version-controlled migration that drops or supersedes migrations
   `...002` (RLS/scoped write), `...003` (read views RLS), and `...005`
   (diagnostic read path), applied identically to local and hosted targets.
3. THE System SHALL remove the `src/ops` tooling that existed solely to provision
   or verify Read_Side_Security (for example `write-credential` and the
   diagnostic read-path tooling) and SHALL leave no dangling references.
4. THE System SHALL remove the public-URL authentication gate concern entirely:
   no Firebase Auth, shared-token, or IAP gate is introduced, and the dashboard
   is served at a public URL.
5. THE System SHALL ensure the datastore permits public read of the
   compute-written tables while keeping the write path non-public, so that the
   dashboard reads without a credential but anonymous parties cannot write.
6. WHEN Read_Side_Security is removed, THE System SHALL retain the single
   Write_Credential (stored in Secret Manager, referenced by name only) as the
   only credential the Cloud_Run_Job needs to write.

### Requirement 5: Establish the Public Read Path for the Dashboard

**User Story:** As the operator, I want the hosted dashboard to read data without
the removed proxy, so that mobile access keeps working after the de-scope.

#### Acceptance Criteria

1. THE System SHALL provide a Public_Read_Path by which the hosted SPA obtains
   the data it displays — either direct read of the public-readable datastore or
   a JSON snapshot written by the Cloud_Run_Job — without an intermediating proxy
   service and without an authentication gate.
2. WHERE a JSON snapshot is used, THE Cloud_Run_Job SHALL write it as part of the
   daily run, and THE SPA SHALL read it read-only.
3. THE System SHALL keep the SPA strictly read-only (it never writes to the
   datastore), consistent with the parent serving-separation intent but without
   the removed proxy.
4. WHEN the dashboard is loaded on a mobile browser at its public URL, THE System
   SHALL render the daily observations, the prediction-vs-actual history, the
   External_Reference_Signal, and the Gemini opinion.
5. IF the Public_Read_Path data is unavailable for a Decision_Date, THEN THE
   dashboard SHALL show an explicit empty/unavailable state rather than a
   fabricated reading.

### Requirement 6: Retain the Cloud-Minimal Delivery Spine

**User Story:** As the operator, I want the cloud execution, scheduling, secrets,
and GitHub deployment kept, because cloud execution and mobile access are binding
constraints, so that the daily run and dashboard operate unattended.

#### Acceptance Criteria

1. THE System SHALL retain the Cloud Run Job as the unattended daily execution of
   the deterministic daily run.
2. THE System SHALL retain exactly one Cloud Scheduler trigger firing the Cloud
   Run Job once per trading day at the Session_Close cadence.
3. THE System SHALL retain Secret Manager as the runtime source of the API keys
   (for example the Gemini and External_Reference_Signal providers) and the
   single Write_Credential, referencing every secret by name only.
4. THE System SHALL retain Artifact Registry and the container image build used
   to deploy the Cloud Run Job.
5. THE System SHALL retain the GitHub Actions deployment of the Cloud Run Job and
   the hosted dashboard.
6. THE System SHALL simplify the deploy pipeline to remove any step, path filter,
   secret, environment variable, or role that existed solely for the removed
   Read_Side_Security or the removed read-proxy service, and SHALL NOT remove the
   steps required to deploy the Job and the dashboard.
7. WHERE the deploy identity currently uses keyless Workload Identity Federation,
   THE System SHALL retain whichever working identity mechanism is already in
   place and SHALL NOT be required to add further deploy-identity ceremony.

### Requirement 7: Remove Research/Software Complexity Not Serving the Core Idea

**User Story:** As the operator, I want the subsystems that solve problems we do
not yet have removed, so that the codebase reflects the proven-first discipline.

#### Acceptance Criteria

1. THE System SHALL remove the Python cross-check (`python/`) of the
   confidence-shrinkage formula, relying on the authoritative TypeScript
   property test, and SHALL remove its invocation from any Makefile target or
   developer workflow.
2. THE System SHALL remove the research-assistant module (`src/research-assistant/`)
   and any callers.
3. THE System SHALL remove the architecture serving-layer guard
   (`src/architecture/servingLayerGuard`) whose boundary is obsolete once the
   read-proxy is gone, and SHALL remove its test.
4. THE System SHALL remove the Strategy_Source multi-strategy attribution from
   the active schema and code, retaining at most a single plain column default if
   one is required by existing rows, and SHALL NOT retain the multi-strategy
   abstraction.
5. THE System SHALL defer-by-removal the feature-discovery program for v1 — the
   feature registry, the candidate-feature set, and the yield ingestion
   (`src/yields/`, the `yields` table) — because no feature has earned inclusion
   and the base signal is unproven, and SHALL remove the `yields` table via
   migration.
6. THE System SHALL remove the risk-boundaries module if it is not consumed by
   the retained display path, and IF it is consumed, THEN THE System SHALL retain
   only the minimal displayed form.
7. WHEN each removal in this requirement is applied, THE System SHALL leave no
   dangling imports, dead exports, failing types, or orphaned tests.

### Requirement 8: Reduce the Data Model to the Cloud-Minimal Set

**User Story:** As the operator, I want the schema reduced to the few tables the
simplified system needs, so that persistence is easy to understand.

#### Acceptance Criteria

1. THE System SHALL reduce the active schema to the retained set: candles,
   pattern vectors, matured analogue outcomes, predictions/firing observations,
   realized outcomes, and evaluation reports — this retained set being the
   Required_Object_Set defined authoritatively in Requirement 10.
2. THE System SHALL replace the `gate_verdicts` and `gate_fold_verdicts` tables
   with an `evaluation_reports` representation that stores the measured metrics
   and carries no `verdict` column.
3. THE System SHALL remove the `yields`, `data_splits`/`walk_forward_folds` (or
   fold them into a single recorded split reference), `feature_registry`,
   `calendar_events`/`news_risk_flags`, and `version_ledger` tables from the
   active schema where they are no longer used by the retained path.
4. THE System SHALL express every schema change as a version-controlled,
   idempotent migration applied identically to local and hosted targets.
5. WHEN a migration drops a table or policy, THE System SHALL ensure no retained
   code reads or writes the dropped object.
6. THE System SHALL preserve the Realized_Outcome_Journal data (predictions
   paired with actual outcomes) across the schema reduction.

### Requirement 9: Preserve Research Integrity and Prove the Simplification

**User Story:** As the operator, I want the simplification to preserve every
anti-self-deception safeguard and to be provably complete, so that I lose no
rigour and no broken state is left behind.

#### Acceptance Criteria

1. THE System SHALL retain, unchanged in behavior, the look-ahead guard, the
   weekly-trend baseline, the Measurement_Engine math, sample-size shrinkage, the
   Realized_Outcome_Journal, the AI-never-scores guard, and the `RESEARCH-LOG`.
2. THE System SHALL keep lint, type-check, and the test suite green at every
   committed step of the de-scope.
3. WHEN a component is deleted, THE System SHALL also delete its tests and any
   references, so the suite reflects the simplified system with no skipped or
   dead tests standing in for removed behavior.
4. THE System SHALL update the living documents (`PROJECT-STATE.md`, and the
   relevant spec statuses) to reflect the removed subsystems and the
   cloud-minimal architecture.
5. THE System SHALL sequence the work so that Requirements 1 and 2 (reframe and
   first evaluation) are completed before the destructive removals in
   Requirements 3–8 begin.
6. WHERE a removal would break the deployed daily run or the dashboard, THE
   System SHALL update the daily-run wiring and the Public_Read_Path in the same
   change so the end-to-end loop stays functional after each step.
7. THE System SHALL confirm, by a passing end-to-end check, that after the
   de-scope the daily run executes in the Cloud Run Job, writes predictions and
   realized outcomes, and the hosted mobile dashboard reads them via the
   Public_Read_Path.

### Requirement 10: Reconcile the Supabase Account to a Clean, Required-Only Schema

**User Story:** As the operator, I want the Supabase account reconciled to only
the tables the simplified system actually needs — with every leftover, empty, or
orphaned object from earlier migrations removed — so that the database is clean
and reflects the real system rather than its history.

#### Glossary addition

- **Required_Object_Set**: The authoritative, version-controlled list of
  database objects the simplified system needs — tables, views, indexes,
  functions, roles, and policies. For v1 the required *tables* are: `candles`,
  `pattern_vectors`, `analogue_outcomes` (matured forward outcomes consumed by
  retrieval), `predictions`/`firing_setups` (the daily observation record),
  `realized_outcomes`, and `evaluation_reports`. The exact final list is fixed in
  design, but it is defined positively (what is kept) and everything else is
  removed.
- **Orphaned_Object**: Any table, view, index, function, role, or policy present
  in the Supabase account that is **not** in the Required_Object_Set — including
  empty tables, tables superseded by later migrations, display/legacy tables no
  longer read or written by retained code (for example `yields`, `data_splits`,
  `walk_forward_folds`, `gate_verdicts`, `gate_fold_verdicts`, `feature_registry`,
  `calendar_events`, `news_risk_flags`, `version_ledger`, `signal_rationale` and
  `external_reference_comparison` if their function is folded into the retained
  `predictions`/snapshot, the dashboard read views, and the diagnostic read-path
  objects), and any object created out-of-band that is not reproduced by a
  committed migration.

#### Acceptance Criteria

1. THE System SHALL define a single authoritative Required_Object_Set in a
   version-controlled artifact (the migration set plus a short manifest comment),
   defined positively as the objects to keep.
2. THE System SHALL enumerate the objects actually present in the Supabase
   account (tables, views, indexes, functions, roles, policies in the `public`
   schema and any project-created schema) at reconciliation time, so the cleanup
   acts on the real account contents rather than only on what the migration
   history is assumed to have created.
3. THE System SHALL classify every enumerated object as either a member of the
   Required_Object_Set or an Orphaned_Object.
4. THE System SHALL remove every Orphaned_Object via a version-controlled,
   idempotent migration, so that after reconciliation the account contains only
   the Required_Object_Set.
5. THE System SHALL make the reconciliation idempotent: re-running it against an
   already-clean account SHALL make no further changes and SHALL report the
   account as already reconciled.
6. BEFORE dropping any object that contains rows that must be preserved (in
   particular the Realized_Outcome_Journal data), THE System SHALL migrate that
   data into a Required_Object_Set table, consistent with Requirement 8.6, and
   SHALL NOT drop a data-bearing object until its data is preserved or the
   operator has confirmed the data is disposable.
7. WHEN the reconciliation runs against a cost-incurring or shared live target,
   THE System SHALL present the exact set of objects to be dropped to the
   operator for approval before executing, and SHALL NOT drop any object until
   the operator approves (consistent with the operational-safety intent of the
   parent operational-wiring spec).
8. THE System SHALL apply the reconciliation identically to the local and hosted
   Supabase targets so the two schemas match.
9. WHEN reconciliation completes, THE System SHALL emit a report listing the
   retained objects and the dropped Orphaned_Objects (names only; no secret
   values), and SHALL treat the account as clean only WHERE the live object
   enumeration equals the Required_Object_Set.
10. THE System SHALL ensure no retained code references any dropped object (no
    read, write, view dependency, or role claim), consistent with Requirements
    8.5 and 9.3.
### Requirement 11: Reconcile the GCP Project to a Clean, Required-Only Resource Set

**User Story:** As the operator, I want the Google Cloud project reconciled to
only the resources the simplified system actually needs — with the services,
jobs, secrets, images, service accounts, IAM bindings, and schedulers left over
from the removed subsystems and earlier provisioning deleted — so that the cloud
project is clean, cheaper, and lower-risk, rather than carrying its history.

#### Glossary addition

- **Required_GCP_Resource_Set**: The authoritative, version-controlled list of
  GCP resources the simplified system needs in project `trade-assistant-508806`.
  For v1 this is: the daily **Cloud Run Job** (`scheduled-daily-run`); exactly
  one **Cloud Scheduler** job triggering it at Session_Close; the **service
  accounts** actually used — the Job runtime SA, the Scheduler invoker SA
  (`scheduler-invoker@…`), and the deploy SA (`gh-deploy@…`) — each holding only
  the roles it needs (`roles/run.invoker`, `roles/secretmanager.secretAccessor`,
  `roles/aiplatform.user` for Vertex AI, `roles/firebasehosting.admin` for the
  deploy SA, and the minimal build/registry roles); the **Secret Manager**
  secrets still referenced at runtime (the single Write_Credential plus the API
  keys the retained providers use — the Gemini/Vertex path and the
  External_Reference_Signal provider); the **Artifact Registry** repository with
  a minimal retention of recent Job images; the **Firebase Hosting** site; and
  the **Workload Identity Federation** pool/provider backing the keyless deploy.
  The exact final list is fixed in design, defined positively (what is kept);
  everything else is removed.
- **Orphaned_GCP_Resource**: Any GCP resource in the project that is **not** in
  the Required_GCP_Resource_Set — in particular the removed **read-proxy** Cloud
  Run service (`dashboard-read-proxy`) and its images; the one-shot
  **`dashboard-seed-run`** Cloud Run Job once seeding is complete; the obsolete
  **`supabase-key` scoped-JWT** secret superseded by the Write_Credential (if a
  distinct secret) and the **provider secrets no longer used** after the yields
  and news removals (for example `YIELD_API_KEY`, `NEWS_CALENDAR_API_KEY`, and
  any listed-but-unreferenced keys such as `TWELVE_DATA_API_KEY`,
  `MASSIVE_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY`, `NEWS_API_KEY`);
  **stale Artifact Registry images** beyond the retention window and all
  read-proxy images; **IAM role bindings** granted for removed resources; and any
  **service account** no longer used by a retained resource.

#### Acceptance Criteria

1. THE System SHALL define a single authoritative Required_GCP_Resource_Set in a
   version-controlled artifact (a committed resource manifest alongside the
   existing `ops/*.config.json` provisioning artifacts), defined positively as
   the resources to keep.
2. THE System SHALL enumerate the resources actually present in the live GCP
   project at reconciliation time — Cloud Run services and jobs, Cloud Scheduler
   jobs, Secret Manager secrets, Artifact Registry repositories and images,
   service accounts, and the IAM policy bindings referencing them — using
   read-only `gcloud … list` / describe queries, so the cleanup acts on the real
   project contents rather than only on what the committed artifacts are assumed
   to have created.
3. THE System SHALL classify every enumerated resource as either a member of the
   Required_GCP_Resource_Set or an Orphaned_GCP_Resource.
4. THE System SHALL remove every Orphaned_GCP_Resource, and WHERE the removal is
   a Live_Cloud_Command, THE System SHALL perform it under the operational-safety
   protocol of the parent operational-wiring spec (reconcile the active project
   and account first, present the exact command to the operator, and execute only
   after operator approval).
5. THE System SHALL present the full set of resources to be deleted to the
   operator for approval before any deletion, SHALL distinguish destructive and
   cost-reducing effects, and SHALL NOT delete any resource until the operator
   approves — because GCP resource deletion is not reversible from the repo
   alone.
6. THE System SHALL remove the `dashboard-read-proxy` Cloud Run service and its
   images as part of this reconciliation, consistent with the read-proxy removal
   in Requirement 4.
7. THE System SHALL retire the one-shot `dashboard-seed-run` Cloud Run Job once
   the hosted backfill it performed is complete and is not required for a pending
   re-seed, deleting it rather than leaving it idle.
8. THE System SHALL delete the obsolete `supabase-key` scoped-JWT secret and the
   provider secrets no longer referenced by retained code after the yields and
   news removals, confirming by inspection that no retained Config_Env_Key or
   `--set-secrets` entry in the deploy pipeline still references a deleted secret.
9. THE System SHALL apply a minimal retention policy to Artifact Registry so that
   only a bounded number of recent Job images are kept and read-proxy / stale
   images are removed.
10. THE System SHALL prune IAM role bindings and service accounts that exist
    solely for Orphaned_GCP_Resources, so that no removed resource leaves a
    dangling grant, while retaining every binding the Required_GCP_Resource_Set
    needs.
11. THE System SHALL make the reconciliation re-runnable: re-running the
    enumeration against an already-clean project SHALL identify no
    Orphaned_GCP_Resource and SHALL report the project as already reconciled.
12. WHEN reconciliation completes, THE System SHALL emit a report listing the
    retained resources and the deleted Orphaned_GCP_Resources (resource names and
    identifiers only; never a secret value), and SHALL treat the project as clean
    only WHERE the live enumeration equals the Required_GCP_Resource_Set.
13. THE System SHALL verify, after reconciliation, that the retained daily loop
    still functions — the Cloud Run Job executes, the Scheduler triggers it, and
    the deploy pipeline still deploys the Job and the dashboard — so the cleanup
    does not break the Cloud_Minimal_Spine (Requirement 6) or the end-to-end
    check (Requirement 9.7).
