# Implementation Plan: Dashboard Data Activation

## Overview

This plan converts the dashboard-data-activation design into incremental, test-driven coding tasks plus the live cloud operations that activate the hosted dashboard. It is **wiring, integration, and operational/security hardening only**: no task re-implements the kill-gate math, `composeGateVerdict`, the `fires()` predicate, the confidence/horizon selector, or any pipeline logic. Every coding task connects a new component to an existing module by its confirmed signature — the `GateVerdictStore` / `FeatureRegistryStore` PORTs (`src/kill-gate/types.ts`, `src/feature-registry/types.ts`), `persistGateVerdict` / `evaluateAndRecordVerdict` (`src/kill-gate/verdict.ts`), the `GatePassingResolver` type (`src/pipeline/types.ts`), `makePipelineLoader`, the `src/scheduled-run/main.ts` injection seam, and the shared `SupabaseRestClient`.

All new code is TypeScript (parent Req 3.3), placed under `src/` alongside the modules it wires, following the existing module convention (`types.ts` where needed, public `index.ts`, colocated `*.test.ts` / `*.property.test.ts`). The adapters reuse the existing paginated `SupabaseRestClient` (Node 22 built-in `fetch`); **no new runtime dependency is introduced** (parent Req 18). The one property-based dependency, `fast-check`, is already pinned in the repo.

The work has a strict persistence/storage chain, a live-activation chain that depends on it and on the already-seeded hosted data, and a parallel operational/security hardening set. The one coupling: the two new adapters, once built, are shared by the persistence wiring, the resolver injection, and the hosted Gate_Run.

Two categories of task appear below and are kept strictly separate:

- **Testable coding tasks** — deterministic adapter / resolver / wiring logic (record↔row mapping, generated-id read-back, idempotent upsert, paginated reads, the pure read resolver, and the injection seam). Each design Correctness Property is implemented by a **single** `fast-check` property test at **minimum 100 iterations**, tagged `// Feature: dashboard-data-activation, Property N: <text>`, run against the no-network stub `fetch` idiom the existing adapter property tests use (never live infrastructure). Each test sub-task carries a `**Validates: Requirements X.Y**` line.
- **LIVE CLOUD EXECUTION tasks** — the hosted Gate_Run, the `scheduled-daily-run` re-run, the Seed_Job `--task-timeout` change, Diagnostic_Read_Path provisioning, and the `allUsers` run.invoker change. These are **not** property tests. They follow the design's **Live Cloud Execution Protocol**: reconcile the active gcloud project/account against `GCP_PROJECT_ID` and the resolved Supabase target against the hosted backend first → show the exact command for operator approval (a permission-reducing/destructive command carries a distinguishable warning) → source every secret from Secret_Manager or stdin, never echoed, logged, committed, or passed as an argument → record only non-secret references (verdict counts, firing-setup counts, Decision_Dates, revisions, URLs). The operator has agreed these run live.

Test sub-tasks are marked optional with `*`. Core implementation and live-cloud tasks are never optional.

## Tasks

