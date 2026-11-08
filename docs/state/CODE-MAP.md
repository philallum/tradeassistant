# Code Map

> Satellite of PROJECT-STATE.md (§3). Repository / code map — what each module is and does.
> Updated alongside PROJECT-STATE.md when code structure changes.

## 3. Repository / code map
- **Dashboard simplification (2026-11-04).** Backend: `src/range-forecast/` (pure expected candle size: `expectedRange.ts`, `realized.ts`), `src/track-record/` (`strategyRecord.ts`, `rangeRecord.ts`, `trackRecordSlice.ts`, `memoizedAnalogueStore.ts`), `src/strategies/calibration.ts` + `src/ops/confluence-calibration/main.ts` (read-only threshold measurement over `data/*.csv`); `PairEvaluation.expectedRange`, snapshot v6 (`expected_range`, `trackRecord`). Web: `components/{PairSummary,StrategyCard,StrategyCardGrid,SystemRecordFooter,MasterCard,AllPairsStrip,ControlBar}.tsx`, `pure/{shapeConviction,shapeStrategyCards,shapePairSummary,shapeSystemRecord,shapeAllPairsStrip,shapeEvidence,shapePairNote}.ts` (`shapePairNote` = the selected pair's own AI rationale from `aiRationale`; `ContextDrawers` shows it above the pair-independent `dailyCommentary` overview); `tabs/` now holds only `Gate/` (accuracy-vs-baseline report). `state/selection.ts` has no "All pairs" (`DEFAULT_PAIR` EURUSD).

Top-level TypeScript modules under `src/` (see each module's `index.ts` for the
authoritative export surface):

- `guard/` — Look-ahead safety guard: rejects any candle dated at/after a
  decision date; enforces matured-only outcomes.
- `ingestion/` — OHLC ingestion + session-boundary normalization, idempotent
  `(asset, date)` upsert.
- `ingestion/ohlcFeed/` — the OHLC_Feed_Provider port + `ohlcFeedConfigFromEnv`
  + FCS/Twelve Data/Massive adapters (zero-SDK `fetch`) + `buildProviderChain`
  fallback resolver (FCS→Twelve Data→Massive, first-usable-wins per pair,
  capability-aware: a date-range backfill skips latest-only FCS). Feeds the
  Candle_Freshness_Stage; output goes through the existing `OhlcIngestion`.
- `encoder/` — Shape-only, per-scale-normalized pattern-vector encoder
  (10/20/40-day windows).
- `retrieval/` — pgvector analogue retrieval (weekly-trend pre-filter,
  self-exclusion, matured-only, similarity radius) + forward-outcome resolver.
  The resolver's pip conversion now lives in the shared `../trade-sim/pip.ts`
  (`trader-edge-validation` Stage A); its stored MFE/MAE are proven byte-identical.
  NOTE (egress lean-up, 2026-10-12): the Supabase vector/analogue adapters now use
  explicit `select=` column projection, and `queryNearest` drops the `scale_dims`
  jsonb from its candidate-slice read (never consumed downstream) — a wire-payload
  cut only; the client-side cosine ranking and firing decision are byte-identical.
  ANN is still ranked CLIENT-SIDE by design: server-side pgvector top-k (OF1) was evaluated and NOT shipped because float4 `<=>` differs from `computeCosineDistance` by up to ~3.8e-8 (> 1e-9 tie epsilon), which could change near-tie ordering and scoring. Possible future route: additive RPC returning top-k plus a >=1e-6 margin, re-ranked client-side. Parity test OF1.1 in `supabaseStores.integration.test.ts` (local-Supabase gated).
- `trade-sim/` — (`trader-edge-validation`, Stages A + B landed) the shared pip
  helper `pip.ts` (`pipSize`/`toPips`/`fromPips`, lifted verbatim from the
  resolver), the `executionModel.ts` Execution_Model (R2: `resolveEntry` =
  next-session-open strictly after the decision date; `applyCosts`; version-stamped
  `DEFAULT_EXECUTION_MODEL`), the path-aware `tradeSimulation.ts` `simulateTrade`
  (R1 — the SL/TP sequencing fix: `target_first`/`stop_first`/`expired`/`ambiguous`,
  both-touched⇒`ambiguous`, optional `IntraCandleResolver` lower-timeframe seam),
  and `types.ts`. All PURE + UNWIRED — a separate read-only consumer that never
  feeds the live firing/scoring decision; the Stage C ledger wires it offline.
- `trade-ledger/` — (`trader-edge-validation`, Stage C landed) the Trade_Ledger:
  `types.ts` (`TradeLedgerRow`, `TradeLedgerStore` port + `InMemoryTradeLedgerStore`)
  and `buildTradeLedger.ts` (per forecast: resolveEntry→simulateTrade→applyCosts→
  one row; suppressed forecasts kept `fired:false`; `ambiguous` never win/loss).
  The SOLE source of every performance metric (R3.4). Offline/ops read path —
  not wired into the daily run. Supabase adapter + additive `trade_ledger`
  migration live under `src/storage/supabase/` + `supabase/migrations/…_trade_ledger.sql`.
- `performance/` — (`trader-edge-validation`, Stage C landed) `metrics.ts`:
  `summarize` (net-of-cost expectancy pips+R as the headline, profit factor,
  drawdown, losing streak, ambiguous/expired shares) and `summarizeBySlice`
  (pair/horizon/direction/confidence-band), derived SOLELY from ledger rows;
  LLM-free (AI-never-scores guardrail retargeted here). As of Stage D this module
  also holds `comparators.ts` (the `ForecastSource` Comparator_Strategies —
  `trendContinuation`/`returnsVolatility`/optional `directionalCoinflip` — all
  scored through the IDENTICAL `buildTradeLedger`+`ExecutionModel`;
  `compareStrategies()` places summaries side by side and states plainly when the
  system does not beat them net of costs OOS, R5) and `calibration.ts` (`calibrate()`
  — confidence-band realized rates + an overlap-discounted `effectiveSampleSize`,
  `monotonic` + `wellCalibrated` reported separately, R6).
- `walk-forward/` — (`trader-edge-validation`, Stage D landed) Freeze-before-measure:
  `parameterSet.ts` (`ParameterSet`/`FrozenBaseline` + `captureFrozenBaseline()`
  reading the live constants verbatim, read-only wrt the decision path, R11),
  `frozenBaselineStore.ts` (`FrozenBaselineStore` port + `InMemoryFrozenBaselineStore`;
  Supabase adapter + additive append-only `frozen_baselines` migration live under
  `src/storage/supabase/` + `supabase/migrations/…_frozen_baselines.sql`),
  `walkForward.ts` (`walkForward()` — select+freeze on in-sample, measure on OOS
  only, record the baseline, flag reserved/tuned-against windows, R7), and
  `pipelineForecastRegenerator.ts` (regenerates OOS forecasts through `evaluatePair`
  under the frozen `PipelineConfig` — the signal is never re-implemented). Pure,
  offline/ops read path — not wired into the daily run.
- `exposure/` — (`trader-edge-validation`, Stage E task 13 landed) `aggregateExposure.ts`:
  `aggregateExposure(firing)` decomposes each surfaced non-FLAT firing into base/quote
  currency legs, sums per currency, flags `concentrated` (>=2 firings and one
  currency's |net| equals the firing count) and picks `strongestPair` (highest
  earnedConfidence, ties by PAIRS order; R8). Pure, deterministic, LLM-free,
  information-only; wired into the v4 snapshot via `scheduled-run/edgeSlices.ts` (Stage F task 15).
- `scheduled-run/signalScorecardStep.ts` — (signal-scorecard, 2026-11-05) `runSignalScorecardStep` is the fail-safe daily-run wiring for the Signal Scorecard: it reconciles the open `signal_predictions` backlog, then rebuilds the per-run Confluence_Matrix the SAME way `confluenceSlice.ts` does (same strategy bundle/engine/config/candles/third-party refs) and records today's six per-signal directions. Wired into `main.ts` `makePersistView` via the new injectable `runScorecard` seam, AFTER the firing rows persist; writes only `signal_predictions`, never throws, feeds nothing firing reads.
- `scheduled-run/signalScorecardSlice.ts` — (signal-scorecard, 2026-11-05) `buildSignalScorecardSlice` is the fail-safe v7 `signalScorecard` snapshot-slice builder: reads the recorded `signal_predictions` rows via `store.getAll()`, aggregates them with `aggregateSignalScorecard`, and maps to the wire slice (`totalRecorded` + per pair+signal `calls`/`correct`/`flat`/`pending`). `EMPTY_SIGNAL_SCORECARD` on any failure. Wired into `makePersistView` via the `buildScorecard` seam AFTER the scorecard step runs so today's rows are included. Snapshot schema bumped v6->v7 (`snapshot.ts`); the slice is appended LAST to keep earlier keys' byte order.
- `scheduled-run/edgeSlices.ts` — (`trader-edge-validation`, Stage F task 15) `buildEdgeSlices` builds the additive v4 `dashboard.json` slices (`tradeLedgerSummary`, `calibration`, `exposure`, `provenance`, `validationStatus`); each slice fail-safe (empty + secret-free log). Reads existing `trade_ledger` rows only (daily run builds none, so ledger/calibration slices are empty until the Stage H edge-eval entry writes them). `validationStatus` is `validated` only if the system has trades, positive net expectancy, and beats every comparator; else `unvalidated`. `SNAPSHOT_SCHEMA_VERSION`=4. Firing/scoring untouched.
- `provenance/` — (`trader-edge-validation`, Stage E task 14 landed) `signalProvenance.ts`:
  `deriveSignalProvenance` builds per-pair Signal_Provenance (last candle stamp with
  explicit NY-close offset, injected `computedAt`, next-session `earliestEntryRef`
  strictly after the last candle, horizon start/end, `dataComplete` + `staleReason`
  holiday|missing_candle|weekend_gap|stale; R9) from CandleStore coverage and
  `mostRecentCompletedTradingDay`. `holiday` only when dates are passed in (no
  holiday calendar exists). Pure, LLM-free; wired into the v4 snapshot via `scheduled-run/edgeSlices.ts` (Stage F task 15).
- `ops/edge-eval/` — (`trader-edge-validation`, Stage H task 20 landed) `main.ts`:
  one-shot operator entry `runEdgeEval` running the evidence suite (frozen baseline →
  walk-forward → system ledger → comparators + calibration) over committed
  `EDGE_EVAL_WINDOWS`; persists `frozen_baselines` + `trade_ledger` rows, appends an
  `[EDGE-EVAL]` note to RESEARCH-LOG.md only via `LivingDocs.appendEdgeEvaluation`.
  Hosted use gated by `ALLOW_HOSTED_BACKTEST`; operator-run, not in the daily Job.
  Standing guard (Stage H task 21): `standingGuard.test.ts` asserts the new modules import no LLM/rationale/external-signal/broker/network code, the live decision modules import none of them (sole exception: `retrieval/resolver.ts` -> `trade-sim/pip.js`), and the live constants (Confidence_Threshold 0.55, risk floor 30, SL/TP pct 75/50, shrinkage 10) and `ParameterSet` shape are unchanged (R12.1-R12.4). Locally verified (`make check` green).
- `strategies/` — (`multi-strategy-confluence-engine`, Stage A in progress) the shared
  signal layer for the four classical strategies + the Confluence_Engine. Landed so far:
  `types.ts` (the `StrategySignal` four-field contract, `STRATEGY_IDS`/`SIGNAL_DIRECTIONS`
  literal unions, `validateStrategySignal` fixed-order guard + `buildSignal`; imports only
  `../llm/types.js` + `../guard/types.js`, no model client — upholds AI-never-scores),
  `candles.ts` (`prepareCandles`: look-ahead guard → empty → finite-OHLC → stable date-sorted
  copy, never mutating input; look-ahead wins over a non-finite value), and `indicators.ts`
  (pure `sma`/`populationStdDev`/`emaSeries`/`rsiWilder`/`roundTo`/`clamp01`/`atrUsable`; ATR
  is NOT re-implemented — callers reuse `computeAtr14` from `confidence/atr.ts`). `testing/arbitraries.ts`
  holds shared fast-check 4.10.0 generators (candle series, decision/future dates, signals/sets,
  weights, thresholds, invalid signals, genuine LLM-tagged values) for the property tests — test-support
  only, exempt from the import-boundary scan. All pure + UNWIRED (no caller in the daily run yet); the
  barrel `index.ts` is deferred to task 8.1. Still to come: trend/breakout/range/reversal, adapters,
  confluenceEngine, confluenceMatrix, config, and the fail-safe `scheduled-run/confluenceSlice.ts` (snapshot v5).
- `baseline/` — Weekly-trend-follow baseline (the null hypothesis to beat).
- `confidence/` — Earned confidence with sample-size shrinkage, ATR-scaled FLAT
  band, horizon (1/2/3-day) selection.
- `kill-gate/` — Two-stage measurement: Gate 1 (directional, vs the baseline),
  Gate 2 (risk-adjusted MFE/MAE after friction), walk-forward fold construction.
  The ACTIVE evaluation write path is a human-read `EvaluationReport`:
  `composeEvaluationReport()` pools the qualifying folds and emits metrics + a
  deterministic Wald CI + non-binding `annotations` and NO `verdict` field;
  `evaluateAndRecordReport()` persists it via `EvaluationReportStore`
  (`evaluation_reports` table, no verdict column) and appends a verdict-free
  RESEARCH-LOG entry. **The legacy PASS/CUT path (`composeGateVerdict`, `GateVerdict`,
  `GateVerdictStore`, `persistGateVerdict`, the `gate_verdicts` adapter,
  `ops/gate-run`) was REMOVED in `codebase-housekeeping` (2026-11-08).** The four
  guard tests that proved "LLM / confluence / third-party / journaling cannot change the
  Kill_Gate" now use `composeEvaluationReport` as their oracle.
  (`LivingDocs.appendVerdict/appendCut` remain in `living-docs/` but have no caller.)
- `llm/` — Role-gated, provenance-tagged LLM interface + `ScoringInputGuard`.
  The v1 production backend `geminiProvider.ts` (Vertex AI `generateContent`
  over built-in `fetch`, ADC/metadata bearer token, no SDK) implements the
  `LlmProvider` port — `src/llm` is the sole SDK-aware layer and still imports
  no SDK package, so the import-boundary smoke test stays green. It supports an
  optional `thinkingBudget` (sent as `generationConfig.thinkingConfig` only when
  set) so a 2.5 thinking model does not spend the output budget on hidden
  reasoning and truncate short display text; the daily run sets `thinkingBudget:0`
  + `maxOutputTokens:1024`, and a `MAX_TOKENS` finish logs a secret-free
  `gemini.generation_truncated` warning.
- `rationale/` — Display-only signal rationale + pattern description, plus
  `dailyCommentary.ts` (`generateDailyCommentary`): a whole-day display-only AI
  note produced every trading day (fired or not) as an LLM-path liveness signal.
  It REUSES the sanctioned `signal_rationale` role (no new role), builds its
  prompt only from deterministic `PairEvaluation` numbers, and returns
  `LlmTagged<string>` — so it is excluded from scoring by the same
  `Deterministic<T>`/`ScoringInputGuard` boundary as the other rationale output.
- `dashboard/` — Silent-by-default dashboard, per-pair `fires()` decision
  (now `direction !== "FLAT" && earnedConfidence >= threshold` only — the
  gate/news/choppiness/concentration suppressors were removed in
  `simplify-to-cloud-minimal` task 3), firing-setup persistence, realized-outcome
  journal. `choppinessMetric.ts` retains the choppiness/efficiency computation as
  a DISPLAYED field on each observation (never a suppressor).
  `signalScorecard.ts` (signal-scorecard feature, 2026-11-05) is the per-signal
  daily direction record: `SignalPredictionStore` port + `InMemory…` reference,
  `recordPredictions(store, matrix)` (one open row per AVAILABLE Confluence_Matrix
  cell, copying its direction — no new signal),
  `reconcileOutcomes(store, decisionDate, candleStore)` (fills the realized
  next-session direction via the shared `track-record/strategyRecord.realizedDirectionAfter`;
  FLAT is an unscored abstention), and `aggregateSignalScorecard(rows)` (pure:
  matured UP/DOWN -> calls/correct, matured FLAT -> flat, unreconciled -> pending,
  for the v7 snapshot slice). Idempotent on `(decision_date, pair, strategy_id)`;
  self-contained date helper so `dashboard/` depends on no `scheduled-run/` code.
  A separate read-only consumer — never feeds firing/confidence/Kill_Gate, takes
  no LLM input. Surfaced on the dashboard by the v7 `signalScorecard` snapshot
  slice -> web `shapeStrategyCards` `recorded` line (see web/ below).
- `risk-boundaries/` — Empirical analogue-derived risk boundaries.
- `external-signal/` — External cross-reference, display/research-only, never
  feeds scoring. `fcsProvider.ts` is the real FCS adapter (`/forex/latest` over
  `fetch`); it batches all five pairs into one request (memoized per
  Decision_Date) to respect the FCS free-plan 3-req/min limit, deriving
  BUY/SELL/HOLD from the daily change %.
- `pipeline/` — End-to-end deterministic daily-run wiring; `makePipelineLoader`.
  (`gatePassingResolver.ts` and the news-resolver wiring were removed in
  `simplify-to-cloud-minimal` task 3; the daily path no longer gates or
  suppresses firing.)
- `scheduled-run/` — GCP-scheduled unattended daily entry (`main.ts`), reuses
  the same daily-run path. `main.ts` now builds the optional Gemini + FCS
  collaborators from env, skips non-trading days (`isTradingDay`), and persists
  the display-only values beside the firing view. It also now runs the
  Candle_Freshness_Stage (`candleFreshness.ts` `runCandleFreshnessStage`, with
  `completedTradingDay.ts` + `candleGap.ts`) BEFORE `runScheduledDaily`,
  fail-safe, to top-up/gap-backfill candles via the provider chain through the
  existing `OhlcIngestion`; `encodeStoredCandles.ts` is the shared
  look-ahead-safe candle→vector encode helper now reused by both the stage and
  `stagedRunner.backfill()`. `freshnessVerification.ts` (added by
  `daily-candle-freshness-and-cleanup` task 14) is a strictly READ-ONLY
  `verifyFreshness(deps)` check (R6): per pair it compares the latest stored
  candle date from `candleStore.getCoverageSummary()` against
  `mostRecentCompletedTradingDay(decisionDate)` and confirms the provided
  `dashboard.json` snapshot's `decisionDate` reflects fresh history — fully
  injectable, mutates nothing, writes nothing (touches no decision path or the
  Measurement_Engine). `src/ops/freshness-verify/main.ts` (added by task 15) is
  the read-only OPERATOR entry wrapping it: it builds the hosted stores (uses
  ONLY the read-only candle store), fetches the published `dashboard.json` from
  the public-read GCS object (`DASHBOARD_SNAPSHOT_BUCKET`), drives
  `verifyFreshness` once, and emits secret-free logs; executing it against
  hosted is the operator-gated ☁️ step (task 15, DONE). `displayOnly.ts` composes the
  rationale + comparison writes (fail-safe per pair); `accessToken.ts` resolves
  the GCP token (Cloud Run metadata server in prod, `gcloud` ADC locally).
  `snapshot.ts` (added `simplify-to-cloud-minimal` task 6) builds + serialises
  the `dashboard.json` Public_Read_Path snapshot and writes it fail-safely
  through an injected `SnapshotSink` AFTER the DB rows persist (a failed write is
  logged and swallowed, never corrupting the source-of-truth rows). Its sink is
  NO LONGER a no-op: `gcsSnapshotSink.ts` (added task 8) is the GCS-backed
  `SnapshotSink` that uploads `dashboard.json` to the public-read bucket via the
  GCS JSON media-upload REST API over built-in `fetch`, authed by the shared
  `AccessTokenProvider` (runtime SA metadata token in prod / `gcloud` ADC
  locally); `resolveSnapshotSink()` returns it when the non-secret
  `DASHBOARD_SNAPSHOT_BUCKET` env is set, else the existing fail-safe no-op.
  `snapshotHistory.ts` (`loadSnapshotHistory`) is the read-only, per-slice
  fail-safe loader that reads the snapshot HISTORY slices back from the persisted
  source-of-truth rows (all firing setups across dates, all realized outcomes,
  all evaluation reports, plus a bounded recent window — `HISTORY_WINDOW_DAYS`=400
  — of matured analogue outcomes and candles, and the derived Decision_Date list)
  so the SPA tabs render real history instead of empty state; `main.ts`
  `persistView` now calls it and hands the result to `buildDashboardSnapshot`
  (which merges today's produced view on top). A slice that fails to load
  degrades to `[]` with a secret-free warning and never breaks the run, matching
  the fail-safe snapshot write. `snapshot.ts` also carries the schema-v2
  `pairEvaluations` slice (every pair evaluated this run, fired or not, with its
  deterministic direction + earned confidence + choppiness + `fired` flag) via
  the exported `pairEvaluationRows()` mapper; `main.ts` `persistView` maps the
  full captured `PairEvaluation[]` (`cachingLoader.get()`) into it. It is
  display-only (never re-enters firing/scoring) and feeds the web Setups tab's
  silent-day run-completion readout (`web/src/pure/shapeRunSummary.ts` +
  `web/src/tabs/Setups/RunSummary.tsx`), so a no-fire day shows a credible
  "run completed" summary rather than a bare "no data" notice. `snapshot.ts`
  (schema v3) also carries the pair-INDEPENDENT `dailyCommentary` record
  `{ decision_date, note_text, generated }` — the daily AI note produced by
  `displayOnly.ts`'s `buildDailyNote` producer (which runs every trading day,
  fired or not, fail-safe) via `src/rationale/dailyCommentary.ts`; the web
  `shapeDailyNote.ts` + `DailyNote.tsx` render it in the Setups panel as the
  LLM-path liveness signal (`generated:false` → explicit "unavailable" marker).
- `csv-loader/`, `staged-runner/` — CSV backfill import + the retained staged-runner
  pieces: `backfill()`, `hasBacktestData()` and `buildFoldInputs()` (the fold construction
  `ops/evaluation-run` feeds to `composeEvaluationReport`). The `backtest` (verdict),
  `forwardLook` and `runAll` stages were removed 2026-11-08. `testHelpers.ts` keeps the
  in-memory deps builder and seeding helpers.
- `storage/` — Supabase config + REST client + adapters (candle, vector,
  analogue, evaluation-report, trade-ledger, frozen-baseline, signal-prediction,
  view-persister stores). `signalPredictionStore.ts` (signal-scorecard,
  2026-11-05) backs the `signal_predictions` table (migration …0009): idempotent
  merge upsert on the composite PK, fail-safe reads that degrade to `[]` on any
  error incl. a not-yet-present table (torn-deploy-safe). The display-data WRITER
  (`displayDataPersister.ts`, which upserted `signal_rationale`/
  `external_reference_comparison`) was DELETED in `simplify-to-cloud-minimal`
  task 6.5 — that content now lives only in the `dashboard.json` snapshot; its
  surviving write-shape types moved to `displayOnlyTypes.ts`. (The gate-verdict
  and feature-registry stores were removed in earlier simplify phases.)
- `ops/` — Operational tooling: `safety/` (gcloud runner + safety guard),
  `secret-manager/`, `deploy-verify/`, `scheduler/`, `seed-run/` (operator tool; its
  Cloud Run deploy surface was removed 2026-11-08, the `csv-loader` library and `data/*.csv`
  stay),
  `evaluation-run/` (the one-shot first-OOS-evaluation entrypoint added by
  `simplify-to-cloud-minimal` task 2.2 - composes + records an `EvaluationReport`
  over a fixed committed OOS split). `candle-backfill/` (added by
  `daily-candle-freshness-and-cleanup` task 12 — the one-off operator entry
  (`main.ts`) that closes the current candle gap for all five pairs by driving the
  shared `runCandleFreshnessStage` once (bounded Gap_Backfill via the provider
  chain through the existing `OhlcIngestion`); injectable + unit-tested with no
  network; executing it against hosted is the operator-gated ☁️ step (task 13)).
  `fx-writer-check/` (added by
  `simplify-to-cloud-minimal` task 5.2a.4 — a PURE verdict classifier +
  live runner that proves the `fx_writer` Scoped_Write_Credential can
  INSERT/UPDATE the retained tables via the real `SupabaseRestClient` while
  DELETE is refused). (`write-credential/` — the scoped-JWT
  `pipeline_writer` selector — was DELETED in task 6.3; it existed solely for the
  read-side security model. The single Write_Credential is the `supabase-key`
  Secret Manager secret, referenced by name in `src/storage/supabaseConfig.ts`.)
  `simplify-to-cloud-minimal` Phase 6 task 7.1 added two NON-code ops artifacts:
  `ops/required-resources.manifest.json` (the authoritative positive keep-list,
  the Required_GCP_Resource_Set) and `ops/enumerate-gcp.sh` (a STRICTLY read-only
  `gcloud list`/`describe`/`get-iam-policy` enumeration that diffs the live
  project against the manifest and labels each resource KEEP vs ORPHANED — no
  mutation; deletions are the separate operator-gated task 7.2).
  `daily-candle-freshness-and-cleanup` Phase 2b added `ops/monitoring/`: a
  committed Cloud Monitoring log-based alert (`candle-freshness-alert-policy.json`
  matching the `candle_freshness.degraded` ERROR event on the daily Job),
  its email notification channel (`candle-freshness-notification-channel.json`),
  and the idempotent `apply-candle-freshness-alert.sh` (APPLIED LIVE 2026-11-03).
- `version-policy/`, `architecture/`, `living-docs/` — version-policy audit;
  compute/storage/serving separation guard; the Living-Docs Writer.

Other roots: `web/` (the SPA, now reading the static `dashboard.json`
snapshot; as of signal-scorecard 2026-11-05 it parses the v7 `signalScorecard`
slice leniently in `api/snapshot.ts` and each `StrategyCard` shows a "Recorded:
right X of Y (N pending)" line from `shapeStrategyCards`'s `recorded` VM — the
dated scorecard for all six signals, beside the replay-based `record` line),
`supabase/migrations/` (schema; `…0009_signal_predictions.sql`),
`ops/` + `ops.config.json` (operational config, including the
`Data_Source_Role` decision that CSV is backfill-only), `.github/workflows/`
(CI + deploy), `data/` (seed CSV candle files).

## Added or changed by `codebase-housekeeping` (2026-11-08)

- `dashboard/dashboard.ts` - `fires(evaluation, threshold)` is exported and is the ONLY
  definition of the firing rule. Callers: `dailyRun`, `persistFiringSetups`, the snapshot's
  `pairEvaluationRows`, the daily-note input (`displayOnly.ts`) and
  `walk-forward/pipelineForecastRegenerator.ts`. `createDashboard` was removed (no caller).
- `guard/tradingDate.ts` - `previousCalendarDate()` (shared; four private copies removed).
- `scheduled-run/warn.ts` - `warnEvent()` / `errorMessage()`: the one secret-free structured
  warning used by every fail-safe step (ten private copies removed; log lines unchanged).
- `scheduled-run/stepTiming.ts` - `timed()`: logs `scheduled_run.step_timing` per step; observation
  only, re-throws the identical error.
- `scheduled-run/confluenceSlice.ts` - `buildRunMatrix()` builds the per-run Confluence_Matrix
  ONCE; `sliceFromRunMatrix()` projects it to the wire slice; `buildConfluenceSlice()` can take
  a prebuilt `run`. `signalScorecardStep.ts` no longer builds its own matrix - it receives the
  shared one (`SignalScorecardStepDeps.run`).
- `scheduled-run/config.ts` - `isLiveDecisionDate()`; with `signalScorecardStep`'s
  `recordThirdParty` and `recordPredictions(..., { excludeStrategyIds })` it implements the
  replay guard (the live-only `third_party` signal is not recorded for a replayed date).
- `ingestion/redactSecrets.ts` - `redactSecrets()`; applied in all five provider clients'
  failure constructors (FCS x2, Twelve Data x2, Massive) because each puts its API key in the
  request URL.
- `encoder/encodeStoredCandles.ts` - `encodeDatesIntoVectors(..., onSkip)` reports skipped dates.
- `pipeline/types.ts` - `PipelineDeps.onWarn`: observer for a degraded display-only step.
- `retrieval/horizonContract.test.ts` - pins the horizon-1-only behaviour (decision R1).
- Removed: `src/news-filter/` (no importer), `src/scaffold.test.ts` / `SCAFFOLD_READY`, the
  legacy verdict path (see `kill-gate/` above), `ops/seed-job.config.json`, the `recharts`
  dependency, tracked `supabase/.temp/` and `web/.firebase/`.

