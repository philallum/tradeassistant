# Obstacles / Open Risks

> Satellite of PROJECT-STATE.md (§7 + §9). Open risks, obstacles, and the dependency-vulnerability triage.

## 7. Obstacles / open risks
- **2026-11-04 `candle_freshness.degraded` ERROR alert — TRIAGED BENIGN, no fix needed (2026-11-05, read-only investigation).** The daily Job `scheduled-daily-run-kc5vf` (2026-11-04 22:00 UTC) emitted the severity-ERROR `candle_freshness.degraded` line. Investigated via Logs Explorer: the per-pair freshness logs show only USDCHF behind — a ONE-day `top_up` gap (`latestDate 2026-11-03` vs `target 2026-11-04`, `provider: null`); the other four pairs (EURUSD/GBPUSD/USDJPY/USDCAD) were topped up to 2026-11-04 by FCS in the same run. RULED OUT the generic-alert causes: (a) keys are healthy — `gcloud run jobs describe` confirms all three provider secrets injected (`external-signal-api-key`, `twelve-data-api-key`, `massive-api-key`), and the same run used them to top-up the other four pairs; (b) NOT a multi-day/all-pairs outage. ROOT CAUSE: USDCHF's 2026-11-04 daily candle had not yet been published by any provider at the run minute (right after the 17:00 NY close), while the majors had. CONFIRMED the data now exists: a read-only TwelveData `time_series` probe returns USDCHF 2026-11-04 (`status: ok`). RESOLUTION: benign transient publication lag. CLOSED 2026-11-05 by an operator-approved live manual Job run (`scheduled-daily-run-f46dx`, exit 0): USDCHF topped up to 2026-11-04 via FCS in one pass, `residualGap=False`, no `candle_freshness.degraded`, all five pairs current. No code/config changed. (The alert-tuning follow-up — distinguish a benign 1-day single-pair residual from a real multi-day gap — remains open in NEXT-STEPS 0c.)

- **Remote migration history is NOT tracked by the Supabase CLI — do NOT `supabase db push` (2026-11-05).** The hosted schema was provisioned out-of-band, so the remote `supabase_migrations.schema_migrations` table does not record migrations 0000–0008. A `supabase db push --db-url "$SUPABASE_POOLER" --dry-run` (verified this turn) therefore lists ALL TEN local migrations as "would push", including the new `20260916000009_signal_predictions.sql` — meaning a real push would try to REPLAY 0000–0008 against a database that already has those objects (risky; several earlier migrations may not be fully re-runnable). Also: the `supabase` CLI here is a shim that needs its companion `supabase-go` on PATH (`export PATH="$HOME/.local/share/supabase:$PATH"`), the CLI is NOT logged in (no `SUPABASE_ACCESS_TOKEN`), and `SUPABASE_DIRECT_CONNECTION` is IPv6-only / unreachable from this host — the IPv4 `SUPABASE_POOLER` must be used for any hosted SQL. PRACTICAL PATH (what was handed to the operator): apply a single additive migration by pasting its SQL into the Supabase SQL editor, then optionally `insert into supabase_migrations.schema_migrations (version,name) values ('20260916000009','signal_predictions') on conflict do nothing;` to reconcile the ledger. UPDATE 2026-11-05: `signal_predictions` NOW EXISTS on hosted — the live Job run `scheduled-daily-run-f46dx` wrote 30 real rows for 2026-11-05 (verified over PostgREST), so the table was created out-of-band (SQL editor path) and the scorecard code is deployed (snapshot schemaVersion 7). The `db push` hazard itself STANDS for any FUTURE migration (the CLI history table is still untracked). Longer-term fix: backfill the CLI history table (`db push` with the migrations already marked applied, or `migration repair`) so future additive migrations can push cleanly.

- **Dashboard-simplification side findings (2026-11-04, read from code; NOT fixed, none changes firing).** (1) **Analogue FLAT dead-band unit mismatch.** `resolve()` classifies FLAT when the net move in PIPS is inside `atr14 x 0.5`, but `ops/outcome-resolution` passes `atr14` from `computeAtr14` in PRICE units (e.g. 0.006), so the band is ~0.003 pips and stored analogue directions are effectively always UP/DOWN by sign. This also explains why the headline accuracy (49.96% vs 48.71%) behaves like a two-class coin-flip comparison. A correct 0.5xATR band would call ~60% of next sessions FLAT (measured). Fixing it changes stored analogue directions, Earned_Confidence and firing, and needs a re-resolve of hosted `analogue_outcomes` (operator-approved ☁️ work); the new track records deliberately score by sign to stay consistent with today's behaviour. (2) **Retrieval returns one representative row per neighbour** (the lowest horizon, i.e. horizon 1), so `selectHorizon` effectively always sees horizon 1 and the expected-candle-size forecast is horizon-1 in practice. (3) **Possible one-session gap:** the live query window excludes the Decision_Date candle while analogue outcomes start at the first candle strictly after the analogue date; confirm whether that is intended. (4) **Track-record cost:** the range-forecast replay re-runs `evaluatePair` for ~20 past dates x 5 pairs inside the daily Job (one memoised pair-wide analogue read, 100 vector queries); bounded by a 120 s deadline and fail-safe, but watch Cloud Run duration and the Supabase egress already over quota on the next deploy; `RANGE_RECORD_LOOKBACK_DAYS=0` disables it. (5) `recharts` is now unused in `web/` (dependency left in place; remove in a follow-up). (6) Strategy records are small samples (often under 20 calls) and measure next-session sign only; the UI flags small samples but they are not evidence of edge. (7) Pre-existing flaky property test `operationalSafety.secretRedaction` failed once under random secrets; passes on rerun, with and without these changes.