- [x] 1. SupabaseGateVerdictStore adapter — implement the GateVerdictStore PORT (Req 1, design Component 1)
  - [x] 1.1 Add the additive `return=representation` read-back capability to `SupabaseRestClient`
    - Add a small additive `insertReturning(table, rows)` method (or a `return=representation` prefer option on the existing insert path) to `src/storage/supabase/client.ts`, reusing the existing headers/transport/`fetch` — no new dependency; the current `upsert` keeps its `Prefer: resolution=merge-duplicates,return=minimal` behaviour
    - The new path issues the insert with `Prefer: return=representation` so the DB-generated `gen_random_uuid()` id is read back from the response body
    - _Requirements: 1.1, 1.2_
  - [x] 1.2 Implement `SupabaseGateVerdictStore.persistVerdict` and `getVerdict`
    - Create `src/storage/supabase/gateVerdictStore.ts` implementing the `GateVerdictStore` PORT verbatim, constructed from a shared `SupabaseRestClient`, reaching storage only through that client
    - `persistVerdict(verdict, split)`: POST one aggregate row to `gate_verdicts` via `insertReturning` to read back the generated `id`, THEN POST one `gate_fold_verdicts` row per `FoldVerdict` referencing that id; return `{ verdictId, foldRows: verdict.foldVerdicts.length }` matching `InMemoryGateVerdictStore` semantics
    - `getVerdict(verdictId)`: read the aggregate by id then its fold rows (paginated), reconstruct the `GateVerdict` + `GateVerdictSplit` from the named columns and the per-fold `metrics` jsonb (full `Gate1Result` / `Gate2Result`); return `null` when no row with that id exists
    - Map record↔row against the real `gate_verdicts` / `gate_fold_verdicts` columns from the design Data Models via the `toRow` / `fromRow` idiom of `SupabaseAnalogueStore`; re-implement no gate math or verdict composition
    - On a non-success PostgREST status, surface the existing secret-free `SupabaseRestError { message, status, table }` augmented with `config_id`, never the Supabase key
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8, 1.9_
  - [x] 1.3 Add the `latestPassVerdict(configId)` read helper used by the resolver
    - Add a read helper on the adapter issuing `client.select(GATE_VERDICTS, "config_id=eq.<id>&verdict=eq.PASS&order=created_at.desc&limit=1")`, returning `{ verdictId } | null` for the newest recorded PASS of a config, reusing the paginated `select`
    - _Requirements: 1.7, 1.8_
  - [x] 1.4* Write property test — GateVerdictStore persist/read round-trip
    - **Property 1: GateVerdictStore persist/read round-trip** — for any `GateVerdict` + `GateVerdictSplit`, `persistVerdict` then `getVerdict(verdictId)` yields an equivalent verdict and split, and `PersistVerdictReport.foldRows === verdict.foldVerdicts.length`; run against the no-network stub `fetch` that mints an id on `return=representation`
    - min 100 iterations, tagged `// Feature: dashboard-data-activation, Property 1: GateVerdictStore persist/read round-trip`
    - **Validates: Requirements 1.3, 1.4**
  - [x] 1.5* Write property test — paginated reads return the complete set
    - **Property 3: Paginated reads return the complete set** — for a fold count spanning more than one PostgREST page (> 1000 rows), `getVerdict` returns every fold row with no ~1000-row truncation, exercising the Range/Content-Range paging against the stub
    - min 100 iterations, tagged `// Feature: dashboard-data-activation, Property 3: Paginated reads return the complete set`
    - **Validates: Requirements 1.7**
  - [x] 1.6* Write integration test against the stub-fetch adapter idiom
    - Mirror the existing `src/storage/supabase/*` adapter tests: round-trip `persistVerdict` → `getVerdict`, a `null` read for an absent id, and a secret-free error on a simulated non-success status (assert the key never appears)
    - _Requirements: 1.1, 1.4, 1.9_

- [x] 2. SupabaseFeatureRegistryStore adapter — implement the FeatureRegistryStore PORT (Req 1, design Component 2)
  - [x] 2.1 Implement `SupabaseFeatureRegistryStore` (`upsert` / `get` / `all`)
    - Create `src/storage/supabase/featureRegistryStore.ts` implementing the `FeatureRegistryStore` PORT, constructed from the shared `SupabaseRestClient`
    - `upsert(row)`: idempotent `client.upsert(FEATURE_REGISTRY, [toRow(row)], "feature_id")` (merge-duplicates on the `feature_id` PK) so re-upserting the same `feature_id` replaces rather than duplicates, matching `InMemoryFeatureRegistryStore`
    - `get(featureId)`: paginated select limit 1, or `null` when absent; `all()`: paginated select over the complete set
    - Persist `status` as exactly one of `candidate` | `included` | `cut` and `verdict_id` as the `gate_verdicts` id or `null`; map columns via `toRow` / `fromRow`; validate no `FEATURE_CEILING` and decide no admission — persist/read only the given row
    - Surface a secret-free `SupabaseRestError` augmented with `feature_id` on a non-success status
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.8, 1.9_
  - [x] 2.2* Write property test — FeatureRegistryStore upsert is idempotent
    - **Property 2: FeatureRegistryStore upsert is idempotent** — for any sequence of upserts, re-upserting a seen `feature_id` replaces rather than duplicates (row set stays one-per-`feature_id`), and the final `status` / `verdictId` round-trip exactly through `get` / `all`; pagination for `all()` is covered by Property 3
    - min 100 iterations, tagged `// Feature: dashboard-data-activation, Property 2: FeatureRegistryStore upsert is idempotent`
    - **Validates: Requirements 1.5, 1.6**

