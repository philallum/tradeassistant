# Requirements Document

## Introduction

With `simplify-to-cloud-minimal` complete, the cloud loop runs end-to-end: the
daily Cloud Run Job writes a firing view and publishes `dashboard.json`, and the
first out-of-sample evaluation is recorded. But a live inspection of the hosted
Supabase database revealed a **data-freshness defect that undermines the whole
loop**: the `candles` table holds daily history for all five pairs from 2010
only up to **2026-09-15**, while the current Decision_Date is weeks later. The
daily Job never ingests fresh candles — the CSV loader was deliberately
backfill-only, and no live OHLC feed is wired (`OHLC_PROVIDER` / `OHLC_BASE_URL`
are empty). The gap therefore grows by one trading day every day, and every
downstream computation (pattern encoding, analogue retrieval, firing decision,
and the realized-outcome journal) is operating on stale history.

The project already has working third-party market-data connections. The primary
is the **FCS** provider (`EXTERNAL_SIGNAL_PROVIDER=FCS`, API key present),
currently used only for the display-only external cross-reference; FCS also
exposes daily OHLC history. Two further providers already have API keys in the
environment — **Twelve Data** (`TWELVE_DATA_API_KEY`) and **Massive**
(`MASSIVE_API_KEY`) — and serve as ordered fallbacks. The Candle_Freshness_Stage
therefore uses a provider fallback chain (FCS → Twelve Data → Massive) so a
single provider's outage or rate-limit does not leave the `candles` table stale.

This spec has two parts:

1. **Candle freshness (the feature).** Add a Candle_Freshness_Stage to the daily
   run that, before the deterministic pipeline computes the firing view, fetches
   the latest daily candles from FCS for all five pairs and backfills any gap
   between the last stored candle and the latest available trading day, then
   ingests them idempotently through the existing `OhlcIngestion` validation and
   upsert. A one-off operator backfill closes the current ~3-week hole.

2. **Follow-up cleanup (the chores).** Resolve the open items left after
   `simplify-to-cloud-minimal`: the Vertex AI 403 that disables the display-only
   AI rationale, the ~50 MB database backup committed into git history, the
   Dependabot vulnerability backlog, the plaintext live secrets in `.env`, and
   the trailing cross-spec checkpoints.

Two principles carry over from the parent spec and bound this one:

- **The research-integrity layer stays intact.** Candle ingestion must remain
  Look_Ahead_Safe (no candle dated at/after a Decision_Date may enter a
  decision), must preserve idempotent `(asset, date)` upserts, and must reuse the
  existing `OhlcIngestion` validation rather than re-implement OHLC handling. No
  change touches the Measurement_Engine, the baseline, shrinkage, or the
  AI-never-scores guard.
- **Fail-safe, data-first.** A candle-fetch failure must degrade safely: the run
  logs a secret-free warning and proceeds on the best available history rather
  than crashing or writing corrupt rows. The FCS API key is a secret and is
  referenced by name only, never logged.

## Glossary

Terms from the parent specs (`fx-daily-pattern-assistant`,
`simplify-to-cloud-minimal`) are reused as-is: **System**, **Pair / Asset**,
**Decision_Date**, **Session_Close / NY_Close**, **Candle**, **Look_Ahead_Safe**,
**Realized_Outcome_Journal**, **Cloud_Run_Job**, **Cloud_Scheduler**,
**Public_Read_Path**, **dashboard.json**, **External_Reference_Signal**,
**FCS**, **Secret_Manager**, **Write_Credential (`fx_writer`)**. New terms:

- **Candle_Freshness_Stage**: A new stage at the start of the daily run that
  brings the `candles` table up to the most recent completed trading day for all
  five pairs before the deterministic pipeline reads candle history.
- **OHLC_Feed_Provider**: The runtime adapter that fetches daily OHLC candles
  from a third-party provider over the existing `fetch`-based, zero-SDK
  transport. Distinct from the display-only External_Reference_Signal use of
  FCS.
- **Provider_Fallback_Chain**: The ordered list of OHLC_Feed_Providers tried per
  request — FCS (primary), then Twelve Data, then Massive — each resolved from
  its own environment API key (by name only). The chain advances to the next
  provider only when the current one is unconfigured or fails; the first
  provider that returns usable candles wins.
- **Candle_Gap**: For a pair, the set of completed trading days between the last
  stored candle's date (exclusive) and the most recent completed trading day
  (inclusive) that have no stored candle.