- **`mobile-dashboard-single-window` design — open items for the tasks phase (2026-11-03).** (1) No requirement defines the Verdict_Banner / All_Pairs_Strip copy for a pair that did NOT fire today (`shapeSetupTrades` returns entries only for surfaced cards); design falls back to the generic unavailable marker. Recommend a short requirement before tasks. (2) Req 3.5 (SL/TP render 'as' the un-validated marker) vs 3.9 (badge compared to SL/TP values): design shows value + marker plus a peer-sized top-level badge; needs operator confirmation. (3) `formatConfidence` rounds, so 'no rounding' (Req 3.8) treats existing `format.ts` formatters as part of shaper output. (4) Evidence accordion renders a placeholder where the old `EvidencePanel` returned null (Req 7.8). (5) Design adds a 10s fetch timeout (`AbortSignal.timeout`); signal plumbing in `snapshotCache` NOT verified. (6) `PairSelector`/`DateSelector` were not read; reuse as-is is an assumption. UPDATE (tasks authored): item (5) is now handled by a `withTimeout` promise race (task 4.1) because `snapshotCache` memoises one shared in-flight promise per generation and the first caller's abort signal wins, so a per-window timeout signal could cancel the fetch for the whole app; item (1) is carried as an OPEN-wording constant in `pure/noSignalCopy.ts` (tasks 1.1, 5.1). Nothing built.

- **`mobile-dashboard-single-window` — brief-vs-code mismatches: FOLDED INTO REQUIREMENTS (2026-11-03). [was: open design-phase items]** Evaluated the redesign brief against the actual `web/` code; the brief's "before" picture overstates the mess and a few of its "fixes" would regress existing careful work. Decisions/risks the design phase must settle: (1) **Not greenfield — it is a consolidation + per-pair re-slice.** The app is ALREADY mobile-first single-column (`AppShell` `overflowX:hidden`, flex column) and `FiringCard` is already a compact card with a shape glyph + text label (not colour-only). Real new work = one unified route (merge the 5 `BottomTabBar` tabs), accordions, an edge pill — most pure shapers reuse as-is. (2) **The "year-long table / N=28470 on mobile" claim does not match the default view.** `EvidencePanel` already renders compact per-pair summary lines, not a year-long raw table; the big backtest/sample numbers live in the separate evaluation/edge tab. Consolidating to a single-window for the Setups view removes that tab from the default mobile path for free — confirm WHICH screen actually feels noisy before writing requirements to strip tables that are not on Setups. (3) **HIGHEST RISK — un-validated trade parameters must stay visually dominant.** The brief's Zone 2 "Trade Parameters" banner (Entry/SL/TP/Expectancy) collides with the `trader-edge-validation` honesty rule: `FiringCard`/`shapeSetupTrades` deliberately render SL/TP as a not-actionable / un-validated marker, never a confident number. The redesign MUST carry that labelling forward (pinned by draft requirements 3.5 + the Req 8 data-invariance block); the banner must never read as a live trade ticket. (4) **Confluence re-slice drops the cross-pair matrix.** Today `ConfluencePanel` is a 5-pair × 6-strategy grid with tested roving-tabindex keyboard nav + validation-gated colour; the brief's Zone 3 is a 6-cell single-pair slice. That is a real semantic change (loses cross-pair comparison) AND risks re-implementing the existing a11y model — lift the tested interaction, and decide explicitly whether an all-pairs comparison strip is retained. RESOLUTION (same day): all four were folded into `requirements.md` after an operator decision. (1) consolidation framing — captured in the requirements' presentation-only scope + Data-Invariance requirement; (2) the noise-location correction — reframed into the Density requirement (keep the separate evaluation/edge detail OFF the default single-window path; do not claim to strip tables that are not on the Setups view); (3) un-validated-banner honesty — new Verdict_Banner criteria (badge prominence >= SL/TP; no live/executable-order affordance); (4) confluence re-slice + a11y — the matrix is now explicitly the selected-pair slice with the EXISTING roving-tabindex keyboard model required verbatim, and cross-pair comparison is retained via the new All_Pairs_Strip requirement (operator chose the top strip over per-pair-only). requirements.md is now 12 EARS requirements, format-valid. No OPEN design-phase blocker remains from this evaluation; design.md is still to be authored.

