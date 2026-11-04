<!-- LIVING-DOCS:PROJECT-STATE -->
# PROJECT-STATE.md — Current Project State

> Living state document (Requirement 5.1). This file is the single place anyone
> — a teammate or Kiro picking the project up cold — can read to understand the
> full picture: what the project is, the technology stack, how the code is laid
> out, what is actually built vs. merely planned, the obstacles hit, and the
> strategic decisions made.
>
> **How this file stays live.** There are two update paths and they must not
> fight each other:
> 1. The machine-managed block delimited by the BEGIN/END STATE HTML comment
>    markers (see them just below) is rewritten by the Living-Docs Writer
>    (`LivingDocs.updateState()` in `src/living-docs/livingDocs.ts`) and by the
>    `update-living-docs` agent hook. Treat it as generated — do not hand-edit
>    its three lines except to correct a factual error. Note: the literal marker
>    strings must appear exactly once each in this file (the writer locates them
>    with a first-match search), so this preamble intentionally does not repeat
>    them verbatim.
> 2. Everything **outside** those markers is human/agent-authored prose and is
>    preserved verbatim across machine updates. When a change, fix, or decision
>    lands, update the relevant prose section below (and append gate verdicts to
>    RESEARCH-LOG.md, never here).
>
> Rule of thumb: the one-line "where we are right now" lives in the STATE block;
> the durable "how and why" lives in the prose. Keep both honest.

<!-- BEGIN STATE -->
- **Phase:** v1 feature-complete and LIVE. `daily-candle-freshness-and-cleanup` candle-gap fix deployed/verified (freshness up_to_date in prod). `trader-edge-validation` Stages A-H code-complete, NOT deployed (two additive migrations applied in hosted; no edge measured). `multi-strategy-confluence-engine` COMPLETE locally AND confirmed LIVE — the deployed Job image serves schema v5 + the confluence slice. Delivery cadence: operator merges dev->main to deploy; agent builds/verifies locally.
- **Updated:** 2026-11-04
- **Summary:** `dashboard-simplification` implemented locally (no spec): six strategy cards, conviction tiers + vote tally, analogue-based expected candle size, per-strategy track record (schema v6), SL/TP/net-expectancy removed from the whole UI, PairSelector + legacy tabs deleted, conflict threshold 0.6->0.5. Also local: provider-chain date screening, decision-date Option B (a run at/after 17:00 NY is labelled the next trading day, plus a bounded candle-freshness retry), the pair view showing the selected pair's own AI note, a trading-days horizon unit in the AI prompts, and a tidied top bar (date selector + Refresh on one row, "Last updated" removed). Root `make check` green (backend 1242 tests); web build + 263 tests green. NOT committed or deployed.
<!-- END STATE -->

## 1. What this project is

