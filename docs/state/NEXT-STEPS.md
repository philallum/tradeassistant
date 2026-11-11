# Immediate Next Steps

> Satellite of PROJECT-STATE.md (§8). The live to-do / what-comes-next list.

## 8. Immediate next steps
0n. **Conditional-edge research (2026-11-10; CHANGELOG, DECISIONS) - Tasks 1-9 and stage 3 DONE offline, nothing deployed.** Evidence Report 1 (conditional slices), Report 2 (setup families, chart features, five encodings) and Report 3 (3- and 5-session holds, 1 x ATR bracket), all with `xtb-standard-v1` costs: no candidate edge, no promising variant, no promising horizon. Stage 5 (Evidence Report 5): three context facts are usable for a pivot dashboard (volatility mean reversion, FOMC/jobs-report sessions about 1.3 x ATR, ATR-based stop distances instead of the analogue stop); conflict/chop and trendiness labels are not supported. NEXT, operator-gated: commit the docs; refresh the local backup branch with the stage 5 code; decide whether to write the pivot spec on this evidence. Stage 4 (rule strategies on longer holds, Evidence Report 4): no cell passes; one lead, reversal held 5 sessions (excess +5.0pp, net +17 pips/trade, 5/5 pairs, but q=0.23 and only 4 qualifying years). The 12-month holdout is too small to confirm it (about 95 trades); the honest next step, if the operator wants it, is a forward paper record of that single frozen rule from today, judged after enough trades, not a holdout run. DECIDED 2026-11-10: pattern research STOPPED; nothing goes to production; tooling kept locally as a backtest bench (DECISIONS). Open, operator-gated: (a) DONE 2026-11-10: research docs pushed with the repo; `src/ops/research/` gitignored and kept local (backup branch `research/edge-bench`, never to be merged); (b) decide whether the live dashboard keeps showing the pattern call given the evidence. Re-run Report 3: `node dist/ops/research/report3Main.js --cache-dir /tmp/research-cache`. NEXT, operator-gated: (1) review `docs/research/EVIDENCE-REPORT-2.md`; (2) decide what, if anything, to freeze for Task 10 - there is no promising configuration, so a holdout run now would only confirm the live signal's null result (the holdout 2025-09-16..2026-09-15 has NOT been read and is worth keeping unused until there is a real candidate); (3) Task 11 (TRADE / WATCH / NO TRADE) has no surviving evidence threshold to build on; (4) options for a different question are in the CHANGELOG entry. Re-run: `npm run build && node dist/ops/research/report2Main.js --cache-dir /tmp/research-cache` then `node dist/ops/research/researchMain.js --rows-cache /tmp/research-cache/rows.json`.
0m. **Evidence-first hardening (2026-11-10; CHANGELOG, DECISIONS, RISKS) - IMPLEMENTED locally, uncommitted, not deployed.** NEXT, operator-gated: (1) review the diff and commit/merge; (2) DECIDED 2026-11-10: keep the weekly-trend baseline as the headline yardstick; change the UI wording (not the target) to "the session after <Decision_Date>"; `FORWARD_TEST_START` = 2026-11-11 confirmed (capture the hosted `frozen_baselines` row on that run). DECIDED 2026-11-10: SHOW n now and decide later (the card says "Based on N similar past days", flagged as a small sample under 30; firing unchanged). Revisit enforcing a minimum n only if the forward record supports it (offline evidence only: firing days with n >= 30 scored 51.8% vs 49.95% below, within noise); (4) apply `supabase/migrations/20260916000011_hourly_candles.sql` by pasting it into the SQL editor (never `db push`) ONLY if the archive is to be written from the Job, which is not wired yet; (5) set the GitHub repository variable `DASHBOARD_SNAPSHOT_URL` so the heartbeat workflow runs, and run it once by hand; (6) optionally run `node dist/ops/layer-measurements/main.js --allow-hosted-read` after a few hundred matured days to answer the pre-registered confluence and intraday questions; (7) DECIDED + BUILT 2026-11-10: a pair whose candles are still behind after the freshness stage is WITHHELD (no call, reason DATA_BEHIND); healthy days are byte-identical. Remaining operator checks: watch the first live degraded day, and exclude withheld days from any forward-record reading (they are not persisted as fired and the scorecard records no custom_pattern signal for them). Local tools: `ops/candle-audit`, `ops/local-eval/{evidenceMain,flatAbMain,atrFilterMain,hourlySimMain}`, `ops/hourly-backfill` (needs `node --env-file=.env`). Do NOT consult the confirmation holdout (`--confirm-holdout`) until a hypothesis is written down.
0l. **Lightweight upgrades (2026-11-10; CHANGELOG, DECISIONS) - IMPLEMENTED locally, uncommitted, not deployed.** NEXT, operator-gated: (1) review the diff (`src/ingestion/rangeGuard*.ts`, `ohlcIngestion.ts`; web `shapeDataHealth`, `shapeHitRateHistory`, `shapeInvalidation`, `DataHealthBanner`, `TrackRecordHistory`, `InvalidationLine`, plus the `SingleWindowShell`/`MasterCard`/`AppShell` wiring); (2) dev->main deploys backend and web (no migration, no schema bump); (3) after the first live ingest, read the Job logs for `candle_ingest.range_rejected`: any rejection of a plausible day means the thresholds need loosening; (4) confirm in the live `dashboard.json` that `provenance` is populated, and eyeball the banner, the Evaluation-page record and the invalidation line. DEFERRED (not built, in order of value): operator-run `edge-eval`, then a read-only reliability readout and possibly Platt scaling labelled unvalidated; an intraday-delta highlight (not a filter) once outcomes can be joined to `intraday_validations`; a currency-basket confluence signal at weight 0; an optional v9 `freshness` slice for the exact degraded-pair list. Not recommended: a 1-to-3 session holding-period expectation (retrieval is horizon-1 only) and external DXY/yield data.
0k. **Dependabot cleanup (started 2026-11-10; CHANGELOG).** UPDATE: the operator merged the green PRs; still open are #39 and #40 (both conflicting, rebase requested) plus dev->main PR #68 (CI green after re-run; flaky `generatedAt` assertion in `src/scheduled-run/main.test.ts:538` should be made timing-independent). The two #40 lint errors were FIXED in PR #69 (merged); #39 and #40 are rebased and CI-green, awaiting merge to `main`, then branch/gate check. Earlier note: then `@dependabot rebase` #40. Original plan (partly superseded): open PRs were #31, #32, #39, #40, #48, #49, #20. NEXT (operator-gated, merges target `main` and can trigger `deploy.yml`): merge #32 first, rebase then merge #39 and #31 (one at a time; shared web lockfile); after #32 merges, close #49 if redundant; decide on #48 and #20 (CI green; #20 carries a source-map-js DoS fix). #40 is blocked until two `no-useless-assignment` lint errors are fixed (`src/scheduled-run/edgeSlices.ts:127`, `src/track-record/rangeRecord.ts:38`). Finally delete any `dependabot/*` branch with no open PR and re-run the local gate (`npm run check`, `make check-web`, `npm run version-policy`).

