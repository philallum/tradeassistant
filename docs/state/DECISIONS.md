# Strategic Decisions

> Satellite of PROJECT-STATE.md. The log of durable architecture/design decisions and why.
>
> **How to read this file.** Entries are kept (never deleted) so the reasoning survives, but the
> file is **not strictly chronological**: the most recent entries were added at the top, older
> ones follow in the order they were written, and a few later entries sit at the bottom. When a
> later entry changes an earlier one, the earlier bullet is usually NOT edited - so use the
> **Decision Index** below to see what is still in force, and read the entry itself for the why.

## Decision Index

Status is taken from the log's own later entries and from the 2026-11-08 peer review. "Active"
means the decision is still how the system works; "Superseded" names what replaced it. Where an
entry mixes a live decision with a stale detail, the Note column says which part is stale.

| Date | Decision | Status | Note |
| --- | --- | --- | --- |
| 2026-11-10 | Conditional-edge research programme: lock last 12 months as holdout (subset of the existing holdout), report hit rate AND after-cost return, continue regardless of outcome, pattern redesign allowed only after the existing pattern is analysed | **Active (offline research, local only)** | Existing `evidenceProtocol.ts` unchanged; 2025-01-02..2025-09-15 released into exploration. See the entry below. |
| 2026-11-10 | Evidence-first hardening: pre-registered protocol, offline FLAT/alignment A/B, local in-memory evaluation, snapshot v9 (`runHealth`, `eventFlags`), static event calendar, GitHub heartbeat | **Active (repo, local only)** | Live FLAT definition, 0.55 line and firing unchanged; see the entry below. |
| 2026-11-10 | Lightweight upgrades: range guard (reject + log), data-health banner, record-of-fired-setups view, labelled invalidation distance | **Active (repo, local only)** | Invalidation distance is a deliberate, labelled reintroduction of one removed UI element. Not deployed. |
| 2026-11-09 | Intraday trigger 08:00 -> 07:00 London; schedule-vs-bar-boundary test | **Active** | Live Scheduler job still to be updated by the operator. |
| 2026-11-09 | Daily candles: stop trusting provider daily bars | **Active (repo)** | Implemented 2026-11-09: candles built from hourly bars on the 17:00 NY close; FCS dropped from the candle chain; repair tool added. Not deployed; history repair awaits operator approval. |
| 2026-11-08 | Codebase housekeeping: horizon-1-only contract, single `fires()`, verdict-path removal, replay guard, shared confluence matrix | **Active** | New (first entry below). |
| 2026-11-06 | Intraday 4H validation is a separate read-only Job | Active | Republish must key-replace only `intradayValidation` (see the data contract). |
| 2026-11-06 | Confluence: a zero score is always `NEUTRAL` | Active | |
| 2026-11-05 | PROJECT-STATE.md is a comprehensive reference (not a thin entry point) | Active | Supersedes the 2026-11-03 "thin" half of the living-docs split. |
| 2026-11-05 | Signal Scorecard records all six signals by dated persistence | Active | Third-party is withheld on a replayed date (2026-11-08). |
| 2026-11-04 | Dashboard simplification (SL/TP removed from the UI; expected candle size; one pair navigator; conviction tiers) | Active | Conflict threshold is now 0.5 (was 0.6). |
| 2026-11-04 | Decision_Date is the NEXT trading day for a run at/after the 17:00 NY close (Option B) | Active | Scheduler is now 17:30 NY (2026-11-06). |
| 2026-11-03 | Mobile redesign: single-window card at every width; tab bar removed | Active | |
| 2026-11-03 | Mobile redesign: All_Pairs_Strip for cross-pair comparison | Active | |
| 2026-11-03 | Mobile redesign: invalid-URL message is best-effort | Active | |
| 2026-11-03 | Living-docs split into a thin PROJECT-STATE + satellites | **Partly superseded** | "Thin" superseded by 2026-11-05; the satellite split stands. |
| 2026-10-07 | `fx_writer` uses a BYO imported ES256 signing key | Active | |
| - | Dimensional minimalism / gate-first build order | Active (principle) | The "kill-gate" is now an evaluation report with no verdict. |
| - | AI division of labor (scoring is AI-free) | Active | Enforced by types and guard tests; see 2026-11-08 for the re-pointed oracles. |
| - | Kill-gate reframe landed by addition, not rename | **Superseded 2026-11-08** | The legacy PASS/CUT path it retained was removed. |
| - | Supabase scoped-write credential (`pipeline_writer`) | **Superseded** | Replaced by `fx_writer` (2026-10-07, and the Option A cutover entry). |
| - | RLS + least privilege (`pipeline_writer`) | **Superseded** | Public-read model: no RLS, public select, `fx_writer` write. |
| - | Serving separation / read-proxy | **Superseded** | The read-proxy was deleted; the SPA reads a static snapshot (Public_Read_Path entries). |
| - | Live Cloud Execution Protocol | Active | |
| - | Automated, keyless, path-filtered deploys | Active | Now also redeploys the intraday Job. |
| - | CSV is backfill, not a feed | Active | The seed Job's deploy surface was removed 2026-11-08; the CSV library stays. |
| - | Display-only producers via `fetch`, not SDKs | Active | |
| - | Living docs stay live via two hooks + the in-code writer | Active | Hook prompts describe an older PROJECT-STATE layout - see RISKS. |
| - | Operator deployment constraints; the three refining decisions | Active | |
| - | Gate_Auto_Block and suppressors REMOVED; Phase 3 complexity removal | Active (history) | The firing rule is the single `fires()` predicate. |
| - | Write_Credential cutover (Option A); Phase 4 schema reduction; hosted schema reconcile (`...006`) | Active (history) | |
| - | Public_Read_Path = static JSON snapshot, realised as a public GCS bucket | Active | |
| - | Phase 6 deploy simplification; Audit §14 recommendations actioned | Active (history) | |
| - | OOS evaluation: honest model prediction + in-memory retrieval; first evaluation run inside the Cloud Run Job | Active | |
| - | Candle freshness via a provider fallback chain | Active | |
| - | Incremental CI/CD delivery cadence | Active | Operator merges `dev` -> `main`. |
| - | Supported-major dependency ceilings in CI; React 19 / TS 7 deferred | Active | The recharts ceiling was removed with the dependency (2026-11-08). |
| - | Dashboard "All pairs" cross-pair detail; silent no-fire day readout; daily AI note liveness signal | **Partly superseded** | The "All pairs" state and tab bar are gone (2026-11-03/04); the readout and note remain. |