- **LIVE shakedown run 2026-11-07 — 3 findings triaged; 1 fixed, 1 false alarm, 1 accepted (Job `scheduled-daily-run-4gzgb`, exit 0).** (1) **Snapshot `generatedAt` "stale" — FALSE ALARM, no bug.** The `10:13Z` value seen during monitoring was a CDN-CACHED copy of `dashboard.json` (served `cache-control: max-age=3600`). A cache-busted re-fetch returned `generatedAt: 2026-11-03T21:28:50.586Z`, matching the GCS object's actual write time exactly. The code already stamps `generatedAt` at snapshot-build time (`buildDashboardSnapshot` `now = new Date()`, `main.ts` passes no override). No change made. (2) **Ambiguous `firingCards` log field — FIXED (code, backend-only, on `dev`, NOT yet deployed).** The two log lines used one name for two quantities; renamed for accuracy: `scheduled_run.snapshot_written` now logs `surfacedSetupsTotal` (rolling count of all surfaced setups in the written snapshot, across dates) and `scheduled_run.complete` now logs `firedToday` (setups that fired on this run's Decision_Date), each with a cross-referencing comment. No behaviour change; no test asserted on the old names; `npm run check` green (1178 passed/7 skipped, lint+tsc clean). (3) **`dashboard.json` `cache-control: public, max-age=3600` — ACCEPTED as-is.** The SPA can serve a snapshot up to 1h stale after a run; appropriate for the once-daily cadence (and it was the real cause of finding #1's confusion). Left unchanged; noted so a cached read is not mistaken for a stale/failed publish.

- **`multi-strategy-confluence-engine` Property 19 "flake" — RESOLVED (root-caused test-only), 2026-11-07.** The long-tracked seed-dependent failure in `src/strategies/engineStatus.property.test.ts` Property 19 was NOT a true flake and NOT an engine bug — it was a TEST-ORACLE bug. The engine already classifies a Confluence_Score of exactly 0 as NEUTRAL regardless of `alignmentThreshold` (to keep UP/DOWN symmetry when the threshold is 0, Req 9.5/9.8), but the Property 19 oracle's `contributors >= 2` branch still returned `ALIGNED_UP` for `score >= alignmentThreshold`; at the degenerate `alignmentThreshold = 0` / `score = 0` point the two disagreed (~1-in-N on the full suite). FIX (test-only, no production code changed): added the matching `if (score === 0) status = "NEUTRAL";` guard to the oracle. Verified: original failing seed `-1244704784` now passes, 8 isolated reruns pass, full `make check` exit 0. This retires the "watch the Property 19 seed flake" note that previously lived in the STATE block + NEXT-STEPS.

- **Hosted Supabase free-plan OVER QUOTA — MITIGATED IN CODE (pending deploy), 2026-10-12.** Project `bffzhjnpzxxuqvmnmylk` was over two cycle-to-date limits: Egress 39.5/5 GB (~8×) and Log Ingestion 1.93/1 GB (~2×); DB size 85 MB is fine. Read-only `supabase inspect db` (traffic-profile, calls, outliers, table/db/role stats) pinned the cause to the RETRIEVAL/BACKTEST path over PostgREST (NOT the dashboard, which serves `dashboard.json` from GCS): `pg_stat_statements` (reset ~18 days ago ≈ this cycle) showed `SELECT * FROM pattern_vectors` by `(asset,decision_date)` 587,340× and by `(weekly_trend_sign,asset)` 9,309× over a 48 MB / 21,001-row 70-dim vector table, `analogue_outcomes` matured-window reads ~22,904×, and ~846K PostgREST auth-preamble calls (the matching log overage). A full-history staged-runner backtest run against HOSTED is the generator. FIXES LANDED IN CODE (this turn, locally verified, NOT deployed): (1) `assertHostedHeavyOpAllowed` hard-refuses the hosted target for the read-heavy backtests (`gate-run`, `evaluation-run`) unless `ALLOW_HOSTED_BACKTEST=1` — so an unattended run can no longer silently sweep hosted; (2) column projection on the hot-path reads — `queryNearest` drops the `scale_dims` jsonb from the large candidate-slice read, and the vector/analogue reads use explicit `select=` instead of `SELECT *`. `make check` GREEN (851 passed/6 skipped); live firing decision byte-identical. CRITICAL CONSTRAINT (unchanged): no CLI command or data deletion reduces a cycle-to-date egress/log total — they reset only at billing-cycle rollover (or on Pro upgrade); DB-size deletion is irrelevant. REMAINING: (a) DEPLOY the backend so the guard is live before any further backtest; (b) still run backfills/backtests against LOCAL Supabase (`supabase start`, `SUPABASE_TARGET=local`) as the norm; (c) DEFERRED Fix 3 — push the ANN top-k server-side via pgvector `<=>` so `queryNearest` stops pulling the candidate slice into Node (needs byte-identical parity verification against the current client-side ranking). NOW TRACKED as task OF1 (+ OF1.1) in `trader-edge-validation/tasks.md` under an "Operational follow-ups" section, explicitly outside the R1–R12 evidence layer with its own byte-identical parity gate; requires a local Supabase to implement/verify (unchecked — planning only).

- **`operationalSafety.secretRedaction` property test flakiness — FIXED this turn, but WATCH (2026-10-09).** This fast-check property failed post-merge on `main` (passed on `dev` — a seed-dependent false positive, not a code regression; the operator saw it as a CI "lint fail"). It asserts a secret VALUE never appears as a substring on any output surface, but surfaces legitimately preserve secret NAMES + fixed `gcloud`/record tokens, and `redactSecrets` only scrubs whole literal VALUE occurrences — so a value that is a substring of a surviving name/token caused a benign false positive. FIX (test-only): `confusableWithStructural` filter on the value generators (`secretSetArb` + an `fc.pre()` on the stdin property). The redaction CODE was never at fault. NOTE: this file has flaked TWICE this session; if it recurs, pin the seed or audit the remaining arbitraries rather than loosening the assertion. Verified: the exact failing seed + 15 fresh runs now pass.

- **Daily AI note was truncated mid-sentence — RESOLVED, CONFIRMED LIVE (2026-11-07).** The live note read cut off ("…The GBPUSD UP setup, with an earned confidence"). ROOT CAUSE confirmed with a direct live Vertex call: `gemini-2.5-flash` is a thinking model and spent 491 of the 512 `maxOutputTokens` on hidden reasoning (`thoughtsTokenCount: 491`), leaving 17 for the visible answer (`finishReason: MAX_TOKENS`). FIX: `src/llm/geminiProvider.ts` gained an optional `thinkingBudget` (sent as `generationConfig.thinkingConfig.thinkingBudget` only when set), `DEFAULT_MAX_OUTPUT_TOKENS` raised 512→1024, and `main.ts` constructs the provider with `thinkingBudget: 0` + `maxOutputTokens: 1024`; a `MAX_TOKENS` finish now logs a secret-free `gemini.generation_truncated` warning. Verified live that `thinkingBudget: 0` → `finishReason: STOP` + a complete 3-sentence note; `npm run check` GREEN (795 tests, +5 provider tests). GOES LIVE after the operator deploys the backend + re-runs the Job; until then the live note is the prior truncated one. The liveness signal and the AI/Deterministic boundary are unaffected. CONFIRMED LIVE on the 2026-11-07 shakedown run (Job `scheduled-daily-run-4gzgb`): the published `dailyCommentary` note is a complete, non-truncated 2026-11-03 note (`generated: true`) and `aiRationale` carries fresh per-pair rationales for the pairs that fired, with NO Vertex 403 and NO MAX_TOKENS truncation in the logs. Both the truncation fix and the Vertex predict-grant (R7, candle-spec task 16) are thus verified working in production. Closed.

- **Dashboard-empty on the custom domain — RESOLVED END-TO-END, LIVE (2026-10-09).** Two independent causes, both now fixed and verified live. (A) CORS: the SPA is served from the custom domain `https://app.teamhandso.me` but the public-read snapshot bucket `trade-assistant-508806-dashboard` CORS `origin` list omitted it (only `.web.app` + `.firebaseapp.com`), so the browser blocked the cross-origin `dashboard.json` fetch. FIXED LIVE via `gsutil cors set` adding `https://app.teamhandso.me` to the `origin` list (kept the two existing origins); the applied config is saved reproducibly at `ops/dashboard-bucket-cors.json`. NOTE: `deploy.yml` does NOT manage bucket CORS — this is a one-time out-of-band step a future bucket rebuild must re-apply (the ops artifact documents it). (B) Empty tabs: the daily run published only today's firing view (`buildDashboardSnapshot(view, displayOnly, { decisionDates: [view.decisionDate] })`, no history), so `firingSetups/analogueOutcomes/realizedOutcomes/candles/evaluationReports` were always `[]`. FIXED IN CODE: new fail-safe read-only `src/scheduled-run/snapshotHistory.ts` (`loadSnapshotHistory`) loads the history slices from the persisted rows; `src/scheduled-run/snapshot.ts` gained a `firingSetups` history slice + a dedupe-merge (today's view wins on PK) + a `decisionDates` union; `main.ts` wires the loader into `persistView`. `npm run check` (lint+tsc+780 tests, 6 skipped) + `npm run build` GREEN. The operator committed+deployed the backend and manually ran the Cloud Run Job; the live `dashboard.json` regenerated (`generatedAt 2026-10-09T09:54:24Z`, ~970 KiB) and now carries firingSetups=4, decisionDates=4, analogueOutcomes=4020, candles=1430 (400-day bounded window), realizedOutcomes=2, evaluationReports=1, externalComparison=5 — VERIFIED live via cache-busted fetch; and a cache-busted GET + OPTIONS preflight from Origin `https://app.teamhandso.me` both return HTTP 200 with `access-control-allow-origin: https://app.teamhandso.me`. `aiRationale=0` is EXPECTED (no pair fired 2026-10-09; the display-only Gemini rationale is generated only for firing pairs and self-populates on the next firing day). (Distinct from the "All pairs" per-tab issue below, which only hides already-present data on first load.)

