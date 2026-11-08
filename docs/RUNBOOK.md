# Runbook

How to run, deploy, schedule and recover the system. Everything here that touches live cloud
resources or the hosted database is an **operator action**: show the exact command, get approval,
run it, record only non-secret references. Nothing in this repo runs them automatically, and an
agent working in the repo must not.

Identifiers below (project, region, job names) are non-secret and also appear in `ops/*.json`.
Secrets are referenced **by Secret Manager name only**.

## At a glance

| Thing | Value |
| --- | --- |
| GCP project / region | `trade-assistant-508806` / `europe-west1` |
| Daily Job | Cloud Run Job `scheduled-daily-run` (`node dist/scheduled-run/main.js`) |
| Daily trigger | Cloud Scheduler `scheduled-daily-run-session-close`, `30 17 * * 1-5` America/New_York (committed in `ops/scheduler-job.config.json`) |
| Intraday Job | Cloud Run Job `intraday-validation-run` (same image, `node dist/scheduled-run/intradayMain.js`) |
| Intraday trigger | Cloud Scheduler `intraday-validation-run-0800-uk`, `0 8 * * 1-5` Europe/London (`ops/intraday-validation-scheduler.config.json`) |
| Output | `dashboard.json` in the public-read bucket named by `DASHBOARD_SNAPSHOT_BUCKET` |
| UI | Firebase Hosting site (`web/firebase.json`), reads that one file |
| Database | Supabase (hosted), reached over PostgREST as the `fx_writer` role |

## The daily cycle

1. 17:00 NY - the FX daily candle closes.
2. 17:30 NY - the Scheduler fires the Job. It labels itself with the **next** trading day
   (Friday -> Monday), freshens candles (retrying 3 x 120 s if a provider has not published the
   bar), evaluates the five pairs, persists, builds the display-only extras, and publishes
   `dashboard.json`. Weekends are skipped by a weekday gate.
3. 08:00 London next morning - the intraday Job validates each pair's call against the forming 4H
   candle and republishes the file with only `intradayValidation` replaced.

Why 17:30 and not 17:00: firing at the exact close meant the in-Job retry window could expire
before providers published the bar, causing a recurring `candle_freshness.degraded` alert. The
30-minute offset resolved it (operator-confirmed 2026-11-06).

## Running locally

```bash
cp .env.example .env            # fill in values; .env is gitignored
npm install && npm run check    # lint + typecheck + tests
npm run build
npm run start:scheduled-run     # one daily run against the SUPABASE_TARGET you configured
```

- `SUPABASE_TARGET=local` (default) with `supabase start` is the safe target. Heavy full-history
  tools (`evaluation-run`, `edge-eval`) **refuse the hosted project** unless `ALLOW_HOSTED_BACKTEST=1`.
- Without `DASHBOARD_SNAPSHOT_BUCKET` the snapshot write is a logged no-op - the run still completes.
- Without a provider key the candle stage is skipped and the run proceeds on stored history.
- The seed candle CSVs live in `data/` and are used by the operator backfill tools and tests only;
  they are **not** in the runtime image.

### Replaying a past date

Set `RUN_DECISION_DATE=YYYY-MM-DD`. The pipeline is a pure function of stored candles strictly
before that date, so the firing result reproduces. Two things are different on a replay:

- The `third_party` signal is **not recorded** to `signal_predictions`
  (`signal_scorecard.third_party_skipped` is logged). It is a live external read that cannot be
  reconstructed for a past date; recording it would store today's value under the old date.
- The FCS reference shown for the day is still today's live value (display only).

## Deploying

Delivery cadence: develop on `dev`; **the operator merges `dev` -> `main`**. A push to `main`
runs `.github/workflows/deploy.yml` (path-filtered):

- **Backend change:** quality gate -> keyless auth (Workload Identity Federation) -> Cloud Build
  image tagged with the commit SHA -> Artifact Registry -> `gcloud run jobs deploy` for the daily
  Job **and** the intraday Job (same SHA-pinned image, so the intraday Job cannot go stale).
- **Frontend change:** web gate -> `firebase deploy --only hosting`, keyless.

Repository variables the workflow reads (names only): `GCP_PROJECT_ID`, `GCP_REGION`,
`AR_REPOSITORY`, `CLOUD_RUN_JOB`, `INTRADAY_CLOUD_RUN_JOB` (defaults to `intraday-validation-run`),
`RUNTIME_SERVICE_ACCOUNT`, `WIF_PROVIDER`, `DEPLOY_SERVICE_ACCOUNT`, `GEMINI_MODEL`,
`DASHBOARD_SNAPSHOT_BUCKET`, `VITE_SNAPSHOT_URL`.

Secrets injected into the Jobs from Secret Manager (name -> env var):

| Secret Manager name | Env var | Used by |
| --- | --- | --- |
| `external-signal-api-key` | `EXTERNAL_SIGNAL_API_KEY` | daily |
| `twelve-data-api-key` | `TWELVE_DATA_API_KEY` | daily, intraday |
| `massive-api-key` | `MASSIVE_API_KEY` | daily |
| `supabase-key` | `SUPABASE_HOSTED_KEY` | daily, intraday |
| `supabase-publishable-key` | `SUPABASE_PUBLISHABLE_KEY` | daily, intraday |
| `supabase-url` | `SUPABASE_HOSTED_URL` | daily, intraday |
| `supabase-pooler-url` | `SUPABASE_POOLER_URL` | daily, intraday |

The Gemini/Vertex path uses **no** API-key secret: it authenticates as the runtime service account
(`roles/aiplatform.user`). Do not remove the Twelve Data / Massive secrets as "orphans" - the
candle provider chain and the intraday layer need them.