## Entries
- **Research stage 5: measure context, not direction (2026-11-10, operator-approved; offline only).** Before any pivot to a context dashboard, each candidate statement (compression and ATR-level volatility forecasts, conflict means chop, trendiness persists, event-session ranges, stop distance) is tested with a pre-registered practical-size threshold as well as significance and stability, so only facts large enough to matter can be shown. Stops are compared by quantile (pinball) loss at 0.75 in ATR units. Pre-registered in `docs/research/PRE-REGISTRATION-5.md`. Result: volatility mean reversion, event-session width and an ATR-based stop are usable; the rest are not.
- **Research code kept out of the repository (2026-11-10, operator decision).** `src/ops/research/` is added to `.gitignore` so it cannot reach `main` or production by accident; the pre-registrations, evidence reports and living docs are pushed. The code lives in the local working tree as ignored files, with a local backup branch `research/edge-bench` that must never be merged (it tracks the code, so merging would bring it in). No shipped module imports it, so CI and the deploy are unaffected.
- **Research stage 4: score rule strategies on excess over their long/short mix (2026-11-10, operator-approved; offline only).** The four live rule strategies are tested on 3/5-session holds and the 1 x ATR bracket with their live settings and fixed exits, nothing tuned. The pre-registered statistic is hit rate minus `u*r + (1-u)*(1-r)` (u = share of long calls, r = share of up outcomes on the same days), so leaning with a multi-year USD trend is not credited as timing skill. Pre-registered in `docs/research/PRE-REGISTRATION-4.md`. Result: none of 12 tests significant; reversal held 5 sessions is recorded as a lead only (see RESEARCH-LOG, NEXT-STEPS).
- **Pattern research stopped; research tooling kept local (2026-11-10, operator decision).** Three pre-registered evidence reports found no edge, so nothing from the research programme goes to production. The tooling in `src/ops/research/` and the reports in `docs/research/` are kept in the local repo as a backtest bench for future pattern ideas, to be run before anything is deployed. The locked holdout (2025-09-16..2026-09-15; treat 2025-09-16 as seen) stays unread for that future use. The live system is unchanged; whether the live dashboard keeps showing the pattern call is a separate, not-yet-made decision.
- **Research stage 3: change the outcome, not the inputs (2026-11-10, operator-approved; offline only).** Test 3- and 5-session holds and a symmetric 1 x ATR target-before-stop bracket. For each outcome the pattern's call is the majority of its analogues' own result for that same outcome (an analogue votes only once its outcome window had closed by the decision date), so the question and the evidence match. Ambiguous bracket days count as losses; swap is not modelled; bootstrap blocks are calendar months because 5-day windows overlap. Pre-registered in `docs/research/PRE-REGISTRATION-3.md`. Result: nothing significant; see RESEARCH-LOG.
- **Research stage 2: setup families + redesigned encodings, price only, XTB costs (2026-11-10, operator-approved; offline only).** The pattern is measured as a CONDITION on the four rule strategies' setups (breakout, reversal, range, trend) as well as an encoding change: chart features a trader judges by eye (range position, distance from averages, swing structure from confirmed pivots, candle body/wicks/close position, compression, channel excursion) are added to the analogue embedding. Tick volume excluded (price only). Research costs are `xtb-standard-v1` (XTB standard account, spread only, BrokerChooser averages plus exec-v1 slippage); `exec-v1` remains the repo default elsewhere. Variants use a fixed k=30 so the encoding is the only thing that changes against the V0b control. Pre-registered in `docs/research/PRE-REGISTRATION-2.md`. Result: nothing significant; see RESEARCH-LOG and CHANGELOG.
- **Conditional-edge research programme (2026-11-10, operator-approved; offline only, nothing deployed).** Question: where, if anywhere, does the existing pattern signal have an after-cost edge, instead of adding features. Choices: (1) report direction hit rate AND after-cost return (exec-v1 costs, 1.0-1.5 pips per trade; no broker figures supplied) in every slice; (2) lock the LAST 12 MONTHS (2025-09-16..2026-09-15) as the holdout, consulted once per frozen configuration; this is a strict subset of the existing untouched confirmation holdout, and 2025-01-02..2025-09-15 is released into exploration, so `evidenceProtocol.ts` is unchanged and the new split lives in `src/ops/research/researchProtocol.ts`, enforced by a guard that throws; (3) continue regardless of outcome (no stopping rule), record negative results as findings; (4) pattern redesign is in scope but sequenced AFTER analysing the existing pattern, so results can be attributed; (5) Benjamini-Hochberg at q=0.10 within pre-registered families, block bootstrap by calendar week, a cell needs 200 scored days to be called significant; (6) the 4H study scores the move REMAINING after the 07:00 UTC read, because scoring against the full session counts the same move twice. Rejected: adding indicators, DXY, ML or AI direction, more voting strategies. Evidence Report 1 (docs/research/EVIDENCE-REPORT-1.md) found no candidate edge. Pattern-variant work (Tasks 8-9) and the holdout run (Task 10) are gated on operator review.
- **Lightweight upgrades from an external suggestion review (2026-11-10, operator-approved scope: the "good" and "low effort" items plus the invalidation distance).** Each suggestion was checked against the code and the project's measure-first rules. Built:
  - **Candle range guard, reject-and-log.** `validateRange` (`src/ingestion/rangeGuard.ts`) rejects a daily candle whose high-low range is below 10% or above 8x the trailing (60-candle) median range of the same pair, using only earlier candles; it is skipped with fewer than 20 prior candles so seeding/backfill never fails. Wired in `OhlcIngestion.ingest`, the single write path (CSV backfill, freshness stage, candle-repair), so a rejected candle is not stored, appears in `IngestReport.errors`, and logs `candle_ingest.range_rejected`. Rejected alternative: store-and-flag (needs a schema change). Constants are measurement inputs, not signal knobs; a structural test pins that no scoring module imports the guard. Complements, does not replace, the structural checks in `sessionAggregation.ts`.
  - **Data-health banner.** Pure `shapeDataHealth` over the already-published `provenance` slice (a declared `holiday` is not a delay), with a 5-day snapshot-age fallback when provenance is empty; non-blocking, dismissable `DataHealthBanner` in `SingleWindowShell`. No schema change.
  - **Record of fired setups.** Pure `shapeHitRateHistory` over `realizedOutcomes` (matured, decided, non-FLAT only; a realized FLAT counts as not right), by pair and by 0.05 confidence band with n and a small-sample flag, on the Evaluation detail view. Labelled "Historical record of fired setups. Not a probability." The journal has no strategy dimension (single engine), so "by strategy" became by pair and band.
  - **Invalidation distance (deliberate reintroduction).** The 2026-11-04 simplification removed SL/TP from the UI. At the operator's request one element returns: the persisted `stop_loss_pips` (75th percentile of the neighbourhood's adverse excursion, measured from the next session's open over one session) is shown as "If price falls/rises X pips below/above the next session's open before that session closes, this pattern thesis is invalidated", tagged "unvalidated" with a visible note "Not a stop recommendation". Take-profit and expectancy stay out of the UI. It is a separate view model (`shapeInvalidation`) so `shapePairSummary` still exposes no stop-style field. No percentile or pinned constant changed. Caveat: RISKS finding 1 (FLAT dead-band unit mismatch) may skew the underlying MAE.
  - **Deliberately NOT built:** Platt/isotonic calibration (run operator `edge-eval` first; C has a narrow range and overlapping windows inflate n), an intraday-delta filter or highlight (thresholds are provisional and unvalidated), a 1-to-3 session holding-period expectation (retrieval is horizon-1 only), a currency-basket confluence signal and real DXY/yield data (no feed in the runtime; a new signal needs weight 0 until validated).

- **Evidence-first hardening after the external review (2026-11-10, operator-approved plan, implemented locally).** Principle: measure before believing, change nothing live until the evidence is recorded and the operator decides. Decisions: (1) **FLAT dead-band: measure, do not change.** The resolver gained `flatBandMode` (`legacy` default = live, `atr_pips` = intended 0.5xATR in pips) and `labelAlignment` (`after_decision_date` default = live, `on_decision_date`); both are offline-only, golden-tested to leave the default byte-identical. Result: neither beats the live definition, so no change is proposed. (2) **Evaluations run on a LOCAL in-memory copy** built from `data/*_D1.csv` through the production encoder and resolver, not on Postgres+pgvector and not on hosted: retrieval cosine is client-side in both backends, so results are the same, and it needs no database or egress. Rejected: hosted with `ALLOW_HOSTED_BACKTEST=1` (quota history), local Supabase (heavier, adds nothing). (3) **Pre-registration is code**: `evidenceProtocol.ts` fixes the forward-test start, the discovery window, an untouched confirmation holdout and the slice dimensions; a test fails if the live parameters drift (tuning must reset the clock) and no default window may overlap the holdout. A candidate pocket only counts if it holds on the holdout, consulted once per written-down hypothesis through `confirmPockets`; formal FDR correction rejected as over-engineering, replaced by always quoting the number of cells examined. (4) **Snapshot v9 carries `runHealth` and `eventFlags`**, appended after v8 with lenient web parsers; v9 is undeployed so both ride the one bump. (5) **Silence is information**: one named reason per silent pair (`DATA_BEHIND`, `THIN_NEIGHBOURHOOD`, `NO_DIRECTIONAL_VIEW`, `BELOW_THRESHOLD`); the wording says "few similar setups (30 or more is more reliable)" rather than implying a hard floor, because the floor is not enforced. (6) **A pair whose candles are still behind after the freshness stage is WITHHELD (operator decision 2026-11-10; supersedes "a stale run still publishes" for that pair).** The run still publishes and exits 0; only the affected pair makes no call: `PairEvaluation.withheld` makes the single firing predicate `fires` return false, the pair surfaces as silent with reason DATA_BEHIND, its published evaluation row is FLAT/0.5 (so the intraday Job does not validate a stale reading), the scorecard records no custom_pattern signal and no realized-outcome row is written, which keeps data failures out of the forward record. Trigger = `degraded || residualGap` only (not a provider fallback). Healthy days are byte-identical (`withholdBehindPairs` returns the loader unchanged). The banner is driven by `runHealth` and a missed-run check on the Decision_Date. (7) **Event calendar is a caution flag only**, never a scoring input (guard test: no live-path module imports it; firing byte-identical). Sources: Fed (official), ECB (official, Dec 2026 onward plus six 2026 meetings), US jobs report by the BLS rule (reproduces every confirmed date but marked `basis: "rule"`; BLS pages could not be fetched). Earlier ECB years are not listed. (8) **Heartbeat via a scheduled GitHub workflow, not Cloud Monitoring**: a once-per-weekday job cannot be expressed as a log-absence alert (window about a day, no weekend awareness). It compares the published Decision_Date with the date the last due run should have produced, so the intraday republish cannot mask a miss; needs the repository variable `DASHBOARD_SNAPSHOT_URL`. (9) **Hourly bars are archived, not yet in the daily path**: `hourly_candles` migration, fail-safe adapter and a Twelve Data observer exist; wiring them into the Job is a separate operator decision. (10) **Trade-sim entry-session fix** (dormant code): the path now starts at the entry session. (11) Deliberately not built: position-sizing calculator, correlation matrix (the currency-leg exposure card already shows USD stacking), formal FDR correction.