0i. **URGENT - daily candle data integrity (RISKS P0, 2026-11-09). DONE 2026-11-09 (deployed, history repaired live); VERIFIED 2026-11-10: the 22:30 UTC daily run and the 07:00 intraday run both succeeded on the fix (candles canonical, validated=5). Watch a few more days; history before 2026-10-12 is unaudited. (Original plan: merge dev->main, then `node dist/ops/candle-repair/main.js --from 2026-10-12` (dry run, review) and the same with `--apply` (live DB write, operator approval), then re-run the daily Job to republish. Until deployed, consider pausing the daily Scheduler.** Partial and mis-dated bars have been stored as completed candles since at least mid-October (EURUSD 2026-11-04 range 2.4 pips; 2026-11-05 is really Friday-morning data). The next scheduled run is tonight 22:30 UTC and is predicted to store another ~30-minute-old bar as Monday's candle. DECIDE: (1) whether to PAUSE the daily Scheduler job until the fix is deployed (`gcloud scheduler jobs pause scheduled-daily-run-session-close --location=europe-west1`; reversible; the dashboard keeps showing Friday's snapshot) or hotfix before 22:30 UTC; (2) the fix approach (derive candles from hourly bars on the 17:00-NY boundary vs a minimal patch); (3) the history repair (rewrite the affected candles, re-encode pattern vectors, recompute analogue outcomes, re-run the daily Job to republish) - all live writes, operator-approved. Also correct the wrongly-"resolved" freshness claim everywhere once fixed.