A personal, local-first **FX Daily Pattern Trading Assistant** for the five
major pairs (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD). It surfaces a small number
of high-conviction, forward-looking daily directional setups ("a pattern is
emerging; over the next 1–3 days, direction X, earned confidence C%") and stays
silent otherwise. It is the successor to a prior forecasting system that failed
instructively; the lessons from that failure are hard constraints and live in
`LESSONS.md`.

Two non-negotiables govern every design choice:
- **Measure before believing.** Nothing drives a displayed signal until it beats
  a defined baseline out-of-sample through a two-stage kill-gate.
- **AI explains and filters; deterministic code decides and scores.** An LLM may
  read news, write rationale, label analogues, and help interpret results. It
  must never compute the directional probability or the kill-gate verdict.

The authoritative design and task breakdown live in `PROJECT-PLAN.md` and under
`.kiro/specs/`. This file tracks the *state*, not the plan.

## 2. Technology stack (what is actually in use)

- **Core language:** TypeScript, Node `>=22 <23` (`.nvmrc` pins the line), ESM
  (`"type": "module"`). The core has **no runtime dependencies** — it uses Node
  22 built-in `fetch`/`http`.
- **TypeScript config:** ES2022 / NodeNext, `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `isolatedModules`. Deliberately strict.
- **Testing:** Vitest + fast-check (property-based testing) for TypeScript —
  the sole authority. The former isolated Python (`pytest` + `hypothesis`)
  cross-check of the confidence-shrinkage formula was removed in
  `simplify-to-cloud-minimal` Phase 3 (task 4); the TS property test in
  `src/confidence/` is now the only check of that formula.
- **Tooling:** ESLint 9 + typescript-eslint. Dependencies are exact-pinned
  (no ranges) in every `package.json`. A custom `version-policy` audit
  (`scripts/version-policy.mjs`) guards version drift.
- **Storage:** Supabase Postgres + **pgvector** for pattern-vector ANN
  retrieval. Local and hosted targets selected via `SUPABASE_TARGET`. Schema
  managed by SQL migrations under `supabase/migrations/`.
- **Cloud (GCP, project `trade-assistant-508806`):** Cloud Run **Job** for the
  scheduled daily refresh (the dashboard read-proxy Cloud Run service was
  live-DELETED in `simplify-to-cloud-minimal` Phase 6 task 7.2);
  Cloud Scheduler (daily `0 17 * * *` America/New_York); Secret Manager for all
  runtime secrets; Cloud Build + Artifact Registry (SHA-pinned images); keyless
  CI auth via Workload Identity Federation / OIDC (no stored SA key).
- **Serving / UI:** React + Vite + TypeScript SPA (`web/`) on Firebase Hosting,
  strictly read-only. Under `simplify-to-cloud-minimal` Phase 5 task 6 the SPA
  reads the Public_Read_Path: a single `dashboard.json` snapshot the Cloud Run
  Job writes at the end of each daily run, fetched via `web/src/api/snapshot.ts`
  `loadSnapshot()` (one shared `snapshotCache` across all tabs). As of task 8,
  the SPA fetches that snapshot CROSS-ORIGIN from a public-read GCS bucket: the
  fetch URL comes from a build-time `VITE_SNAPSHOT_URL` (fallback same-origin
  `/dashboard.json`), and the daily Cloud Run Job writes the object through the
  new GCS `SnapshotSink` (`src/scheduled-run/gcsSnapshotSink.ts`). The CSP
  `connect-src` includes `https://storage.googleapis.com`. The former
  `services/read-proxy/` Node `http` service + its `/api` rewrite + ten-endpoint
  allowlist are DELETED in code; the live GCP read-proxy resource was also
  DELETED in the Phase 6 R11 reconcile (task 7.2).
- **External providers (keys in Secret Manager, read at runtime):** market-data
  and news/calendar providers plus Gemini for the LLM layer. Data/LLM inputs
  only — never scoring.

## 3. Repository / code map

What each `src/` and `web/` module is and does.

**Moved to [`docs/state/CODE-MAP.md`](docs/state/CODE-MAP.md).** This section now lives in a satellite doc to keep
PROJECT-STATE.md a thin entry point. Update it there when the relevant change lands.

## 4. Spec completion status

| Spec | Status | Open items |
| --- | --- | --- |
| `fx-daily-pattern-assistant` | **Complete** (all tasks `[x]`) | — |
| `operational-wiring` | **Reconciled** (daily-candle R11.2) | Task 12's parent is now `[x]` (all four subtasks 12.1–12.4 were `[x]`). Task 13 (final checkpoint — cloud half) is explicitly **DEFERRED (superseded)**: the cloud half (SecretManager/DeployVerifier/Scheduler + the hosted `pipeline_writer` write path) was re-done by `simplify-to-cloud-minimal` — read-side roles dropped for a sole `fx_writer` write role, and the end-to-end cloud loop was proven live under that spec's task 8 (`scheduled-daily-run-2rrm6`, exit 0). Task 12.4's `pipeline_writer` posture is noted as superseded by `fx_writer` though left `[x]` (genuinely executed at the time). |
| `dashboard-ui` | **Reconciled** (daily-candle R11.3) | Task 17 (post-deploy Read_Proxy smoke) and Task 18 (final checkpoint) are explicitly **DEFERRED (superseded)**: the Read_Proxy (`services/read-proxy/`) and the Firebase `/api` rewrite those tasks verified were REMOVED in `simplify-to-cloud-minimal` Phase 5 (the SPA now reads a static public `dashboard.json` snapshot same-origin, no proxy). The write-rejection (`405`) / disallowed-query (`400`/`404`) smoke targets an HTTP component that no longer exists and is NOT falsely ticked; the equivalent live liveness (public `dashboard.json` anonymously fetchable, HTTP 200) was proven under `simplify-to-cloud-minimal` task 8. PLUS a new Requirement 8 criterion 8 (added this turn, format-valid): on 'All pairs', the AI / Third-party / Pattern-Outcomes tabs must render a cross-pair view over all five pairs instead of a 'pick a pair' prompt — reverses the original 8.2 dead-end that made the dashboard look empty of third-party/AI content on first load. Design addendum + task 19 (subtasks 19.1–19.7) for criterion 8 are now WRITTEN and format-valid (web/-only: compose existing pure shapers via a thin `shapeAllPairs` helper, one getSnapshot() read, per-pair no-data markers, labels preserved; design Property 16 added). Implementation of task 19 pending. (Tasks 17/18 trailing checkpoints still open.) |
| `dashboard-data-activation` | **Complete** (all tasks `[x]`) | — |
| `simplify-to-cloud-minimal` | **Complete** (all Phases 1-7 done; tasks 8, 8.1, 8.2 `[x]`). The first leak-free OOS evaluation was RECORDED (reportId `7ae77f6a-…`, +1.24pp vs baseline, below 3pp, no verdict), the Public_Read_Path snapshot uploader was IMPLEMENTED (GCS `SnapshotSink`) with its live bucket/IAM/CORS + repo vars PROVISIONED (operator-approved), and PR #25 was merged + deployed. The parent task 8 end-to-end cloud-loop proof is DONE: a live daily Cloud Run Job run (`scheduled-daily-run-2rrm6`, exit 0) wrote a `firing_setups` row for 2026-10-08 (EURUSD DOWN, conf ≈0.571, surfaced), maintained `realized_outcomes`, and published `dashboard.json` to the public bucket, verified anonymously fetchable (HTTP 200). | De-scope spec: kill-gate reframed to a human-read evaluation report (task 1), the `evaluation_reports` persistence + report write path + first-evaluation entrypoint landed (task 2.x), Phase 2/3 removed the auto-block + suppressors + research/software complexity, Phase 5 task 6 (6.1-6.5) landed the Public_Read_Path (fail-safe `dashboard.json` snapshot writer wired into the daily run, SPA repointed to a single `loadSnapshot()`, `services/read-proxy/` + read-side `src/ops/write-credential/` deleted, proxy/allowlist tests replaced with snapshot-path tests, the last `signal_rationale`/`external_reference_comparison` writer removed and its write-shape types relocated to `displayOnlyTypes.ts`), and task 5.2a cut over the `fx_writer` Write_Credential. Phase 4 is LIVE-APPLIED (task 5.3, operator-approved): migration `...006` was applied to hosted (project `bffzhjnpzxxuqvmnmylk`) after a fresh backup, reducing the schema to the 6-table Required_Object_Set; the three read-side roles (pipeline_writer, dashboard_reader, diagnostic_reader) were dropped, leaving `fx_writer` the sole write role; data preserved; idempotency confirmed; `make check` green. Phase 6 COMPLETE: task 7 simplified `deploy.yml`, task 7.1 authored the GCP manifest + read-only enumeration, and task 7.2 EXECUTED the ☁️ operator-approved GCP reconcile deletions live against project `trade-assistant-508806`. Phase 7: task 8.1 DONE (research-integrity layer confirmed intact — look-ahead guard, weekly-trend baseline, measurement math, shrinkage, realized-outcome journal, AI-never-scores guard all behaviour-unchanged — AND it surfaced + FIXED a look-ahead LEAK in `src/staged-runner/stagedRunner.ts` `buildFoldInputs` plus a follow-on performance fix, both merged to `main` via PRs #23/#24 and redeployed); task 8.2 DONE (this living-docs update). FIRST OOS EVALUATION NOW RECORDED: hosted `evaluation_reports` holds exactly one `shape-only` row (id `7ae77f6a-8d98-4d7c-a0e2-a2e5acf258b5`) and RESEARCH-LOG.md carries the matching `[EVALUATION] shape-only` entry — model accuracy 0.4996 vs baseline 0.4871, delta +1.24pp, 95% Wald CI [+0.66pp, +1.82pp], n=28470, deltaExceeds3pp=false, strength weak=16071/moderate=12351/strong=48. The shape-only pattern beats the weekly-trend baseline by a small, statistically-positive margin (CI excludes zero) but below the 3pp annotation threshold; recorded as a measured FINDING, no verdict. This is the first time the project's central premise is measured in the living log. Scope C, delete-not-quarantine. The Public_Read_Path snapshot uploader was then IMPLEMENTED (the GCS `SnapshotSink` in `src/scheduled-run/gcsSnapshotSink.ts`, wired via `resolveSnapshotSink()` on `DASHBOARD_SNAPSHOT_BUCKET`) and the live infra PROVISIONED (public-read bucket, runtime-SA object write, public read, CORS, repo vars) — all operator-approved. PR #25 was then merged + deployed, and the parent task 8 end-to-end cloud-loop proof was COMPLETED: a live daily Cloud Run Job run (`scheduled-daily-run-2rrm6`, exit 0) wrote a `firing_setups` row for 2026-10-08 (EURUSD DOWN, conf ≈0.571, surfaced), maintained `realized_outcomes`, and published `dashboard.json` to the public bucket — anonymously fetchable over HTTPS (HTTP 200). The only residue is follow-ups (the Vertex 403 for the display-only AI rationale; housekeeping), not spec work. |
| `daily-candle-freshness-and-cleanup` | **In implementation** — Phases 1-3 (tasks 1-11) DONE + merged (Candle_Freshness_Stage wired into the daily run, FCS→Twelve Data→Massive fallback chain, reusing `OhlcIngestion`); Phase 4 COMPLETE: task 12 (one-off backfill operator entry `src/ops/candle-backfill/main.ts`) + task 13 (☁️ operator-approved hosted run, 2026-10-08) DONE. The ☁️ run closed the ~3-week hole: all five pairs advanced 2026-09-15 → 2026-10-06 (Twelve Data served the range; 15 accepted/0 rejected per pair; verified live), with a benign one-day residual to 2026-10-07 the next Daily_Top_Up will take (R3.3). `make check` + web build green. Phase 5 task 14 (+ 14.1) DONE: Phase 5 COMPLETE (tasks 14 + 15). Task 14 added the READ-ONLY `verifyFreshness` helper + unit tests (`src/scheduled-run/freshnessVerification.ts`); task 15 added the read-only operator entry `src/ops/freshness-verify/main.ts` (+ tests, `make check` green 763 passed/6 skipped) and EXECUTED the ☁️ operator-approved LIVE read-only verify against hosted (`bffzhjnpzxxuqvmnmylk`, Decision_Date 2026-10-08): `dashboard.json` Decision_Date 2026-10-08 ⇒ snapshot reflects fresh history (R6.1 PASS); all five pairs latest 2026-10-06 vs target 2026-10-07 ⇒ the known benign one-day provider-availability residual (R6.2 FINDING, not a defect; next Daily_Top_Up closes it); no write performed. Remaining: Phase 6 cleanup R7-R11, Phase 7. Phase 6 task 16 (☁️ Vertex 403, R7) DONE `[x]`: diagnostics confirmed `roles/aiplatform.user` (includes `aiplatform.endpoints.predict`) was ALREADY bound to `job-runtime@` (IAM audit: ADDED 2026-10-08 17:58Z) and the logged 403 (2026-10-08 12:34Z) PREDATED that grant; `gemini-2.5-flash` reachable in `europe-west1` (countTokens HTTP 200). Manifest `rolesNote` records the verified least-privilege grant (R7.3). An operator-approved ☁️ manual Job run (`scheduled-daily-run-962h6`, exit 0) produced NO predict-403 and published a fresh `dashboard.json` (decisionDate 2026-10-09); zero pairs fired that day so the per-firing-pair rationale (R7.2) will self-confirm on the next firing day (operator accepted the 403 resolution as sufficient). Remaining in Phase 6: tasks 17-20 (R8-R11) + Phase 7. | New combined spec. Fixes a confirmed candle-data freshness DEFECT (hosted `candles` only to 2026-09-15; the daily Job never ingests fresh candles) via a Candle_Freshness_Stage that daily-tops-up + auto gap-backfills BEFORE the pipeline reads history, through the existing `OhlcIngestion` (Look_Ahead_Safe, idempotent, fail-safe), fed by a provider FALLBACK CHAIN FCS → Twelve Data → Massive (keys already in `.env`; first usable candles win, cascade on failure, normalize each response to one `RawCandle`), plus a one-off backfill for the current hole. Also bundles the leftover cleanup: Vertex AI 403 (R7), ~50MB git-history backup removal (R8), Dependabot triage/fix (R9), `.env` secret rotation+untrack (R10), trailing cross-spec checkpoint reconcile (R11), living docs/verification (R12). The design grounds the OHLC_Feed_Provider two-capability port (fetchLatest/fetchRange) + the FCS→Twelve Data→Massive fallback chain (FCS latest-only, so a multi-day range routes to Twelve Data/Massive), the Candle_Freshness_Stage reusing `OhlcIngestion` before the pipeline, a bounded 90-day backfill, a one-off operator backfill entry (`src/ops/candle-backfill/main.ts`), and cleanup R7–R11; tasks are 22 across 7 phases with the live-cloud items (one-off backfill, Vertex grant, secret rotation, hosted verify) operator-gated. Next: implement (start Phase 1). |
| `trader-edge-validation` | **In implementation — Stages A–G DONE and Stage H tasks 20 (`src/ops/edge-eval/` operator entry), 21 (standing-guard verification) and 22 (living docs) DONE locally; task 23 (final checkpoint) DONE locally (make check + web build green; decision path untouched) — all Stage A-H complete; only OF1/OF1.1 (operational follow-up, outside R1-R12) remain. Nothing deployed; both migrations (`trade_ledger`, `frozen_baselines`) are applied in hosted via the SQL editor; v4 snapshot is code-complete. No edge measurement has been run against real data, so no finding is recorded (any result goes to RESEARCH-LOG.md only, R12.5).** Earlier detail: Stages A + B + C + D DONE; Stage E tasks 13 (Aggregate_Exposure) + 14 (Signal_Provenance) DONE, Stage F task 15 (snapshot v4 producer, `edgeSlices.ts`) DONE locally, Stage G tasks 16 + 17 (web v4 types; Setups FORECAST/TRADE re-org with un-validated markers) DONE locally, task 18 (Evaluation tab leads with net-of-cost results) DONE locally, task 19 next** (tasks 1/1.1/2/2.1/3/3.1/4/4.1/5/6/6.1/7/8/8.1/9/10/10.1/11/11.1/12/12.1 `[x]`, locally verified, not yet deployed; Stages E–H pending; both `trade_ledger` + `frozen_baselines` migrations await operator apply; v3→v4 snapshot bump still upcoming in Stage F) | New spec turning an experienced-trader review into the evidence + honest-presentation layer the system lacks. 12 EARS requirements: R1 path-aware Trade_Simulation (`target_first`/`stop_first`/`expired`/`ambiguous`) — fixes the SL/TP sequencing defect (SL=75th pct MAE, TP=median MFE are independent distributions, order never checked); R2 explicit Execution_Model (entry/spread/commission/slippage); R3 deterministic Trade_Ledger (sole metric source, suppressed forecasts includable); R4 net-of-cost profitability metrics (expectancy pips+R, profit factor, drawdown, by pair/horizon/confidence band) as headline over directional accuracy; R5 Comparator_Strategies (trend + returns/vol) under identical execution, negatives surfaced; R6 confidence Calibration accounting for analogue overlap; R7 Walk_Forward_Evaluation with a frozen Parameter_Set (Horizon selection is a fittable parameter) + reserved untouched window; R8 Aggregate_Exposure over the 4 USD-legged pairs (info-only, no sizing); R9 Signal_Provenance / freshness (timestamp+tz, earliest realistic entry, stale/holiday policy); R10 dashboard re-org around the trader's decision (label un-validated numbers, evidence before AI); R11 freeze current Parameter_Set as a Frozen_Baseline; R12 standing scope/integrity guard (all artifacts deterministic + LLM-free; no execution/broker/new-LLM/new-provider/new-tunable; threshold never lowered to manufacture signals; PASS/CUT verdicts stay in RESEARCH-LOG.md). Respects the two project non-negotiables + a promoted third (nothing presented as more certain than the evidence supports). OPEN QUESTION for design: with D1-only data, resolve `ambiguous` same-candle outcomes via lower-timeframe data or keep as a reported category. DESIGN (authored): grounded in the actual code — R1 Trade_Simulation is a sibling walker over the same forward candles as `src/retrieval/resolver.ts` (whose `computeExcursions()` was CONFIRMED to take independent `Math.max` of favorable/adverse moves, discarding touch order — the root of the defect); the resolver is left byte-identical and a parallel path-aware reader added. Same-candle SL+TP ⇒ `ambiguous` first-class, with an optional `intraCandleResolver` seam (D1 default = report, don't guess). Every new module is a separate read-only consumer (never a scoring input), mirroring `realizedOutcomeJournal`; AI-never-scores re-verified via the `evaluationReportAiFree` property style. New modules: `src/trade-sim/`, `src/trade-ledger/`, `src/performance/`, `src/walk-forward/`, `src/exposure/`, `src/provenance/`, `src/ops/edge-eval/`. Comparators reuse `predictBaseline`/`weeklyTrendSign` + `atr.ts`; the walk-forward harness reuses `runDailyPipeline`/`evaluatePair` under a frozen ParameterSet. SCHEMA IMPACT (operator sign-off before tasks): two NEW tables `trade_ledger` + `frozen_baselines` (port + InMemory + Supabase, existing convention) and a snapshot bump v3→v4 with additive slices (`tradeLedgerSummary`, `calibration`, `exposure`, per-forecast `provenance` + `validated|unvalidated`). Derived summaries route verdict-like output to RESEARCH-LOG.md via the existing EvaluationReport path. TASKS (authored, then reformatted into DEPLOYABLE STAGES): 23 tasks across 8 stages A–H, each a self-contained deploy-safe increment (one deploy target per stage: A–F,H backend-only, G frontend-only). Stage A pip-helper lift + resolver byte-identical proof (ships alone); B Trade_Simulation + Execution_Model (pure, unwired); C Trade_Ledger + 🗄️ `trade_ledger` migration + metrics + AI-guard; D Frozen_Baseline + 🗄️ `frozen_baselines` migration + comparators + calibration + walk-forward; E Exposure + Provenance (pure, unwired); F snapshot v3→v4 producer + daily-run wiring (output grows, decision unchanged); G web v4 types + SPA re-org; H `src/ops/edge-eval/` entry + scope-discipline verification + living docs + final checkpoint. Deploy-safety invariants per stage: green check/build, live decision byte-identical, no half-exposed contract, daily run never breaks. Orderings: resolver-parity-before-build (A alone), expand-only additive tables with fail-safe adapters (torn deploy harmless), producer-before-consumer across the backend/web split (F before G). Nothing live-visible until Stage F. No ☁️ live-cloud tasks; only live touch is the two additive 🗄️ migrations (drop nothing, normal cadence after backup). tasks.md has no diagnostics. STAGE A DONE: NEW `src/trade-sim/pip.ts` (`pipSize`/`toPips`/`fromPips`) lifted from the resolver's private `toPips`; resolver imports it; parity property test proves byte-identical resolver MFE/MAE (R1.1/R12.1); `make check` GREEN (797). STAGE B DONE: NEW `src/trade-sim/{types,executionModel,tradeSimulation}.ts` + 2 property-tests — `ExecutionModel` (`exec-v1`; `resolveEntry` next-session-open strictly after decision date; `applyCosts` net=gross−friction) and path-aware `simulateTrade` (THE R1 fix: `target_first`/`stop_first`/`expired`/`ambiguous`, both-touched⇒ambiguous gross 0, optional `IntraCandleResolver`); pure + UNWIRED; `make check` GREEN (805). STAGE C DONE (tasks 4/4.1/5/6/6.1/7, locally verified, not deployed): NEW `src/trade-ledger/{types,buildTradeLedger}.ts` (ledger port + InMemory + builder: resolveEntry→simulateTrade→applyCosts per forecast; suppressed kept `fired:false`; ambiguous first-class), `supabase/migrations/20260916000007_trade_ledger.sql` (FIRST new table, additive-only, idempotent, public SELECT + fx_writer write), `src/storage/supabase/tradeLedgerStore.ts` (FAIL-SAFE read → `[]` on absent table/error), `src/performance/metrics.ts` (`summarize`/`summarizeBySlice`, net-of-cost headline, derived solely from ledger rows) + 3 property-tests incl. the AI-never-scores guardrail retargeted at the metric paths. `make check` GREEN (815/6 skipped, +10). STAGE D DONE (tasks 8/8.1/9/10/10.1/11/11.1/12/12.1, locally verified, not deployed): NEW `src/walk-forward/parameterSet.ts` (`ParameterSet`/`FrozenBaseline` + `captureFrozenBaseline()` reading the live constants verbatim, read-only R11.3), `supabase/migrations/20260916000008_frozen_baselines.sql` (SECOND new table — additive, append-only, jsonb params, public SELECT + fx_writer INSERT), `src/walk-forward/frozenBaselineStore.ts` (port + InMemory) + `src/storage/supabase/frozenBaselineStore.ts` (FAIL-SAFE read), `src/performance/comparators.ts` (Comparator_Strategies trend/returns-vol/coinflip through the IDENTICAL ledger+ExecutionModel; `compareStrategies()` surfaces a negative result plainly R5.4), `src/performance/calibration.ts` (band realized rates + overlap-discounted effective-N, `monotonic`/`wellCalibrated` R6), `src/walk-forward/walkForward.ts` (freeze-on-in-sample → measure-on-OOS → record baseline → flag reserved/tuned-against R7) + `src/walk-forward/pipelineForecastRegenerator.ts` (regenerates OOS forecasts via `evaluatePair` under the frozen `PipelineConfig`, signal never re-implemented R7.4) + property/unit tests. `make check` GREEN (846/6 skipped, +31). All four stages backend-only, offline read path (not wired into the daily run), live decision byte-identical; both new tables are additive + adapters fail-safe so a torn deploy is harmless. OPEN (operator sign-off): the two new tables (`trade_ledger` + `frozen_baselines`) await apply (tasks 5/9) + v3→v4 bump (task 15); the D1-ambiguity "report, don't guess" default (tasks 3/17) vs adding lower-timeframe sourcing. Next: deploy Stages C+D + apply both migrations (operator) OR proceed to Stage E (Aggregate_Exposure + Signal_Provenance, pure/unwired). |
| `multi-strategy-confluence-engine` | **Complete locally** (all 91 tasks `[x]`; final checkpoint task 26 PASSED — full unified `make check` exit 0: backend lint/typecheck + 1178 passed/7 skipped [the 7 skips are the opt-in Supabase integration suite], then web build + 267 passed/32 files). NOT deployed (operator merges dev->main; frontend + backend both ship via that path). The confluence feature is additive/output-only and was re-confirmed firing-neutral at the checkpoint — firing decision, Earned_Confidence, and every pre-existing snapshot slice are byte-identical with/without the confluence inputs (guard tests 15.5/17.2/19.2). | New spec adding four deterministic strategies (Trend EMA 20/50, Breakout Donchian 20, Range Bollinger+RSI14, Reversal extension/ATR/momentum) behind a shared `StrategySignal` contract alongside the existing `custom_pattern` + `third_party` signals, a pure Confluence_Engine (weighted net score in [-1,1]; `CONFLICT_FLAT` on strong opposing signals at the 0.6 Conflict_Threshold; alignment threshold 0.4; a score of exactly 0 is always NEUTRAL to preserve UP/DOWN symmetry; single signal never aligned), a per-pair `confluence` snapshot slice (schema v4->v5), and a keyboard-accessible Confluence_Panel matrix in the SPA. Built across 8 deploy-safe stages A-H. Confluence is advisory/parallel and NEVER changes the firing decision, Earned_Confidence, or the 0.55 threshold; everything labelled `unvalidated` / "Strength is not a probability"; all strategies look-ahead-safe. No live-cloud / migration tasks. Full per-task history in docs/state/CHANGELOG.md. |
| `mobile-dashboard-single-window` | **Complete locally** (all 48 tasks `[x]`; final checkpoint passed: web 394 tests + build, root `npm run check`; AppShell wired to SingleWindowShell, tab bar deleted; NOT deployed) | New feature spec: a mobile-first IA/visual-layout REFACTOR of the `web/` SPA. Replaces the 5-tab `BottomTabBar` with one progressive-disclosure "Master_Card" per pair (sticky Control_Bar; Verdict_Banner; per-pair 6-cell Confluence_Matrix sliced from the existing all-pairs grid, with the tested roving-tabindex keyboard model preserved; default-collapsed Daily-AI-note + Historical-evidence drawers), plus a compact All_Pairs_Strip at the top so cross-pair comparison survives the per-pair slice. STRICTLY presentation-only — every value stays sourced verbatim from the existing `web/src/pure/` shapers (`shapeDashboard`/`shapeConfluence`/`shapeSetupTrades`/`shapeEvidence`/`shapeDailyNote`); the Data-Invariance requirement pins the correctness property (rendered string == shaper output; shapers byte-identical before/after). Evaluated the brief against the real code and folded the findings in: it is a consolidation + per-pair re-slice (not greenfield — app is already mobile-first single-column); the un-validated SL/TP state must stay visually dominant (no live-order affordance), per the trader-edge-validation honesty rule; density win is consolidation keeping the separate evaluation/edge detail off the default path (the heavy tables are NOT on the Setups default view). DECISIONS: unified card at all viewport widths + bottom tab bar removed; keep cross-pair comparison via a top All_Pairs_Strip (vs per-pair-only). `requirements.md` now 12 EARS requirements (detailed + folded), format-valid; `.config.kiro` (feature, requirements-first). `design.md` authored (format-valid): 3 new pure helpers (`shapeAllPairsStrip`, `selectPairConfluenceRow`, `shapeBacktestEdge` over the existing `delta_vs_baseline`/`formatDeltaPp`) + new components (SingleWindowShell, ControlBar, AllPairsStrip, MasterCard, VerdictBanner, PairConfluenceMatrix reusing `nextCell` with rowCount=1, ContextDrawers/Accordion, BacktestEdgePill); the five shapers, `confluenceNav`, `format.ts`, `selection.ts` stay UNMODIFIED (enforced by a CI file-untouched check); `BottomTabBar` deleted, Gate kept as a separate evaluation detail view. Requirement 10 amended: invalid-URL fallback is mandatory, the 'selection unavailable' message is best-effort (no selection-store change). OPEN: banner/strip copy for a pair that did not fire (not in requirements). `tasks.md` authored (format-valid): 8 top-level tasks in 10 dependency waves, web/-only and deploy-safe (pure helpers + components UNWIRED first, then `SingleWindowShell`, then wire into `AppShell`, delete `BottomTabBar`/`TabRouter` last). Data invariance (Property 5) enforced by a required sha256 hash-fixture test over the 8 protected files; 10s timeout via promise race (not an abort signal) because `snapshotCache` shares one in-flight fetch. No-fire-pair copy lives in one constant (`pure/noSignalCopy.ts`), wording OPEN for operator. Task 1 DONE locally (new unwired pure modules + property tests under `web/src/pure/`); nothing wired or deployed. Task 4.1 DONE locally (`withTimeout` promise-race helper); nothing wired or deployed. |