- **Intraday trigger moves from 08:00 to 07:00 Europe/London, and a test now forbids a trigger near a 4H boundary (2026-11-09, operator decision after the first scheduled run validated 0 of 5 pairs).** The Job needs the forming 4H bar to already exist at the provider; 08:00 London is exactly on the 08:00 UTC boundary in winter, so nothing was published. The operator wanted it earlier than 08:30 ("before I get to my desk") and to use the 04:00-08:00 UTC candle. 07:00 London is 3 h into that bar in winter and 2 h in summer. Rejected: 08:30 (too late for the operator); a code-side wait/fallback for a not-yet-published bar (more machinery than a schedule fix, can be added later); renaming the Scheduler job (the name `intraday-validation-run-0800-uk` is kept and documented as historical to avoid a create/delete). `intradaySchedule.test.ts` reads the committed config and requires >=30 min clearance from a boundary in both GMT and BST. NOT yet applied to the live Scheduler job (operator-gated).

- **Daily candles: stop trusting provider "daily bars" (2026-11-09, DECIDED by "fix this"; deployed and history repaired live 2026-11-09).** See RISKS "DAILY CANDLE DATA INTEGRITY". The recommendation under consideration is to derive each completed daily candle from hourly bars on the system's own 17:00-NY session boundary (the convention the stored history and `sessionBoundary.ts` already claim) and to store a session only after it has closed, rather than adapting three providers' differing day boundaries and labels. Alternatives weighed: (a) minimal patch - drop FCS from the OHLC chain and request several Twelve Data bars, then ingest only the target date (fast, but leaves a 2-hour boundary mismatch with the stored history and Sat/Sun bar handling); (b) keep daily endpoints but add completeness/shape validation (a range sanity check would have caught 11-04, not the mis-dated 11-05).

- **Codebase housekeeping after the 2026-11-08 peer review: same behaviour, less complexity, honest docs (spec `codebase-housekeeping`).** A full senior-developer review found the code in good shape and the *documentation* the main debt. The decisions, each approved by the operator:
  - **Horizon-1 only, documented, not changed (R1).** `retrieve()` returns one record per analogue date (the smallest horizon), so horizons 2 and 3 are never populated and a firing pair always reports horizon 1. Rejected: (b) removing the dormant 1/2/3 selection (closes off real multi-horizon, touches `selectHorizon` and its property tests) and (c) making all three horizons real (changes confidence, firing and the headline +1.24pp result; not housekeeping). The behaviour is pinned by `src/retrieval/horizonContract.test.ts`; real multi-horizon is a separate future spec.
  - **Replay guard for the live third-party read (R2).** FCS `/forex/latest` is a live value, so recording it under a replayed `RUN_DECISION_DATE` would score today's value against an old date. On a non-live Decision_Date (`isLiveDecisionDate`) the scorecard omits ONLY `third_party` and logs `signal_scorecard.third_party_skipped`. The normal scheduled run is byte-identical.
  - **One firing predicate.** `fires(evaluation, threshold)` in `src/dashboard/dashboard.ts` is the only definition; persistence, the snapshot's `pairEvaluations`, the daily-note input and the walk-forward regenerator call it (five copies existed and had drifted in how they obtained the threshold).
  - **The legacy PASS/CUT verdict path is removed.** `composeGateVerdict`, `GateVerdict`, `GateVerdictStore`, `persistGateVerdict`, the Supabase `gate_verdicts` adapter, `ops/gate-run` and the staged-runner `backtest`/`forwardLook`/`runAll` stages had no production caller (the live write path is `composeEvaluationReport` -> `evaluation_reports`). Kept: `staged-runner` `backfill`/`buildFoldInputs`/`hasBacktestData` (used by `ops/hosted-backfill` and `ops/evaluation-run`), `composeEvaluationReport`, `gate1`, `gate2`, `walkForward`, and `LivingDocs.appendVerdict/appendCut` (now unused by code; left for a later decision). **The four boundary tests that used `composeGateVerdict` as their oracle were re-pointed to `composeEvaluationReport` BEFORE the removal** so the "LLM / confluence / third-party / journaling cannot change the Kill_Gate" guarantee never lapsed; a temporary mutation confirmed all four still fail on a leak.
  - **Seed job: deploy surface only.** `ops/seed-job.config.json` and the Dockerfile `data/` copy were removed; `csv-loader` and `data/*.csv` stay for the operator backfill tools and tests. Deleting the orphaned Cloud Run Jobs/images/service accounts is an operator checklist in `docs/RUNBOOK.md`, never an agent action.
  - **The per-run Confluence_Matrix is built once** (`buildRunMatrix`) and shared by the `confluence` slice and the Signal Scorecard. They had two independent assemblers that already differed (one warned on a failed candle load, the other dropped the pair silently).
  - **Silent skips now speak.** Every fail-safe step that degrades logs a named, secret-free event (`candle_freshness.encode_skipped`, `scheduled_run.pipeline_warning`, the track-record deadline, the intraday fallback read). Provider failure messages are redacted (`src/ingestion/redactSecrets.ts`) because every candle client puts its API key in the request URL.
  - **Per-step timing is logged first; no optimisation yet.** Candle history is read many times per run, but nothing has been measured, so memoisation is deferred until `scheduled_run.step_timing` shows it matters.
  - **`ops/scheduler-job.config.json` and the keep-list manifest now say `30 17 * * 1-5`**, matching the operator-confirmed live cron (2026-11-06); they had still said `0 17`.
  - **Not changed (deliberately):** the firing rule and 0.55 threshold, shrinkage constants, look-ahead guards, sequential pair evaluation, fail-safe reads, the `buildDashboardSnapshot` signature, `makePipelineLoader`, exact dependency pins and the version-policy audit.
  - **Deferred:** real multi-horizon, candle-store memoisation, a visible "data behind" banner, moving the Lean/Split conviction tiers server-side, a web linter, and removing the dormant offline evidence layer.

- **Intraday 4H validation is a SEPARATE read-only Job, not a daily-pipeline step (2026-11-06, `intraday-validation` feature, from a reviewed plan).** The ask: a few hours after the immutable daily prediction, check whether the currently-forming 4H candle supports or contradicts the original daily direction — WITHOUT a second forecasting system and without touching the daily engine. Key decisions, each confirmed with the operator during planning: (1) a SEPARATE ~08:00-UK Cloud Run Job (second Scheduler trigger) that reads back the persisted daily prediction, computes validation, and republishes `dashboard.json` — the 17:00-NY daily Job is byte-unchanged (an isolation regression test enforces it). (2) Twelve Data is the SOLE intraday 4H provider (reuses `TWELVE_DATA_API_KEY`) via a NEW isolated client, because all three existing OHLC adapters hard-code the daily timeframe and floor to a UTC day — so a 4H path is genuinely new code, kept entirely out of the daily ingestion/provider-chain. (3) The forming bar is derived from the FIXED UTC 4H boundaries (00/04/08/12/16/20) with a staleness guard, NOT a fixed offset, so UK/NY DST is handled automatically. (4) Produce validation STATE plus a BOUNDED, symmetric, deterministic confidence delta (±10pp, five states), displayed as an "unvalidated adjustment" — explicitly NOT a calibrated probability ("strength is not a probability"); the original Earned_Confidence is stored untouched and the delta/current stored separately. (5) Validate EVERY pair's deterministic direction (incl. FLAT→NOT_APPLICABLE), so a silent day still shows a validation state. (6) Thresholds (0.25/0.5 body-to-range, 0.66/0.34 price position) and delta magnitudes are PROVISIONAL and centralized for a future evidence-based tune; the features are persisted so usefulness can be MEASURED later before any accuracy claim. Everything fails safe: any provider/data/write failure degrades to "validation unavailable" with the daily forecast byte-identical. Implemented following the project's additive-migration + storage-port + append-LAST-snapshot-slice + pure-shaper patterns; schema bumped to v8.