### Out-of-band prerequisites (not created by the workflow)

The GCS bucket and its CORS (`ops/dashboard-bucket-cors.json`), both Scheduler jobs and the IAM
roles, and the Cloud Monitoring alert (`ops/monitoring/apply-candle-freshness-alert.sh`).

## Database migrations

Migrations in `supabase/migrations/` are applied **out-of-band** (SQL editor / operator).
**Never run `supabase db push`**: the remote CLI migration-history table is untracked, so a push
would try to replay everything. Migrations are additive (`create table if not exists`, guarded
grants), and every Supabase read adapter is fail-safe, so a deploy that lands before its
migration degrades to an empty result instead of crashing.

## Operating commands

```bash
# Run the daily Job now (idempotent by Decision_Date; used to self-heal a candle gap or verify)
gcloud run jobs execute scheduled-daily-run --region europe-west1 --wait

# Run the intraday Job now
gcloud run jobs execute intraday-validation-run --region europe-west1 --wait

# Pause / resume the intraday trigger (e.g. while its image is being fixed)
gcloud scheduler jobs pause  intraday-validation-run-0800-uk --location=europe-west1
gcloud scheduler jobs resume intraday-validation-run-0800-uk --location=europe-west1

# Point the intraday Job at a specific image by hand (deploy.yml normally does this)
gcloud run jobs update intraday-validation-run --image=<image-uri> --region=europe-west1
```

### The intraday republish hazard

The intraday Job rewrites `dashboard.json` (key-replacing only `intradayValidation`). Only run it on
an image that does a key-replace - an older version overwrote the daily slices with empty ones.
If the live file ever shows empty daily slices, re-run the daily Job to restore it, then re-run
the intraday Job and confirm every other slice is unchanged.

## Observability and what to do

All logs are structured JSON; none contain a secret.

| You see | Meaning | Action |
| --- | --- | --- |
| `candle_freshness.degraded` (severity ERROR; also the Cloud Monitoring alert) | One or more pairs are still behind after the retries; the run published on stored history | Check the provider keys/status; re-run the daily Job later; confirm the pair's latest candle |
| `candle_freshness.retry` | A provider had not published the bar yet | Normal near the close; only act if it ends in `degraded` |
| `candle_freshness.encode_skipped` | A candle's pattern vector could not be stored (lowers that pair's analogue pool) | Look at `message`; re-run the daily Job once the store is healthy |
| `scheduled_run.pipeline_warning` | A display-only step degraded (e.g. expected candle size) | Check the Supabase read; firing is unaffected |
| `scheduled_run.*_failed` / `intraday_validation.startup_warning` | A fail-safe slice/step degraded to its empty default | The named `slice`/`step` says which; the rest of the run is unaffected |
| `signal_scorecard.third_party_skipped` | The run's date was not the live date (a replay) | Expected on replays |
| `scheduled_run.step_timing` | Per-step duration, `outcome` ok/error | Use it to find the slow step (track-record replay has a 120 s deadline) |
| `scheduled_run.snapshot_write_failed` / `snapshot_skipped` | `dashboard.json` was not updated | The DB rows are intact; check the bucket/permissions and re-run |
| `intraday_validation.complete republished=True validated=5` | A healthy intraday run | - |

## Operator cloud-cleanup checklist

Removed from the code in the housekeeping work, but the **cloud resources still exist until you
delete them**. Do these only after listing what is actually live:

```bash
ops/enumerate-gcp.sh           # READ-ONLY: lists live resources and diffs them against the keep-list
ops/enumerate-gcp.sh --json    # same, raw
```

The keep-list is `ops/required-resources.manifest.json`; anything live that is not in it is a
deletion candidate. Known candidates (illustrative - trust the live enumeration, and review each
before deleting):

- [ ] Cloud Run Job `dashboard-seed-run` (the one-shot seed Job; its deploy config and the
      Dockerfile `data/` copy were removed).
- [ ] Cloud Run Job `dashboard-gate-run` (the legacy PASS/CUT gate Job; `ops/gate-run` was removed).
- [ ] Cloud Run Service `dashboard-read-proxy` (removed earlier).
- [ ] Artifact Registry images under `dashboard-read-proxy/`, `gate-run/`, `seed-run/`, and
      `scheduled-run` images beyond the retention window.
- [ ] Secrets for removed providers: `alpha-vantage-api-key`, `finnhub-api-key`, `news-api-key`,
      `news-calendar-api-key`, `supabase-direct-connection`, `supabase-read-key`,
      `supabase-secret-key`, `supabase-token`.
- [ ] Service accounts `read-proxy-runtime@`, `gate-run-runtime@`; **review** (do not blindly
      delete) `trade-assistant@`, the default compute account, and `firebase-adminsdk-fbsvc@`.
- [ ] Hosted Supabase: confirm the legacy `gate_verdicts` / `gate_fold_verdicts` tables are gone
      (the migrations drop them; whether the hosted project has had them applied is not
      verifiable from the repo).

Also on the operator list from `docs/state/RISKS.md`: rotate any real secrets that were ever held
in the local `.env`, and review the open Dependabot findings.

## Recovering

- **A bad or stale `dashboard.json`:** re-run the daily Job (idempotent), then the intraday Job.
- **A missed day / candle gap:** the next run's freshness stage back-fills a bounded gap
  (default look-back 90 trading days, via the range-capable providers - FCS is latest-only). A
  manual `gcloud run jobs execute scheduled-daily-run --wait` clears it sooner.
- **Roll back a deploy:** redeploy the previous commit's SHA-tagged image with
  `gcloud run jobs update <job> --image=<previous-image-uri>` for both Jobs.