0j. **Intraday trigger**: the repo now says 07:00 London (`ops/intraday-validation-scheduler.config.json`, guarded by `intradaySchedule.test.ts`) but the LIVE Scheduler job still fires at 08:00 until the operator runs `gcloud scheduler jobs update http intraday-validation-run-0800-uk --location=europe-west1 --schedule='0 7 * * 1-5' --time-zone=Europe/London`. To restore today's card, optionally run the Job once by hand (`gcloud run jobs execute intraday-validation-run --region europe-west1 --wait`; mid-bar now; the republish key-replace is proven safe).

0h. `codebase-housekeeping` (peer-review remediation, spec in `.kiro/specs/codebase-housekeeping/`) — IMPLEMENTED locally 2026-11-08; not committed/deployed. Behaviour-preserving except two intended, tested changes: the replay guard (a replayed `RUN_DECISION_DATE` no longer records the live-only `third_party` signal) and the shared confluence matrix. NEXT, all operator-gated: (1) review the diff (single `fires()`, legacy PASS/CUT verdict path + `ops/gate-run` removed, seed-job deploy surface removed, `recharts` dropped, `supabase/.temp` + `web/.firebase` untracked, provider-error redaction, named warn events, per-step timing, new docs); (2) dev->main to deploy backend (no schema bump, no migration); (3) after the first deploy read `scheduled_run.step_timing` in the Job logs — only then decide whether a shared candle store is worth doing; (4) work through the **operator cloud-cleanup checklist** in `docs/RUNBOOK.md` (orphaned `dashboard-seed-run` / `dashboard-gate-run` Jobs, old images, removed-provider secrets, two service accounts) using the read-only `ops/enumerate-gcp.sh` first; (5) confirm the committed `ops/scheduler-job.config.json` (`30 17 * * 1-5`) matches the live Scheduler job. OPEN (deliberately deferred): real 1/2/3 horizon selection (decision R1), a visible "data behind" banner, moving the Lean/Split conviction tiers server-side, a web linter, `LivingDocs.appendVerdict/appendCut` (now uncalled).

0g. Automation: `deploy.yml` now also deploys `intraday-validation-run` (`gcloud run jobs deploy`, same SHA-pinned image, entrypoint override, intraday-only secrets, fail-fast on an empty bucket) — written + YAML-validated + workflow tests green locally (CHANGELOG 2026-11-06), NOT yet exercised by a real run. NEXT: merge dev->main; on that deploy confirm the new step succeeds (risk: the WIF deploy SA must be allowed to deploy a second Cloud Run Job; if it 403s the daily deploy still succeeds first and only this step fails) and that `intraday-validation-run` shows the new image. Optional variable `INTRADAY_CLOUD_RUN_JOB` (defaults to `intraday-validation-run`). The Scheduler job stays operator-managed. Item (c) of 0f is resolved once this is verified.

0f. `intraday-validation` fix DEPLOYED + LIVE-VERIFIED 2026-11-06 (CHANGELOG): steps 1-4 of 0e below are DONE (live file restored, intraday Job on the fixed image, trigger resumed). REMAINING: (a) check the first SCHEDULED trigger (Mon 2026-11-09 08:00 London) logs for `intraday_validation.complete republished=True validated=5`; (b) confirm the SPA renders the card (not visually checked); (c) ~~the intraday Job image is not updated by `deploy.yml`~~ — RESOLVED IN CODE: `deploy.yml` now also deploys `intraday-validation-run` on every backend deploy (see 0g); still to be confirmed by the first real deploy; (d) accrue data before any usefulness claim.

0e. (DONE — see 0f) `intraday-validation` fix to deploy + live file to restore (RISKS 2026-11-06). The live `dashboard.json` currently has EMPTY daily slices (clobbered by the first intraday republish). Code is fixed locally (backend gate green: tsc, eslint, 1317 tests; web untouched): the Job reads the published snapshot, validates all 5 pairs from its `pairEvaluations`, and republishes the same snapshot with only `intradayValidation` replaced (skips if no matching published snapshot). Operator-gated sequence: (1) dev->main to deploy the fixed image; (2) the `intraday-validation-run` Job uses its OWN image tag (`scheduled-run:75de888…`), so update it to the new image (`gcloud run jobs update intraday-validation-run --image=<new>`); until then PAUSE the 08:00 trigger (`gcloud scheduler jobs pause intraday-validation-run-0800-uk --location=europe-west1`) so the old image cannot clobber the file again, then resume; (3) restore the live file by re-running the daily Job (`gcloud run jobs execute scheduled-daily-run --wait`) or let the next scheduled daily run do it; (4) re-run the intraday Job manually and verify read-only that every other slice is unchanged and `intradayValidation.rows` has 5 pairs; (5) confirm the first scheduled 08:00 London trigger, the web card render, then accrue data before any usefulness claim.