- **Dashboard per-pair tabs hide data on the default "All pairs" view (diagnosed; fix specced, not yet built).** AI, Third-party, and Pattern/Outcomes show a pick-a-pair prompt on "All pairs", so on first load the dashboard appears to carry no third-party/AI content even though the published `dashboard.json` has it (verified: `externalComparison` one row per pair; deployed SPA bundle current; date matches). Not a pipeline bug — selecting a specific pair reveals the data. Fix is dashboard-ui Req 8 criterion 8 (render those tabs cross-pair over all five pairs on "All pairs"); design/tasks/implementation pending. (The Vertex 403 that also emptied the AI tab is now RESOLVED — `daily-candle-freshness-and-cleanup` task 16; the AI tab will populate on the next firing-pair run.)

- **Candle-data freshness defect (CONFIRMED; top priority, now owned by a spec).** Hosted `candles` hold daily history for all 5 pairs only through 2026-09-15 (per-pair ≈4183-4184 rows; verified read-only), while the current Decision_Date is ~16 trading days later and the gap grows by one trading day per run. Root cause: nothing ingests fresh candles (CSV loader backfill-only; `OHLC_PROVIDER`/`OHLC_BASE_URL` empty). Impact: encoding, retrieval, the firing view, the realized-outcome journal, and any future evaluation all read stale history — the live daily loop executes but is not producing current-day signals. Owned by the new spec `daily-candle-freshness-and-cleanup` (Candle_Freshness_Stage + FCS→Twelve Data→Massive fallback chain + one-off backfill). Requirements phase only; not yet implemented.

- **`fx_writer` write-path cutover (5.2a) COMPLETE; the open ☁️ gate is now the 5.3 hosted reconcile itself.** The role exists on hosted and is granted to `authenticator`, `supabase-key` v3 carries a verifiable `role: fx_writer` ES256 JWT, and a live REST write-check is GREEN (INSERT/UPDATE succeed, DELETE refused 403). To get there, `...006` STEP 7 (grants) and STEP 3+4 (drop old RLS policies + disable RLS) were pulled forward out-of-band on the 5 existing retained tables; `pipeline_writer` still works so the daily run is unbroken. REMAINING RISK for task 5.3: it performs the DESTRUCTIVE drops (tables, views, the `pipeline_writer` role, diagnostic read path) and creates `evaluation_reports` — take a fresh hosted backup (schema+data+roles) and present the exact drop set before applying. Hosted SQL/REST from local MUST use the IPv4 `SUPABASE_POOLER` (direct `db.*:5432` is IPv6-only, unreachable here). Sensitive artifact: gitignored `ops/fx-writer-key/` holds the `fx_writer` private signing key.

