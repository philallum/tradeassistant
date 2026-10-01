# Implementation Plan: Operational Wiring

## Overview

This plan converts the operational-wiring design into incremental, test-driven coding tasks. It is **wiring only**: no task re-implements validation, scoring, kill-gate, or pipeline logic. Every task connects a new component to an existing module by its confirmed signature — `OhlcIngestion.ingest`, `runScheduledDaily` → `runDailyPipeline`, `walkForwardFolds` / `composeGateVerdict`, the three storage PORTs (`CandleStore` / `PatternVectorStore` / `AnalogueStore`), `loadScheduledRunConfig`, and `.github/workflows/deploy.yml`.

All new code is TypeScript (parent Req 3.3), placed under `src/` alongside the modules it wires, following the existing module convention (`types.ts`, public `index.ts`, colocated `*.test.ts` / `*.property.test.ts`). The one property-based dependency (`fast-check`) is already pinned in the repo; no new dependency is introduced (parent Req 18).

The work splits into two halves and one shared seam, built in dependency order:

- **Local half** (deterministic, no cloud access): CsvLoader → Supabase adapters → StagedRunner backfill → backtest → forward-look.
- **Shared seam**: the Supabase storage adapters replace the two throwing stubs in `src/scheduled-run/main.ts` (`buildSupabaseStores`, `persistView`) and unblock both the local StagedRunner and the deployed Job.
- **Cloud half** (strict chain): OperationalSafety guard → SecretManagerProvisioner → DeployVerifier → SchedulerProvisioner. CsvLoader and the OperationalSafety guard have no dependencies and can start first.

Two categories of task appear below and are kept strictly separate:

- **Testable coding tasks** — pure/deterministic logic (CSV parsing, StagedRunner orchestration, and the pure decision logic inside every cloud component: classification, redaction, reconciliation, success/prerequisite predicates). Each carries a `fast-check` property test at **minimum 100 iterations**, tagged `// Feature: operational-wiring, Property {N}: {property_text}`. The Supabase adapters instead carry integration tests against a local Supabase instance.
- **LIVE CLOUD EXECUTION tasks** — actually creating secrets, granting IAM, executing the real Cloud Run Job, reading Cloud Logging, and creating the scheduler in project `trade-assistant-508806`. These are **not** property tests. They follow the design's **Live Cloud Execution Protocol**: reconcile active project/account against `GCP_PROJECT_ID` → show the exact `gcloud` command and get operator approval → pipe secret values via `--data-file=-` on stdin (never echo, never as an argument, never commit) → read Cloud Logging for feedback afterward, recording only non-secret references. The operator has agreed these run live.

Test sub-tasks are marked optional with `*`. Core implementation tasks and live-cloud tasks are never optional.

## Tasks