0d. `intraday-validation` (read-only 4H validation layer, from a reviewed plan) — IMPLEMENTED locally (see CHANGELOG + DECISIONS 2026-11-06); not committed/deployed. Full local gate green (backend eslint+tsc+1308 tests+version-policy; web build+288 tests). NEXT, all operator-gated: (1) review the diff (new `src/intraday-validation/`, `src/ingestion/intradayFeed/`, `src/scheduled-run/intradayMain.ts` + `intradayValidationSlice.ts`, `src/storage/supabase/intradayValidationStore.ts`, migration `…0010`, the v8 snapshot bump on both sides, web shaper + `IntradayValidationCard`, `ops/intraday-validation-scheduler.config.json`); (2) apply migration `supabase/migrations/20260916000010_intraday_validations.sql` out-of-band in hosted (additive; fail-safe adapter makes a torn deploy harmless); (3) dev->main to deploy backend + web together (schema v8); (4) provision the SECOND Cloud Scheduler trigger + the `intraday-validation-run` Job per the committed config (same image, command override to `dist/scheduled-run/intradayMain.js`, reuse secrets by name); (5) after a live run, confirm the `intradayValidation` slice populates and the card renders, then begin COLLECTING data (do not claim the feature improves performance until the stored features/outcomes show it). OPEN: thresholds/delta magnitudes are provisional — a later evidence-based tune is a separate research task.

0c. (DONE — scheduler shifted to `30 17 * * 1-5` NY and operator confirmed the alert is resolved, 2026-11-06; only the SECONDARY alert-softening idea below remains optional.) Candle freshness — RECURRING `candle_freshness.degraded`, now ROOT-CAUSED (RISKS 2026-11-05): the scheduler fires at the 17:00 NY close instant and the ~6-min retry gives up before providers publish the daily bar; it recurred on 2026-11-05's run with ALL FIVE pairs behind. PENDING operator go-ahead (all non-destructive): (1) shift scheduler `scheduled-daily-run-session-close` to `30 17 * * 1-5` NY — the durable fix, also re-aligns the live cron (`0 17 * * *`) to the committed Mon–Fri; (2) widen the Job retry env `CANDLE_FRESHNESS_RETRY_ATTEMPTS=5` / `CANDLE_FRESHNESS_RETRY_DELAY_SECONDS=180` (~15 min, inside the 600s timeout); (3) one manual `gcloud run jobs execute scheduled-daily-run --wait` now to clear today's gap (TwelveData already has 2026-11-05 for all pairs). The 2026-11-04 single-pair instance was closed by the earlier manual run. SECONDARY (still open): consider softening the log-based alert (`ops/monitoring/candle-freshness-alert-policy.json`) so a benign publish-lag residual the next run clears does not page at severity ERROR, distinct from a genuine multi-day outage.

0b. Signal Scorecard (signal-scorecard feature, no spec) — DEPLOYED + LIVE-VERIFIED 2026-11-05. The dated `signal_predictions` recorder (migration …0009, store, record/reconcile step) AND the v7 `signalScorecard` snapshot slice + web "Recorded" line are implemented (CHANGELOG 2026-11-05, three entries). The live Job run `scheduled-daily-run-f46dx` proved it in production: the `signal_predictions` table EXISTS on hosted (30 rows written for 2026-11-05, incl. third_party; verified over PostgREST) and the published snapshot is schemaVersion 7 with a populated `signalScorecard` slice. So the earlier "create the table" + "NOT deployed" actions are DONE. REMAINING: (a) confirm the first RECONCILIATION fills realized direction + correct on the next run once 2026-11-05's forward session closes (web card moves from "N pending" to "right X of Y"); (b) web/ dev->main merge state for the StrategyCard "Recorded" line — confirm the deployed SPA bundle renders it (the backend slice is already live). OPEN DECISION (unchanged): the recorded ledger accrues from live daily runs; a one-off operator backfill that replays the four pure strategies into `signal_predictions` to seed history was offered but NOT built (third_party cannot be backfilled). Decide: seed via backfill vs let it accumulate live.