- **Daily_Top_Up**: The normal case — fetching and ingesting the one (or few)
  most recent completed daily candles on each scheduled run.
- **Gap_Backfill**: Closing a multi-day Candle_Gap by fetching the full missing
  range from the OHLC_Feed_Provider in one bounded request per pair.
- **Completed_Trading_Day**: A weekday whose Session_Close (NY close) has passed
  for the run's Decision_Date, so its daily candle is final and
  Look_Ahead_Safe to ingest.

## Requirements

### Requirement 1: Fetch daily candles via a provider fallback chain (FCS → Twelve Data → Massive)

**User Story:** As the operator, I want the daily run to pull the latest daily
candles from FCS and automatically fall back to Twelve Data then Massive if FCS
fails, so a single provider outage or rate-limit never leaves the database
stale.

#### Acceptance Criteria

1. WHEN the daily run starts THEN the System SHALL resolve a
   Provider_Fallback_Chain of OHLC_Feed_Providers in the fixed order FCS →
   Twelve Data → Massive, each from its own environment API key
   (`EXTERNAL_SIGNAL_API_KEY` for FCS, `TWELVE_DATA_API_KEY`, `MASSIVE_API_KEY`
   — referenced by name only), over the built-in `fetch` with no vendor SDK.
2. WHEN requesting daily candles THEN the active provider SHALL request the
   daily (`1D`) OHLC series for the five Pairs (EURUSD, GBPUSD, USDJPY, USDCHF,
   USDCAD), batching Pairs into as few requests as that provider allows to
   respect its rate limit.
3. IF the active provider is unconfigured (its API key is absent) OR its request
   fails (network, HTTP error, malformed body) OR it returns no usable candle
   for a Pair THEN the System SHALL advance to the next provider in the chain for
   that need; the FIRST provider that returns usable candles for a Pair wins,
   and later providers SHALL NOT overwrite candles already obtained from an
   earlier one in the same run.
4. WHEN any provider returns a candle THEN the System SHALL map it to the
   internal `RawCandle` shape and ingest it through the existing `OhlcIngestion`
   (validation + session-boundary normalization + idempotent `(asset, date)`
   upsert); it SHALL NOT bypass or re-implement that path, regardless of which
   provider supplied the candle.
5. IF EVERY provider in the chain is unconfigured or fails THEN the System SHALL
   skip the Candle_Freshness_Stage with a secret-free log and proceed on the
   existing stored history (no crash, no partial corruption).
6. The System SHALL normalize each provider's native response (differing field
   names/units/date formats across FCS, Twelve Data, Massive) to the single
   internal `RawCandle` shape before ingestion, so OHLC validity and
   session-boundary rules apply identically no matter the source; the stored
   candle's `source` SHALL record which provider supplied it.
7. The System SHALL NOT log any provider API key or secret value at any point.

### Requirement 2: Daily top-up before the pipeline computes the firing view

**User Story:** As the operator, I want each run to append the previous day's
candle before anything is computed, so the firing view and journal reflect the
most recent completed session.

#### Acceptance Criteria

1. WHEN the daily run executes for a Decision_Date THEN the Candle_Freshness_Stage
   SHALL run BEFORE the deterministic pipeline reads candle history, so the
   pipeline sees the freshest candles.
2. WHEN topping up THEN the System SHALL ingest only Completed_Trading_Day
   candles strictly before the Decision_Date (Look_Ahead_Safe); it SHALL NOT
   ingest a candle dated on or after the Decision_Date.
3. WHEN a run has already ingested the latest completed candle THEN re-running
   SHALL be a no-op on storage (idempotent upsert), adding no duplicate rows.
4. WHEN the top-up completes THEN the System SHALL emit a secret-free structured
   log of per-pair outcome (candles fetched, accepted, rejected, the resulting
   latest stored date).

### Requirement 3: Detect and backfill a multi-day gap automatically

**User Story:** As the operator, I want the run to notice when the database has
fallen behind by more than a day and catch it up, so a missed run or an outage
self-heals.

#### Acceptance Criteria

1. WHEN the Candle_Freshness_Stage starts THEN for each Pair the System SHALL
   compute the Candle_Gap from the last stored candle date to the most recent
   Completed_Trading_Day.
