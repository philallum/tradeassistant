# Immediate Next Steps

> Satellite of PROJECT-STATE.md (§8). The live to-do / what-comes-next list.

## 8. Immediate next steps
0c. Candle freshness — the 2026-11-04 `candle_freshness.degraded` alert was triaged BENIGN (USDCHF one-day publication lag; RISKS 2026-11-05). (a) CONFIRM the gap cleared: after the next daily run (or a manual `node dist/ops/candle-backfill/main.js`), check `candle_freshness_pair` for USDCHF shows `residualGap=False` at the current target. (b) OPEN TUNING DECISION (surfaced, not actioned): a single-pair single-day `top_up` residual right after the NY close is expected to recur and currently fires a severity-ERROR alert needing manual triage. Consider softening the log-based alert (`ops/monitoring/candle-freshness-alert-policy.json`) to distinguish a benign 1-day single-pair residual (next run clears it) from a genuine multi-day / multi-pair gap, so routine lag does not page. Operator to decide: tune vs leave as-is.

0b. Signal Scorecard (signal-scorecard feature, no spec) — IMPLEMENTED locally (see CHANGELOG 2026-11-05, two entries): the dated `signal_predictions` recorder (migration …0009, store, record/reconcile step) AND the v7 `signalScorecard` snapshot slice + web "Recorded" line on each StrategyCard. Backend + web suites/build green; NOT committed/deployed. IMMEDIATE OPERATOR ACTION: create the `signal_predictions` table on the remote DB — do NOT `supabase db push` (it would replay all ten migrations; see RISKS 2026-11-05). The additive SQL was handed over this turn to paste into the Supabase SQL editor; the table is NOT yet created. OPEN DECISION: the recorded ledger starts empty and accrues from live daily runs, so the web card shows "Recorded: nothing yet" until the Job has run across several sessions. Offered but NOT built: a one-off operator backfill that replays the four pure strategies into `signal_predictions` to seed history (third_party cannot be backfilled — it is the reason the recorder exists). Decide: seed via backfill vs let it accumulate live. Also needs the usual operator review + dev->main deploy alongside the schema v7 bump.

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