- [x] 3. Shared gate-store construction — `buildSupabaseGateStores` (Req 1, design Component 3)
  - [x] 3.1 Implement `buildSupabaseGateStores(supabase, fetchImpl?)` in `src/storage/supabase/index.ts`
    - Additively export `buildSupabaseGateStores(supabase, fetchImpl?)` building ONE shared `SupabaseRestClient` (or accepting an existing one so the Gate_Run shares the client with `buildSupabaseStores`) and returning `{ gateVerdictStore, featureRegistryStore }`
    - Do NOT widen `PipelineStores` — the pipeline's candle/vector/analogue triple shape is unchanged
    - _Requirements: 1.2_
  - [x] 3.2* Write unit test — shared client + no PipelineStores widening
    - Assert both adapters are constructed from one shared client and that `buildSupabaseStores` still returns exactly `{ candleStore, vectorStore, analogueStore }`
    - _Requirements: 1.2_

- [x] 4. Gate-verdict persistence wiring — Backtest_Stage persists through the adapter (Req 2, design Component 4)
  - [x] 4.1 Add gate-store deps to `StagedRunnerDeps` and persist beside the log
    - Extend `StagedRunnerDeps` in `src/staged-runner/stagedRunner.ts` with `gateVerdictStore: GateVerdictStore` and `featureRegistryStore: FeatureRegistryStore` (defaulting to the in-memory references in tests, the Supabase adapters in the Gate_Run)
    - In the Backtest_Stage, after `composeGateVerdict(...)`, call `persistGateVerdict(deps.gateVerdictStore, verdict, split)` (or `evaluateAndRecordVerdict({ configId, folds, split, store, docs })`) IN ADDITION to the existing `logGateVerdict`; re-implement no verdict composition
    - Derive the `GateVerdictSplit` (`trainEnd`, `testStart`, `testEnd`, optional `selectedHorizon`) from the walk-forward fold bounds already available in the stage
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [x] 4.2 Upsert `feature_registry` included rows on PASS and surface persist failure
    - For a PASS verdict and admitted features, `upsert` each `feature_registry` row with `status = "included"` and the justifying `verdictId` from the persist report (consistent with parent Req 13)
    - On a `persistGateVerdict` rejection, surface the failure identifying the affected `configId`; do not swallow it or proceed as though recorded
    - _Requirements: 2.4, 2.6_
  - [x] 4.3* Write unit tests — additive persistence, PASS→included upsert, failure surfacing
    - Assert the stage calls `persistGateVerdict` in addition to `logGateVerdict` (log preserved); a PASS triggers a `feature_registry` `included` upsert carrying the justifying `verdictId`; a persist rejection propagates with the `configId` and is not swallowed
    - _Requirements: 2.1, 2.4, 2.5, 2.6_

