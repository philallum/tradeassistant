# Requirements Document

## Introduction

The FX Daily Pattern Trading Assistant's deterministic core is complete: the ingestion/validation module (parent Requirement 7), the two-stage kill-gate math (parent Requirement 11), the end-to-end daily pipeline (`src/pipeline/dailyPipeline.ts`), the Cloud Run Job entry point (`src/scheduled-run/main.ts`, parent Requirement 16.7), and the delivery workflow (`.github/workflows/deploy.yml`) all exist and pass tests. What is missing is the **operational wiring** that connects that finished core to real historical data and to live cloud infrastructure.

This spec closes five operational gaps identified after the parent spec's tasks were completed. It is deliberately scoped to *wiring only*: it feeds and triggers the existing deterministic components and provisions the cloud resources they already assume, and it does **not** re-implement any validation, scoring, kill-gate, or pipeline logic. Every requirement below either produces inputs for, invokes, or provisions infrastructure around an already-built module, and cross-references the parent requirement it serves.

The five gaps and their dependency structure:

- **Local-data half** (largely independent of the cloud half):
  - **CSV Import** (Requirement 1) — a loader that parses the `data/*.csv` candle files and feeds the existing ingestion module.
  - **Staged Runner** (Requirement 2) — an end-to-end runner with backfill, backtest, and forward-look stages built on the existing pipeline and kill-gate.
- **Cloud half** (a strict dependency chain):
  - **Secret Manager** (Requirement 3) — create and populate the GCP secrets the running Job pulls at runtime. *Must exist before* deploy verification can succeed.
  - **Deploy Verification** (Requirement 4) — a real, live check that GitHub deploys to GCP and the Job executes successfully. *Depends on* Secret Manager; *must precede* scheduling.
  - **Cloud Scheduler** (Requirement 5) — a daily trigger for the deployed Job, timed to Session_Close. *Depends on* a verified, successful deploy.
  - **Hosted Backfill Execution** (Requirement 7) — actually run the backfill against hosted Supabase so the scheduled Job has candle history to evaluate. *Depends on* the Supabase adapters and the Backfill_Stage.
  - **Least-Privilege Hosted Write Access** (Requirement 8) — the deployed Job must write candles, vectors, and firing setups under Row-Level Security with a scoped, non-service-role credential, rather than an RLS-restricted anon key (which cannot write) or an RLS-bypassing service-role key (over-privileged).

An **Operational safety** requirement (Requirement 6) governs the live cloud commands the operator runs in this spec: secret values are never committed or echoed, and every create/deploy/cost-incurring command is shown to the operator before execution.

## Glossary

Terms defined in the parent spec (`fx-daily-pattern-assistant/requirements.md`) are reused as-is and referenced here rather than redefined: **System**, **Pair / Asset**, **Decision_Date**, **Session_Close / NY_Close**, **Matured_Outcome**, **Pattern_Vector**, **Kill_Gate**, **Gate_1 / Gate_2**, **Walk_Forward_Window**, **Out_Of_Sample_Test**, **Research_Log**, **Strategy_Source**, **Latest_Stable**. New operational terms:

- **CSV_Candle_File**: One of the five tab-separated daily-candle files in `data/` — `EURUSD_D1.csv`, `GBPUSD_D1.csv`, `USDJPY_D1.csv`, `USDCHF_D1.csv`, `USDCAD_D1.csv`. Each has a 6-column header (`Time`, `Open`, `High`, `Low`, `Close`, `Volume`) and 7-column data rows (the six named fields plus a trailing integer column, the per-candle tick count), CRLF line endings, and `YYYY-MM-DD 00:00:00` timestamps with daily history beginning in 2010.
- **CSV_Loader**: The operational script that reads a CSV_Candle_File, maps each row to the `RawCandle` shape the existing ingestion module consumes, and hands the batch to that module. It performs parsing and mapping only; it performs no OHLC validation, deduplication, or session normalization itself.
- **Data_Source_Role**: The classification of the CSV_Candle_Files as either a one-time historical **backfill** source or an ongoing **feed** running alongside the live API providers (`OHLC_PROVIDER` / `OHLC_API_KEY` / `OHLC_BASE_URL`). This role determines whether the CSV_Loader runs once or on a recurring cadence.
- **Staged_Runner**: The operational entrypoint exposing three ordered stages — Backfill_Stage, Backtest_Stage, Forward_Look_Stage — over the existing deterministic modules.
- **Backfill_Stage**: The stage that loads all historical candle data (CSV and/or API) into Supabase through the existing ingestion module and builds and stores the Pattern_Vectors, populating the matured forward outcomes retrieval reads.
- **Backtest_Stage**: The stage that runs the existing Kill_Gate over the Walk_Forward_Window folds on the backfilled history and appends the per-fold verdicts and metrics to the Research_Log.
- **Forward_Look_Stage**: The stage that produces the live 1–3 day directional setups for the current Decision_Date by invoking the existing daily pipeline (`runDailyPipeline`) / scheduled-run path, without duplicating that logic.
- **Env_Key**: A single configuration key present in the project `.env` file (referenced by name only, never by value).
- **Secret_Key**: An Env_Key whose value is confidential — every `*_API_KEY`, `*_KEY`, `*_TOKEN`, service-account credential, or connection string/URL bearing an embedded credential — which must be stored in Google Secret Manager and injected at runtime via `--set-secrets`.
- **Config_Env_Key**: An Env_Key whose value is non-confidential — project id, region, model id, provider *name*, or boolean toggle (`*_ENABLED`, `GOOGLE_GENAI_USE_VERTEXAI`) — which is passed to the Job via `--set-env-vars`.
- **Secret_Manager**: Google Secret Manager in the target GCP project, the runtime source of every Secret_Key for the Cloud Run Job.
- **Runtime_Service_Account**: The dedicated least-privilege service account the Cloud Run Job runs as, which must hold `roles/secretmanager.secretAccessor` to read the Secret_Keys at runtime.
- **Cloud_Run_Job**: The deployed Cloud Run Job (`scheduled-run` image) that executes `src/scheduled-run/main.ts` to completion once per invocation.
- **Deploy_Verification**: A real, live post-deploy check performed against the actual GCP project that executes the Cloud_Run_Job once and asserts success via the job execution status and Cloud Logging, confirming GitHub actually deploys to Google Cloud and the Job runs.
- **Scheduler_Job**: A Google Cloud Scheduler job that triggers the Cloud_Run_Job daily, timed relative to the 17:00 America/New_York Session_Close (22:00 UTC during US Eastern Standard Time).
- **Live_Cloud_Command**: Any operator-run command that creates, modifies, deploys, executes, or otherwise incurs cost against the live GCP project (secret creation, IAM grants, deploy verification runs, scheduler creation).
- **Hosted_Candle_Seeding**: The one-time live operation that runs the existing Backfill_Stage against the hosted Supabase backend (`SUPABASE_TARGET=hosted`), populating the `candles`, `pattern_vectors`, and matured `analogue_outcomes` tables from the `data/*.csv` CSV_Candle_Files so the scheduled daily Cloud_Run_Job evaluates real candle history rather than an empty database.
- **Pipeline_Writer_Role**: A dedicated least-privilege Postgres role the deployed Cloud_Run_Job authenticates as, holding only `INSERT`/`UPDATE`/`SELECT` on the five compute-written tables (`candles`, `pattern_vectors`, `analogue_outcomes`, `firing_setups`, `realized_outcomes`) and no `DELETE` or access to any other table or schema. Reached through PostgREST via a signed JWT whose `role` claim selects it; Row-Level Security still applies.
- **Scoped_Write_Credential**: The signed JWT (role claim = Pipeline_Writer_Role, signed with the project JWT secret) the Cloud_Run_Job presents as its Bearer credential — NOT the service-role (`sb_secret_`) key. It is the value of the `supabase-key` Secret Manager secret the Job reads.
- **Service_Role_Key**: The RLS-bypassing Supabase secret key (`sb_secret_...`), reserved for operator-run one-off operations (e.g. the Hosted_Candle_Seeding backfill); never deployed into the Cloud_Run_Job and never committed.

## Requirements

### Requirement 1: CSV Candle Import Into Existing Ingestion

**User Story:** As a researcher, I want a loader that imports the `data/` candle CSV files into the existing ingestion module, so that the deterministic core runs on the confirmed historical dataset without re-implementing any validation.

#### Acceptance Criteria