Cross-spec note (RECONCILED — daily-candle R11.1): `dashboard-data-activation`
Task 16 ran `dashboard-ui` Task 17's read-only smoke against the then-live
Read_Proxy and recorded it done. The Read_Proxy and the `/api` rewrite were
LATER removed by `simplify-to-cloud-minimal` Phase 5 (the SPA now reads a static
public `dashboard.json` snapshot). The two documents are now consistent:
`dashboard-data-activation` Task 16 stays `[x]` (genuinely executed at the time)
with a reconciliation note recording the supersession, and `dashboard-ui` Task 17
is explicitly DEFERRED (superseded) rather than ticked — the smoke it describes
targets an architecture that no longer exists, and the current public read path's
liveness was proven under `simplify-to-cloud-minimal` task 8.

## 5. Build / test / CI

- `make check` ≡ `npm run check` ≡ `eslint . && tsc --noEmit && vitest run`.
  (The isolated Python cross-check and the `make check-all`/`py-*` targets were
  removed in `simplify-to-cloud-minimal` Phase 3 task 4; the TypeScript property
  test in `src/confidence/` is the sole authority for the shrinkage formula.)
- **CI** (`.github/workflows/ci.yml`): on every push/PR — two jobs. The
  `quality` job runs the backend gate (Node from `.nvmrc`, `npm ci`, then
  Lint / Type-check / Tests / Version-policy as distinct stages, no
  `continue-on-error`). The `web` job verifies the SPA (`web/` working dir, own
  lockfile cache: `npm ci`, `npm run build` = `tsc --noEmit && vite build`,
  `npm run test`). The SPA now carries `@types/node` with `"node"` in its
  tsconfig `types`, so the build type-checks the Node-built-in imports in its
  test files under a clean CI install. (The Python cross-check is not wired into
  CI.)