- [x] 5. GatePassingResolver — pure read-only resolver (Req 3, design Component 5)
  - [x] 5.1 Implement `makeGatePassingResolver(deps)`
    - Create `src/pipeline/gatePassingResolver.ts` exporting `makeGatePassingResolver(deps): GatePassingResolver` satisfying `(pair, decisionDate) => Promise<boolean> | boolean`
    - Resolve the pair's active config via `activeConfigFor(pair)` defaulting to `` `${pair}-active` ``, read the latest PASS through `latestPassVerdict(configId)` (bound to the gate-verdict adapter); return `true` ONLY when a recorded PASS backs the active config, `false` otherwise
    - Consume recorded outcomes only — never re-run the walk-forward backtest, re-evaluate Gate 1 / Gate 2, or re-compute gate math; keep it a pure/deterministic read over the recorded rows
    - On a store/read failure, REJECT (surface the error up through `evaluatePair` / `runDailyPipeline`); never resolve `true` on failure
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 3.8_
  - [x] 5.2* Write property test — resolver reflects recorded PASS / no-PASS exactly
    - **Property 4: Resolver reflects recorded PASS / no-PASS exactly** — for any pair/Decision_Date, resolves `true` when a PASS exists for the pair's active config and `false` when none exists, never surfacing an un-passed pair
    - min 100 iterations, tagged `// Feature: dashboard-data-activation, Property 4: Resolver reflects recorded PASS / no-PASS exactly`
    - **Validates: Requirements 3.2, 3.6**
  - [x] 5.3* Write property test — resolver never coerces `true` on read failure
    - **Property 5: Resolver never coerces true on read failure** — for any induced store/read failure, the resolver promise rejects and never resolves `true`
    - min 100 iterations, tagged `// Feature: dashboard-data-activation, Property 5: Resolver never coerces true on read failure`
    - **Validates: Requirements 3.8**
  - [x] 5.4* Write property test — resolver is deterministic over a fixed history
    - **Property 6: Resolver is deterministic over a fixed history** — for any fixed recorded-verdict history + Decision_Date, repeated invocations yield identical results (parent Req 3.1, 16.7)
    - min 100 iterations, tagged `// Feature: dashboard-data-activation, Property 6: Resolver is deterministic over a fixed history`
    - **Validates: Requirements 3.7**

- [x] 6. Resolver injection into production wiring (Req 3, design Component 5)
  - [x] 6.1 Inject the resolver as `deps.gatePassing` in `src/scheduled-run/main.ts`
    - In the `loadEvaluations` seam, build `buildSupabaseGateStores(supabase)` and `makeGatePassingResolver({ gateVerdictStore, featureRegistryStore, activeConfigFor: (pair) => `${pair}-active`, latestPassVerdict })`, then pass `{ ...buildSupabaseStores(supabase), gatePassing }` into `makePipelineLoader`
    - Change exactly this one seam; leave the pipeline, `runDailyPipeline`, `runScheduledDaily`, and `fires()` untouched so `evaluatePair` uses the injected resolver through `deps.gatePassing ?? resolveGatePassingDefault`
    - _Requirements: 3.4, 3.5_
  - [x] 6.2* Write unit test — loader receives a non-undefined gatePassing, fires() unchanged
    - Assert `makePipelineLoader` receives a defined `gatePassing` from `main.ts` and that the firing precondition in `fires()` is byte-for-byte unchanged (`gatePassing && !newsSuppressed && direction !== "FLAT" && earnedConfidence >= confidenceThreshold`)
    - _Requirements: 3.4, 3.5_

- [x] 7. Gate-tables write-path migration — unblock hosted Gate_Run writes (Req 2, design RLS risk)
  - [x] 7.1 Write the idempotent gate-tables grant/RLS migration
    - Add `supabase/migrations/<ts>_gate_tables_pipeline_writer.sql` mirroring `20260916000002`: grant `select, insert, update` on `gate_verdicts`, `gate_fold_verdicts`, `feature_registry` to `pipeline_writer`, and WHERE RLS is enabled on them add a `pipeline_writer`-scoped policy; idempotent / re-runnable; applies identically local + hosted
    - This must precede the live Gate_Run so its writes succeed; the current `pipeline_writer` migration does NOT cover these three tables (design-flagged risk)
    - _Requirements: 2.1, 9.1_
  - [x] 7.2* Write structural/unit test — the grants are present
    - Assert the migration grants `select, insert, update` (and no `delete`) on the three gate tables to `pipeline_writer` and is safely re-runnable
    - _Requirements: 2.1_

- [x] 8. Gate_Run Cloud Run Job entry — build-only wiring (Req 4, design Component 6)
  - [x] 8.1 Implement `src/ops/gate-run/main.ts`
    - Mirror `src/ops/seed-run/main.ts`: `loadScheduledRunConfig()` → `buildSupabaseStores(config.supabase)` + `buildSupabaseGateStores(config.supabase)` sharing one client → run the Backtest_Stage over the hosted seeded walk-forward folds → `composeGateVerdict` per config → `persistGateVerdict` + `logGateVerdict` → upsert `feature_registry` `included` rows for PASS → emit structured secret-free logs
    - Build-only here (no deploy); introduce no gate math — it is Component 4 wired to the hosted stores
    - _Requirements: 2.1, 2.2, 4.2_
  - [x] 8.2* Write unit test — Gate_Run wiring over in-memory stores
    - Run the entry with in-memory `GateVerdictStore` / `FeatureRegistryStore`; assert verdicts persist, a PASS yields `included` rows with the justifying `verdictId`, and `composeGateVerdict` is the sole verdict producer (no re-implementation)
    - _Requirements: 2.1, 2.2, 4.2_