1. THE CSV_Loader SHALL read each CSV_Candle_File for EURUSD, GBPUSD, USDJPY, USDCHF, and USDCAD from the `data/` directory as tab-separated values, treating the first line as a 6-column header (`Time`, `Open`, `High`, `Low`, `Close`, `Volume`) and each subsequent non-empty line as a 7-column data row, and SHALL accept both CRLF and LF line endings.
2. THE CSV_Loader SHALL exclude the seventh data column (per-candle tick count) from the candle representation so that only the `Time`, `Open`, `High`, `Low`, and `Close` fields populate each `RawCandle`.
3. WHEN the CSV_Loader parses a `Time` value of the form `YYYY-MM-DD 00:00:00`, THE CSV_Loader SHALL pass the unaltered timestamp to the existing ingestion module for normalization to the Session_Close boundary (17:00 America/New_York, 22:00 UTC) per parent Requirements 7.7 and 7.8, and SHALL NOT itself alter, shift, or normalize the timestamp.
4. THE CSV_Loader SHALL feed the parsed candles to the existing `src/ingestion` module (`OhlcIngestion.ingest`) so that OHLC validity rejection (parent Requirement 7.3), `(Asset, Date)` deduplication (parent Requirement 7.4), and per-pair coverage summaries (parent Requirement 7.6) are performed by that module, and SHALL NOT re-implement any of those checks.
5. IF a CSV_Candle_File is missing, unreadable, or its parsed header row does not contain exactly the 6 expected columns in the expected order, THEN THE CSV_Loader SHALL abort processing of that file, SHALL report an error identifying the file by name and the reason for failure, and SHALL NOT feed any candles from that file to the ingestion module.
6. WHEN the CSV_Loader runs two or more times over an unchanged set of CSV_Candle_Files, THE System SHALL produce identical stored results with no duplicated candles, relying on the existing module's idempotent `(Asset, Date)` upsert (parent Requirement 7.4).
7. WHEN import of a CSV_Candle_File completes without an aborting error, THE CSV_Loader SHALL emit the per-pair coverage summary returned by the ingestion module, reporting for each Pair its stored candle count, earliest stored date, and latest stored date.
8. THE System SHALL record the Data_Source_Role of the CSV_Candle_Files as exactly one of {one-time backfill source, ongoing feed alongside the live API providers (`OHLC_PROVIDER`, `OHLC_API_KEY`, `OHLC_BASE_URL`)}, and WHILE a recorded Data_Source_Role is set, THE CSV_Loader SHALL run only in accordance with that recorded role.
9. IF a data row does not contain exactly 7 tab-separated columns or contains a `Time`, `Open`, `High`, `Low`, or `Close` value that cannot be parsed into its expected type, THEN THE CSV_Loader SHALL abort processing of that file, SHALL report an error identifying the file by name and the offending row, and SHALL NOT feed any candles from that file to the ingestion module.
10. IF a CSV_Candle_File contains a valid 6-column header but zero data rows, THEN THE CSV_Loader SHALL report that the file is empty and SHALL feed no candles from that file to the ingestion module.

### Requirement 2: Staged Backfill / Backtest / Forward-Look Runner

**User Story:** As a researcher, I want a single end-to-end runner with distinct backfill, backtest, and forward-look stages, so that I can populate history, prove the premise out-of-sample, and produce live setups using the existing pipeline without duplicating it.

#### Acceptance Criteria

