# Implementation Plan

Measurement-first, delete-not-quarantine. Each task leaves `make check` (lint +
typecheck + vitest) green and the end-to-end daily loop functional. The phases
follow the design's 7-step sequencing: **measure before you rip out** (Phase 1),
then the destructive removals, then the public read path, deploy, and cloud
reconcile, then end-to-end verification.

> Live-cloud tasks (Supabase hosted migration, GCP reconcile, deploy) are run
> under the operational-safety protocol: reconcile project/account first, show
> the exact command, execute only on operator approval. These are marked ☁️.

## Phase 1 — Reframe the kill-gate to an evaluation report, record the first evaluation (R1, R2)

- [x] 1. Introduce the `EvaluationReport` type and `composeEvaluationReport`
  - Add `EvaluationReport` to `src/kill-gate/types.ts` (metrics + sample-size-aware
    uncertainty + non-binding `annotations`; **no `verdict` field**).
  - Rename/replace `composeGateVerdict` → `composeEvaluationReport` in
    `src/kill-gate/verdict.ts`, keeping `evaluateGate1`/`evaluateGate2` math unchanged.
  - Keep `GATE1_MIN_DELTA` / Gate-2 `margin>=0` only as `annotations.deltaExceeds3pp` /
    `annotations.riskAdjNonNegative` (non-binding).
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6_

- [x] 1.1 Add deterministic uncertainty to the report
  - Compute a Wald confidence interval on the accuracy delta from the matched
    sample size; include an explicit low-n note when the matched subset is small.
  - Property test: identical inputs → identical report; CI widens as n shrinks.
  - _Requirements: 1.6, 2.5_

- [x] 1.2 Preserve the AI-never-scores guard over the new path
  - Assert via test that no LLM output reaches `composeEvaluationReport` or any
    report metric (reuse/extend `ScoringInputGuard`).
  - _Requirements: 1.7_

- [x] 2. Add the `evaluation_reports` persistence (local migration first)
  - New migration `...006` (local target): create `evaluation_reports` (schema per
    design; no `verdict` column). Add a `storage/supabase` adapter to persist a report.
  - Replace the `GateVerdictStore` write path usage in the evaluation flow with the
    report store; leave `gate_verdicts` table in place for now (dropped in Phase 4).
  - _Requirements: 1.3, 8.2_

- [x] 2.1 Living-Docs: evaluation-report entry in RESEARCH-LOG
  - Add an `appendEvaluationReport()` path to `src/living-docs/` that renders the
    report metrics (no PASS/CUT). Retire `appendVerdict`/`appendCut` usage from the
    evaluation flow (keep the functions only if still referenced; else remove).
  - Validate the entry shape with a test.
  - _Requirements: 2.2, 2.4_

- [x] 2.2 ☁️ Run the first real evaluation and record it
  - Run the measurement engine over the fixed, recorded chronological OOS split for
    the shape-only config against the backfilled history.
  - Append the resulting `EvaluationReport` to `RESEARCH-LOG.md`; record the exact
    split dates; if the matched sample is below the meaningful-read floor, record the
    report and state the limitation explicitly.
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

## Phase 2 — Remove the auto-block and the suppressors (R3)

- [x] 3. Simplify the firing condition
  - `fires()` (`src/dashboard/dashboard.ts`) → `direction !== "FLAT" && earnedConfidence >= threshold`.
  - Remove `gatePassing` and `newsSuppressed` from `PairEvaluation`; add a displayed
    `choppiness` number.
  - Update `persistFiringSetups.ts`: drop the gate/news/choppiness/concentration
    suppression branches; retain `below_floor` and `not_fired`.
  - _Requirements: 3.4, 3.5_

- [x] 3.1 Delete the gate-passing resolver and its wiring
  - Delete `src/pipeline/gatePassingResolver.ts` and `makeGatePassingResolver`; remove
    its construction/wiring in `src/scheduled-run/main.ts` and the `gatePassing` dep in
    `src/pipeline/`.
  - _Requirements: 3.4_

- [x] 3.2 Remove the choppiness guard as a suppressor; keep the metric
  - Delete the Choppiness_Guard suppression code and tests; retain the choppiness/
    efficiency computation and surface it as a displayed field on the observation.
  - _Requirements: 3.1, 3.2_

- [x] 3.3 Remove the currency-concentration guard as a suppressor
  - Delete the concentration suppressor and its `competing_pairs` plumbing; optionally
    keep same-currency info as display context only.
  - _Requirements: 3.3_

- [x] 3.4 Replace suppression tests with no-suppression tests
  - Delete tests asserting gate/news/choppiness/concentration suppression; add tests
    asserting every pair's observation is displayed (incl. explicit "no trade") and
    choppiness is a field, not a gate.
  - _Requirements: 3.5, 3.6, 9.3_