- [x] 9. LIVE CLOUD: apply the gate-tables migration to hosted (Req 4, Req 9)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live Cloud Execution Protocol.
  - Reconcile the resolved Supabase target against `SUPABASE_TARGET=hosted` and the active gcloud project/account against `GCP_PROJECT_ID` first; abort and surface any mismatch
  - Show the exact migration-apply command (task 7.1) for approval; apply to hosted; the migration is idempotent so a re-run adds no duplicate grants/policies
  - Confirm the `pipeline_writer` grant posture on `gate_verdicts` / `gate_fold_verdicts` / `feature_registry` before the Gate_Run; record only non-secret references
  - _Requirements: 4.1, 4.3, 9.1, 9.4_

- [x] 10. LIVE CLOUD: build, deploy, and execute the Gate_Run against hosted (Req 4, Req 9)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live Cloud Execution Protocol; depends on task 9.
  - Reconcile target/project/account first; abort on mismatch (Req 4.1, 9.4, 9.6)
  - Build a SHA-pinned image (reuse the existing `Dockerfile` pattern, overriding command/args to `dist/ops/gate-run/main.js`), deploy as a Cloud_Run_Job with a dedicated runtime SA scoped to the gate-tables write path, and `--set-secrets` by name (Secret_Manager/stdin only, never echoed/committed/argv) (Req 4.3, 9.2, 9.3)
  - Show each `gcloud` command for approval; execute the Job once over the already-seeded hosted `pattern_vectors` + matured `analogue_outcomes` (no re-seed) (Req 4.2)
  - Confirm at least one PASS Gate_Verdict is recorded in hosted `gate_verdicts` for an active pair config (Req 4.4); record only non-secret references (verdict counts, Decision_Dates, revisions) (Req 9.7)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 9.1, 9.2, 9.3, 9.4, 9.7_

- [-] 11. LIVE CLOUD: re-run scheduled-daily-run with the resolver deployed and verify firing (Req 4, Req 9)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live Cloud Execution Protocol; depends on tasks 6 and 10.
  - Reconcile target/project/account first; show the redeploy/execute command for approval
  - Redeploy/execute the `scheduled-daily-run` Job on the image containing the injected resolver for the current / most-recent matured Decision_Date (Req 4.5)
  - Confirm the run persisted its view, that `firing_setups` has one or more rows for a pair that passes the gate, is non-FLAT, is non-suppressed, and meets the Confidence_Threshold, and that `v_decision_dates` returns at least one Decision_Date (Req 4.6)
  - IF zero firing setups, report whether the cause is no recorded PASS, a FLAT direction, a news suppression, or Earned_Confidence below threshold — read from the recorded evaluation — WITHOUT altering `fires()` or the gate math to force a firing (Req 4.7); on a firing Decision_Date, leave Task 17 able to run (Req 4.8)
  - Record only non-secret references
  - _Requirements: 4.5, 4.6, 4.7, 4.8_