1. THE Staged_Runner SHALL expose three distinct stages — Backfill_Stage, Backtest_Stage, and Forward_Look_Stage — as independently runnable operations that also compose into an ordered end-to-end run.
2. WHEN the Backfill_Stage runs, THE System SHALL load all historical candle data (from the CSV_Loader of Requirement 1 and, where the Data_Source_Role indicates, the live API providers) into Supabase through the existing ingestion module, and SHALL build and store the Pattern_Vectors, populating the matured forward outcomes retrieval reads.
3. WHEN the Backtest_Stage runs, THE System SHALL invoke the existing Kill_Gate over the Walk_Forward_Window folds (parent Requirements 11 and 19) on the backfilled history and SHALL NOT re-implement the gate math.
4. WHEN the Backtest_Stage completes a verdict, THE System SHALL append the per-fold verdicts and metrics to the Research_Log (`RESEARCH-LOG.md`) consistent with parent Requirements 11.9, 11.10, 11.11, and 19.4.
5. WHEN the Forward_Look_Stage runs, THE System SHALL produce the live 1–3 day directional setups for the current or most-recent matured Decision_Date by invoking the existing daily pipeline (`runDailyPipeline` in `src/pipeline/dailyPipeline.ts`) via the existing scheduled-run path (`src/scheduled-run`), and SHALL NOT duplicate the pipeline or the `dailyRun` firing logic.
6. THE System SHALL order the composed end-to-end run so that the Backfill_Stage precedes the Backtest_Stage and the Backtest_Stage precedes the Forward_Look_Stage, because each stage consumes the prior stage's stored output.
7. IF a stage is invoked before its prerequisite stored data exists (for example the Backtest_Stage before any candles or Pattern_Vectors are stored), THEN THE System SHALL abort that stage, SHALL report an error naming the missing prerequisite, SHALL leave prior stored data unchanged, and SHALL NOT emit a fabricated or empty result as if it were valid.
8. WHEN the Forward_Look_Stage is invoked with the same stored inputs and the same Decision_Date, THE System SHALL produce an identical set of setups, consistent with the deterministic-computation guarantee (parent Requirement 3.1) and the equivalent-unattended-run guarantee (parent Requirement 16.7).
9. IF any stage in the composed end-to-end run fails, THEN THE System SHALL stop the composed run at the failed stage and SHALL NOT execute subsequent stages.

### Requirement 3: Secret Manager Provisioning and Classification

**User Story:** As the system owner, I want the GCP secrets the running Job depends on created, populated, and access-granted from my `.env` without exposing any secret value, so that the deployed Cloud Run Job can pull its credentials at runtime.

#### Acceptance Criteria