## Phase 3 — Remove complexity not serving the core idea (R7)

- [x] 4. Remove the Python cross-check
  - Delete `python/`; remove its invocation from the Makefile and any dev workflow.
  - _Requirements: 7.1_

- [x] 4.1 Remove the research-assistant module
  - Delete `src/research-assistant/` and all callers.
  - _Requirements: 7.2_

- [x] 4.2 Remove the architecture serving-layer guard
  - Delete `src/architecture/servingLayerGuard` and its test (its boundary is obsolete
    once the read-proxy goes).
  - _Requirements: 7.3_

- [x] 4.3 Remove the Strategy_Source multi-strategy abstraction
  - Collapse `realized_outcomes.strategy_id` to a plain default (or drop it if no
    retained reader needs it); remove the multi-strategy types/branches.
  - _Requirements: 7.4_

- [x] 4.4 Remove yields + feature-discovery program
  - Delete `src/yields/`, the feature registry, and the candidate-feature set and their
    tests/callers (the `yields`/`feature_registry` tables are dropped in Phase 4).
  - _Requirements: 7.5_

- [x] 4.5 Confirm risk-boundaries stays (display only)
  - Keep `src/risk-boundaries/` as the firing-card SL/TP source; add/retain a test that
    it is display-only and feeds no scoring path.
  - _Requirements: 7.6_

- [x] 4.6 Prove no dangling references after Phase 3
  - `make check` green: no dead imports/exports, no failing types, no orphaned tests.
  - _Requirements: 7.7, 9.2, 9.3_

## Phase 4 — Reduce the schema + reconcile Supabase (R8, R10)

- [x] 5. Author the schema-reduction migration (`...006`, local)
  - Extend `...006` to drop `gate_verdicts`, `gate_fold_verdicts`, `yields`,
    `data_splits`, `walk_forward_folds`, `feature_registry`, `calendar_events`,
    `news_risk_flags`, `version_ledger`, `signal_rationale`,
    `external_reference_comparison`, the read views, RLS policies, the
    `pipeline_writer` role, and the diagnostic read-path objects.
  - Before dropping data-bearing objects, migrate realized-outcome rows into the
    retained `realized_outcomes` shape.
  - Grant public `SELECT` on the retained tables; restrict `INSERT`/`UPDATE` to the
    single Write_Credential (no RLS row policies).
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 4.2, 4.5, 4.6_

- [x] 5.1 Define the authoritative Required_Object_Set + enumeration
  - Add a short manifest comment listing the kept objects; write the
    `information_schema`/`pg_catalog` introspection query used to enumerate the live
    account and diff it against the Required_Object_Set.
  - _Requirements: 10.1, 10.2, 10.3_

- [x] 5.2 Make the reconciliation idempotent + no dangling references
  - The migration leaves exactly the Required_Object_Set; re-running is a no-op.
  - Grep/typecheck proves no retained code reads/writes a dropped object (incl. role
    claims and view deps).
  - _Requirements: 10.4, 10.5, 10.10, 8.5, 9.3_

- [x] 5.2a ☁️ Cut over the Write_Credential before the reconcile (operator-approved)
  - PRECONDITION for 5.3, surfaced by the live enumeration: migration `...006` STEP 6
    drops the `pipeline_writer` role (the identity the Cloud_Run_Job currently writes
    with via the scoped ES256 JWT in the `supabase-key` secret), and STEP 7 grants
    `INSERT`/`UPDATE` to the single Write_Credential role `fx_writer` — but `fx_writer`
    does NOT exist on hosted and the grant is guarded `if exists`, so applying `...006`
    as-is would leave the datastore public-read with NO working write path for the Job
    (R4.5, R4.6). This task establishes the replacement write path so the drop of
    `pipeline_writer` is safe.
  - DESIGN DECISION (operator-approved): the Job writes through PostgREST (REST, not direct
    Postgres), so `fx_writer` must be a PostgREST SCOPED-JWT role mirroring the existing
    `pipeline_writer` model — a NOLOGIN role that `authenticator` is a member of, reached via
    a JWT whose `role` claim is `fx_writer`. A bare password/login role is NOT reachable
    through `/rest/v1` and is explicitly rejected here. This keeps the client/deploy shape
    unchanged (two headers: publishable `apikey` + Bearer scoped JWT); only the role name and
    the signed JWT change. (Current write path: `src/storage/supabase/client.ts` sends
    `apikey` + `Authorization: Bearer <JWT>`; `src/storage/supabaseConfig.ts` resolves
    `SUPABASE_HOSTED_KEY`=Bearer JWT and `SUPABASE_PUBLISHABLE_KEY`=apikey; `deploy.yml`
    injects `SUPABASE_HOSTED_KEY=supabase-key:latest` + `SUPABASE_PUBLISHABLE_KEY=
    supabase-publishable-key:latest`.)
  - _Requirements: 4.5, 4.6, 8.4_