0a. `dashboard-simplification` — IMPLEMENTED locally (see CHANGELOG 2026-11-04); not committed/deployed. NEXT: operator reviews the diff (127 changed/deleted files incl. the legacy-tab deletions), then dev->main to deploy backend (schema v6, `trackRecord`, `expectedRange`, conflict 0.5) and web together; first run after deploy should be watched for Job duration (RISKS: track-record cost). Then decide on the analogue FLAT dead-band units fix (RISKS finding 1; ☁️ re-resolve needed) and remove the unused `recharts` dependency. Re-run `node dist/ops/confluence-calibration/main.js` (after `npm run build`) once the pattern signal can be replayed, to re-check thresholds.

0. `mobile-dashboard-single-window` — COMPLETE locally (all 48 tasks; web build + 394 tests + root `npm run check` green). NEXT: operator confirms the OPEN no-fire-pair wording (`pure/noSignalCopy.ts`), checks why four other `.kiro/specs/` dirs show as deleted in the working tree, then merges dev->main to deploy (web/ only).

1. DONE + LIVE-VERIFIED — `multi-strategy-confluence-engine` is COMPLETE
   locally (all 91 tasks `[x]`; task 26 unified `make check` exit 0) AND the
   backend confluence v5 producer is CONFIRMED DEPLOYED: the 2026-11-07 live
   shakedown run (Job `scheduled-daily-run-4gzgb`, exit 0) published a schema-v5
   `dashboard.json` with a fully populated `confluence` slice (5 pairs, 6/6
   cells, engine ran live). The deployed image already carried it, correcting the
   earlier "NOT deployed" note. The remaining un-merged local work is test/tooling
   only (the Property 19 oracle fix + the `make check` web wiring) and is
   operator-gated dev->main; it is not visible in the live snapshot.

   SHAKEDOWN FOLLOW-UPS (from the live run, see RISKS.md) — decide whether to
   open a small bugfix spec: (a) snapshot `generatedAt` is stale vs the actual
   GCS publish time (stamp it at build time); (b) the two `firingCards` log
   fields mean different things (rolling surfaced count vs fired-today count) —
   rename/document; (c) `dashboard.json` cache-control max-age=3600 (noted,
   likely fine for a daily cadence).

2. TOP PRIORITY — CONTINUE `daily-candle-freshness-and-cleanup` Phase 6 cleanup
   (R7-R11), then Phase 7. Phases 1-5 are DONE: the Candle_Freshness_Stage
   (tasks 1-11) is merged to `main`; the ☁️ task 13 hosted backfill closed the
   candle gap (all five pairs to 2026-10-06, benign one-day residual); and the
   ☁️ task 15 read-only hosted freshness verify PASSED (snapshot reflects fresh
   history; the only finding is that known one-day provider-availability residual,
   which the next Daily_Top_Up takes). NEXT action is the Phase 6 follow-ups,
   tracked as requirements R7-R11 of this spec: the Vertex 403 predict grant
   (☁️, task 16), `.env` secret rotation + untrack (R10), the ~50MB git backup
   housekeeping, and Dependabot triage. Keep `make check` + the web build green;
   the ☁️ live-cloud items (Vertex predict grant, `.env` secret rotation) stay
   operator-gated under the operational-safety protocol.
2. HIGH PRIORITY — `dashboard-ui` Req 8 criterion 8 DESIGN + TASKS are DONE
   (design addendum + task 19, subtasks 19.1–19.7, both format-valid). NEXT
   ACTION: EXECUTE task 19 — implement the thin pure `shapeAllPairs` helper +
   its property test (Property 16), edit the AI, Third-party, and
   Pattern/Outcomes tabs to render a cross-pair all-five-pairs view on "All
   pairs" (composing the existing `shapeExternal`/`shapeAi`/Pattern-Outcomes
   shapers over one `getSnapshot()` read, per-pair no-data markers, labels
   preserved), and add the DOM tests. Keep `make check` + the web build green,
   then ship via a `dev`→`main` PR (operator-gated merge). web/-only; no
   snapshot schema / daily Job / `src/` core change.