1. THE System SHALL classify each Env_Key in the project `.env` as either a Secret_Key or a Config_Env_Key using the convention: every `*_API_KEY`, `*_KEY`, `*_TOKEN`, service-account credential, and credential-bearing connection string or URL is a Secret_Key; project id, region, model id, provider *names*, and boolean toggles (`*_ENABLED`, `GOOGLE_GENAI_USE_VERTEXAI`) are Config_Env_Keys.
2. THE System SHALL create in Secret_Manager, within the target GCP project, a secret for every Secret_Key required by the Cloud_Run_Job at runtime, including the Supabase secrets already referenced by `deploy.yml` (`supabase-url`, `supabase-key`, `supabase-pooler-url`) and the third-party provider Secret_Keys (`OHLC_API_KEY`, `YIELD_API_KEY`, `NEWS_CALENDAR_API_KEY`, `EXTERNAL_SIGNAL_API_KEY`, `TWELVE_DATA_API_KEY`, `MASSIVE_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `FINNHUB_API_KEY`, `NEWS_API_KEY`, and any credential-bearing Supabase key or token the Job reads).
3. WHEN populating a Secret_Manager secret from the `.env` file, THE System SHALL read the value directly from `.env` without committing it to version control and without echoing it to logs, terminal output, chat, or the Research_Log, consistent with Requirement 6.
4. THE System SHALL grant the Runtime_Service_Account the `roles/secretmanager.secretAccessor` role on each created secret, and SHALL verify the grant is present before treating Secret_Manager provisioning as complete.
5. THE System SHALL update the `deploy.yml` `--set-secrets` argument so that every Secret_Key the Cloud_Run_Job requires is injected from its Secret_Manager secret, and SHALL update the `--set-env-vars` argument so that every Config_Env_Key the Job requires is passed as a plain environment variable.
6. THE System SHALL NOT place any Secret_Key value in `deploy.yml`, in any committed configuration file, or in any `--set-env-vars` argument.
7. THE System SHALL reconcile the target GCP project against the `.env` `GCP_PROJECT_ID` before creating any Secret_Manager resource, and IF the active gcloud project differs from `GCP_PROJECT_ID`, THEN THE System SHALL abort and surface the discrepancy for operator resolution before creating any resource.
8. WHEN a secret for a given Secret_Key already exists in Secret_Manager, THE System SHALL add a new secret version rather than creating a duplicate secret, so that re-running provisioning is idempotent.
9. IF a Secret_Key's value in `.env` is empty or absent, THEN THE System SHALL report that missing value and SHALL NOT create or version a secret with an empty value.

### Requirement 4: Live Deploy Verification

**User Story:** As the system owner, I want a real verification that GitHub actually deploys to Google Cloud and the Job runs, so that I know the delivery pipeline works end-to-end rather than only that the workflow file is syntactically valid.

#### Acceptance Criteria

1. THE Deploy_Verification SHALL run against the actual target GCP project and the actually deployed Cloud_Run_Job, not a mock, emulator, or dry run.
2. WHEN Deploy_Verification runs, THE System SHALL execute the deployed Cloud_Run_Job once, SHALL wait up to 300 seconds for the execution to complete, and SHALL treat the execution as successful only WHERE its succeeded task count equals its task count.
3. THE Deploy_Verification SHALL confirm the executed run's outcome by polling Cloud Logging for up to 60 seconds for the Job execution's structured completion log entry and the absence of an error-level log entry for that execution.
4. IF the Cloud_Run_Job execution fails, exceeds the 300-second completion window, or reports a succeeded task count less than its task count, THEN THE Deploy_Verification SHALL report a failing result identifying the failed execution id and its Cloud Logging reference.
5. THE System SHALL treat successful Secret_Manager provisioning (Requirement 3) as a prerequisite of Deploy_Verification, because the Cloud_Run_Job pulls its Secret_Keys at runtime, and IF the required secrets or the Runtime_Service_Account accessor grant are absent, THEN THE System SHALL surface that missing prerequisite rather than reporting an ambiguous execution failure.
6. THE System SHALL record the Deploy_Verification outcome (success or failure with its Cloud Logging reference) without recording any Secret_Key value.

### Requirement 5: Cloud Scheduler Daily Trigger

**User Story:** As a trader, I want the deployed Cloud Run Job triggered automatically once per day, so that the daily refresh runs unattended and produces the same result as a local run per parent Requirement 16.7.

#### Acceptance Criteria

1. THE System SHALL create exactly one Scheduler_Job that triggers the deployed Cloud_Run_Job once per calendar day.
2. THE System SHALL configure the Scheduler_Job to fire at 17:00 America/New_York Session_Close, using the America/New_York timezone so that the fire time automatically resolves to 22:00 UTC during US Eastern Standard Time and 21:00 UTC during US Eastern Daylight Time, such that each triggered run evaluates the daily candles that closed at that Session_Close.
3. IF Deploy_Verification (Requirement 4) has not completed successfully, THEN THE System SHALL NOT create the Scheduler_Job and SHALL surface an indication that the Deploy_Verification prerequisite was not met.
4. THE System SHALL express the Scheduler_Job provisioning as exactly one recorded, version-controlled artifact selected from: (a) a `gcloud scheduler` step in the workflow, (b) a committed configuration or Terraform file, or (c) a documented manual command committed to the repository, and SHALL record in that same artifact which of the three approaches was used.
5. WHEN the Scheduler_Job triggers the Cloud_Run_Job, THE System SHALL cause the unattended run to produce a result equivalent to a local run executed against the same input candles, consistent with parent Requirement 16.7.
6. IF the Scheduler_Job triggering attempt fails to invoke the Cloud_Run_Job, THEN THE System SHALL retry up to 3 times and, if all attempts fail, SHALL record a failure indication identifying the failed trigger.
7. THE System SHALL grant the Scheduler_Job's invoker identity only the single role required to invoke the Cloud_Run_Job and SHALL NOT grant any broader or additional role to that identity.

### Requirement 6: Operational Safety for Live Cloud Commands

**User Story:** As the system owner, I want every live cloud action in this spec to be shown to me before it runs and to never expose a secret value, so that I retain control over cost-incurring changes and my credentials stay confidential.

#### Acceptance Criteria

1. WHEN the operator is about to run a Live_Cloud_Command that creates, modifies, deploys, executes, or otherwise incurs cost against the GCP project, THE System SHALL present the exact command to the operator and SHALL NOT execute it until the operator approves.
2. THE System SHALL NOT commit, echo, or log any Secret_Key value at any point during secret creation, deployment, verification, or scheduling.
3. WHEN a command handles a Secret_Key, THE System SHALL reference that key by name only and SHALL source its value directly from the `.env` file or Secret_Manager rather than reproducing the value in command output, chat, or committed files.
4. THE System SHALL reconcile the active gcloud project and account against the expected target (`GCP_PROJECT_ID`) before running any Live_Cloud_Command, consistent with Requirement 3.7.
5. IF a Live_Cloud_Command would delete, overwrite, or reduce the permissions of an existing cloud resource, THEN THE System SHALL present a distinguishable warning identifying the affected resource and effect to the operator and SHALL NOT execute the command until the operator approves.
6. IF the active gcloud project or account does not match the expected target, THEN THE System SHALL abort the Live_Cloud_Command and surface the mismatch rather than executing against an unintended project or identity.

### Requirement 7: Hosted Supabase Backfill Execution

**User Story:** As the system owner, I want the historical backfill actually executed against hosted Supabase, so that the scheduled daily Cloud_Run_Job evaluates real candle history instead of an empty database.

#### Acceptance Criteria

1. THE System SHALL reconcile the resolved storage target against `SUPABASE_TARGET=hosted` and the active gcloud project against `GCP_PROJECT_ID` before writing any data, and IF the resolved target is not the hosted backend THEN THE System SHALL abort Hosted_Candle_Seeding and surface the discrepancy, consistent with Requirement 6.4.
2. THE System SHALL confirm the hosted `candles`, `pattern_vectors`, and `analogue_outcomes` tables exist before seeding, and IF a required table is absent THEN THE System SHALL surface that missing prerequisite rather than failing mid-write.
3. WHEN Hosted_Candle_Seeding runs, THE System SHALL execute the existing Backfill_Stage (Requirement 2.2) against the hosted Supabase stores with Data_Source_Role = backfill, loading all five pairs from the CSV_Candle_Files through the existing ingestion module and building and storing the Pattern_Vectors, and SHALL NOT re-implement ingestion, encoding, or storage logic.
4. WHEN Hosted_Candle_Seeding is run two or more times over an unchanged set of CSV_Candle_Files, THE System SHALL produce identical stored results with no duplicated candles, relying on the existing idempotent `(Asset, Date)` upsert (Requirement 1.6, parent Requirement 7.4).
5. WHEN seeding completes, THE System SHALL emit the per-pair coverage summary (stored candle count, earliest stored date, and latest stored date per Pair) and SHALL treat Hosted_Candle_Seeding as complete only WHERE every one of the five pairs has a non-zero stored candle count.
6. THE System SHALL record only non-secret references (coverage counts and dates) from Hosted_Candle_Seeding and SHALL NOT echo, log, or commit the Supabase key, consistent with Requirements 6.2 and 6.3.
### Requirement 8: Least-Privilege Hosted Write Credential and Row-Level Security

**User Story:** As the system owner, I want the deployed Job to write to hosted Supabase under Row-Level Security with a scoped, non-service-role credential, so that the daily run can persist its results while a compromise of the Job cannot read or destroy unrelated data.

#### Acceptance Criteria

1. THE System SHALL enable Row-Level Security on each compute-written table — `candles`, `pattern_vectors`, `analogue_outcomes`, `firing_setups`, and `realized_outcomes` — via a version-controlled, idempotent migration applied identically to the local and hosted targets (parent Requirement 17.2).
2. THE System SHALL define, in that same migration, a dedicated Pipeline_Writer_Role granted only `INSERT`, `UPDATE`, and `SELECT` on those five tables, with Row-Level Security policies scoped to that role, and SHALL NOT grant it `DELETE` or any access to other tables or schemas.
3. THE deployed Cloud_Run_Job SHALL authenticate to hosted Supabase using the Scoped_Write_Credential (a signed JWT whose `role` claim selects the Pipeline_Writer_Role) and SHALL NOT use the Service_Role_Key.
4. THE System SHALL reserve the Service_Role_Key for operator-run one-off operations only, and SHALL NOT store it as the Cloud_Run_Job's `supabase-key` secret, in `deploy.yml`, or in any committed file.
5. THE System SHALL keep the publishable (anon) key as a read-only credential reserved for the future read-only serving layer (parent Requirement 17.3) and SHALL NOT use it for the Job's write path.
6. THE System SHALL set the `supabase-key` Secret Manager secret to the Scoped_Write_Credential and SHALL inject it into the Job via `--set-secrets`, placing no secret value in `deploy.yml`, consistent with Requirement 3.6.
7. WHEN the write path is exercised under the Scoped_Write_Credential, THE System SHALL permit an `INSERT`/`UPDATE` on the five compute-written tables and SHALL deny a `DELETE` or any write to a table outside that set, confirming the scope.
8. THE System SHALL NOT echo, log, or commit the Scoped_Write_Credential, the Service_Role_Key, or the project JWT secret at any point, consistent with Requirements 6.2 and 6.3.