- **The central premise is now MEASURED in the living log (RESOLVED).** For the
  first time, `RESEARCH-LOG.md` carries a recorded evaluation between its
  `BEGIN/END ENTRIES` markers: one `[EVALUATION] shape-only` entry matching the
  single hosted `evaluation_reports` row (id `7ae77f6a-8d98-4d7c-a0e2-a2e5acf258b5`).
  The empirical question — does shape-only pattern matching beat the weekly-trend
  baseline out-of-sample? — now has a measured answer: model accuracy 0.4996 vs
  baseline 0.4871, delta +1.24pp, 95% Wald CI [+0.66pp, +1.82pp], n=28470,
  deltaExceeds3pp=false, strength weak=16071/moderate=12351/strong=48. The pattern
  beats the baseline by a small, statistically-positive margin (the CI excludes
  zero) but below the 3pp annotation threshold; this is recorded as a finding, with
  no verdict. HOW IT GOT HERE (`simplify-to-cloud-minimal` task 8/8.1): the first
  live ☁️ hosted evaluation run exposed a look-ahead LEAK in the evaluation fold
  construction (`buildFoldInputs` sourced the model prediction from the matured
  outcome it was scored against → a false tautological `model=1`); it was FIXED
  (model prediction now sourced honestly from the retrieved analogue neighborhood
  as of each decision date), a follow-on performance fix made the honest evaluation
  runnable inside the Cloud Run Job, both fixes merged to `main` (PRs #23/#24) and
  the image redeployed, and the leak-free evaluation was executed and recorded. The
  earlier `dashboard-data-activation` Tasks 10/11 DB-vs-log discrepancy is now moot:
  the authoritative measured record is this evaluation report, present in BOTH the
  hosted table and the living research log.
- **Simplicity/complexity audit flags premature infrastructure (new this turn).**
  `docs/architecture/PROJECT-SIMPLICITY-AUDIT.md` reviews the whole project
  against the original local-first MVP and concludes the project has grown a
  production-grade platform (two deployable services, full GCP estate, RLS +
  scoped JWT + read-proxy + read views + diagnostic path, provider/strategy/
  storage abstractions, a Python cross-check for one formula, 13 tables, 4
  specs) while the central premise above has never been measured. It recommends
  protecting the research-integrity layer and deferring/removing/simplifying the
  surrounding software — re-introducing cloud, serving, and the scoped-credential
  security model only once a public serving layer actually requires them. The
  audit is advisory; no code, config, or cloud change was made, and deferred
  subsystems should be branch-quarantined rather than deleted. A follow-up
  focused review (audit §13) refines the kill-gate guidance: PROTECT the
  measurement engine (Gate 1/Gate 2 math) but reframe it as a human-read
  evaluation report; SIMPLIFY the `PASS`/`CUT` verdict (undocumented, inherited
  `+3pp`/`margin>=0` thresholds) into annotations at most; REMOVE the live-path
  auto-block (`gatePassingResolver`, Req 12.3) for v1. The software should
  measure and report; the operator decides whether the evidence supports the
  approach — it should not auto-decide the research is "alive" or "dead".
- **No usable local Supabase + live secrets in `.env` (new this turn).** The
  first-OOS-evaluation run (`simplify-to-cloud-minimal` task 2.2) could not be
  executed locally: `.env` has `SUPABASE_TARGET=hosted`, `SUPABASE_LOCAL_KEY` is
  empty, the Supabase CLI shim is broken (`supabase-go` binary missing), and no
  local Supabase stack is running (only an unrelated `wpdb` MySQL container). To
  run the evaluation locally the stack must be stood up, migration 006 applied,
  and candles/vectors seeded. Separately and more importantly, `.env` holds LIVE
  hosted Supabase secrets (the secret key, JWT secret, and DB password, referenced
  by name only here) — these should be rotated and the file untracked. This is
  outside the task scope but worth flagging as a security risk.
- **Write_Credential cutover gap BLOCKS task 5.3 (surfaced this turn via the live
  enumeration).** The schema-reduction migration `...006` STEP 6 drops the
  `pipeline_writer` role — the identity the Cloud Run Job currently uses to write
  (the scoped ES256 JWT in the `supabase-key` secret). STEP 7 is supposed to hand
  write (INSERT/UPDATE) to the single Write_Credential role `fx_writer`, but that
  grant is guarded `if exists (fx_writer)` and the live enumeration confirms
  `fx_writer` does NOT exist on hosted. So applying `...006` as-is would drop the
  Job's write path and NOT establish a replacement — leaving the DB public-read
  with no role able to write. This is the same shape of gap that 6.5 closed for
  the display writer: the migration is correct in isolation but a prerequisite was
  unowned. NOW OWNED + SCOPED: task 5.2a "Cut over the Write_Credential before the
  reconcile" (☁️, operator-approved) is broken into 5.2a.1-5.2a.4. The scoping
  settled the write-path model (Option A, operator-approved): `fx_writer` is a
  PostgREST SCOPED-JWT role mirroring `pipeline_writer` (NOLOGIN, `authenticator`
  is a member, reached via a `role: fx_writer` JWT) — NOT a bare login role, which
  the REST client cannot reach — so the cutover is a role re-mint + `supabase-key`
  secret rotation with NO client code change. SECOND BUG FOUND: migration `...006`
  STEP 7 grants `fx_writer` table privileges but OMITS `grant fx_writer to
  authenticator`, so even once the role exists PostgREST would reject it at runtime
  with `42501 permission denied to set role`. 5.2a.1 fixes the migration; 5.3 still
  depends on 5.2a being green. RELATED FINDING: `evaluation_reports` does not yet
  exist on hosted (migration `...006` has never been applied there) — the full file
  creates it before granting, so this is not itself a blocker.
- **A FULL hosted backup exists as of this turn (reversibility net for 5.3).**
  `~/supabase-backup-20261007T151618Z/` holds `schema.sql`, `data.sql` (~53 MB),
  and `roles.sql`, taken via `supabase db dump` over the IPv4 pooler and verified
  to contain all 11 to-be-dropped tables. NOTE: this backup is OUTSIDE the repo
  and is NOT committed (it contains production data); it is a local safety net for
  the 5.3 apply, not a durable artefact. Tooling note correcting an earlier claim:
  the Supabase CLI (v2.109) WORKS here and bundles a PG-17-compatible dumper; the
  local `pg_dump` is v15 and is version-gated out against the 17.6 server, and the
  IPv6 direct connection is unreachable — use the IPv4 pooler for hosted ops.
- **`.env` live-secret exposure is BROADER than previously noted (elevated this
  turn).** Reading `.env` for the 5.3 prep confirmed it holds, in plaintext: the
  hosted Supabase secret key, JWT secret, DB password (in two connection strings),
  and the Supabase access token, PLUS ~10 third-party provider API keys (Twelve
  Data, Massive, Alpha Vantage, Finnhub, News API, FMP, FCS) — all referenced by
  name only here, never by value. These are LIVE production credentials now
  directly in the path of cloud operations. Rotate ALL of them and untrack `.env`
  before further live work; prior notes mentioned only the three Supabase secrets.
  Now tracked as requirement R10 of the new spec
  `daily-candle-freshness-and-cleanup`.
- **Display-only features work locally but are undeployed and have prod-config
  prerequisites.** The Gemini + FCS wiring was verified only against live APIs
  from the dev machine. For the deployed Cloud Run Job to produce the data: the
  GitHub `GEMINI_MODEL` repo variable must be `gemini-2.5-flash` (the previously
  configured `gemini-3.5-flash` 404s), the Job's runtime service account needs
  `roles/aiplatform.user` for Vertex AI, and `.github/workflows/deploy.yml` must
  carry `EXTERNAL_SIGNAL_PROVIDER=FCS` (added this turn) so `externalSignalConfig
  FromEnv` resolves. Until a Job run completes post-deploy, the AI and
  Third-party tabs stay in their empty/unavailable states. Note the AI tab is
  per-firing-card, so on a silent (no-firing) day showing "no rationale" is
  correct, not a bug.
- **Display-only Gemini rationale 403 on Vertex AI — RESOLVED (`daily-candle-freshness-and-cleanup` task 16, R7).** The earlier HTTP 403 `aiplatform.endpoints.predict denied` for `job-runtime@` on `gemini-2.5-flash` is fixed: `roles/aiplatform.user` (which includes `aiplatform.endpoints.predict`) is bound to the SA (IAM audit: ADDED 2026-10-08 17:58Z) and the logged 403 (2026-10-08 12:34Z) predated that grant. An operator-approved ☁️ Job run (`scheduled-daily-run-962h6`, exit 0) produced NO predict-403; the model is reachable in `europe-west1` (countTokens HTTP 200). Zero pairs fired that run so the per-firing-pair rationale (R7.2) will self-confirm on the next firing day. The path stays display-only (never touches scoring). Manifest `rolesNote` records the verified least-privilege grant.
- **Read-proxy CODE removed; the live GCP resource still exists.** The
  `services/read-proxy/` code, its `/api` rewrite, and the SPA's ten-endpoint
  allowlist were DELETED in `simplify-to-cloud-minimal` Phase 5 task 6; the SPA
  now reads the static `dashboard.json` snapshot, so the former local-only
  `/candles` + `/analogue-outcomes` column fix is moot. REMAINING RISK: the
  deployed `dashboard-read-proxy` Cloud Run service + its images still exist in
  GCP and are now orphaned — their deletion is the Phase 6 R11 operator-approved
  sweep (task 7.2, PENDING operator approval). As of task 7.1 the orphan set is
  ENUMERATED: a live read-only `ops/enumerate-gcp.sh` run (diffed against
  `ops/required-resources.manifest.json`) classified `dashboard-read-proxy` plus
  jobs `dashboard-seed-run`/`dashboard-gate-run`, ~10 obsolete secrets, stale
  Artifact Registry images, and several review-SAs as ORPHANED deletion
  candidates — but NO deletion was executed. Until task 7.2 runs the stale service
  remains but nothing points at it.
- **Snapshot sink no-op / `dashboard.json` not published — RESOLVED.** The daily
  Job's `resolveSnapshotSink()` was a logged no-op, so no `dashboard.json` was ever
  published and the SPA fetched a static asset Firebase Hosting cannot write at
  runtime. The GCS `SnapshotSink` is now IMPLEMENTED
  (`src/scheduled-run/gcsSnapshotSink.ts`, wired on `DASHBOARD_SNAPSHOT_BUCKET`) and
  the live bucket/IAM/CORS + the `DASHBOARD_SNAPSHOT_BUCKET`/`VITE_SNAPSHOT_URL`
  repo vars are provisioned (operator-approved). PR #25 was merged + deployed and
  the loop is now PROVEN LIVE: the daily Cloud Run Job run
  `scheduled-daily-run-2rrm6` published `dashboard.json` (1779 bytes) to the
  public bucket, verified anonymously fetchable over HTTPS (HTTP 200). Fully
  resolved under parent task 8.
- **Frontend auto-deploy: IAM blocker cleared; green deploy not yet verified.**
  The first `deploy-frontend` run 403'd because the deploy SA
  (`gh-deploy@…`, the `DEPLOY_SERVICE_ACCOUNT`) lacked a Firebase Hosting role;
  `roles/firebasehosting.admin` has now been granted (live grant applied + binding
  verified in the SA's IAM policy) and the deprecated `FIREBASE_TOKEN` env was
  removed in favour of ADC. The workflow edit is not yet committed/pushed, and
  the deploy has not been re-run, so a successful hosting publish remains
  expected-but-unverified. Secondary note: the pipeline uses the third-party
  `dorny/paths-filter@v3` action — if the org restricts Actions to
  verified/first-party publishers, replace it with native per-file `paths:`
  filters (which would require splitting into two workflow files).
- **Live-cloud checkboxes can't be re-verified from the repo alone.** Hosted
  migrations applied, secrets provisioned, images deployed, scheduler created,
  and scoped-write verified live are all asserted via LIVE CLOUD task checkboxes.
  Treat them as claims pending re-verification against the live project, not as
  facts provable from source.
- **Non-transactional gate writes.** The aggregate-then-fold insert is not
  transactional across PostgREST requests; a fold-insert failure can leave a
  tolerable orphan aggregate row (append-only), surfaced with its `configId`.
- **Diagnostic read path.** Because the anon key is RLS-limited and the scoped
  read key 401s on raw PostgREST, a least-privilege read-only count path exists
  (`...005` migration + `supabase/DIAGNOSTIC_READ_PATH_POLICY.md`); service-role
  one-offs must be read-only, operator-approved, and never logged.
- **Git hygiene / branch confusion.** The remote is named `main` (not `origin`),
  which collides with the `main` branch and caused work to feel "lost" when it
  was only committed on another branch. Work had become fragmented across `dev`
  and `activate/dashboard-firing`; this was reconciled by merging the latter into
  `dev` (see STATE summary). The reconciling merge commit on `dev` is not yet
  pushed. Recommended follow-ups: rename the remote to `origin`, and push `dev`
  (directly or via PR per team preference).
- **Deploy reaches the live image only via a `dev`→`main` PR merge.** The Deploy
  workflow (`.github/workflows/deploy.yml`) triggers ONLY on push to `main`;
  pushes to `dev` run CI only. So any fix (e.g. the leak fix in PR #23, the perf +
  flaky-test fix in PR #24) is NOT in the deployed Cloud Run Job image until the
  operator merges the PR to `main`. PR #23 and PR #24 are merged + deployed;
  PR #25 (the GCS snapshot sink + the
  `DASHBOARD_SNAPSHOT_BUCKET`/`VITE_SNAPSHOT_URL` repo-var wiring) is the current
  one open and awaiting the operator's merge to `main`.
- **A flaky, seed-dependent property test exists in dormant `news-filter`.**
  `src/news-filter/property28-suppressionPure.test.ts` broke CI on `main` once
  (bad fast-check seed) because it scanned the pass-through `reason` for direction
  tokens. Fixed this session (test-only; `suppress()` was correct). The
  `src/news-filter/` module is dormant under the de-scope (pipeline wiring
  removed) but still exported from `src/index.ts` and still runs in CI; consider
  removing the module in a later cleanup.
- **~50 MB DB backup committed into git history + 20 Dependabot vulnerabilities.**
  `ops/backups/hosted-5.3-*.sql` (~50 MB) was committed in the Phase-2-7 de-scope
  commit and now lives in git history (GitHub flagged it over the 50 MB
  recommended size) — consider gitignoring/removing it and the `ops/backups/` dir.
  Separately, the repo's Dependabot reports 20 vulnerabilities (4 critical, 2
  high, 12 moderate, 2 low) — worth a dedicated pass. Now tracked as requirements
  of the new spec `daily-candle-freshness-and-cleanup`: the git-history backup
  removal is R8, the Dependabot triage/fix is **R9 — DONE (see §9 below)**, /web
  toolchain upgraded to vite 7 / vitest 3.2.4 to clear the Dependabot-PR CI failures.
  The recurring Dependabot ERESOLVE / unsupported-major CI failures are now
  STRUCTURALLY addressed by a CI-enforced supported-major-ceiling policy
  (`auditCeilings`/`SUPPORTED_MAJOR_CEILINGS` across both package trees) plus
  matching `.github/dependabot.yml` ignore rules, with React 19 / recharts 3 /
  TypeScript 7 held as documented DEFERRED migrations (TS 7 blocked upstream
  until typescript-eslint supports the TS 7.1 API). See §9 for detail.


## 9. Dependency vulnerability triage (R9 — `daily-candle-freshness-and-cleanup` task 18)

Triaged against the live `npm audit` output in each `package.json` (root
`fx-daily-pattern-assistant` and the web SPA `web/dashboard-ui-web`) — this is
local dependency work, no live-cloud/network/auth-gated action. The 20 recorded
Dependabot findings (4 critical / 2 high / 12 moderate / 2 low) are the sum of
the individual GitHub advisories across both package trees; `npm audit` collapses
them onto the vulnerable packages below. Every finding is bucketed so nothing is
silently dropped.

**Buckets**

- **(a) Fixed by a compatible pinned bump — APPLIED.** `web/package.json`:
  `vite` 5.4.11 → **5.4.21** and `vitest` 2.1.8 → **2.1.9** (exact pins, no
  ranges — honoring the no-ranges policy; both patch-level within the installed
  5.x / 2.x majors). These absorbed the advisories that are fixed WITHIN the
  5.4.x / 2.1.x lines: the Vitest API-server RCE (GHSA-9crc-q9x8-hgqq, critical,
  fixed in 2.1.9) and the several `vite` `server.fs.deny` bypass / path-traversal
  CVEs fixed within 5.4.x (e.g. GHSA-x574-m823-4x7w, -356w-63v5-8wf4,
  -859w-5945-r5v3, -xcj6-pq6g-qj4x, -4r4m-qw57-chr8, -vg6x-rcgg-rjx6). `make
  check` + the web build + the web test suite stay green on the bumped versions.
  The `/web` toolchain was subsequently upgraded as one atomic set to clear the
  Dependabot-PR CI ERESOLVE failures: `vite` 5.4.21 → **7.3.7**, `vitest`
  2.1.9 → **3.2.4**, `@vitejs/plugin-react` 4.3.4 → **4.7.0** (exact pins, no
  ranges), regenerating `web/package-lock.json`; this clears the `vite`
  `server.fs.deny` CVEs (fixed ≤6.4.2) and the `esbuild` dev-server leak (vite 7
  ships esbuild 0.27+). Verified locally on Node 22: web `npm ci` resolves with
  no ERESOLVE, `npm run build` green, `npm test` 146/146 green.
- **(b) Requires a breaking (SemVer-major) change — PARTIALLY TAKEN.**
  The vite/vitest major has now been partially taken (to `vite` **7.3.7** /
  `vitest` **3.2.4** / `@vitejs/plugin-react` **4.7.0**, see bucket (a)), which
  cleared the `vite` `server.fs.deny` CVEs (`<=6.4.2`) and the `esbuild`
  dev-server leak. The ONLY still-deferred items are the ones that need `vitest`
  **5** (which forces `vite` **8** → `@vitejs/plugin-react` **6**, peer `vite ^8`
  only — a larger jump): the two `tinypool` prototype-pollution criticals
  (`<=2.1.1`), `@vitest/mocker` path traversal (`<4.1.11`), and the `vitest`
  UI-server file read (fixed 3.2.6+ → vitest 5.x). **Migration note:** vitest 2→5
  / vite 7→8 remain breaking (config API, plugin peer-deps, test runner
  behaviour) and are deferred to a dedicated tooling-upgrade pass rather than
  forced here. **Reachability:** all remaining items are dev/CI-only (vite/vitest
  never ship to production — the web app deploys as a static pre-built SPA to
  Firebase Hosting) and require a running vitest dev/API/UI server (not used in
  CI build or prod), so runtime exposure is nil.
- **(c) Not applicable (dev-only / unreachable at runtime) — RATIONALE RECORDED.**
  Root `fx-daily-pattern-assistant`: `source-map-js` 1.2.1 (high, event-loop DoS,
  `<1.2.2`, GHSA-68fv-2mgg-jv7q) — a dev-only transitive dep (via
  `vitest`→`vite`→`postcss` and `@vitest/coverage-v8`→`magicast`); not directly
  pinned by this repo, only reachable in test-tooling source-map parsing, never in
  the compiled production artifact. The root project already runs the current
  `vitest` 5.0.1 / `vite` 8.3.0; the residual sits in a transitive `postcss` /
  `magicast` and clears when those upstreams ship source-map-js ≥1.2.2. Not force-
  pinned via an override to avoid introducing a non-standard transitive pin for a
  dev-only, unreachable DoS.

**Triage table (every finding bucketed)**

| Pkg (tree) | Direct? | Severity | Advisory (short) | Bucket | Action / rationale |
| --- | --- | --- | --- | --- | --- |
| `vite` (web) | yes | high+mod×N | `server.fs.deny` bypasses, path traversal (fixed ≤6.4.2) | (a) | Pinned 5.4.11→5.4.21→**7.3.7**; `<=6.4.2` CVEs cleared by vite 7 |
| `vitest` (web) | yes | critical | API-server RCE GHSA-9crc (fixed 2.1.9) | (a) | Pinned 2.1.8→2.1.9→**3.2.4** |
| `vitest` (web) | yes | critical | UI-server file read GHSA-5xrq (`<3.2.6`) | (b) | Needs vitest **5** (→ vite 8 → plugin-react 6), deferred |
| `esbuild` (web) | no | moderate | dev-server request/response leak `<=0.24.2` | (a) | Cleared by vite 7 (ships esbuild 0.27+) |
| `tinypool` (web) | no | critical×2 | prototype-pollution → RCE `<=2.1.1` | (b) | Needs vitest **5** (→ vite 8 → plugin-react 6), deferred |
| `@vitest/mocker` (web) | no | moderate | path traversal `<4.1.11` | (b) | Needs vitest **5** (→ vite 8 → plugin-react 6), deferred |
| `vite-node` (web) | no | moderate | via vulnerable vite | (a) | Cleared by vite 7 upgrade |
| `source-map-js` (root) | no | high | event-loop DoS `<1.2.2` | (c) | Dev-only transitive (postcss/magicast); unreachable in prod artifact |

**Green verification after the applied bump:** root `npm run check` (lint +
typecheck + 763 vitest tests) green; `web` `npm run build` (tsc + vite build)
green; `web` `npm test` (146 tests) green. Lockfiles updated via `npm install`
in `web/`. After the subsequent `/web` toolchain upgrade (vite 7.3.7 / vitest
3.2.4 / @vitejs/plugin-react 4.7.0): web `npm ci` resolves clean with no
ERESOLVE, `npm run build` green, and `npm test` 146/146 green on Node 22.

**(d) Grouping to prevent recurrence — ADDED.** A new `.github/dependabot.yml`
was added that GROUPS the coupled `vite` / `vitest` / `@vitejs/*` / `@vitest/*`
/ `tinypool` / `esbuild` packages into a single atomic `vite-vitest-toolchain`
PR per `/web` run, so the peer set moves together and the ungrouped-partial-bump
ERESOLVE failure (one package bumped while its peers lagged) cannot recur.

**(e) Durable supported-major-ceiling policy — CI-ENFORCED (this turn).** To
stop the recurring Dependabot ERESOLVE / unsupported-major CI failures and keep
all future dependency work on supported majors, a durable supported-major
ceiling is now enforced in CI: `scripts/version-policy.mjs` audits BOTH package
trees (root `package.json` and `web/package.json`) for exact pins AND enforces
`SUPPORTED_MAJOR_CEILINGS` via the pure `auditCeilings` logic in the shared
`src/version-policy/audit.js` (surfaced through `versionPolicy.ts`), exiting
non-zero on any violation. Ceilings: `typescript<=6`, `@types/node<=22`,
`react`/`react-dom`/`@types/react`/`@types/react-dom<=18`, `recharts<=2`
(covered by `src/version-policy/ceilings.test.ts` — 7 unit + 2 fast-check
property tests). `.github/dependabot.yml` was extended to match: a new `react`
group under `/web` (react, react-dom, @types/react, @types/react-dom move
atomically) plus `ignore` rules holding the blocked/deferred majors consistent
with the ceilings constant (root + web `typescript >=7`; `@types/node >=23`;
web `react`/`react-dom`/`@types/react`/`@types/react-dom >=19`; web
`recharts >=3`). React 19, recharts 3, and TypeScript 7 are DEFERRED migrations
held behind these ceilings rather than silent CI failures: recharts 3 has a
breaking Tooltip Formatter API, React 19 is a major with recharts-2 peer
constraints, and TS 7 is blocked upstream by typescript-eslint (peer `<6.1.0`
until the TS 7.1 API) — TypeScript 7 can be revisited once typescript-eslint
supports that API. Separately, a latent fast-check-4 test-arbitrary bug in
`web/src/pure/selectDates.browse.property.test.ts` (its `fc.date()` arbitrary
could yield an Invalid Date → `RangeError`) was fixed with a safe YYYY-MM-DD
builder that works under fast-check 3 and 4; the production `selectDates.ts` was
correct and untouched. STRATEGIC DECISION (operator-approved): enforce the
supported-major ceilings in CI and defer the React 19 / recharts 3 / TS 7 majors
as explicit, CI-guarded decisions. All changes are locally verified green (root
`npm run check` 773 passed/6 skipped incl. the 10 new ceiling tests; `node
scripts/version-policy.mjs` exit 0 over 22 specs across both trees; web build +
146 tests green; dependabot.yml valid YAML) but are UNCOMMITTED on branch `dev`,
so Dependabot's live behavior is not yet confirmed against GitHub.