3. DONE — PR #25 (`dev`→`main`) was merged + deployed (Job image `b4b27b2e…`,
   env `DASHBOARD_SNAPSHOT_BUCKET=trade-assistant-508806-dashboard`, SPA rebuilt
   with the bucket snapshot URL) and one daily Cloud Run Job run
   (`scheduled-daily-run-2rrm6`, exit 0) PROVED the loop: it wrote the
   `firing_setups` row for 2026-10-08, maintained `realized_outcomes`, and
   published `dashboard.json` to the public bucket (anonymously fetchable, HTTP
   200). Parent task 8 is marked `[x]` and `simplify-to-cloud-minimal` is
   COMPLETE.
4. DONE (`daily-candle-freshness-and-cleanup` task 16, R7). The runtime SA
   (`job-runtime@`) Vertex AI 403 is resolved: `roles/aiplatform.user` (includes
   `aiplatform.endpoints.predict`) is bound to the SA and an operator-approved ☁️
   Job run (`scheduled-daily-run-962h6`, exit 0) produced no predict-403; model
   reachable in `europe-west1`. Zero pairs fired that run, so the per-firing-pair
   rationale (R7.2) self-confirms on the next firing day. `GEMINI_MODEL` repo
   variable is `gemini-2.5-flash` (the previously configured `gemini-3.5-flash`
   404s). Display-only path; never blocked the loop.
5. Commit the uncommitted living-doc/task edits still outstanding from prior
   turns, now including the new spec files: the RESEARCH-LOG.md evaluation entry,
   this PROJECT-STATE.md update, the task-8 checkbox in `tasks.md`, the new
   `.kiro/specs/daily-candle-freshness-and-cleanup/` requirements.md (+ `.config`),
   and the amended `.kiro/specs/dashboard-ui/requirements.md` (new Req 8
   criterion 8).