- **PROJECT-STATE.md repurposed from a thin entry point into a comprehensive project reference (2026-11-05, operator request; SUPERSEDES the "keep it thin" part of the 2026-11-03 living-docs-split decision below).** The 2026-11-03 split made PROJECT-STATE.md a thin pointer (STATE block + a few sections + links) with all durable prose in `docs/state/` satellites. The operator now wants PROJECT-STATE.md itself to be the single shareable document that gives someone a complete, accurate understanding of the system (tech stack, architecture, the real calculations/formulas, data model, ops) to onboard from and plan enhancements against. Decision: keep the satellite split for LIVE CHURN (CODE-MAP per-module detail, DECISIONS, RISKS, NEXT-STEPS, CHANGELOG remain the auto-updated homes, linked not duplicated) BUT expand PROJECT-STATE.md's body into a durable reference (architecture-at-a-glance, daily-run flow, a "how the calculations work" section with verbatim formulas/constants, data model, how-to-extend patterns). The machine-managed STATE block is unchanged and still the ONLY region the Living-Docs Writer / `update-living-docs` hook touches (markers verified unique), so automation and the new reference coexist. Tradeoff accepted: the new prose includes a few hand-maintained durable facts (schema version, deployed specs, deploy-secret list) that must be refreshed on a schema bump / new spec — flagged in the document's own preamble. This does not re-bloat the STATE `Summary:` line (per-turn narrative still goes to CHANGELOG).