- **Version-policy stage (hardened).** The Version-policy CI stage
  (`scripts/version-policy.mjs`) now (a) audits BOTH the root AND the `web/`
  package trees for exact, non-prerelease pins (previously it only audited root),
  and (b) enforces `SUPPORTED_MAJOR_CEILINGS` (`typescript<=6`,
  `@types/node<=22`, `react`/`react-dom`/`@types/react`/`@types/react-dom<=18`,
  `recharts<=2`) via the pure `auditCeilings` logic in the shared
  `src/version-policy/audit.js` (typed by `audit.d.ts`, surfaced through
  `versionPolicy.ts` as `VersionPolicyCheck.auditCeilings`), failing CI
  (non-zero exit) if any pin exceeds its supported major. The ceilings are kept
  consistent with the `.github/dependabot.yml` ignore rules and exist because
  TypeScript 7 is blocked upstream (typescript-eslint peer stops `<6.1.0` until
  the TS 7.1 API) and React 19 / recharts 3 are deferred breaking migrations.
  Covered by `src/version-policy/ceilings.test.ts` (7 unit + 2 fast-check
  property tests).
- **Deploy** (`.github/workflows/deploy.yml`): on push to `main`, a two-target
  path-filtered pipeline. A `changes` job (`dorny/paths-filter@v3`) emits
  `backend`/`frontend` flags. BACKEND (gated on `backend`): full quality gate →
  keyless WIF auth → Cloud Build SHA-tagged image → Artifact Registry →
  `gcloud run jobs deploy` to the Cloud Run Job as a least-privilege runtime SA.
  Non-secret config via `--set-env-vars`; every secret via `--set-secrets`
  (`<name>:latest`) — no secret value in the file. As of
  `simplify-to-cloud-minimal` Phase 6 task 7 the `--set-secrets` list was
  simplified to the secrets a retained runtime module reads; as of
  `daily-candle-freshness-and-cleanup` Phase 1 (2026-11-03) it is SEVEN:
  `external-signal-api-key` (FCS), `twelve-data-api-key` + `massive-api-key` (the
  range-capable OHLC fallbacks the Candle_Freshness_Stage needs — do NOT re-drop
  them), `supabase-key` = the `fx_writer` Write_Credential,
  `supabase-publishable-key`, `supabase-url`, `supabase-pooler-url`. The provider
  secrets for removed subsystems (alpha-vantage, finnhub, news, news-calendar)
  remain dropped. No read-proxy/RLS/scoped-read/
  read-view step ever existed in this workflow to remove; the WIF deploy identity
  and both deploy targets are unchanged. FRONTEND (gated on
  `frontend`): `web-quality-gate` (build + tests) → `deploy-frontend`
  (`firebase deploy --only hosting` from `web/`), reusing the same keyless WIF
  identity, authenticating to firebase-tools via `GOOGLE_APPLICATION_CREDENTIALS`
  (ADC); no stored `FIREBASE_TOKEN` or SA key (the deprecated `FIREBASE_TOKEN`
  env was removed). A skipped path-filter gate cascades to skip its dependent
  deploy. The deploy SA was granted `roles/firebasehosting.admin` (live grant
  applied), which the frontend job requires.