6. (SUPERSEDED by `simplify-to-cloud-minimal` Phase 5 task 6 — the read-proxy
   code is deleted and the SPA now reads the `dashboard.json` snapshot.) What
   remains: DELETE the orphaned `dashboard-read-proxy` Cloud Run service + images
   from GCP in the Phase 6 R11 operator-approved sweep (task 7.2). (The real
   snapshot uploader is now IMPLEMENTED as the GCS `SnapshotSink` and its live
   infra provisioned; it shipped to the Job via the PR #25 merge in step 3.)
7. DONE — the first real evaluation of the core premise is recorded in
   `RESEARCH-LOG.md` as an evaluation REPORT (model-vs-baseline accuracy, delta,
   friction-adjusted MFE/MAE, sample size, Wald CI), no `PASS`/`CUT` verdict, per
   audit §13. Result: +1.24pp over baseline, CI [+0.66pp, +1.82pp], below the 3pp
   annotation threshold. The DB-vs-log discrepancy is resolved (the report lives in
   both the hosted table and the log).
8. DONE (daily-candle R11.2) — `operational-wiring` Task 12's parent is now `[x]`
   (all four subtasks `[x]`); Task 13 (final checkpoint — cloud half) is explicitly
   DEFERRED (superseded) because the cloud half was re-done by
   `simplify-to-cloud-minimal` and its end-to-end loop proven live under that spec's
   task 8.
9. DONE (daily-candle R11.1/R11.3) — `dashboard-ui` Tasks 17 (post-deploy Read_Proxy
   smoke) and 18 (final checkpoint) are explicitly DEFERRED (superseded): the
   Read_Proxy + `/api` rewrite they verified were removed in
   `simplify-to-cloud-minimal` Phase 5 (SPA now reads a static `dashboard.json`
   snapshot). Reconciled with `dashboard-data-activation` Task 16 (left `[x]` with a
   supersession note) so the specs tell a single consistent story.
10. Push the reconciling merge on `dev` to the remote (directly or via PR), and
   rename the remote `main` → `origin` to remove the branch/remote name clash.
11. Decide on the simplicity/complexity audit
   (`docs/architecture/PROJECT-SIMPLICITY-AUDIT.md`, incl. the §13 kill-gate
   review): its top recommendation is to run the existing measurement engine and
   record the first evaluation report (step 7) BEFORE any rearchitecting, then
   de-scope infrastructure (defer-on-branch, don't delete) and reframe the
   kill-gate as a report rather than an auto-blocking PASS/CUT verdict. Per the
   operator's binding constraints (cloud execution + mobile access; see
   Obstacles), the de-scope target is now "cloud-minimal single-user" rather
   than local-first, and — per three further operator decisions (public data,
   drop the choppiness/concentration suppressors, keep GitHub deploy) — removes
   the read-side security layer and the auth gate entirely. DONE: the audit now
   carries §14 (authoritative constraint-adjusted architecture) plus annotated
   §7/§8/§9/§12 (edited this turn, document only). OUTSTANDING (implementation,
   not yet started): action the §14 recommendations in the codebase — but only
   after step 7 (run the measurement engine, record the first evaluation report)
   per the audit's own ordering.
12. Execute the `simplify-to-cloud-minimal` spec. Phases 1-3 are DONE, Phase 4
   schema authoring (tasks 5.1 + 5.2) is authored locally, and THIS TURN Phase 5
   task 6 (6.1-6.4) landed: the fail-safe `dashboard.json` snapshot writer is
   wired into the daily run, the SPA reads it via `loadSnapshot()`, the
   read-proxy code + read-side `write-credential` tooling are deleted, and the
   proxy/allowlist tests are replaced with snapshot-path tests (`make check` +
   web build/tests green, local-only), AND task 6.5 (DONE this turn) removed the
   last live writer of `signal_rationale`/`external_reference_comparison` — the
   `makeDisplayDataPersister` call + module are deleted, the surviving write-shape
   types relocated to `displayOnlyTypes.ts`, `displayOnly` still feeds the
   snapshot, `make check` green. Phase 6 task 7 (simplify `deploy.yml`) and
   task 7.1 (author `ops/required-resources.manifest.json` + the read-only
   `ops/enumerate-gcp.sh` enumeration) are now DONE in code (`make check` green);
   tasks 5.2a and 5.3 are also DONE (the `fx_writer` cutover + the hosted schema
   reconcile). NEXT ☁️ OPERATOR STEP: task 7.2 — present the enumerated orphan
   delete set and, on approval, delete the `dashboard-read-proxy` service + images,
   the `dashboard-seed-run`/`dashboard-gate-run` jobs, the obsolete provider/scoped
   secrets, stale Artifact Registry images (retention), and dangling IAM/SAs; then
   wire the real snapshot uploader (currently a no-op) and run Phase 7 end-to-end
   verification. STILL PENDING: the ACTUAL first OOS evaluation run — the single
   highest-value measurement step. Its code is now fixed and leak-free; it is no
   longer blocked on code or on a local Supabase but specifically on the PR #24
   redeploy + the one-off evaluation Cloud Run Job re-run — now DONE and recorded
   (see step 7).


- **(2026-11-04) Decision-date semantics spec — PROPOSED, not started.** The 17:00 NY run on day D uses candles strictly before D, so D's just-closed candle is excluded and a UK morning read is built on the close two sessions back (confirmed on the live 2026-11-03 snapshot: `lastCandleTimestamp` 2026-11-02 17:00 NY). Proposal: treat the run as the decision for D+1 (target = D). Awaiting operator answers: label runs "for D+1" vs keep run date; keep past decisions as-is vs recompute. Also align the live Scheduler cron (`0 17 * * *`) with the committed `0 17 * * 1-5`.

- **(2026-11-04, update) Decision-date options scoped; awaiting operator choice, nothing built.** Read-only code survey: the "candles strictly before D" rule lives in 12+ places (guard, encoder, retrieval, strategies/confluence, track-record, freshness target, provenance). Option A (run keeps its date, uses D's candle) needs every stored pattern vector re-encoded in hosted Supabase and walk-forward/kill-gate baselines re-run and re-frozen. Option B (run on day D is labelled the next trading day, rule unchanged) needs only the run's date derivation plus the weekend-skip check on the run's own date, keeps all history valid, but the label is no longer the run date. Recommendation: B. Either option makes the freshness stage fetch the candle closing at the instant the job fires, so a short delay and/or retry on the first run becomes relevant.

- **(2026-11-04, update) Decision-date Option B IMPLEMENTED locally (see CHANGELOG/DECISIONS); supersedes the two proposal bullets above.** Remaining: operator commits and merges dev->main to deploy; then verify the first scheduled run shows `candle_freshness.retry`/`up_to_date` for the just-closed candle and a snapshot labelled with the next trading day. Optional: align the live Scheduler cron with the committed `1-5` and/or shift it to 17:30 NY.

- **(2026-11-04) AI note follow-up.** Pair view now shows the selected pair's own rationale (local, not deployed; see CHANGELOG). The horizon-unit gap ("over the next hour" for a 1-day horizon) is fixed locally in the LLM prompts; after deploy, confirm a live rationale says trading days, not hours.