- [x] 5.2a.1 Fix migration `...006` STEP 7 to make `fx_writer` a usable PostgREST write role (local)
  - In `...006` STEP 7, in addition to the existing table grants, add the membership grant
    `grant fx_writer to authenticator` (guarded `if exists authenticator`, re-runnable) so
    PostgREST can `SET ROLE fx_writer`; without it a `fx_writer` JWT is rejected with
    `42501 permission denied to set role "fx_writer"` (same reason migration `...002` grants
    `pipeline_writer to authenticator`). Keep `grant usage on schema public to fx_writer` and
    the SELECT/INSERT/UPDATE (NO DELETE) grants on the six retained tables. Still NO RLS row
    policies (public-data model). Keep the whole block guarded on `fx_writer` existence +
    idempotent.
  - Update the migration guard test (`src/storage/schemaReconcileMigration.test.ts`) to assert
    the `authenticator` membership grant is present. `make check` green.
  - _Requirements: 4.5, 4.6, 8.3, 10.5_

- [x] 5.2a.2 Confirm the client/config need no change for the role swap (local)
  - Verify (and add/adjust a test if useful) that `supabaseConfig.ts` + `client.ts` are
    role-name-agnostic: they carry whatever Bearer JWT is in `supabase-key` and whatever
    `apikey` is in `supabase-publishable-key`, so swapping the JWT's `role` claim from
    `pipeline_writer` to `fx_writer` requires NO code change. Document this explicitly so the
    cutover is a secret rotation, not a code edit. (If any code hardcodes `pipeline_writer`,
    remove that coupling.)
  - _Requirements: 4.6, 9.3_

- [x] 5.2a.3 ☁️ Provision `fx_writer` on hosted + mint and store its JWT (operator-approved)
  - Create the `fx_writer` NOLOGIN role on hosted and `grant fx_writer to authenticator`
    (this is exactly what 5.2a.1's STEP 7 does when `...006` is applied; if provisioning
    BEFORE the full `...006` apply, run just those two statements out-of-band so the write
    path exists first — operator-approved, shown exactly, idempotent).
  - Mint a signed JWT with `role: fx_writer` using the project's JWT signing key (the same
    asymmetric-key model as the `pipeline_writer` JWT); store it as the `supabase-key` Secret
    Manager secret (new version), referenced BY NAME only — never a value in the repo or logs.
    The publishable `apikey` secret is unchanged.
  - _Requirements: 4.5, 4.6, 8.3, 8.4_

- [x] 5.2a.4 ☁️ Verify the Job can write as `fx_writer` BEFORE 5.3 drops `pipeline_writer`
  - With the new `supabase-key` JWT in place, run a scoped write check against hosted
    (operator-approved): confirm INSERT/UPDATE succeed on the retained tables as `fx_writer`
    and that DELETE is refused (no DELETE grant). Prefer a one-off `src/ops` write-check over
    a full Job run; a full `gcloud run jobs execute` is acceptable once the secret is live.
  - Only once this is GREEN is task 5.3 safe to apply (dropping `pipeline_writer` no longer
    removes the sole write path). Record the check result (names/outcome only, no secrets).
  - _Requirements: 4.5, 4.6, 8.4_

  - NOTE: `evaluation_reports` does not yet exist on hosted (migration `...006` has never been
    applied there); `...006` creates it before granting, so no extra step is needed — but
    after 5.3 confirm the `fx_writer` grants landed on all six retained tables.

- [x] 5.3 ☁️ Apply the reconcile to the hosted target (operator-approved)
  - DEPENDS ON 5.2a (the `fx_writer` write-path cutover) being green — do not apply until
    the Job writes as `fx_writer`, else dropping `pipeline_writer` breaks the daily run.
  - Take a fresh hosted backup first (schema + data + roles) and present the exact drop
    set to the operator; apply `...006` to hosted after approval. (A backup +
    read-only live enumeration were already performed once during the first 5.3 attempt;
    re-take the backup at apply time since the DB may have changed.)
  - Emit a report of retained vs dropped objects (names only); confirm the live
    enumeration equals the Required_Object_Set on local and hosted (zero orphaned rows).
  - _Requirements: 10.6, 10.7, 10.8, 10.9_

## Phase 5 — Delete the read-side security + build the Public Read Path (R4, R5)

- [x] 6. Write the dashboard JSON snapshot in the daily run
  - Add a snapshot writer to `src/scheduled-run/`: serialize the dashboard view +
    prediction-vs-actual history + external signal + Gemini opinion + evaluation
    summary to `dashboard.json`; write it to Hosting / a public bucket at the end of
    the run; fail-safe (a failed write logs and never corrupts persisted rows).
  - _Requirements: 5.1, 5.2_