- [x] 1. CsvLoader — parse `data/*.csv` and feed existing ingestion (Req 1)
  - [x] 1.1 Implement `parseCsvCandles` tab-separated parser and `RawCandle` mapping
    - Create `src/csv-loader/types.ts` (`DataSourceRole`, `CsvParseError`, `CsvLoadReport`) and `src/csv-loader/csvLoader.ts` with `CSV_HEADER`, `CSV_DATA_COLUMNS = 7`
    - Parse a `CSV_Candle_File` as tab-separated, treating line 1 as the 6-column header (`Time`,`Open`,`High`,`Low`,`Close`,`Volume`) and each subsequent non-empty line as a 7-column row; accept both CRLF and LF endings
    - Map each row to a `RawCandle` using only `Time` (verbatim string), `Open`/`High`/`Low`/`Close` (cols 2–5) and `source:"csv"`; drop col 6 (Volume) and col 7 (tick count)
    - Pass the raw `YYYY-MM-DD 00:00:00` timestamp UNALTERED; perform no OHLC validation, dedup, or session normalization (that stays in ingestion)
    - Return an all-or-nothing discriminated result: header not exactly the 6 expected columns in order → abort, report by file name, feed nothing; any row not exactly 7 tab columns or with an unparsable `Time`/`Open`/`High`/`Low`/`Close` → abort, report file + offending row, feed nothing; valid header with zero data rows → report empty, feed nothing
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.9, 1.10_

  - [x] 1.2 Write property test — CSV parsing is line-ending independent
    - **Property 1: CSV parsing is line-ending independent**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 1: ...`
    - **Validates: Requirements 1.1**

  - [x] 1.3 Write property test — CSV mapping excludes Volume and tick count
    - **Property 2: CSV mapping excludes Volume and tick count**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 2: ...`
    - **Validates: Requirements 1.2**

  - [x] 1.4 Write property test — CSV timestamp is passed through verbatim
    - **Property 3: CSV timestamp is passed through verbatim**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 3: ...`
    - **Validates: Requirements 1.3**

  - [x] 1.5 Write property test — a malformed header aborts the file and feeds nothing
    - **Property 4: A malformed header aborts the file and feeds nothing**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 4: ...`
    - **Validates: Requirements 1.5**

  - [x] 1.6 Write property test — a malformed row causes no partial ingest
    - **Property 6: A malformed row causes no partial ingest**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 6: ...`
    - **Validates: Requirements 1.9**

  - [x] 1.7 Implement `CsvLoader.loadFile` / `loadAll` delegation to `OhlcIngestion.ingest`
    - Implement `loadFile(path, pair, role)` that parses then calls `OhlcIngestion.ingest(pair, candles)`, surfacing the returned `IngestReport` unchanged so OHLC-validity rejection (parent Req 7.3), `(Asset,Date)` dedup (parent Req 7.4), and normalization (parent Req 7.7/7.8) remain the ingestion module's job
    - Implement `loadAll(dir, role)` over the five `PAIRS`, then emit the per-pair coverage summary from `ingestion.coverageSummary()` (count, earliest date, latest date per pair)
    - _Requirements: 1.4, 1.7_

  - [x] 1.8 Write property test — CSV import is idempotent
    - **Property 5: CSV import is idempotent** (run through a real `OhlcIngestion` over an `InMemoryCandleStore` to exercise the actual `(Asset,Date)` upsert)
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 5: ...`
    - **Validates: Requirements 1.6**

  - [x] 1.9 Write unit tests — coverage pass-through and empty-file reporting
    - Test `loadAll` emits the ingestion coverage summary verbatim (Req 1.7); test a header-only file reports empty and feeds nothing (Req 1.10)
    - _Requirements: 1.7, 1.10_

  - [x] 1.10 Record the `Data_Source_Role` decision and enforce run cadence
    - Add a committed operational config entry (e.g. `ops.config.json` `{ "csv": { "role": "backfill" } }`) recording the `Data_Source_Role` as exactly one of `backfill` | `feed`, never in `.env`
    - Make the loader run once for `backfill` and only on the recurring cadence for `feed`, in accordance with the recorded role
    - _Requirements: 1.8_

- [x] 2. Supabase storage adapters — implement the three PORTs (shared seam, design Component 3)
  - [x] 2.1 Implement `SupabaseCandleStore`, `SupabasePatternVectorStore`, `SupabaseAnalogueStore`
    - Create `src/storage/supabase/` implementing each existing PORT with the SAME method signatures as its in-memory reference: candle `upsertCandles`/`getCandles`/`getCoverageSummary`; vector `upsertVector`/`getVector`/`getVectorsByAsset`/`queryNearest` (pgvector ANN with the `weeklyTrendSign` metadata pre-filter and the documented similarity→date→asset tie-break); analogue `upsertOutcome`/`getMaturedOutcomes`/`getOutcomes`
    - Connect over the IPv4 pooler/REST endpoint using `SupabaseConfig.url` (overridden by `SUPABASE_POOLER_URL` via the existing `resolveSupabaseOverIpv4`) and `SupabaseConfig.key`; never log the key (a `Secret_Key`)
    - _Requirements: (parent Req 17.1 storage-port substitution; unblocks spec Req 2.2, 2.5, 4)_

  - [x] 2.2 Implement `buildSupabaseStores` and `makeSupabaseViewPersister`, replacing the two throwing stubs
    - Implement `buildSupabaseStores(supabase): PipelineStores` returning `{ candleStore, vectorStore, analogueStore }` in the exact shape `src/scheduled-run/main.ts` expects, replacing ONLY that throwing stub
    - Implement `makeSupabaseViewPersister(supabase): DashboardViewPersister` writing the `DashboardView` (firing cards + suppressions) to `firing_setups`, replacing the throwing `persistView` seam; leave the pipeline, scheduled runner, and `dailyRun` entry point unchanged
    - _Requirements: (parent Req 17.1; unblocks spec Req 2.2, 2.5, 4)_

  - [x] 2.3 Write integration tests against local Supabase (`SUPABASE_TARGET=local`)
    - Run the SAME port contract tests the in-memory stores satisfy — round-trip `upsert`/`get`, coverage summary, `queryNearest` ordering + pre-filter, plus a pgvector ANN sanity check — against the real backend using 1–3 representative fixtures (not property iterations)
    - Verify `makeSupabaseViewPersister` by writing a `DashboardView` and reading `firing_setups` back
    - _Requirements: (parent Req 17.2 shared-schema interchangeability)_