- [ ] 12. LIVE CLOUD: Seed_Job timeout hardening (Req 5, Req 9)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live Cloud Execution Protocol.
  - Raise the `dashboard-seed-run` Cloud_Run_Job `--task-timeout` from 3600s to a value in 5400–7200s, expressed as a version-controlled recorded change in `ops/scheduler-job.config.json` / `ops.config.json` or the deploy workflow (Req 5.1, 5.2)
  - Reconcile target/project/account first; show the exact change command for approval before execution (Req 5.5)
  - Re-run the Seed_Job and confirm the execution reports a SUCCESS status (Req 5.3), relying on the existing idempotent `(Asset, Date)` upserts so no duplicate rows / no re-seed result (Req 5.4); record only non-secret references
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 13. Diagnostic_Read_Path — least-privilege read-only count path (Req 6, Req 9)
  - [ ] 13.1 Provision the read-only diagnostic path and its policy artifact
    - Add the least-privilege Diagnostic_Read_Path — a read-only diagnostic Postgres role (SELECT-only on the counted tables) reached via a scoped read JWT, OR a fixed allowlisted `count` endpoint on the Read_Proxy — as an idempotent migration/config; grant read-only only, no write and no RLS-bypass (Req 6.1, 6.5)
    - Commit a version-controlled policy (doc/artifact) recording which credential/endpoint routine read-only diagnostics use and why the publishable (anon) key (RLS-limited to 0 rows) and the scoped read key (401 on raw PostgREST) are insufficient for raw counts; routine verification uses this path, never the Service_Role_Key (Req 6.2, 6.3). Any Service_Role_Key one-off is read-only, operator-approved, never echoed/logged/committed (Req 6.4)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ] 13.2* Write test/doc artifact asserting read-only scope
    - Add a structural test or committed verification artifact asserting the diagnostic role/endpoint has only read access (a write / out-of-scope query is denied) and returns exact counts
    - _Requirements: 6.1, 6.5_
  - [ ] 13.3 LIVE CLOUD: apply the diagnostic grant under the protocol
    - **This is a LIVE operator-approved operation — NOT a property test.** Reconcile target/project first; show the grant/apply command for approval; apply the read-only grant; confirm counts return without the Service_Role_Key; record only non-secret references
    - _Requirements: 6.1, 6.3_

- [ ] 14. LIVE CLOUD: allUsers run.invoker review (Req 7, Req 9)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live Cloud Execution Protocol.
  - Reconcile target/project/account first; evaluate the `roles/run.invoker` grant to `allUsers` on `dashboard-read-proxy` (Req 7.1)
  - WHERE a least-privilege Invoker_Identity is preferred, replace `allUsers` with a named service account granted ONLY `roles/run.invoker` on `dashboard-read-proxy` and no broader role (Req 7.2); preserve the read-only select-only Allowlist, the rate limit, and the CSP / security headers regardless of posture (Req 7.3)
  - An IAM change is **permission-reducing**: present a distinguishable warning naming the affected resource and effect and require approval before execution (Req 7.5, 9.5); after the change confirm the public `/api` path still returns a successful response end-to-end (Req 7.5); IF a change would break the `/api` rewrite path, retain a working invoker configuration (Req 7.6)
  - Record the invoker decision (retain `allUsers` with justification, or replace) in the Req 8 Deployment_Record (Req 7.4); record only non-secret references
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.5_