- [x] 6.1 Repoint the SPA to the snapshot
  - Replace `web/src/api/` ten-endpoint client + `endpoints.ts` allowlist with a single
    typed `loadSnapshot()` fetching `dashboard.json`; keep the wire-format row types that
    describe the snapshot shape.
  - Remove the Firebase Hosting `/api` rewrite to the read-proxy; the SPA fetches a
    same-origin static asset; no auth gate.
  - Show an explicit empty/unavailable state when the snapshot is missing.
  - _Requirements: 5.1, 5.3, 5.4, 5.5, 4.4_

- [x] 6.2 Delete the read-proxy service (code)
  - Delete `services/read-proxy/` in full (source, tests, Dockerfile, deploy reference).
  - _Requirements: 4.1_

- [x] 6.3 Remove the read-side security ops tooling
  - Delete `src/ops` tooling that existed solely for Read_Side_Security (write-credential
    provisioning, diagnostic read-path tooling); leave no dangling references.
  - Retain the single Write_Credential (Secret Manager, by name) as the Job's only write
    credential.
  - _Requirements: 4.3, 4.6_

- [x] 6.4 Update SPA + core tests for the new read path
  - Delete read-proxy allowlist / RLS / endpoint-map tests; add tests for `loadSnapshot()`
    and the snapshot writer.
  - `make check` + `web` build/tests green.
  - _Requirements: 9.2, 9.3_

- [x] 6.5 Stop writing the dropped display tables in the daily run
  - Remove the `signal_rationale` / `external_reference_comparison` write from the daily
    run: delete the `makeDisplayDataPersister(supabase)(displayOnly)` call and its wiring
    in `src/scheduled-run/main.ts`, and delete `makeDisplayDataPersister` +
    `displayDataPersister.ts` and their tests. The display content now lives only in the
    `dashboard.json` snapshot (design: "their display content moves into the snapshot"),
    so still BUILD `displayOnly` and pass it to `buildDashboardSnapshot`; only the DB
    write is removed.
  - Grep/typecheck proves no retained code reads or writes `signal_rationale` /
    `external_reference_comparison`; `make check` green. This is the Phase 5 removal that
    unblocks the hosted schema reconcile (task 5.3), since migration `...006` drops both
    tables.
  - _Requirements: 4.1, 5.1, 10.10, 9.3_

## Phase 6 — Simplify the deploy pipeline + reconcile GCP (R6, R11)

- [x] 7. Simplify `deploy.yml`
  - Remove the read-proxy and any RLS/scoped-JWT/read-view steps, secrets, env vars, and
    path filters; keep the Cloud Run Job deploy and the Hosting publish; keep the working
    deploy identity without adding ceremony.
  - _Requirements: 6.5, 6.6, 6.7_

- [x] 7.1 Author the GCP required-resources manifest + enumeration
  - Add `ops/required-resources.manifest.json` (positive keep-list: Job, one Scheduler,
    the used SAs + minimal roles, retained secrets, Artifact Registry w/ retention,
    Hosting, WIF). Write the read-only `gcloud … list` enumeration + diff.
  - _Requirements: 11.1, 11.2, 11.3, 6.1, 6.2, 6.3, 6.4_

- [x] 7.2 ☁️ Reconcile the GCP project (operator-approved deletions)
  - Present the full delete set to the operator; delete the `dashboard-read-proxy` service
    + images, the one-shot `dashboard-seed-run` job (seeding complete), the obsolete
    `supabase-key` scoped-JWT secret and now-unused provider secrets, stale images
    (retention), and dangling IAM bindings / service accounts.
  - Emit a retained-vs-deleted report (names only); confirm the live enumeration equals the
    Required_GCP_Resource_Set; re-run is a no-op.
  - _Requirements: 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12_

## Phase 7 — End-to-end verification + living docs (R9)

- [~] 8. ☁️ Prove the simplified cloud loop end-to-end
  - Execute the Cloud Run Job once; confirm it writes predictions + realized outcomes +
    the `dashboard.json` snapshot, the Scheduler triggers it, and the hosted mobile
    dashboard renders from the snapshot. Confirm the deploy pipeline still deploys the Job
    and the dashboard.
  - _Requirements: 9.6, 9.7, 11.13_

- [-] 8.1 Confirm the research-integrity layer is intact
  - Verify (tests green) that the look-ahead guard, weekly-trend baseline, measurement
    math, shrinkage, realized-outcome journal, and AI-never-scores guard are unchanged in
    behaviour; RESEARCH-LOG carries the first evaluation report.
  - _Requirements: 9.1_

- [ ] 8.2 Update the living documents
  - Update `PROJECT-STATE.md` (removed subsystems, cloud-minimal architecture) and the
    spec statuses; mark the audit §14 recommendations as actioned.
  - _Requirements: 9.4_