- [x] 3. StagedRunner — backfill / backtest / forward-look over existing modules (Req 2)
  - [x] 3.1 Implement `StagedRunner` scaffold and `backfill` stage
    - Create `src/staged-runner/types.ts` (`StageName`, `StageResult` with `missingPrerequisite`, `StagedRunnerDeps`) and `src/staged-runner/stagedRunner.ts`
    - Implement `backfill(role)`: load candles via `CsvLoader` (and the live API providers where `role="feed"`) through `OhlcIngestion.ingest` (which upserts via the `CandleStore` PORT), then build + upsert `Pattern_Vectors` via the existing `encodePatternVector` through the `PatternVectorStore` PORT; matured `AnalogueStore` outcomes are populated by the existing resolver, not re-implemented here
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Write property test — stored vectors correspond to stored candles after backfill
    - **Property 7: Stored pattern vectors correspond to stored candles after backfill** (against in-memory stores)
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 7: ...`
    - **Validates: Requirements 2.2**

  - [x] 3.3 Implement `backtest` stage wiring to the existing kill-gate
    - Call `walkForwardFolds(pair, history)` then `composeGateVerdict(configId, folds)` (or `evaluateAndRecordVerdict`) from `src/kill-gate`; NEVER re-derive gate math
    - Append the per-fold verdicts and metrics to `RESEARCH-LOG.md` via the existing living-docs writer (parent Req 11.9–11.11, 19.4)
    - Abort with `ok:false` + named `missingPrerequisite` if no candles/vectors are stored, leaving stored data unchanged
    - _Requirements: 2.3, 2.4, 2.7_

  - [x] 3.4 Implement `forwardLook` stage wiring to `runScheduledDaily`
    - Call `runScheduledDaily(config, { loadEvaluations, persistView })` (which internally calls `runDailyPipeline`) for the current/most-recent matured `Decision_Date`; do NOT duplicate the pipeline or `dailyRun` firing logic
    - Abort with `ok:false` + named `missingPrerequisite` if vectors/matured outcomes are missing, leaving stored data unchanged
    - _Requirements: 2.5, 2.7_

  - [x] 3.5 Write property test — forward-look is deterministic
    - **Property 10: Forward-look is deterministic** (invoke `forwardLook` twice on identical stored inputs + Decision_Date, deep-compare `DashboardView`s)
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 10: ...`
    - **Validates: Requirements 2.8, 5.5**

  - [x] 3.6 Implement `runAll` composed ordered run
    - Compose `backfill` → `backtest` → `forwardLook` in order (each consumes the prior stage's stored output), stopping at the first failed stage so no subsequent stage runs
    - _Requirements: 2.6, 2.9_

  - [x] 3.7 Write property test — composed run runs stages in dependency order
    - **Property 8: The composed run always runs stages in dependency order**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 8: ...`
    - **Validates: Requirements 2.6**

  - [x] 3.8 Write property test — a missing prerequisite aborts a stage without mutating stored data
    - **Property 9: A missing prerequisite aborts a stage without mutating stored data**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 9: ...`
    - **Validates: Requirements 2.7**

  - [x] 3.9 Write property test — a failed stage stops the composed run
    - **Property 11: A failed stage stops the composed run** (fake stage forced to fail; assert no later stage side effects occur)
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 11: ...`
    - **Validates: Requirements 2.9**

  - [x] 3.10 Write unit tests — stage delegation and standalone invocation
    - Test backtest calls `walkForwardFolds`/`composeGateVerdict` and appends via a fake `RESEARCH-LOG.md` writer (Req 2.3, 2.4); test forward-look calls `runScheduledDaily`→`runDailyPipeline` with no forked logic (Req 2.5); test each stage runs standalone and `runAll` composes them (Req 2.1)
    - _Requirements: 2.1, 2.3, 2.4, 2.5_

- [x] 4. Checkpoint — local half
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. OperationalSafety guard + GcloudRunner — shared cloud dependency (Req 6, design Component 7)
  - [x] 5.1 Implement the `GcloudRunner` choke point and `OperationalSafety` pure logic
    - Create `src/ops/safety/` with `GcloudRunner.run(argv, opts?)` as the single seam for shelling out to `gcloud`, supplying secret values only on stdin (`--data-file=-`), never interpolated into argv
    - Implement `reconcileTarget(expectedProject)`: permit a command only when active project AND account match `GCP_PROJECT_ID`, else abort and surface the mismatch
    - Implement `confirm(presentation)`: present the exact command with secret values redacted as `<from .env: NAME>`; for a destructive/overwriting op carry a distinguishable warning naming the affected resource; do not run until the operator approves
    - Implement the redaction helper that substitutes any `Secret_Key` value with the `<from .env: NAME>` placeholder on every display/log surface
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.2 Write property test — no Live_Cloud_Command runs without operator approval
    - **Property 21: No Live_Cloud_Command runs without operator approval**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 21: ...`
    - **Validates: Requirements 6.1**

  - [x] 5.3 Write property test — destructive commands require a distinguishable, named warning
    - **Property 22: Destructive commands require a distinguishable, named warning before approval**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 22: ...`
    - **Validates: Requirements 6.5**

  - [x] 5.4 Write property test — no Secret_Key value ever appears on any output surface
    - **Property 23: No Secret_Key value ever appears on any output surface** (thread random secret values through every presentation/log/record path; assert the raw value never appears and travels only on stdin)
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 23: ...`
    - **Validates: Requirements 3.3, 4.6, 6.2, 6.3**

  - [x] 5.5 Write property test — active project and account are reconciled before every Live_Cloud_Command
    - **Property 24: Active project and account are reconciled before every Live_Cloud_Command**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 24: ...`
    - **Validates: Requirements 3.7, 6.4, 6.6**

- [x] 6. SecretManagerProvisioner — classify, plan, provision, grant, update deploy.yml (Req 3)
  - [x] 6.1 Implement `classifyEnvKey` and the name-only `SecretProvisionPlan`
    - Create `src/ops/secret-manager/classify.ts`: `classifyEnvKey(name)` returns `secret` for `*_API_KEY`/`*_KEY`/`*_TOKEN`/credential JSON/credential-bearing URL, and `config` for project id, region, model id, provider names, and boolean toggles (`*_ENABLED`, `GOOGLE_GENAI_USE_VERTEXAI`)
    - Implement `plan(env)` in `src/ops/secret-manager/provisioner.ts` building `SecretProvisionPlan` from `.env` by NAME only (no value read into the plan), including `missingValues` for `Secret_Key`s with empty/absent values
    - _Requirements: 3.1, 3.9_

  - [x] 6.2 Write property test — env-key classification follows the naming convention
    - **Property 12: Env-key classification follows the naming convention**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 12: ...`
    - **Validates: Requirements 3.1**

  - [x] 6.3 Write property test — empty or absent secret values are reported, never created
    - **Property 16: Empty or absent secret values are reported, never created**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 16: ...`
    - **Validates: Requirements 3.9**

  - [x] 6.4 Implement idempotent create-or-version command construction (pure)
    - Implement the pure command-planning logic in `provision(env)` that, per `Secret_Key` with a non-empty value, emits an "add new version" command when the secret already exists and a "create secret" command only when absent, so re-running is idempotent; values are marked for stdin (`--data-file=-`), never argv
    - _Requirements: 3.2, 3.8_

  - [x] 6.5 Write property test — provisioning chooses version-add over duplicate-create
    - **Property 15: Provisioning chooses version-add over duplicate-create**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 15: ...`
    - **Validates: Requirements 3.8**

  - [x] 6.6 Implement `updateDeployWorkflow` rewriting `deploy.yml` to the full classified key set
    - Rewrite `.github/workflows/deploy.yml` so `--set-secrets` maps every required `Secret_Key` (the three existing `supabase-url`/`supabase-key`/`supabase-pooler-url` plus every provider `Secret_Key` present with a value: `OHLC_API_KEY`, `YIELD_API_KEY`, `NEWS_CALENDAR_API_KEY`, `EXTERNAL_SIGNAL_API_KEY`, and any set of `TWELVE_DATA_API_KEY`/`MASSIVE_API_KEY`/`ALPHA_VANTAGE_API_KEY`/`FINNHUB_API_KEY`/`NEWS_API_KEY`) from its Secret Manager secret, and `--set-env-vars` covers every `Config_Env_Key`
    - Place NO secret value in `deploy.yml`; no `Secret_Key` under `--set-env-vars`
    - _Requirements: 3.5, 3.6_

  - [x] 6.7 Write property test — the rewritten deploy.yml covers every required key
    - **Property 13: The rewritten deploy.yml covers every required key**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 13: ...`
    - **Validates: Requirements 3.5**

  - [x] 6.8 Write property test — the rewritten deploy.yml leaks no secret and misplaces no secret
    - **Property 14: The rewritten deploy.yml leaks no secret and misplaces no secret**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 14: ...`
    - **Validates: Requirements 3.6**

  - [x] 6.9 Implement `grantAndVerifyAccessor` (pure command + verify predicate)
    - Build the command to grant `roles/secretmanager.secretAccessor` to the `Runtime_Service_Account` on each secret, and the read-back check that treats provisioning complete only when the grant is present in the IAM policy
    - _Requirements: 3.4_

  - [x] 6.10 LIVE CLOUD: provision secrets, grant + verify accessor in `trade-assistant-508806`
    - **This is a LIVE operator-approved cloud operation — NOT a property test.** Follow the Live Cloud Execution Protocol.
    - Reconcile active project + account against `GCP_PROJECT_ID` first; abort on mismatch (Req 3.7)
    - For each `Secret_Key` with a non-empty `.env` value: show the exact `gcloud secrets create` / `gcloud secrets versions add --data-file=-` command for approval before running; pipe the value on stdin from `.env` — never echo, log, commit, or pass as an argument (Req 3.3, 6.2, 6.3); add a version if the secret exists (Req 3.8); report and skip empty/absent values (Req 3.9)
    - Grant `roles/secretmanager.secretAccessor` to the `Runtime_Service_Account` and read the IAM policy back to verify the grant before treating provisioning complete (Req 3.4)
    - Read Cloud Logging / command output for feedback; record only non-secret references
    - _Requirements: 3.2, 3.3, 3.4, 3.7, 3.8, 3.9_

- [ ] 7. DeployVerifier — live check that GitHub deploys and the Job runs (Req 4)
  - [ ] 7.1 Implement the success and prerequisite predicates (pure)
    - Create `src/ops/deploy-verify/verifier.ts` with `DeployVerifyResult`
    - Implement the success predicate: an execution is successful iff `succeededTaskCount === taskCount` AND `elapsedMs <= 300_000`, failure otherwise; failure states (execution failure, 300s timeout, short succeeded count) map to `ok:false` carrying the execution id + Cloud Logging reference
    - Implement `checkPrerequisites(runtimeServiceAccount)`: block verification whenever the required secrets OR the accessor grant is absent, surfacing the specific missing item rather than an ambiguous execution failure
    - _Requirements: 4.2, 4.4, 4.5_

  - [ ] 7.2 Write property test — the deploy-verify success predicate
    - **Property 17: The deploy-verify success predicate**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 17: ...`
    - **Validates: Requirements 4.2**

  - [ ] 7.3 Write property test — a failed execution maps to a failing result carrying its identifiers
    - **Property 18: A failed execution maps to a failing result carrying its identifiers**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 18: ...`
    - **Validates: Requirements 4.4**

  - [ ] 7.4 Write property test — a missing verify prerequisite is surfaced specifically
    - **Property 19: A missing verify prerequisite is surfaced specifically**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 19: ...`
    - **Validates: Requirements 4.5**

  - [ ] 7.5 LIVE CLOUD: execute the deployed Cloud Run Job and verify via Cloud Logging
    - **This is a LIVE operator-approved cloud operation — NOT a property test.** Follow the Live Cloud Execution Protocol against the actual project and deployed Job (no mock/emulator/dry-run, Req 4.1).
    - Reconcile project + account first; confirm the Req 3 prerequisites (secrets + accessor grant) before executing, surfacing any missing prerequisite (Req 4.5)
    - Show the exact `gcloud run jobs execute <job> --wait` command for approval; execute once and wait up to 300s; treat success as succeeded-task-count == task-count (Req 4.2)
    - Poll Cloud Logging up to 60s for the structured completion entry and the absence of an error-level entry for that execution (Req 4.3); on failure/timeout/short count report the execution id + log reference (Req 4.4)
    - Record the outcome (success/failure + Cloud Logging reference) with no `Secret_Key` value (Req 4.6)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 8. SchedulerProvisioner — one daily trigger gated on a successful verify (Req 5)
  - [ ] 8.1 Implement the `SchedulerPlan` and the verify-gate predicate (pure)
    - Create `src/ops/scheduler/provisioner.ts` with `SchedulerPlan` (`schedule "0 17 * * *"`, `timeZone "America/New_York"`, `artifactApproach`, least-privilege `invokerServiceAccount`)
    - Implement `create(plan, verify)` to construct the create command iff `verify.ok`, otherwise refuse and surface the unmet Deploy_Verification prerequisite; configure exactly one daily job, `--max-retry-attempts=3`, and grant the invoker identity only `roles/run.invoker` on the Job
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7_

  - [ ] 8.2 Write property test — scheduler creation is gated on a successful verify
    - **Property 20: Scheduler creation is gated on a successful verify**
    - min 100 iterations, tagged `// Feature: operational-wiring, Property 20: ...`
    - **Validates: Requirements 5.3**

  - [ ] 8.3 Write unit tests — scheduler config values
    - Test schedule `0 17 * * *`, timezone `America/New_York` (Req 5.2), retry attempts = 3 (Req 5.6), invoker granted only `roles/run.invoker` (Req 5.7)
    - _Requirements: 5.2, 5.6, 5.7_

  - [ ] 8.4 Implement `writeArtifact` — committed scheduler IaC artifact recording the approach
    - Emit exactly one version-controlled artifact (one of: workflow step, committed config/Terraform, or documented committed command) that records which of the three approaches was used and the exact provisioning command
    - _Requirements: 5.4_

  - [ ] 8.5 LIVE CLOUD: create the daily Cloud Scheduler job
    - **This is a LIVE operator-approved cloud operation — NOT a property test.** Follow the Live Cloud Execution Protocol.
    - Reconcile project + account first; refuse to create unless DeployVerifier (task 7.5) reported success (Req 5.3)
    - Show the exact `gcloud scheduler jobs create http` command for approval: exactly one daily job, `America/New_York` timezone so DST resolves automatically (Req 5.1, 5.2), invoker granted only `roles/run.invoker` (Req 5.7), `--max-retry-attempts=3` (Req 5.6)
    - The equivalent-unattended-run guarantee (Req 5.5) is inherited — the triggered Job runs the same `main.ts` → `runScheduledDaily` → `runDailyPipeline` path as a local run (parent Req 16.7)
    - Read Cloud Logging for feedback; record only non-secret references
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.7_

- [ ] 9. Final checkpoint — cloud half
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster path; core implementation and live-cloud tasks are never optional.
- **LIVE CLOUD EXECUTION tasks (6.10, 7.5, 8.5) are not property tests.** They perform real, cost-incurring operations in `trade-assistant-508806` under the Live Cloud Execution Protocol: reconcile project/account → show the exact `gcloud` command and get operator approval → pipe secret values via `--data-file=-` on stdin (never echo/commit) → read Cloud Logging for feedback. No secret value is ever printed, logged, committed, or passed as an argument.
- The Supabase adapters (task 2) are the shared seam that replaces the two throwing stubs in `src/scheduled-run/main.ts`; they unblock both the local StagedRunner and the deployed Job used by DeployVerifier.
- Dependency order: local half CsvLoader → Supabase adapters → StagedRunner (backfill → backtest → forward-look); cloud half OperationalSafety → SecretManager → DeployVerifier → Scheduler. CsvLoader (task 1) and the OperationalSafety guard (task 5) have no dependencies and start first.
- Requirement coverage: Req 1 (tasks 1.1–1.10), Req 2 (tasks 3.1–3.10), Req 3 (tasks 6.1–6.10), Req 4 (tasks 7.1–7.5), Req 5 (tasks 8.1–8.5), Req 6 (tasks 5.1–5.5). Every design Property 1–24 is covered by a tagged property test (Properties 1–11 local; 12–24 cloud pure logic).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.10", "5.2", "5.3", "5.4", "5.5", "6.1"] },
    { "id": 2, "tasks": ["1.8", "1.9", "2.1", "6.2", "6.3", "6.4", "6.9"] },
    { "id": 3, "tasks": ["2.2", "6.5", "6.6"] },
    { "id": 4, "tasks": ["2.3", "3.1", "6.7", "6.8"] },
    { "id": 5, "tasks": ["3.2", "3.3", "3.4", "6.10"] },
    { "id": 6, "tasks": ["3.5", "3.6", "3.10", "7.1"] },
    { "id": 7, "tasks": ["3.7", "3.8", "3.9", "7.2", "7.3", "7.4"] },
    { "id": 8, "tasks": ["7.5"] },
    { "id": 9, "tasks": ["8.1", "8.4"] },
    { "id": 10, "tasks": ["8.2", "8.3"] },
    { "id": 11, "tasks": ["8.5"] }
  ]
}
```