## 6. Strategic decisions

The durable, append-only log of architecture/design decisions and their rationale.

**Moved to [`docs/state/DECISIONS.md`](docs/state/DECISIONS.md).** This section now lives in a satellite doc to keep
PROJECT-STATE.md a thin entry point. Update it there when the relevant change lands.

## 7. Obstacles / open risks

Open risks and obstacles, plus the dependency-vulnerability triage (former §9).

**Moved to [`docs/state/RISKS.md`](docs/state/RISKS.md).** This section now lives in a satellite doc to keep
PROJECT-STATE.md a thin entry point. Update it there when the relevant change lands.

## 8. Immediate next steps

The live to-do / what-comes-next list.

**Moved to [`docs/state/NEXT-STEPS.md`](docs/state/NEXT-STEPS.md).** This section now lives in a satellite doc to keep
PROJECT-STATE.md a thin entry point. Update it there when the relevant change lands.

## Notes on maintenance

This file is the **thin entry point**. It carries the machine-managed STATE block, §1 (what
this is), §2 (stack), §4 (spec status), §5 (build/CI), and links to the satellite docs under
`docs/state/` (CODE-MAP, DECISIONS, RISKS, NEXT-STEPS) plus the session-journal archive
`docs/state/CHANGELOG.md`.

The STATE block above is rewritten in place by `LivingDocs.updateState()` and by the
`update-living-docs` hook; it only ever touches the three lines between the BEGIN/END STATE
markers, so the markers must appear exactly once here. Keep the `Summary:` line SHORT — a
one-to-three-sentence "where we are right now". Do NOT paste per-turn narrative onto it; the
accreted journal that used to live there now lives in `docs/state/CHANGELOG.md`, and durable
detail belongs in the relevant satellite (§3/§6/§7/§8).

When a change, fix, or decision lands: update the STATE `Summary:` to the new one-liner, and
edit the affected satellite doc (and §4/§5 here if the spec-status/build picture changed).
Never write a secret value, key, token, or JWT into any of these files; reference credentials
by name only. Kill-gate verdicts belong in `RESEARCH-LOG.md` (via `appendVerdict()` /
`appendCut()`), never here. Hand-authored constraints belong in `LESSONS.md`.