- **Signal Scorecard records all six signals by DATED PERSISTENCE, not replay (2026-11-05, signal-scorecard feature, no spec).** The ask: keep a permanent record of which of the six signals (trend, breakout, range, reversal, custom_pattern, third_party) was historically right or wrong — register each signal's UP/DOWN/FLAT direction for a pair on a Decision_Date, then on a later run record the actual next-session outcome. The existing `trackRecord` snapshot slice already answers "how often was this signal right lately" for the FOUR classical strategies by look-ahead-safe REPLAY (they are pure functions of candles), and for `custom_pattern` from its fired-day realized-outcome journal. Decision (operator: "all six uniformly"): add a NEW dated recorder rather than extend replay, because `third_party` is a LIVE external read that CANNOT be reconstructed after the fact and `custom_pattern`'s journal misses non-fired days — only recording the day's directions and reconciling the next session captures all six honestly in one ledger. Implemented additively: a `signal_predictions` table (PK `(decision_date, pair, strategy_id)`), a fail-safe `SignalPredictionStore` (torn-deploy-safe reads), `recordPredictions` (copies each AVAILABLE Confluence_Matrix cell's direction — no new signal computed) and `reconcileOutcomes` (fills the realized side via the SAME shared `realizedDirectionAfter` rule the replay record uses — sign of the next session's open-to-close; FLAT is an unscored abstention), wired fail-safe into the scheduled run AFTER the firing rows persist. Scoring isolation upheld: it writes only its own table, feeds nothing the firing/confidence/Kill_Gate path reads, and takes no LLM input (standing-guard + strategies import-boundary tests still green). The replay-based `trackRecord` slice is deliberately KEPT (redundant for the four pure strategies, but zero-persistence and already working); surfacing the recorded scorecard on the dashboard (a snapshot slice + web card) is deferred.

- **Dashboard simplification: remove what cannot be validated, show what can be measured (2026-11-04).** (1) SL/TP/net expectancy are removed from EVERY UI surface (main card and Evaluation view); backend derivation, ledger and `PerformanceSummary` stay for research, and `edge-eval` keeps appending the after-cost figures to RESEARCH-LOG. Reason: daily bars cannot establish which level is hit first, net expectancy was one system-wide ledger number copied onto every pair, and the measured OOS edge (+1.24pp) leaves after-cost expectancy near zero. (2) Replace with an analogue-based, PAIR-RELATIVE expected candle size (Small/Medium/Large by terciles of the pair's own span/ATR history; range = P25-P75 of neighbourhood ratios x today's ATR), scored daily by replay. Direction-free, display-only. (3) One pair navigator: the All_Pairs_Strip; `PairSelector` and the "All pairs" state are gone. (4) Conviction tiers replace "Neutral": Aligned (engine consensus), Split (engine CONFLICT_FLAT or an exact up/down tie), Lean (majority below the alignment bar), No view; the vote tally is always shown; no direction colour while un-validated. (5) Per-strategy track records come from deterministic look-ahead-safe replay (no new persistence); realized direction is scored by the SIGN of the next session's open-to-close move so records are comparable with the project's headline accuracy (see RISKS for why not a 0.5xATR dead-band). (6) Conflict threshold 0.6->0.5, alignment stays 0.4: measured over ~1500 days x 5 pairs, no threshold pair improves the hit-rate of aligned classical calls (45-48% vs ~51% base rate), so this is a clarity change, not an accuracy claim; rationale is that a firing pattern's strength (shrunk confidence >= 0.55, typically 0.55-0.65) was mostly below 0.6, so the core signal was excluded from conflict detection. Regime-based weights and a 4h timeframe are explicitly deferred (no evidence yet; would add inputs to a system with a +1.24pp edge).

- **Mobile redesign: invalid-URL message is best-effort; selection store contract unchanged (2026-11-03, `mobile-dashboard-single-window` design).** `parseSelectionFromSearch` discards rejected raw `pair`/`date` values and defaults to the `ALL` sentinel, so the UI cannot reliably know a value was rejected. Decision (operator): keep `state/selection.ts` byte-unchanged. Requirement 10.3 (fall back to EURUSD / Latest_Decision_Date, keep any valid field) is mandatory and implemented in `SingleWindowShell` (maps `ALL` to EURUSD); Requirement 10.4 (message that the selection was unavailable) is best-effort, absence is not a defect. Design also fixed: the five shapers + `confluenceNav` + `format.ts` stay unmodified (CI file-untouched check enforces data invariance); backtest edge pill reads the existing `delta_vs_baseline` via `formatDeltaPp`.

- **Mobile redesign keeps cross-pair comparison via a top All_Pairs_Strip, not per-pair-only (2026-11-03, `mobile-dashboard-single-window` requirements).** Slicing the confluence view down to the SELECTED pair (the brief's Zone 3) would drop the at-a-glance all-five-pairs scan the current 5-pair × 6-strategy grid provides. Decision (operator): add a compact All_Pairs_Strip at the top of the single window — one entry per pair showing Direction (with a non-colour cue) + net Confluence_Score, display-only and sourced verbatim from the shapers, selecting an entry drills into that pair's Master_Card. Rejected alternatives: per-pair-only (lose the scan) and a collapsible all-pairs drawer (comparison one tap away but not glanceable). Captured as the new Requirement 4. Two further findings from the brief-vs-code evaluation were folded into existing requirements rather than new decisions: (a) the un-validated SL/TP state must stay visually dominant with no live-order affordance (Verdict_Banner criteria, upholding the trader-edge-validation honesty rule); (b) the per-pair confluence slice must preserve the EXISTING tested roving-tabindex keyboard model (arrow/Home/End move focus without selecting, single Tab stop, Escape dismiss — real in `web/src/pure/confluenceNav`) rather than invent a new tap-to-reveal.

- **Mobile dashboard redesign is a unified single-window card at EVERY viewport width; the bottom tab bar is removed (2026-11-03, `mobile-dashboard-single-window` requirements).** The redesign replaces the 5-tab `BottomTabBar` layout with one progressive-disclosure "Master_Card" per pair. The open question was whether desktop keeps the old tabbed view. Decision (stakeholder, via the requirements clarification): the unified card is the ONLY layout at all widths and the bottom tab bar is removed entirely — not merely hidden on narrow viewports (Requirement 1, criteria 4-5). Paired with the hard scope rule that this is a PRESENTATION-ONLY refactor: all displayed values remain sourced verbatim from the existing `web/src/pure/` shapers, and Requirement 8 pins the invariant as a correctness property (rendered string == shaper output; each shaper byte-identical before/after for identical Snapshot input) so the later property-based tests can enforce it.

- **Confluence_Engine: a zero Confluence_Score is always `NEUTRAL` (2026-11-06, `multi-strategy-confluence-engine` task 16).** The engine's ≥2-contributor classification used `score >= alignmentThreshold ? ALIGNED_UP : score <= -alignmentThreshold ? ALIGNED_DOWN : NEUTRAL`. At the degenerate point `alignmentThreshold = 0` with a net score of exactly `0`, the `>=` arm claims the zero for ALIGNED_UP before the `<=` arm runs, so a zero score is labelled ALIGNED_UP on BOTH a signal set and its UP<->DOWN-flipped twin — violating the UP/DOWN symmetry invariant (Requirement 9.8). This is a latent contradiction in the requirements: criteria 9.3 (`score >= alignmentThreshold`) and 9.4 (`score <= -alignmentThreshold`) both admit `score = 0` when the threshold is 0, while 9.8 demands symmetry. Decision: a Confluence_Score of exactly 0 carries no directional lean and is ALWAYS `NEUTRAL`, regardless of the alignment threshold; every non-zero score follows 9.3/9.4 unchanged. This resolves the overlap in favour of the stronger, intentional symmetry guarantee (and is consistent with 9.5 and the Score_Gauge being centred at 0). Caught by the Property 20 metamorphic test during the Stage E green checkpoint; Property 19's boundary oracle was updated to the same rule, and design.md step 7 + the symmetry note record it. Behaviour is unchanged for all non-zero scores and the default config (`alignmentThreshold = 0.4`).

- **Living-docs split into a thin PROJECT-STATE.md + `docs/state/` satellites (2026-11-03).** PROJECT-STATE.md had grown to ~1150 lines / 172 KB, almost entirely because the machine-managed STATE block's `Summary:` line had accreted every turn's narrative. Decision: keep PROJECT-STATE.md as a thin entry point (STATE block + §1 what-this-is, §2 stack, §4 spec-status table, §5 build/CI, and link stubs for the rest) and move the heavy, slower-changing prose verbatim into satellites: `docs/state/CODE-MAP.md` (§3), `DECISIONS.md` (§6), `RISKS.md` (§7 + the §9 dep triage), `NEXT-STEPS.md` (§8), and `CHANGELOG.md` (the per-turn journal that used to bloat `Summary:`). The STATE `Phase`/`Summary` lines are now kept to 1–3 sentences. Constraint respected: the Living-Docs Writer (`LivingDocs.updateState`) still only rewrites the 3 lines between the `<!-- BEGIN/END STATE -->` markers, which remain unique in PROJECT-STATE.md — its 32 tests pass unchanged. Both hooks (`keep-project-state-live.json` Stop, `update-living-docs.kiro.hook` postTaskExecution) were updated to route per-turn narrative to CHANGELOG.md and durable detail to the correct satellite, so the monolith can't silently re-bloat. Result: PROJECT-STATE.md ~221 lines / 35 KB.

- **`fx_writer` write credential uses a BYO imported ES256 signing key (operator-approved, 2026-10-07).** Task 5.2a.3 assumed `fx_writer` could be minted offline with the project's own signing key "the same asymmetric-key model as the `pipeline_writer` JWT". Live reconciliation showed the active hosted signing key (`680889e6-…`, ES256/P-256, `in_use`) is Supabase-managed and non-exportable, so offline minting against it is impossible, and the BYO-key material once in `.env` is stale/revoked (`f85d3e2d-…`) or not a usable key. Decision: generate a fresh P-256 keypair locally, import its PRIVATE JWK into Supabase as a STANDBY key (so JWKS publishes the public half for PostgREST verification) and mint the `fx_writer` token locally with the matching private key (header `kid`=the standby key id). Service-role writing was rejected (bypasses RLS; reserved for operator one-offs). This preserves the PostgREST scoped-JWT model while adapting to Supabase's current managed-key reality. Private key lives only in gitignored `ops/fx-writer-key/` and is never committed or logged.

- **Dimensional minimalism / gate-first build order.** The kill-gate was built
  before feature discovery so the first thing the project learns is whether a
  shape-only daily pattern even beats the weekly trend. Features are added one at
  a time, each must pass both gates, failures are cut and logged.
- **AI division of labor.** Scoring and gate verdicts are AI-free by
  construction; a `ScoringInputGuard` + property test assert no LLM output
  reaches those paths.
- **Kill-gate reframe landed by addition, not rename (simplify task 1).** The
  human-read `EvaluationReport` + `composeEvaluationReport` were added beside
  the legacy `composeGateVerdict`/`GateVerdict` PASS/CUT path rather than
  renaming it, because the legacy verdict is still wired into
  `src/staged-runner/`, `src/ops/gate-run/`, and `web/`. This keeps the
  'measure-first, keep the loop green at every step' sequencing honest; the
  transitional legacy path is removed in tasks 2/2.1 (persistence + Living-Docs
  retargeted to `evaluation_reports` with no verdict column). The gate math
  (`evaluateGate1`/`evaluateGate2`, walk-forward pooling) is unchanged.
- **Supabase scoped-write credential.** The pipeline writes using an **ES256 JWT
  signed with an operator-held BYO asymmetric key**, role claim
  `pipeline_writer`, stored as the `supabase-key` Secret Manager secret.
  `SupabaseRestClient` splits `apikey` (publishable/anon — API-gateway
  admission) from `Authorization: Bearer` (the scoped JWT — the write path). The
  RLS-bypassing service-role key is reserved for operator one-offs and is never
  stored as `supabase-key` or referenced in `deploy.yml`.
- **RLS + least privilege.** RLS is enabled on the compute-written tables; the
  `pipeline_writer` role has SELECT/INSERT/UPDATE but **no DELETE**. Migrations
  `...002` (scoped write) and `...004` (gate tables grant) establish this; `...004`
  had to precede the live Gate_Run or its writes would be refused.
- **Live Cloud Execution Protocol.** `OperationalSafety` + `GcloudRunner`
  reconcile the active gcloud project/account and Supabase target before any
  live op, require operator approval showing the exact command, pass secrets
  only on stdin (never argv/logs/commits), and record only non-secret
  references.
- **Serving separation.** The SPA is strictly read-only; only the read-proxy
  touches Supabase, through a fixed allowlist with a SELECT/GET-only client. A
  `servingLayerGuard` test enforces the compute/storage/serving boundary.
- **Automated, keyless, path-filtered deploys for both targets.** The frontend
  SPA deploys to Firebase Hosting on merge to `main` (previously manual), via the
  same `deploy.yml` as the backend Cloud Run Job. A `dorny/paths-filter` job
  routes backend-only vs frontend-only commits so each target redeploys only
  when its own files change (a workflow-file change triggers both). Both deploys
  are keyless — the frontend reuses the backend's Workload Identity Federation
  identity and passes a short-lived OAuth access token to firebase-tools rather
  than storing a long-lived `FIREBASE_TOKEN` or SA key, keeping the frontend's
  security posture consistent with the backend's. The SPA also gained CI
  coverage (the `web` job), closing the prior gap where a broken frontend could
  merge undetected.
- **CSV is backfill, not a feed.** `ops.config.json` records
  `Data_Source_Role = { csv: { role: "backfill" } }` — run once to seed history,
  not a recurring source.
- **Display-only producers wired via `fetch`, not SDKs.** Both the Gemini
  rationale (Req 15) and the third-party reference (Req 23) are reached over the
  built-in `fetch` against REST endpoints rather than vendor SDKs. This keeps the
  core's zero-runtime-dependency property and lets the Gemini adapter live in the
  single sanctioned `src/llm` layer without tripping the import-boundary guard
  (which forbids SDK packages anywhere in `src/`). Both producers are optional
  and fail-safe: an unconfigured or failing provider degrades to "no rationale" /
  "reference unavailable" for the affected pair and never blocks the deterministic
  firing view from being persisted. Weekday gating is defence-in-depth: the
  scheduler cron is restricted to Mon–Fri (`0 17 * * 1-5`) and `main.ts`
  additionally early-exits on a weekend Decision_Date.
- **Living docs stay live via two agent hooks + the in-code writer.** The
  machine-managed STATE block is owned by `LivingDocs.updateState()`; the prose
  is kept current by two Kiro hooks in `.kiro/hooks/`:
  `keep-project-state-live.json` (trigger `Stop`) fires after any turn with a
  meaningful change/fix/decision, and `update-living-docs.kiro.hook` (trigger
  `postTaskExecution`) fires at spec-task boundaries. Both edit only the STATE
  block's three lines plus the affected prose, never write secrets, and leave
  RESEARCH-LOG.md (kill-gate verdicts) and LESSONS.md (constraints) alone. The
  literal BEGIN/END STATE marker strings appear exactly once in this file so the
  writer's first-match lookup targets the real block.
- **Operator deployment constraints (stated, binding).** The operator has
  confirmed two hard constraints that the simplicity audit must respect:
  (1) execution MUST be cloud — Cloud Run Job + Cloud Scheduler; local/laptop
  cron is not an option; and (2) the dashboard MUST be reachable from mobile,
  i.e. a hosted public URL, not localhost. This shifts the audit's de-scope
  target from "local-first" to "cloud-minimal single-user": Cloud Run Job,
  Cloud Scheduler, a hosted mobile-friendly dashboard, Secret Manager, and a
  minimal deploy path all become justified (move from DEFER toward KEEP). What
  these constraints do NOT justify (one trusted user, not hostile multi-tenant):
  the separate read-proxy service, RLS + scoped ES256 JWT `pipeline_writer` role
  + read views + diagnostic read path, and dual/keyless CI-CD ceremony — these
  stay REMOVE/SIMPLIFY. New concern introduced: a public URL needs ONE
  lightweight access gate (Firebase Auth single-user, a shared token, or Cloud
  Run IAP) in place of the removed security apparatus. The §13 kill-gate
  conclusion is unaffected (where it runs ≠ whether software auto-decides
  PASS/CUT). The audit document has NOT yet been edited to add this
  "revised under cloud + mobile constraints" section — pending the operator's
  auth preference. This turn was analysis only; no code, config, or document
  change was made.
- **Three further operator decisions (refine the above; originally captured as
  analysis only — since ACTIONED in code, see the closing bullet below).**
  (1) **Public data** — the operator confirms the data
  does not need protecting; it is fine for the public to see it. This REMOVES
  the entire read-side security layer (read-proxy service, RLS, scoped ES256 JWT
  `pipeline_writer` role, read views, diagnostic read path) and WITHDRAWS the
  public-URL auth-gate concern from the prior bullet — the dashboard can be a
  plain public URL. What still matters: API keys and the single DB write
  credential stay in Secret Manager, and the write path must not be publicly
  writable (public read OK, public write not). (2) **Choppiness guard →
  REMOVE as a suppressor** (and the currency-concentration guard likewise):
  these silently decide what the operator may see, the same objection as the
  §13 kill-gate. Keep the choppiness/efficiency metric only as a DISPLAYED field
  so the operator decides whether to stay out — do not suppress. (3) **Keep
  GitHub Actions deployment → KEEP** (convenient for the operator and consistent
  with mandatory cloud execution); treat keyless-WIF vs stored-key as "keep
  whatever already works, don't invest more ceremony" rather than a hard
  requirement. Net de-scope target is now simpler than "cloud-minimal
  single-user": Cloud Run Job + Cloud Scheduler + hosted public-read Postgres +
  public hosted mobile dashboard (no auth gate) + Secret Manager (keys + write
  cred) + GitHub Actions deploy; NO read-proxy, RLS, scoped JWT, read views,
  diagnostic path, auth gate, or choppiness/concentration suppressors. This
  target is now captured authoritatively in audit **§14**. (Originally captured
  document-only as a recommendation; see the closing "§14 recommendations now
  ACTIONED" bullet below — the removals have since been executed in code and
  reconciled on the live estate.)
- **Gate_Auto_Block and the suppressors are now REMOVED in code
  (`simplify-to-cloud-minimal` task 3, Phase 2).** The prior two bullets recorded
  these as recommendations; this turn actioned them. `fires()` is now purely
  `direction !== "FLAT" && earnedConfidence >= threshold` — no configuration is
  ever prevented from driving a displayed observation by an automatic gate, and
  no setup is silently suppressed. The gate-passing resolver (`gatePassingResolver.ts`
  + `makeGatePassingResolver` + its wiring in `scheduled-run/main.ts`), the
  Choppiness_Guard suppressor, and the Currency_Concentration_Guard are deleted;
  the choppiness/efficiency metric survives only as a DISPLAYED field. The
  `PairEvaluation` shape dropped `gatePassing`/`newsSuppressed` and gained
  `choppiness`; `suppression_reason` shrank to `below_floor`/`not_fired`. News
  gated firing via `newsSuppressed`, so dropping that field also removed the
  pipeline's news-resolver wiring (the `src/news-filter/` module itself is left
  for R7/Phase 3). Suppression/auto-block tests were deleted and replaced with
  no-suppression tests (every pair's observation is displayed, incl. an explicit
  "no trade"); `make check` stays green. The DORMANT legacy `gate_verdicts` PASS
  path and the SQL `suppression_reason`/`competing_pairs` schema objects are
  intentionally left for Phase 4 task 5 (schema reduction), and the `web/` SPA's
  snapshot wire-format cleanup for Phase 5.
- **Phase 3 complexity removal landed in code (`simplify-to-cloud-minimal` task 4,
  4.1-4.6).** The audit §14 'remove software not serving the core idea'
  recommendation is now actioned at code level (schema/table drops remain for
  Phase 4, SPA wire-format for Phase 5). Deleted outright (delete-not-quarantine):
  `src/research-assistant/`, `src/architecture/servingLayerGuard`, `src/yields/`,
  `src/features/` (candidate-feature set), `src/feature-registry/`, and the top-level
  `python/` cross-check with its Makefile/`.dockerignore`/`.gitignore`/`package.json`
  references. The Strategy_Source multi-strategy abstraction was removed from the
  domain model (`StrategyId` type and `strategyId` store keys gone; the retained
  Supabase write path keeps a single hardcoded `'system'` column default until the
  Phase 4 schema drop). `src/risk-boundaries/` is explicitly KEPT (R7.6) because it
  feeds the firing-card SL/TP; a new display-only guard test proves perturbing its
  config moves SL/TP but leaves every scoring field byte-for-byte identical. Two
  deliberate non-deletions: the `research_assistant` LLM role in `src/llm/` (a
  sanctioned LLM-interface role, distinct from the deleted module) and the dormant
  `gate_verdicts` verdict path (dropped in Phase 4). `make check` green at every
  subtask (633 tests). Changes are local, not committed/pushed.
- **Write_Credential cutover keeps the scoped-JWT REST model (Option A,
  `simplify-to-cloud-minimal` task 5.2a scoping).** The dashboard went public
  (read side de-secured), but the WRITE path still needs a credential, and the
  Cloud_Run_Job writes through PostgREST/REST, not direct Postgres. So the single
  Write_Credential `fx_writer` is modelled exactly like the outgoing
  `pipeline_writer`: a NOLOGIN Postgres role that `authenticator` is a member of,
  assumed via a signed JWT whose `role` claim is `fx_writer` and carried in the
  `Authorization: Bearer` header alongside the publishable `apikey`. A bare
  password/login role was explicitly rejected because `SupabaseRestClient` has no
  direct-Postgres path. Consequence: the cutover is a role provision + JWT re-mint
  + `supabase-key` secret rotation with NO change to `client.ts`/`supabaseConfig.ts`
  (they are role-name-agnostic by design). This is a pragmatic deviation from the
  stricter reading of "remove the scoped-JWT security" — under public data the JWT
  no longer protects reads (reads are open); it only names the write role, which is
  the minimum needed to keep the write path non-public (R4.5/R4.6). The scoping also
  found migration `...006` STEP 7 was missing `grant fx_writer to authenticator`
  (without it PostgREST rejects the role with `42501`); task 5.2a.1 fixes it. No
  code or cloud change was made this turn — this is the scoped plan only.
- **Phase 4 schema-reduction migration authored locally; hosted apply gated
  behind Phase 5 (`simplify-to-cloud-minimal` tasks 5.1 + 5.2).** The reconcile
  follows the design's "reconcile-to-known-good" shape: a single authoritative
  Required_Object_Set keep-list (the six retained tables + extensions + indexes;
  NO project-created roles/views/RLS policies under public data) is defined
  positively in migration `...006`, and a read-only `information_schema`/
  `pg_catalog` enumeration/diff query classifies every live object as kept vs
  orphaned (acting on real account contents, not assumed migration history). The
  destructive half is strictly ordered DATA-PRESERVE-THEN-DROP: the
  Realized_Outcome_Journal is back-filled into `realized_outcomes`
  (`on conflict do nothing`, `to_regclass`-guarded) BEFORE any drop, then 9
  views, all RLS policies, 11 orphaned tables, and 3 project-created roles are
  dropped, and public `SELECT` + `fx_writer`-restricted `INSERT`/`UPDATE` (no
  `DELETE`, no RLS row policies) are granted. Every statement is idempotent so
  re-running is a no-op (R10.5). Two deliberate scope boundaries: (a) the
  enumeration SELECT is left COMMENTED so applying the migration performs no
  account-wide read; (b) the HOSTED apply (task 5.3) is a separate
  operator-approved ☁️ step. **Operator decision this turn:** 5.3 is DEFERRED
  until after Phase 5, because the migration drops `signal_rationale` and
  `external_reference_comparison`, which still have a live writer
  (`displayDataPersister.ts` via `scheduled-run/main.ts`) that Phase 5
  (tasks 6-6.4) removes. Applying the hosted drop earlier would break the daily
  run with Postgres `42P01 (undefined_table)`. The constraint is documented
  inline in the migration (STEP 5 note). Changes are local, not committed/pushed,
  and NOT applied to any live target.
- **Hosted schema reconcile (`...006`) is APPLIED; the datastore is now at the
  public-data end state (`simplify-to-cloud-minimal` task 5.3, operator-approved).**
  Migration `...006` was applied to the hosted project `bffzhjnpzxxuqvmnmylk`
  after a fresh backup, reducing the schema to the 6-table Required_Object_Set
  with public read, `fx_writer`-only write (INSERT/UPDATE, no DELETE), no RLS
  policies, and no read-side roles or views. Three robustness fixes to the
  migration were needed SPECIFICALLY because hosted Supabase runs `postgres` as a
  NON-superuser and auto-enables RLS on new public tables — a durable fact worth
  recording for any future hosted migration: (1) STEP 6 must grant each
  about-to-be-dropped role to current_user WITH INHERIT TRUE before `drop owned
  by`; (2) STEP 4 must explicitly disable RLS on a freshly created public table
  (here `evaluation_reports`); (3) STEP 3 policy drops must be `to_regclass`-guarded
  (a DO loop) for re-apply idempotency. Also durable: hosted DDL from local must
  go through the IPv4 `SUPABASE_POOLER`, because the direct db host is IPv6-only.
- **Public_Read_Path = static JSON snapshot; read-proxy + read-side security
  removed in code (`simplify-to-cloud-minimal` Phase 5 task 6).** Design
  Decision 2 chose a static `dashboard.json` snapshot over direct PostgREST: the
  Cloud Run Job writes one file at the end of each daily run and the SPA fetches
  that same-origin static asset — no proxy, no PostgREST coupling, no auth gate,
  nothing public but a flat JSON file (matches "data is public"). This turn
  actioned it: ADDED a fail-safe snapshot writer (`src/scheduled-run/snapshot.ts`,
  wired AFTER the DB rows persist so a snapshot failure never corrupts the
  source-of-truth rows); DELETED `services/read-proxy/` in full and the SPA's
  ten-endpoint client + `endpoints.ts` allowlist + the Firebase `/api` rewrite,
  replacing them with a single typed `loadSnapshot()` + shared `snapshotCache`;
  DELETED `src/ops/write-credential/` (the scoped-JWT `pipeline_writer` selector,
  read-side-only) while RETAINING the single `supabase-key` Write_Credential by
  name; the Gate tab was reframed from PASS/CUT verdict cards to the human-read
  evaluation-report view (R1-aligned). `make check` + web build/tests green;
  grep confirms no dangling proxy/allowlist/write-credential/`/api` references.
  SEQUENCING (corrected, then resolved): task 6 did NOT by itself unblock the
  parked hosted reconcile (task 5.3). It added the snapshot writer BESIDE the
  existing display-table writer, so `signal_rationale`/`external_reference_comparison`
  were still written and dropping them on hosted would have broken the run with
  `42P01`. The actual unblocking step was a NEW task 6.5, which is NOW DONE:
  `makeDisplayDataPersister` + its DB-write call + the `displayDataPersister.ts`
  module (and its integration test) are DELETED; the three write-shape types the
  snapshot still needs were relocated to `src/storage/supabase/displayOnlyTypes.ts`;
  `displayOnly` is still built and still fed to `buildDashboardSnapshot`, so the
  display content lives only in `dashboard.json`. Verified (independently + `make
  check` green) that no retained code writes either table. Task 5.3 is now
  genuinely safe to apply. Two deliberate scope boundaries left for later: the `deploy.yml`
  pipeline simplification is Phase 6 task 7 (only a stale comment corrected), and
  the snapshot sink is a logged no-op until the Phase 6 uploader is wired. Changes
  are local, not committed/pushed; no live cloud resource touched.
- **Phase 6 deploy simplification + GCP reconcile is split code-first,
  deletions-last (`simplify-to-cloud-minimal` task 7 + 7.1 done; 7.2 pending).**
  The GCP cleanup follows design Decision 4's reconcile-to-known-good shape:
  `ops/required-resources.manifest.json` is the authoritative POSITIVE keep-list
  (Required_GCP_Resource_Set) and `ops/enumerate-gcp.sh` is a strictly read-only
  `gcloud` diff that classifies live resources KEEP vs ORPHANED. The non-destructive
  halves — simplifying `deploy.yml` (task 7) and authoring the manifest +
  enumeration (task 7.1) — landed this turn with `make check` green; the destructive
  half (task 7.2: deleting the `dashboard-read-proxy` service, the `dashboard-seed-run`/
  `dashboard-gate-run` jobs, obsolete secrets, stale images, dangling IAM/SAs) is a
  SEPARATE ☁️ operator-approved step and was deliberately NOT run — the orphan set is
  already enumerated and awaits approval of the exact delete commands. On `deploy.yml`,
  the only removal was secret-list trimming (six provider secrets for removed
  subsystems); the Job's `supabase-key`/`fx_writer` write path, the publishable
  apikey, the FCS key, both deploy targets, and the keyless WIF identity are all
  retained — confirming there was no read-side-security wiring in the workflow itself
  (it had lived in `services/read-proxy/` + the Firebase `/api` rewrite, both already
  removed in Phase 5).
- **OOS evaluation path: honest model prediction + in-memory retrieval (`simplify-to-cloud-minimal` task 8).** Two coupled corrections to `src/staged-runner/stagedRunner.ts` `buildFoldInputs` (the SHARED fold builder for both the evaluation-report and legacy verdict paths). (a) Correctness: the model's directional prediction for a decision date is now sourced from the Analogue_Neighborhood retrieved AS OF that date (`retrieve`→`selectHorizon`→`dominantDirection`/`earnedConfidence`/`excursionProfileAt`), NOT from the matured outcome it is scored against — closing a look-ahead leak that had produced a tautological `model=1`. `actual` is still the matured outcome; the baseline keeps its Weekly_Trend_Follow derivation; the gate math (gate1/gate2/verdict) is untouched. (b) Performance: because `retrieve` is now called per firing date, each pair's stored vectors + full matured-outcome set are bulk-loaded from the hosted stores ONCE and mirrored into `InMemoryPatternVectorStore`/`InMemoryAnalogueStore` (identical ports → byte-identical retrieval), so per-date retrieval is served in-memory and the hosted round-trip count collapses from ~2,500 to ~10. This is what makes the honest evaluation finish inside the Cloud Run Job timeout. Guard tests: `buildFoldInputsLeak.test.ts` (regression), `buildFoldInputsNoLeak.property.test.ts` (property), `buildFoldInputsPreload.test.ts` (byte-identical + bounded round-trips).
- **Run the first OOS evaluation INSIDE the Cloud Run Job, not locally (`simplify-to-cloud-minimal` task 8, operator-approved).** The honest evaluation does heavy per-date retrieval over the full OOS year; running it from a dev machine over the public internet proved too slow/fragile (a transient `fetch failed` aborted a ~30-min run with no resume). Decision: execute it as a one-off `gcloud run jobs execute scheduled-daily-run` with per-execution overrides (`--args dist/ops/evaluation-run/main.js`, `--update-env-vars EVALUATION_RUN_DOCS_DIR=/tmp`, raised `--task-timeout`) against the deployed image — co-located with the DB, robust. The in-container RESEARCH-LOG append is ephemeral (`/tmp`); the durable record is the hosted `evaluation_reports` row, synced back into the repo RESEARCH-LOG.md afterward.
- **Audit §14 cloud-minimal recommendations are now ACTIONED, not merely
  recommended (`simplify-to-cloud-minimal`, closed task 8.2).** The de-scope
  target captured in audit §14 and the three further operator decisions (public
  data, drop the suppressors, keep GitHub deploy) have been realised end-to-end,
  in code AND on the live estate — the cloud-minimal architecture now exists:
  (a) the removed subsystems are gone in code — the read-proxy service + its code
  and `/api` rewrite, the entire read-side security layer (RLS, scoped-read role,
  diagnostic read path, read views), the Python cross-check, yields + the feature
  registry, the research-assistant module, the serving-layer guard, and the
  auto-block + the choppiness/concentration suppressors (choppiness survives only
  as a displayed metric); (b) the hosted schema was reduced to the six-table
  Required_Object_Set and the live GCP estate reconciled against the positive
  keep-list (Phase 4 task 5.3 + Phase 6 task 7.2, both operator-approved); (c) the
  Public_Read_Path static `dashboard.json` snapshot ships in place of the proxy;
  (d) the kill-gate was reframed from an auto-blocking PASS/CUT verdict to a
  human-read evaluation report; and (e) the first evaluation is recorded (see §7).
  The historical bullets above are kept as the decision trail; this bullet marks
  the recommendation as DONE.
- **Public_Read_Path realised as a public GCS bucket (Option A, operator-approved).**
  The deferred snapshot uploader is now wired: the daily Cloud Run Job writes
  `dashboard.json` to a public-read GCS bucket (`trade-assistant-508806-dashboard`)
  via a zero-SDK `SnapshotSink` (`src/scheduled-run/gcsSnapshotSink.ts`) using the
  GCS JSON media-upload REST API over built-in `fetch`, authed by the existing
  `AccessTokenProvider` (runtime SA metadata token / local ADC) — no new auth, no
  SDK, fail-safe (a failed upload is logged+swallowed and never corrupts the
  persisted rows). The hosted SPA fetches that object cross-origin
  (`VITE_SNAPSHOT_URL`), with the CSP `connect-src` widened to
  `https://storage.googleapis.com` only. Firebase Hosting cannot rewrite to a raw
  bucket and reintroducing a serving service was rejected, so under the public-data
  decision a cross-origin fetch of a public bucket object is the minimal path. Live
  infra (bucket, runtime-SA object write, public read, CORS, repo vars) provisioned
  operator-approved.
- **Candle freshness via a provider fallback chain (new spec `daily-candle-freshness-and-cleanup`, requirements phase).** The live loop was found to run on stale candles (hosted history ended 2026-09-15 with no daily ingestion). The chosen fix adds a Candle_Freshness_Stage to the daily run that tops-up the prior day's candle and auto-backfills any gap BEFORE the deterministic pipeline reads history, reusing the existing `OhlcIngestion` validation + idempotent `(asset,date)` upsert (Look_Ahead_Safe, no re-implementation). Data comes from an ordered Provider_Fallback_Chain — FCS (primary, the connection already used for the display-only cross-reference) → Twelve Data → Massive — each resolved from its own `.env` API key by name (`EXTERNAL_SIGNAL_API_KEY` / `TWELVE_DATA_API_KEY` / `MASSIVE_API_KEY`), tried in order with first-usable-wins and skip-and-proceed-on-total-failure, each native response normalized to the single internal `RawCandle` shape over zero-SDK `fetch`. This keeps the daily loop producing current-day signals and self-heals a missed run, without a new credential or provider dependency. Requirements only so far; design/tasks/implementation pending.
- **Incremental CI/CD delivery cadence (operator).** Work ships milestone-by-milestone: implement a coherent task set locally (keeping `make check` + web build green), the operator merges `dev`→`main` to trigger the Deploy workflow, verify, then the next milestone. The agent builds + verifies locally and does NOT run GitHub/PR/merge/deploy actions — the operator handles all GitHub. ☁️ live steps (one-off backfill, Vertex grant, secret rotation) remain operator-gated with the exact command shown first.
- **Dashboard "All pairs" shows cross-pair detail, not a pick-a-pair prompt (dashboard-ui Req 8 criterion 8, this turn).** The operator's "nothing from the third-party API" report was diagnosed as a UX dead-end, not a data defect: the FCS external-comparison data is present in the live `dashboard.json` and the deployed SPA is current, but the AI, Third-party, and Pattern/Outcomes tabs each render a "pick a pair" prompt when the Pair_Selector is on the default "All pairs" (original dashboard-ui Req 8.2). Decision: those three per-pair tabs will render a cross-pair view over all five pairs on "All pairs" (verbatim snapshot values + explicit per-pair no-data markers), matching how the Setups tab already behaves, so the default landing view never hides present data. Requirements amended + format-valid; implementation pending.
- **Supported-major dependency ceilings enforced in CI; React 19 / recharts 3 / TS 7 deferred (operator-approved, this turn).** To stop recurring Dependabot ERESOLVE / unsupported-major CI failures, a durable supported-major ceiling is now enforced across BOTH package trees via `auditCeilings`/`SUPPORTED_MAJOR_CEILINGS` in `scripts/version-policy.mjs`, with matching `.github/dependabot.yml` ignore rules. React 18→19, recharts 2→3, and TypeScript 5→7 are held as explicit, CI-guarded DEFERRED migrations (recharts 3 breaks the Tooltip Formatter API; React 19 has recharts-2 peer constraints; TS 7 is blocked upstream by typescript-eslint until the TS 7.1 API) rather than being force-upgraded now. See §9 bucket (e).
- **Silent no-fire day shows a credible run-completion readout, not a bare "no data" (operator-requested, this turn).** The operator noted that the silent-by-default design made a successful-but-nothing-actionable run indistinguishable from a broken/absent run. Decision: on a no-fire day the Setups tab's silent state renders an affirmative "run completed, evaluated N pairs, M met the threshold" summary plus a per-pair readout of each pair's deterministic direction + earned confidence (vs the 0.55 threshold) + choppiness. This required carrying the non-firing pairs' evaluations outward: a new display-only `pairEvaluations` snapshot slice (schema v2) populated in `main.ts` from the already-captured full `PairEvaluation[]` (confidence for non-firing pairs was previously computed then dropped by `dailyRun`). The silent-by-default product behaviour is preserved — no fabricated actionable setups — only the "completed vs broken" ambiguity is removed. The readout is scoped to the silent state (firing days render cards as before). These values are display-only and never re-enter the firing/scoring path (AI/Deterministic boundary untouched). Code complete + locally verified; live after the operator deploys both halves and re-runs the Job.
- **Daily AI commentary note as an LLM-path liveness signal, reusing `signal_rationale` (operator-requested, this turn).** The operator noted the AI content stayed empty on no-fire days (the rationale producer only ran for firing cards), so a working AI layer was indistinguishable from a broken one. Decision: generate a short display-only whole-day note on EVERY trading day (fired or not) and render it in the Setups panel. To respect the AI/Deterministic boundary WITHOUT widening the hard-coded role allow-list, it REUSES the sanctioned `signal_rationale` role (its `SignalRationaleInput` is an open structural map, so a richer whole-day payload is valid) rather than adding a `daily_commentary` role; the prompt is built only from deterministic `PairEvaluation` numbers (direction, Earned_Confidence vs threshold, choppiness) and the output is `LlmTagged<string>`, so it is structurally excluded from scoring. It is carried in a NEW pair-INDEPENDENT `dailyCommentary` snapshot slice (schema v3) — not the per-pair `aiRationale` slice — because the AI tab is pair-gated and blank on "All pairs". `generated:false` + empty text when the LLM path is unavailable, surfaced as an explicit "AI commentary unavailable" marker (never fabricated); the note's PRESENCE is itself the liveness signal. Fully fail-safe (no LLM / provider error → no note, run unaffected). Code complete + locally verified (backend 790 tests, web 167 tests); DEPLOYED + LIVE-VERIFIED 2026-10-09 (schema v3 snapshot, `generated=true`, real note, no provenance leak). One cosmetic follow-up open: the live note reads truncated mid-sentence (see §7).


- **(2026-11-04) Decision_Date is the NEXT trading day for a run at/after the 17:00 NY close (Option B).** The look-ahead rule (candles strictly before the Decision_Date) is deliberately unchanged; only the run's date derivation moved (`resolveDecisionDate`, NY clock). This lets the run use the candle that just closed without touching the guard, encoder, stored vectors, analogue outcomes or any baseline, and leaves stored history valid. Rejected Option A (run keeps its date, rule becomes inclusive): needs a hosted re-encode of all vectors and a re-freeze of walk-forward/kill-gate baselines. Consequence: the freshness stage must obtain a candle that closes at the instant the Job fires, hence the bounded in-process retry in `freshenCandles`.