2. IF a Pair's Candle_Gap spans more than one trading day THEN the System SHALL
   perform a Gap_Backfill: fetch the missing date range from the
   OHLC_Feed_Provider (advancing through the Provider_Fallback_Chain if the
   primary fails) and ingest it idempotently, bounded to a configured
   maximum lookback so a very old `last stored` date cannot trigger an
   unbounded request.
3. IF the Gap_Backfill cannot fully close the gap (provider range limit, partial
   data) THEN the System SHALL ingest what it did retrieve, log the residual gap
   per Pair (secret-free), and still proceed — a partial catch-up is better than
   none and never blocks the run.
4. WHEN there is no gap (last stored candle is the most recent
   Completed_Trading_Day) THEN the System SHALL make no fetch for that Pair
   beyond the normal Daily_Top_Up check.

### Requirement 4: Fail-safe, non-corrupting ingestion

**User Story:** As the operator, I want a bad or unreachable feed to never break
the daily run or poison the data, so the loop stays reliable.

#### Acceptance Criteria

1. IF a provider request fails (network, HTTP error, malformed body) THEN the
   System SHALL advance to the next provider in the Provider_Fallback_Chain
   (Requirement 1); only when EVERY provider in the chain has failed or is
   unconfigured SHALL the stage log a secret-free warning and continue the run
   on the existing stored history — a provider failure SHALL NOT crash the Job
   or abort the pipeline.
2. WHEN the provider returns a candle that fails OHLC validity
   (`high >= low`, open/close within `[low, high]`, finite numbers) THEN the
   System SHALL reject that candle via the existing `OhlcIngestion` validation
   and record it in the ingest report; a rejected candle SHALL NOT be stored.
3. WHEN candles are ingested THEN existing stored candles SHALL be preserved;
   the stage SHALL only append/replace by `(asset, date)` upsert and SHALL NOT
   delete history.
4. The Candle_Freshness_Stage SHALL run within the Job's task timeout under
   normal conditions (bounded request count, bounded Gap_Backfill lookback).

### Requirement 5: Close the existing ~3-week gap (one-off, operator-approved)

**User Story:** As the operator, I want the current hole (last stored
2026-09-15) closed once, so ongoing daily top-ups have a continuous base.

#### Acceptance Criteria

1. The System SHALL provide a one-off, operator-runnable path (a bounded
   Gap_Backfill invocation) that closes the current gap for all five Pairs from
   the last stored candle up to the most recent Completed_Trading_Day.
2. WHEN the one-off backfill runs THEN it SHALL be idempotent (safe to re-run)
   and SHALL ingest through the same validated `OhlcIngestion` path.
3. WHEN the one-off backfill completes THEN the System SHALL report per-Pair the
   new latest stored date and any residual gap (names/dates only, no secrets).
4. This one-off backfill SHALL be run under the operational-safety protocol
   (reconcile target, show the exact command, operator approval) as a live
   write to the hosted database.

### Requirement 6: Verify freshness feeds the dashboard and evaluation

**User Story:** As the operator, I want proof that current candles actually reach
the firing view, the snapshot, and future evaluations, so freshness is real and
not just stored.

#### Acceptance Criteria

1. WHEN a daily run completes after the Candle_Freshness_Stage THEN the
   `dashboard.json` snapshot's Decision_Date SHALL reflect a run computed over
   candle history that includes the most recent Completed_Trading_Day.
2. WHEN freshness is confirmed THEN the per-pair latest stored candle date in the
   hosted `candles` table SHALL equal the most recent Completed_Trading_Day for
   that Pair (modulo provider availability), verified by a read-only query.
3. The freshness stage SHALL NOT alter the recorded Evaluation_Report path or the
   Measurement_Engine; it only ensures those paths read current data.

### Requirement 7: Fix the display-only AI rationale (Vertex AI 403)

**User Story:** As the operator, I want the AI tab to show the Gemini rationale,
so the display-only narrative works as designed.

#### Acceptance Criteria

1. WHEN the daily Job calls Vertex AI for the display-only rationale THEN the
   runtime service account (`job-runtime@`) SHALL hold the IAM permission
   required to invoke the configured publisher model, resolving the observed
   `aiplatform.endpoints.predict denied` 403.
2. WHEN the permission is granted THEN a subsequent daily run SHALL populate the
   AI rationale for at least one firing Pair, verified in the logs / snapshot.
3. The fix SHALL be least-privilege (grant only the permission needed) and the
   GCP required-resources manifest SHALL be updated to record the corrected
   grant.