- [ ] 15. Deployment_Record provenance — commit the dashboard deployment record (Req 8)
  - Commit the dashboard Deployment_Record (the currently uncommitted `web/README.md` Task 16 edit) to version control so the live state is reproducible (Req 8.1)
  - Identify the live public URLs — the Firebase_Hosting default URL and the custom domain `app.teamhandso.me` — the deployed `dashboard-read-proxy` revision, and the invoker posture resulting from task 14 (Req 8.2)
  - Record only non-secret references (no Secret_Key / Scoped_Write_Credential / Service_Role_Key) and ensure the committed record reflects the current live deployment state (Req 8.3, 8.4)
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 16. Final checkpoint — LIVE CLOUD: dashboard-ui Task 17 read-only smoke against real data (Req 10)
  - **This is a LIVE operator-approved verification — NOT a property test.** Depends on tasks 10, 11, 14, 15. Ensure all tests pass, ask the user if questions arise.
  - Run `dashboard-ui` Task 17's read-only smoke verification against the real hosted data produced by the Gate_Run + daily re-run
  - Confirm the public dashboard URL serves the latest firing Decision_Date returned by `v_decision_dates` from real `firing_setups` data (Req 10.1); the Read_Proxy rejects a write (non-GET/HEAD) with HTTP 405 (Req 10.2); and the Read_Proxy rejects a query/resource outside the Allowlist with HTTP 400 or 404 (Req 10.3)
  - Treat the activation as complete only WHERE all three hold (Req 10.4); do NOT modify the Read_Proxy firing logic, the gate math, or the `fires()` predicate to force the checks to pass — they pass only because real recorded verdicts produced a real firing Decision_Date (Req 10.5)
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster path; core implementation and live-cloud tasks are never optional.
- **LIVE CLOUD EXECUTION tasks (9, 10, 11, 12, 13.3, 14, 16) are not property tests.** They perform real, cost-incurring or permission-changing operations under the Live Cloud Execution Protocol: reconcile active gcloud project/account against `GCP_PROJECT_ID` and the resolved Supabase target against the hosted backend → show the exact command for operator approval (a permission-reducing/destructive command — e.g. the task 14 invoker change — carries a distinguishable warning naming the resource and effect) → source secrets from Secret_Manager/stdin, never echoed, logged, committed, or passed as an argument → record only non-secret references (verdict counts, firing-setup counts, Decision_Dates, revisions, URLs). The enumerated live ops are: task 9 (apply gate-tables migration to hosted), task 10 (build/deploy/execute the Gate_Run), task 11 (daily re-run + firing verification), task 12 (Seed_Job timeout change), task 13.3 (apply the diagnostic grant), task 14 (allUsers invoker review), and task 16 (Task 17 smoke).
- No new runtime dependency is introduced (parent Req 18): the adapters reuse the existing paginated `SupabaseRestClient` over Node 22 `fetch`; `fast-check` is already pinned. `PipelineStores` is NOT widened — `buildSupabaseGateStores` is a sibling builder.
- No re-implementation: `composeGateVerdict` is the sole verdict producer and `fires()` the sole firing predicate; the adapters and resolver persist / read / inject only, and the resolver is a pure read over recorded rows.
- **Key design risk surfaced:** the existing `20260916000002` RLS migration does NOT grant `pipeline_writer` on `gate_verdicts` / `gate_fold_verdicts` / `feature_registry`. Task 7 adds that idempotent migration and task 9 applies it to hosted; both MUST precede the Gate_Run write (task 10) or its writes may be refused. Also note the aggregate-then-fold insert is not transactional across PostgREST requests — a fold-insert failure leaves a tolerable orphan aggregate row (append-only history) and is surfaced with the `configId`, not silently swallowed.
- Dependency order: the deterministic coding chain (tasks 1 → 2 → 3 → 4 → 5 → 6, with 7 and 8 built alongside) precedes the live-cloud chain; within the live chain the gate-tables migration (7) + its live apply (9) precede the Gate_Run execution (10), which precedes the daily re-run (11), which precedes the Task 17 smoke (16). Tasks 12, 13, 14, 15 (operational hardening) proceed in parallel; task 15 depends on task 14's invoker decision and task 16 depends on tasks 10, 11, 14, 15.
- Requirement coverage: Req 1 (tasks 1.x, 2.x, 3.x), Req 2 (tasks 4.x, 7, 8), Req 3 (tasks 5.x, 6.x), Req 4 (tasks 8, 9, 10, 11), Req 5 (task 12), Req 6 (task 13.x), Req 7 (task 14), Req 8 (task 15), Req 9 (woven through tasks 9–14, 16), Req 10 (task 16). Every design Property 1–6 is covered by exactly one tagged ≥100-iteration property test: Property 1 (1.4), Property 2 (2.2), Property 3 (1.5), Property 4 (5.2), Property 5 (5.3), Property 6 (5.4).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "7.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "1.6", "2.2", "7.2", "13.1"] },
    { "id": 3, "tasks": ["3.1", "5.1", "13.2"] },
    { "id": 4, "tasks": ["3.2", "4.1", "5.2", "5.3", "5.4"] },
    { "id": 5, "tasks": ["4.2", "6.1", "8.1"] },
    { "id": 6, "tasks": ["4.3", "6.2", "8.2"] },
    { "id": 7, "tasks": ["9", "12", "13.3", "14"] },
    { "id": 8, "tasks": ["10", "15"] },
    { "id": 9, "tasks": ["11"] },
    { "id": 10, "tasks": ["16"] }
  ]
}
```