4. This fix SHALL NOT alter the AI/Deterministic boundary: the rationale remains
   display-only and never reaches any scoring or firing path.

### Requirement 8: Remove the large backup from version control

**User Story:** As a maintainer, I want the repository free of the ~50 MB
database dump, so clones and history stay lean and no production data lingers in
git.

#### Acceptance Criteria

1. The System SHALL stop tracking `ops/backups/` (gitignore the directory) so no
   database dump is committed in future.
2. The existing committed `ops/backups/hosted-5.3-*.sql` (~50 MB) SHALL be
   removed from the working tree; its removal from git history SHALL be a
   documented, operator-approved step (history rewrite is destructive and
   coordinated).
3. WHEN the cleanup is done THEN no `*.sql` dump of production data SHALL remain
   tracked in the repository.

### Requirement 9: Address the dependency vulnerabilities

**User Story:** As a maintainer, I want the Dependabot findings triaged and the
actionable ones fixed, so the project is not shipping known-vulnerable
dependencies.

#### Acceptance Criteria

1. The System SHALL triage the reported Dependabot vulnerabilities (recorded as
   20: 4 critical, 2 high, 12 moderate, 2 low) into: fixable by a safe version
   bump, requiring a breaking change, or not applicable (dev-only / unreachable).
2. WHEN a vulnerability is fixable by a compatible bump THEN the System SHALL
   apply it with an exact pinned version (honoring the no-ranges policy) and keep
   `make check` + the web build green.
3. WHEN a vulnerability requires a breaking change or is not applicable THEN the
   System SHALL record the decision and rationale rather than silently leaving
   it.

### Requirement 10: Rotate and untrack the live secrets in `.env`

**User Story:** As the operator, I want the plaintext production secrets out of
the working tree and rotated, so a leaked `.env` cannot compromise the system.

#### Acceptance Criteria

1. The System SHALL confirm `.env` is gitignored and SHALL verify no secret
   value was ever committed; IF any was, its removal from history SHALL be a
   documented operator-approved step.
2. The live secrets currently in `.env` (the Supabase keys/JWT/DB password, the
   FCS and other provider API keys — referenced by name only) SHALL be rotated,
   and the authoritative runtime copies in Secret_Manager SHALL be updated to the
   rotated versions.
3. WHEN rotation is complete THEN the deployed Job SHALL continue to run with the
   rotated Secret_Manager versions (verified by one run), and the old secret
   versions SHALL be disabled/destroyed.
4. All rotation steps SHALL be operator-approved live actions; no secret value
   SHALL appear in the repo, logs, or this spec.

### Requirement 11: Close the trailing cross-spec checkpoints

**User Story:** As a maintainer, I want the stale open checkpoints from the
earlier specs reconciled, so the spec statuses tell the truth.

#### Acceptance Criteria

1. The System SHALL reconcile the `dashboard-data-activation` Task 16 vs
   `dashboard-ui` Task 17 discrepancy (one marks the other's smoke done while
   the other is unticked) to a single consistent state.
2. The System SHALL complete or explicitly defer `operational-wiring` Task 13
   and tick Task 12's parent checkbox if its subtasks are all done.
3. The System SHALL complete or explicitly defer `dashboard-ui` Tasks 17 and 18
   (post-deploy read-only smoke + final checkpoint).
4. WHEN reconciled THEN `PROJECT-STATE.md` §4 SHALL reflect the corrected
   statuses.

### Requirement 12: Living docs and verification

**User Story:** As anyone picking up the project, I want the state docs updated
and the changes verified, so the live picture stays honest.

#### Acceptance Criteria

1. WHEN the candle feature lands THEN `PROJECT-STATE.md` SHALL record the
   Candle_Freshness_Stage (stack/code-map/decisions) and the candle gap SHALL be
   moved from an open risk to resolved once closed.
2. WHEN each follow-up is actioned THEN its entry SHALL move out of the Obstacles
   / Immediate-next-steps lists.
3. All code changes SHALL keep `make check` (lint + typecheck + vitest) and the
   web build green; new behaviour (the OHLC_Feed_Provider adapter, gap
   detection, fail-safe degradation) SHALL be covered by unit/property tests
   with injected `fetch` (no live network in tests).
4. Live-cloud actions (the one-off backfill, the Vertex grant, secret rotation)
   SHALL be run under the operational-safety protocol and recorded by
   non-secret reference only.
