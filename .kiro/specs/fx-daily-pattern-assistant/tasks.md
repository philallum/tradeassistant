# Implementation Plan: FX Daily Pattern Trading Assistant

## Overview

This plan converts the design into incremental, test-driven coding tasks in the exact build order mandated by Requirement 12 and PROJECT-PLAN section 7: **the two-stage kill-gate harness is provable on the shape-only model BEFORE any candidate feature is added.**

The deterministic core is TypeScript (authoritative), with Python used only as a statistical cross-check where the design calls for it (Requirement 3.3, 3.4). Storage is Supabase Postgres + pgvector.

Two shared primitives are built early and reused everywhere:

- The **Look-Ahead Guard** (Requirement 4) — a single tested guard function imported by ingestion, encoder, retrieval, and resolver.
- The **AI/deterministic boundary** (`LLM_Interface` + `ScoringInputGuard`) — no LLM output ever reaches a probability or verdict path (Requirement 2).

Each of the 40 Correctness Properties from the design is implemented as a single property-based test (>=100 iterations) using `fast-check` (TypeScript, authoritative) or `hypothesis` (Python cross-check where the design says so), tagged with the exact comment:
`// Feature: fx-daily-pattern-assistant, Property {number}: {property_text}`

Test sub-tasks are marked optional with `*`. Core implementation tasks are never optional.

## Tasks

- [x] 1. Project bootstrap + quality/documentation harness
  - [x] 1.1 Scaffold the TypeScript project on Node Active LTS with pinned latest-stable toolchain
    - Initialize the TS project (latest-stable TypeScript on Node Active LTS), configure ESLint, the type-checker, and the test runner (Vitest/Jest) with `fast-check` pinned
    - Configure the Python cross-check environment (latest-stable Python) with `hypothesis` pinned, invoked as isolated deterministic steps
    - Pin every third-party dependency to an exact, non-prerelease version; add a lint rule that fails on deprecated APIs
    - Add a `make check` / npm script that runs lint + type-check + tests
    - _Requirements: 3.3, 3.4, 18.1, 18.2, 18.3, 18.4, 18.5_

  - [x] 1.2 Configure CI to run lint, type-check, and tests, failing on any failure
    - Wire a CI workflow that runs lint, type-check, the test runner, and the version-policy check
    - Ensure the pipeline reports a failing status if any stage fails
    - _Requirements: 6.1, 6.2_

  - [x] 1.3 Implement the version-policy check and version ledger
    - Implement `VersionPolicyCheck.audit()` that fails when any pinned dep/lang/runtime is a prerelease or uses an open-ended version range
    - Implement `record()` to write `version_ledger` entries with selected version + verification date, and `availableUpgrades()` to surface newer stable versions for human review
    - Wire the audit into CI (from 1.2)
    - _Requirements: 18.3, 18.4, 18.6, 18.7, 18.8_

  - [x] 1.4 Write property test for version-policy enforcement
    - **Property 34: For all dependency/language/runtime specifications, the automated version-policy check fails if any specification is a prerelease build or uses an open-ended version range, and passes only when every specification is an exact, non-prerelease version.**
    - **Validates: Requirements 18.3, 18.4, 18.8**

  - [x] 1.5 Write unit tests for version ledger recording and upgrade surfacing
    - Test `record()` persists version + verification date; test `availableUpgrades()` surfaces newer stable versions
    - _Requirements: 18.6, 18.7_

  - [x] 1.6 Implement environment-based Supabase config (local + hosted) and connectivity round-trip
    - Read Supabase connection config from env supporting both a local and a hosted target
    - Implement a connectivity check performing a round-trip write and read
    - _Requirements: 6.3, 6.4, 17.2_

  - [x] 1.7 Create living-docs (PROJECT-STATE.md, RESEARCH-LOG.md, LESSONS.md) and the Living-Docs Writer
    - Author `PROJECT-STATE.md`, `RESEARCH-LOG.md`, and `LESSONS.md` (LESSONS.md captures PROJECT-PLAN section 0)
    - Implement `LivingDocs` with `updateState()`, `appendVerdict()`, `appendCut()`, and `validateLogEntry()` (structural check of a templated Research_Log entry)
    - _Requirements: 5.1, 5.2, 5.3, 6.5_

  - [x] 1.8 Write unit tests for living-docs writer and log-entry template validation
    - Test `validateLogEntry()` accepts a conforming template and rejects malformed entries; test docs existence smoke test
    - _Requirements: 5.1, 5.3, 6.5_

  - [x] 1.9 Implement the shared Look-Ahead Guard primitive
    - Implement `LookAheadGuard.assertPastOnly()` (reject any candle dated >= decisionDate), `isMatured()` (full horizon window closed as of evalDate), and `maturedPreDateOnly()` (filter analogues to matured, strictly-pre-date)
    - Surface rejections as typed `LookAheadViolation` results (fail-loud), never silent drops; export as the single source of truth for date-boundary safety
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 1.10 Write the look-ahead-guard property test
    - **Property 2: For all candle sets and Decision_Dates, the guarded feature/retrieval input contains no candle dated at or after the Decision_Date, and for all forward outcomes and evaluation dates, an outcome is counted only when its full Horizon window has closed as of the evaluation date.**
    - This is the mandated look-ahead-guard named test (Requirement 4.5)
    - **Validates: Requirements 4.1, 4.2, 4.4, 4.5, 7.5**

- [x] 2. Storage schema and daily OHLC ingestion
  - [x] 2.1 Create the shared Supabase migrations (schema identical local and hosted)
    - Author migrations for `candles`, `yields` (per-country 10Y, keyed by `(country,date)`), `pattern_vectors` (with HNSW `vector_cosine_ops` index + `weekly_trend_sign` metadata index), `analogue_outcomes`, `data_splits`, `walk_forward_folds` (fold_index, train/test bounds, `frozen`), `gate_fold_verdicts` (per-fold gate results + `skipped` flag), `feature_registry`, `gate_verdicts`, `firing_setups` (stop_loss/take_profit + `suppression_reason` enum incl. `'currency_concentration'` + competing_pairs), `calendar_events`, `news_risk_flags`, and `version_ledger`; enable pgvector
    - Include the `ohlc_valid` check constraint on `candles` and the `(asset,date)` primary key; key `yields` by `(country,date)`, `walk_forward_folds` by `(asset,fold_index)`, `gate_fold_verdicts` by `(verdict_id,fold_index)`, and `firing_setups` by `(decision_date,pair)`
    - Keep compute and storage independent of any serving layer; the same migrations run local and hosted
    - _Requirements: 7.2, 7.3, 8.4, 13.8, 17.1, 17.2, 19, 21, 22_

  - [x] 2.2 Implement NY-close session-boundary normalization
    - Implement `normalizeSessionBoundary()` to normalize every source feed to the 17:00 America/New_York boundary (22:00 UTC during EST) before storage, producing Monday-Friday daily candles and merging Sunday partials into Monday
    - _Requirements: 7.7, 7.8_

  - [x] 2.3 Implement OHLC validation and idempotent ingestion keyed by (asset, date)
    - Implement `validate()` rejecting high<low or open/close outside [low,high]; implement `ingest()` performing idempotent upsert by (asset,date), invoking the Look-Ahead Guard on adjacent windowing
    - Implement `coverageSummary()` producing per-pair coverage of ingested daily history
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 2.4 Write property test for OHLC validity rejection
    - **Property 32: For all candidate candles, ingestion accepts the candle if and only if its high is greater than or equal to its low and both open and close fall within the high-low range; otherwise it is rejected.**
    - **Validates: Requirement 7.3**

  - [x] 2.5 Write property test for idempotent ingestion
    - **Property 33: For all source candle sets, ingesting the set once and ingesting it multiple times produce the same stored result with no duplicate (Asset, Date) rows.**
    - **Validates: Requirement 7.4**

  - [x] 2.6 Write integration test for OHLC ingestion into Supabase and coverage summary
    - Ingest representative candles into Supabase; assert stored result and per-pair coverage summary
    - _Requirements: 7.1, 7.6_

  - [x] 2.7 Implement yield-feed ingestion into `yields` (per-country 10Y)
    - Implement `ingestYields()` performing look-ahead-safe, idempotent upsert of per-country 10Y government-bond yields keyed by (country, date)
    - Implement a fail-safe: when the yield feed is missing/unavailable for a (country, date), treat the yield feature as unavailable for that date (never fabricate, interpolate, or use a future value)
    - _Requirements: 13.8_

  - [x] 2.8 Write integration test for yield ingestion into Supabase
    - Ingest representative per-country 10Y yields; assert `(country,date)` keying, idempotent upsert, and the missing-feed unavailable path
    - _Requirements: 13.8_

  - [x] 2.9 Add strategy attribution and the realized-outcomes journal schema (follow-up migration)
    - Add a follow-up Supabase migration (the initial schema in 2.1 is already applied): add `strategy_id text not null default 'system'` to `firing_setups` and make its primary key `(decision_date, pair, strategy_id)`; add `'too_choppy'` to the `firing_setups.suppression_reason` enum; create the new `realized_outcomes` table (per design Component 19 / Data Models) keyed by `(strategy_id, pair, decision_date)` for idempotent upsert
    - Land this with the storage schema so `strategy_id` and `realized_outcomes` exist before the first daily run and the predicted-vs-actual corpus can accumulate from day one; the same migration runs identically local and hosted and keeps compute/storage independent of any serving layer so future strategies (LLM-taught trader, Python algo) are separate consumers of shared storage
    - _Requirements: 25.1, 25.6, 25.7, 17.2_

- [x] 3. Minimal shape-only pattern vector
  - [x] 3.1 Implement the shape-only, per-scale-normalized pattern vector encoder
    - Implement `encode()` over fixed 10/20/40 trading-day windows, per-scale independent normalization, concatenated fixed dim=70 embedding; handle degenerate (zero-variance) windows with a defined non-error result
    - Implement `weeklyTrendSign()` = 5-trading-day rolling ROC sign (UP if Close*T - Close*{T-5} >= 0, else DOWN); enforce the Look-Ahead Guard on the input window
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 4.1_

  - [x] 3.2 Persist pattern vectors to pgvector with metadata
    - Store each vector as a `pattern_vectors` row (embedding, weekly_trend_sign, per-scale slices), keyed by (asset, decision_date)
    - _Requirements: 8.3, 8.4_

  - [x] 3.3 Write property test for shape-only scale invariance
    - **Property 9: For all input windows and positive price scalars, encoding the window and encoding the window with all prices multiplied by that scalar produce identical Pattern_Vectors, so absolute price level does not dominate the representation.**
    - **Validates: Requirement 8.2**

  - [x] 3.4 Write property test for identical-window determinism (deterministic reproducibility)
    - **Property 1 (encoder scope): For all valid inputs to the pattern-vector encoder, invoking it twice with identical inputs produces identical outputs.** Generators include zero-variance windows.
    - Part of the mandated deterministic-reproducibility named test
    - **Validates: Requirements 3.1, 3.2, 8.5**

  - [x] 3.5 Write integration test for pgvector persistence
    - Persist and read back a pattern vector; assert embedding and metadata round-trip
    - _Requirements: 8.4_

- [x] 4. Similarity retrieval and forward-outcome resolution
  - [x] 4.1 Implement pgvector retrieval with weekly-trend-sign pre-filter, self-exclusion, pre-date, matured-only, and Similarity_Radius epsilon cutoff
    - Implement `retrieve()` that pre-filters on `weekly_trend_sign` metadata before the ANN search, applies pgvector similarity, excludes the query itself, restricts to strictly-pre-date and matured analogues (via `maturedPreDateOnly`), and uses a stable tie-break ordering (similarity, then date, then asset) for determinism
    - Apply the configurable `Similarity_Radius` epsilon cutoff: admit an analogue only if its cosine distance to the query is <= epsilon (in addition to, not instead of, the existing pre-filters); if fewer than 30 analogues fall within epsilon for a Decision_Date, shrink Earned_Confidence toward neutral (reusing the sample-size floor/shrinkage mechanism) and surface nothing on similarity grounds alone
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7, 9.8, 9.9, 20_

  - [x] 4.2 Implement the forward-outcome resolver (1/2/3d terminal direction + MFE/MAE)
    - Implement `resolve()` capturing terminal Direction_Class and MFE/MAE at each of the 1/2/3-day horizons, using only candles dated after the analogue date; persist to `analogue_outcomes` with `matured` flag
    - _Requirements: 9.6, 4.2_

  - [x] 4.3 Write property test for retrieval self-exclusion, pre-date, matured-only
    - **Property 3: For all queries and backing data, every analogue in the returned Analogue_Neighborhood is dated strictly before the query Decision_Date, is a Matured_Outcome, and is not the query pattern itself.**
    - **Validates: Requirements 9.3, 9.4, 9.5**

  - [x] 4.4 Write property test for neighborhood weekly-trend regime match
    - **Property 10: For all queries and backing data, every analogue in the returned neighborhood has the same Weekly_Trend_Sign as the query.**
    - **Validates: Requirement 9.2**

  - [x] 4.5 Write property test for forward outcomes per horizon
    - **Property 11: For all resolved analogues, the forward outcome contains a terminal Direction_Class and MFE/MAE values for each of the 1-, 2-, and 3-day Horizons, computed only from candles dated after the analogue date.**
    - **Validates: Requirement 9.6**

  - [x] 4.6 Write property test for retrieval determinism
    - **Property 1 (retrieval scope): For all identical inputs, retrieval returns identical analogue sets.**
    - **Validates: Requirements 3.1, 9.7**

  - [x] 4.7 Write integration test for pgvector ANN retrieval ordering
    - Verify ANN retrieval ordering and metadata pre-filter against seeded data
    - _Requirements: 9.1_

  - [x] 4.8 Write the similarity-radius silence property test
    - **Property 35: For all queries and analogues, an analogue is admitted only if its cosine distance to the query is <= the configurable epsilon; and if fewer than 30 analogues fall within epsilon, no setup is surfaced on similarity grounds alone.**
    - This is the mandated "similarity-radius silence test"
    - **Validates: Requirements 9.8, 9.9, 20.2, 20.3**

- [x] 5. Earned confidence, FLAT dead-band, and horizon selection
  - [x] 5.1 Implement earned confidence with fixed-prior shrinkage
    - Implement `earnedConfidence()` = `(n/(n+k))*C_raw + (k/(n+k))*0.5` with k=10, constrained to [0,1]; a sub-30-analogue neighborhood cannot cross the threshold on sample size alone
    - _Requirements: 10.1, 10.2, 10.3, 10.7_

  - [x] 5.2 Implement ATR_14-scaled FLAT dead-band classification and horizon selection
    - Compute ATR_14; implement `classify()` returning exactly one Direction_Class using the ATR_14-scaled dead-band (not a fixed pip count); implement `selectHorizon()` picking the horizon with strongest historical resolution
    - _Requirements: 1.4, 10.4, 10.5, 10.6_

  - [x] 5.3 Write property test for bounded confidence
    - **Property 12: For all Analogue_Neighborhoods and Horizons, the computed Earned_Confidence lies within the range [0,1].**
    - **Validates: Requirement 10.2**

  - [x] 5.4 Write property test for sample-size shrinkage toward neutral
    - **Property 13: For all neighborhoods, Earned_Confidence equals C_shrunk = (n/(n+k))*C_raw + (k/(n+k))*0.5 with k=10; for pairs of neighborhoods with the same C_raw but differing analogue counts, the one with fewer analogues yields a confidence no farther from 0.5 than the larger one, and a sub-30-analogue neighborhood cannot be reported as crossing the Confidence_Threshold on sample size alone.**
    - **Validates: Requirement 10.3**

  - [x] 5.5 Write property test for total, exact direction classification
    - **Property 7: For all net forward moves and ATR_14 values, classification returns exactly one Direction_Class; the move classifies FLAT if and only if it lies within the ATR_14-scaled dead-band, and UP or DOWN by the sign of the move otherwise.**
    - **Validates: Requirements 1.4, 10.5**

  - [x] 5.6 Write property test for ATR_14-scaled FLAT band
    - **Property 8: For all net moves and positive ATR_14 values, scaling ATR_14 by a positive factor scales the FLAT dead-band boundary by the same factor; the classification boundary is not a fixed pip constant.**
    - **Validates: Requirement 10.4**

  - [x] 5.7 Write property test for horizon selection maximizing resolution
    - **Property 14: For all Analogue_Neighborhoods, the resolution rate at the selected Horizon is greater than or equal to the resolution rate at every other candidate Horizon (1, 2, 3).**
    - **Validates: Requirement 10.6**

  - [x] 5.8 Write property test for confidence determinism (Python cross-check)
    - **Property 1 (confidence scope): For all identical inputs, earnedConfidence returns identical values.** Implement the authoritative test in fast-check and a `hypothesis` cross-check of the shrinkage formula distribution.
    - **Validates: Requirements 3.1, 10.7**

- [x] 6. Two-stage kill-gate harness (BEFORE feature discovery)
  - [x] 6.1 Implement the weekly-trend-follow baseline
    - Implement `Baseline.predict()` returning the 5-trading-day rolling ROC sign (UP if Close*T - Close*{T-5} >= 0, else DOWN)
    - _Requirements: 11.1_

  - [x] 6.2 Implement the walk-forward folds (sequential, non-overlapping, chronological)
    - Implement `walkForwardFolds()` producing sequential, non-overlapping, chronologically ordered train/test folds (default ~3y train / ~1y test, rolling forward by the test period) where every train window strictly precedes its test window; the out-of-sample set is the union of the test folds
    - Persist folds to `walk_forward_folds` with frozen boundaries (`frozen=true`) and reject attempts to change recorded fold dates (change-rejection)
    - _Requirements: 11.2, 11.4, 19.1, 19.2_

  - [x] 6.3 Implement Gate 1 (conditional/matched-subset directional) with sample-size floor
    - Compute metrics on the Out_Of_Sample_Test only; evaluate only where the matched neighborhood has >=30 analogues; Gate 1 passes iff model accuracy exceeds baseline accuracy by >=3pp, where baseline accuracy is computed on the model's firing subset of Decision_Dates and that subset has >=30 samples
    - _Requirements: 11.3, 11.5, 11.6_

  - [x] 6.4 Implement Gate 2 (risk-adjusted MFE/MAE) with symmetric pair-specific friction
    - Evaluate Gate 2 only after Gate 1 passes; deduct Friction_Penalty (1.5 pips EURUSD/GBPUSD; 2.0 pips USDJPY/USDCHF/USDCAD) from MFE/MAE of BOTH model and baseline; pass iff model excursion-weighted hit metric >= baseline's after deduction
    - _Requirements: 11.7, 11.8_

  - [x] 6.5 Compose the walk-forward verdict and auto-append to the Research_Log
    - Evaluate both gates per fold; a config PASSES only if it passes BOTH Gate 1 and Gate 2 on EVERY qualifying fold (matched-firing subset >=30-sample floor); folds below the floor are skipped and recorded; a single failing qualifying fold makes the verdict CUT
    - Persist per-fold verdicts + metrics to `gate_fold_verdicts` and the aggregate verdict to `gate_verdicts`; auto-append the aggregate + per-fold verdicts and accuracy-vs-baseline and risk-adjusted-vs-baseline metrics to `RESEARCH-LOG.md` (via LivingDocs), and log cuts with metrics
    - _Requirements: 11.2, 11.9, 11.10, 11.11, 11.13, 19, 5.4, 5.5, 12.1_

  - [x] 6.6 Write property test for baseline equals weekly trend sign
    - **Property 15: For all Decision*Dates and Pairs, the Weekly_Trend_Follow baseline's predicted direction equals the Weekly_Trend_Sign, defined as the 5-trading-day rolling ROC: UP when Close_T - Close*{T-5} >= 0, otherwise DOWN.**
    - **Validates: Requirement 11.1**

  - [x] 6.7 Write property test for the chronological split definition
    - **Property 16: For all histories, the Data_Split assigns the earliest 70% (±2pp) to train/dev and the most recent 30% (±2pp) to the Out_Of_Sample_Test with no shuffling, and every train date precedes every test date.**
    - Note: retained for the split definition; the primary evaluation partition is now the walk-forward folds (see 6.2, and Property 36 in 6.17)
    - **Validates: Requirement 11.2**

  - [x] 6.8 Write property test for immutable recorded split dates
    - **Property 17: For all frozen Data_Splits, any attempt to change the recorded split dates is rejected and the originally recorded dates are retained.**
    - **Validates: Requirement 11.4**

  - [x] 6.9 Write property test for out-of-sample-only verdicts
    - **Property 18: For all Kill_Gate verdicts, every date contributing to the scored metrics belongs to the Out_Of_Sample_Test partition.**
    - **Validates: Requirement 11.3**

  - [x] 6.10 Write property test for sample-size floor gating evaluation
    - **Property 19: For all configurations whose matched Analogue_Neighborhood contains fewer than 30 analogues, the Kill_Gate withholds a pass/cut evaluation for that configuration.**
    - **Validates: Requirement 11.5**

  - [x] 6.11 Write property test for Gate 1 directional threshold
    - **Property 20: For all out-of-sample metrics, Gate_1 passes if and only if the pattern-model's directional accuracy exceeds the baseline's accuracy by at least 3 percentage points, where the baseline's accuracy is computed on the matched subset of Decision_Dates on which the model fires, and that matched subset contains at least 30 samples.**
    - **Validates: Requirement 11.6**

  - [x] 6.12 Write the symmetric-friction property test (mandated named test)
    - **Property 21: For all excursion sets and Pairs, the pair-specific Friction_Penalty (1.5 pips EURUSD/GBPUSD; 2.0 pips USDJPY/USDCHF/USDCAD) is deducted from the MFE/MAE excursions of both the pattern-model outcomes and the baseline outcomes before comparison, so the same penalty applied to both sides never advantages one side over the other.**
    - **Validates: Requirement 11.7**

  - [x] 6.13 Write property test for Gate 2 sequencing and risk-adjusted threshold
    - **Property 22: For all configurations, Gate_2 is evaluated only after Gate_1 has passed, and Gate_2 passes if and only if the pattern-model's excursion-weighted hit metric over the selected Horizon is >= the baseline's after Friction_Penalty deduction (margin >= 0).**
    - **Validates: Requirement 11.8**

  - [x] 6.14 Write property test for verdict composition
    - **Property 23: For all configurations, the Kill_Gate verdict is PASS if and only if both Gate_1 and Gate_2 pass; otherwise it is CUT, and the corresponding verdict and metrics are logged.**
    - **Validates: Requirements 11.9, 11.10**

  - [x] 6.15 Write the kill-gate fixture-reproducibility named test
    - **Property 1 (kill-gate scope): the harness reproduces known metrics on a fixed fixture.** Assert deterministic metrics on a recorded fixture.
    - **Validates: Requirements 3.1, 11.12**

  - [x] 6.16 Write the deliberately-null-feature-fails named test
    - A feature/pattern with no predictive signal must FAIL both gates (verifies Properties 20, 22, 23 discriminate signal from noise)
    - _Requirements: 11.6, 11.8, 11.9, 11.10_

  - [x] 6.17 Write property test for walk-forward fold construction
    - **Property 36: For all histories, the Walk_Forward_Window folds are sequential, non-overlapping, chronologically ordered with every train window preceding its test window, and the out-of-sample set equals the union of the test folds.**
    - **Validates: Requirements 11.2, 19.1**

  - [x] 6.18 Write the cross-regime inclusion property test
    - **Property 37: For all candidate configurations, a feature/config is admitted only if it passes both Gate_1 and Gate_2 on every qualifying walk-forward fold; folds below the >=30-sample floor are skipped and recorded, and a single failing qualifying fold blocks inclusion.**
    - This is the mandated "cross-regime inclusion test": a feature passing recent data but failing an earlier-regime fold must NOT be included
    - **Validates: Requirements 11.13, 19.3, 19.5**

- [x] 7. Checkpoint - shape-only model provable through the gate
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Feature discovery through the gate (one at a time, ceiling <=12)
  - [x] 8.1 Implement the Feature Registry with independent toggling and inclusion ceiling
    - Implement `candidates()` (%B, RSI, volumeProxyRegime, weeklyTrendContext, distanceToSma, structuralLiquiditySr, yieldSpread10y), `evaluateOneAtATime()` re-running the gate per candidate, `included()` capped at 12; retain passers, cut+log failers with metric deltas (via LivingDocs); persist to `feature_registry`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.8, 12.2, 12.3_

  - [x] 8.2 Implement the candidate feature computations including Structural_Liquidity_SR distance and yield spread
    - Implement %B, RSI, volume-proxy regime (regime not magnitude), weekly-trend context, distance-to-SMA, and `structuralLiquidityDistance()` = distance to nearest of Prev Day High/Low, Prev Week High/Low, and 20-Day High/Low; all under the Look-Ahead Guard
    - Implement `yieldSpread10y()` = base-country 10Y minus quote-country 10Y, using only `yields` rows dated strictly before the Decision_Date (look-ahead guard); apply the missing-yield fail-safe (feature treated as unavailable for that date, never fabricated/interpolated/future-valued)
    - _Requirements: 13.5, 13.6, 13.8, 4.1_

  - [x] 8.3 Write property test for inclusion requiring a passing verdict
    - **Property 25: For all candidate features, a feature is in the included set only if a PASS verdict exists for it; a feature without a PASS verdict is never included.**
    - **Validates: Requirements 12.2, 13.2**

  - [x] 8.4 Write property test for the feature ceiling
    - **Property 26: For all sequences of feature inclusions, the count of included features never exceeds 12.**
    - **Validates: Requirement 13.4**

  - [x] 8.5 Write property test for structural liquidity distance
    - **Property 27: For all prices and reference-level sets, the Structural_Liquidity_SR feature equals the minimum absolute distance to the nearest of Previous Day High/Low, Previous Week High/Low, and 20-Day High/Low.**
    - **Validates: Requirement 13.6**

  - [x] 8.6 Write property test for reproducible verdict on independent toggle
    - **Property 1 (feature-toggle scope): For all features toggled independently with otherwise-unchanged config, the prior verdict is reproduced.**
    - **Validates: Requirements 3.1, 13.7**

  - [x] 8.7 Write unit tests for candidate membership, single-candidate gate run, and cut logging with deltas
    - Test `candidates()` membership, one-candidate gate run, and cut logging with metric deltas
    - _Requirements: 13.1, 13.3, 13.5_

  - [x] 8.8 Write property test for the yield-spread feature definition
    - **Property 40: For all Pairs and Decision_Dates, the Yield_Spread feature equals the base-country 10Y yield minus the quote-country 10Y yield, using only yield data dated strictly before the Decision_Date.**
    - **Validates: Requirement 13.8**

- [x] 9. AI layer behind the thin swappable LLM_Interface
  - [x] 9.1 Implement the LLM_Interface with role gating and provenance tagging
    - Implement `invoke<R>()` accepting only the four sanctioned roles (news_filter, signal_rationale, pattern_description, research_assistant), rejecting and recording any other role; wrap all outputs in `LlmTagged<T>` provenance markers; all LLM calls route through this interface
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 9.2 Implement the ScoringInputGuard and the AI/deterministic boundary enforcement
    - Implement `ScoringInputGuard` that rejects any LlmTagged value reaching a scoring function, records the blocked attempt, and leaves deterministic probability/verdict computations unchanged; ensure scoring function signatures accept no LLM-derived type
    - _Requirements: 2.1, 2.2, 2.6_

  - [x] 9.3 Implement the News Filter and deterministic suppression with fail-safe
    - Implement `ingestCalendar()` parsing structured calendar JSON ({name, currency, impact, timestamp}) into `calendar_events`; `riskFlag()` via LLM_Interface emitting structured `RiskFlag {level, reason}`; deterministic `suppress()` consuming only the flag (never generating a Direction_Class), recording the reason; fail-safe: on feed unavailable/timeout/invalid, flag missing context, log ingestion error, and suppress all cards
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [x] 9.4 Implement signal rationale, analogue labels, and human-gated research assist
    - Implement `signal_rationale` (plain-language text derived from deterministic numeric inputs, cannot alter the signal), `pattern_description` (qualitative analogue labels), and `research_assistant` (proposals only; the registry withholds acceptance until recorded human approval); exclude rationale/labels from probability and verdict computations
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 2.8_

  - [x] 9.5 Write the AI-free-scoring guardrail named test
    - **Property 4: For all LLM-tagged values, no such value reaches the directional-probability computation or the Kill_Gate verdict computation; any attempt is blocked and recorded, and the deterministic computations proceed unchanged; equivalently, generating rationale/analogue labels leaves the numeric probability and verdict identical.**
    - **Validates: Requirements 2.1, 2.2, 2.6, 2.7, 15.2, 15.4**

  - [x] 9.6 Write property test for LLM role gating
    - **Property 5: For all role identifiers passed to the LLM_Interface, the call is accepted if and only if the role is one of the four sanctioned roles; any other role is rejected before invocation and the rejected role is recorded.**
    - **Validates: Requirements 2.3, 2.5**

  - [x] 9.7 Write property test for human-gated research proposals
    - **Property 6: For all research-assistant proposals lacking a recorded human approval, the included feature set and recorded interpretations are identical before and after the proposal.**
    - **Validates: Requirement 2.8**

  - [x] 9.8 Write property test for deterministic news suppression never generating a signal
    - **Property 28: For all structured risk flags, the suppression decision is a pure function of the flag and produces only a suppress/permit outcome (with a reason), never a Direction_Class.**
    - **Validates: Requirements 14.3, 14.5**

  - [x] 9.9 Write property test for elevated event risk suppressing firing setups
    - **Property 29: For all Pairs and Decision_Dates where the news filter indicates elevated event risk, any otherwise-firing setup for that Pair is suppressed and the stated reason is recorded.**
    - **Validates: Requirement 14.4**

  - [x] 9.10 Write the news fail-safe named property test
    - **Property 30: For all feed-failure modes (unavailable, timeout, or failed validation) on a Decision_Date, the missing news context is flagged, an ingestion error is logged, and every one of the five Pairs is suppressed for that Decision_Date.**
    - **Validates: Requirement 14.6**

  - [x] 9.11 Write unit/smoke tests for news JSON parsing, RiskFlag shape, rationale/label generation, and the LLM-import boundary
    - Test calendar JSON field validation, structured RiskFlag shape, rationale/label generation from numeric inputs, and a static check that no module imports an LLM client except through LLM_Interface
    - _Requirements: 14.1, 14.2, 15.1, 15.3, 2.4_

- [x] 10. Silent-by-default dashboard and scheduled runs
  - [x] 10.1 Implement the daily-run entry point, silent-by-default dashboard, and Currency Concentration Guard
    - Implement `Dashboard.dailyRun()` across all 5 pairs; a pair renders iff it is gate-passing AND Earned_Confidence >= the configurable Confidence_Threshold AND news permits; empty otherwise; never display a feature/pattern that has not passed the gate; respect news suppression; make the threshold configurable and tunable against the backtest
    - Implement the Currency Concentration Guard (Component 16) as a dashboard-level suppression step that runs AFTER per-pair firing decisions and BEFORE render: within each set of aligned same-currency (base or quote) same-day setups, keep only the top-N (default 2, configurable) highest-Earned_Confidence setups and suppress the rest with reason `'currency_concentration'` + competing pairs; deterministic, no LLM
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 16.6, 1.1, 1.2, 12.3, 22_

  - [x] 10.2 Implement the firing card rendering
    - Render a firing card showing pair, Direction_Class, selected Horizon, Earned_Confidence, favorable-vs-adverse excursion profile, the empirical Stop_Loss and Take_Profit (from Component 15, task 10.7), and AI rationale
    - _Requirements: 16.3, 1.3, 1.5, 21.4_

  - [x] 10.3 Implement the GCP-scheduled daily refresh reusing the same entry point
    - Package the deterministic TypeScript daily-run entry point as a container and deploy it as a Cloud Run Job (run-to-completion batch), triggered on the daily cadence by Cloud Scheduler; the scheduled run reuses the exact same entry point as the local dashboard and produces the same result unattended as an equivalent local run
    - Add the delivery pipeline as code: a GitHub Actions workflow on the `main` branch that runs the full quality gate (`npm run check`) and, only on green, builds the image via Cloud Build, pushes it to Artifact Registry tagged with the commit SHA, and deploys that SHA-pinned image to the Cloud Run Job (enabling exact rollback; extends the determinism principle to ops)
    - Authenticate CI to Google Cloud via Workload Identity Federation (keyless OIDC), and run the Cloud Run Job as a dedicated least-privilege service account
    - Source runtime secrets (Supabase URL/keys, DB connection) from Google Secret Manager at runtime — never committed or baked into the image; provide non-secret config (project, region, model) via environment variables per the project's `.env` conventions
    - Connect to Supabase from Cloud Run via the IPv4-reachable connection pooler (or REST path), not the IPv6-only direct database host
    - _Requirements: 16.7_

  - [x] 10.4 Write property test for the silent-by-default firing invariant
    - **Property 24: For all Pairs and Decision_Dates, a Pair is surfaced iff it has a Kill_Gate-passing pattern AND its Earned_Confidence crosses the configurable Confidence_Threshold AND the news filter permits trading; if none satisfy all three, the dashboard is empty, and nothing unpassed by the Kill_Gate is ever displayed. In addition, the Currency_Concentration_Guard is applied as a further suppression step, so a Pair satisfying all three conditions may still be suppressed when it is an aligned same-currency setup outranked beyond the top-N by Earned_Confidence.**
    - **Validates: Requirements 1.1, 1.2, 12.3, 16.2, 16.5, 16.6, 22.1**

  - [x] 10.5 Write property test for firing card required fields
    - **Property 31: For all firing setups, the rendered card includes the Pair, Direction_Class, selected Horizon, Earned_Confidence, the favorable-versus-adverse excursion profile, the empirical Stop_Loss and Take_Profit, and the AI rationale.**
    - **Validates: Requirements 1.3, 1.5, 16.3, 21.4**

  - [x] 10.6 Write property test for scheduled-run/local-run reproducibility and unit test for threshold configurability
    - **Property 1 (view scope): For all identical fixed storage, a scheduled unattended run produces the same view as an equivalent local run.** Add a unit test asserting the Confidence_Threshold is configurable.
    - **Validates: Requirements 3.1, 16.4, 16.7**

  - [x] 10.7 Implement Component 15 Empirical Risk Boundaries (deterministic, no LLM)
    - Implement `derive()` deriving Stop_Loss = configurable percentile (default 75th) of neighborhood MAE and Take_Profit = configurable percentile (default 50th) of neighborhood MFE at the selected horizon, computed deterministically with no LLM input; return not-actionable (null) when the neighborhood has < 30 analogues
    - _Requirements: 21_

  - [x] 10.8 Write the empirical risk boundaries property test
    - **Property 38: For all firing neighborhoods with at least 30 analogues, Stop_Loss equals the configured percentile (default 75th) of neighborhood MAE and Take_Profit equals the configured percentile (default 50th) of neighborhood MFE, computed deterministically with no LLM input; for neighborhoods below the floor, the boundaries are not surfaced as actionable.**
    - This is the mandated "empirical risk boundaries test"
    - **Validates: Requirements 21.1, 21.2, 21.3, 21.5**

  - [x] 10.9 Write the currency-concentration guard property test
    - **Property 39: For all sets of same-day setups aligned on the same base or quote currency, the Currency_Concentration_Guard retains only the N highest-Earned_Confidence aligned setups (default N=2) and suppresses the rest with a recorded currency-concentration reason and competing Pairs, computed deterministically with no LLM input.**
    - This is the mandated "currency-concentration guard test"
    - **Validates: Requirements 22.1, 22.2, 22.3, 22.4**

  - [x] 10.10 Persist per-pair firing/suppression outcomes to `firing_setups`
    - Write each pair's firing/suppression outcome (Direction_Class, horizon, Earned_Confidence, empirical Stop_Loss/Take_Profit, `surfaced` flag, `suppression_reason` incl. `'currency_concentration'`, and competing pairs) to `firing_setups` keyed by (decision_date, pair)
    - _Requirements: 21, 22_

- [ ] 11. Integration, schema parity, and serving-layer architecture guard
  - [~] 11.1 Wire the end-to-end pipeline and add schema-parity integration test
    - Wire ingestion -> encoder -> retrieval -> resolver -> confidence -> kill-gate -> feature registry -> news filter -> dashboard into a single daily-run path; add an integration test asserting the storage schema is identical across local and hosted Supabase targets
    - _Requirements: 17.2_

  - [~] 11.2 Write the serving-layer architecture-guard test (documentation/architecture guard only)
    - Add a smoke/structural test asserting compute and storage never depend on a serving layer and no public API/website exists in v1, reserving the read-only serving layer so it can be added later without rearchitecting (later phase, NOT implemented in v1)
    - _Requirements: 17.1, 17.3, 17.4_

  - [~] 11.3 Implement the External Signal Cross-Reference provider and dashboard display (outside the deterministic core)
    - Implement a thin, swappable `ExternalSignalProvider` interface (Component 17) that fetches the CURRENT third-party technical-analysis signal (recommended direction + provider score) for each of the five pairs at daily-run time; wrap results as `ExternalReferenceSignal` with a provider provenance tag and fetch timestamp
    - Fetch and compare entirely OUTSIDE the deterministic core: the external reference is never an input to the directional probability, Earned_Confidence, Direction_Class, Kill_Gate verdict, retrieval, or any scoring/decision path; including or omitting it must leave every computed probability and verdict identical
    - Display the reference beside each pair's own output on the dashboard so agreement/divergence is visually apparent for human comparison; optionally log the comparison (e.g. to the Research_Log) for later divergence analysis — display/research-only, never feeding scoring
    - Use only current signals for the live daily run; never use external references for historical backtest or Kill_Gate evaluation (look-ahead safety, reproducibility)
    - Fail-safe: on provider unavailable/timeout/invalid response, mark the reference unavailable for that pair via a typed error and leave the system's own output unchanged
    - _Requirements: 23_

  - [~] 11.4 Write tests for the external cross-reference boundary and fail-safe
    - Unit/smoke test the `ExternalSignalProvider` interface (swappable provider, `ExternalReferenceSignal` shape) and the fail-safe path (unavailable/timeout/invalid → reference marked unavailable, own output unchanged)
    - Add a boundary test asserting that including vs omitting the external reference leaves the directional probability and Kill_Gate verdict byte-for-byte identical (the external reference never reaches a scoring/decision path), and that external references are not used in any historical backtest/Kill_Gate evaluation
    - _Requirements: 23.2, 23.3, 23.4, 23.5, 23.6_

  - [~] 11.5 Implement the Choppiness Volatility Silence Guard (deterministic dashboard-level suppressor, all pairs)
    - Implement `ChoppinessGuard` (Component 18): compute a look-ahead-safe `Choppiness_Metric` per pair as the Kaufman Efficiency Ratio ER = |Close_T − Close_{T−w}| / Σ|Close_i − Close_{i−1}| over a fixed trailing window w (value in [0,1]; ~1 clean trend, ~0 chop), using only candles dated strictly before the Decision_Date via the shared Look-Ahead Guard
    - Run it as a dashboard-level suppression step after per-pair firing decisions (gate-passing, confidence, news) and before final render, across all five pairs; when ER is below a configurable, backtest-tunable threshold, suppress that pair's otherwise-firing setup (hard veto — the pair stays silent) and record a `'too_choppy'` suppression reason; compose with the news and currency-concentration suppressors rather than replacing them
    - Suppressor only: never generate a Direction_Class or signal; never feed the directional probability, Earned_Confidence, Direction_Class classification, retrieval, or the Kill_Gate verdict; no LLM input; deterministic and reproducible
    - Persist the choppiness suppression outcome/reason alongside the other firing/suppression outcomes in `firing_setups`
    - _Requirements: 24_

  - [~] 11.6 Write property test for the choppiness silence guard boundary and determinism
    - **Property 41: For all pairs and Decision_Dates, the Choppiness_Guard suppresses an otherwise-firing setup if and only if the look-ahead-safe Efficiency-Ratio Choppiness_Metric is below the configurable threshold; suppression never generates a Direction_Class and leaves the directional probability, Earned_Confidence, and Kill_Gate verdict identical; and the Choppiness_Metric is deterministic (identical inputs yield identical values) and takes no LLM input.**
    - **Validates: Requirements 24.2, 24.4, 24.5, 24.7, 24.8**

  - [~] 11.8 Implement realized-outcome journaling with Strategy_Source attribution (look-ahead-safe, idempotent)
    - Using the `strategy_id` column and `realized_outcomes` table added by the schema migration in task 2.9, tag every surfaced/suppressed signal with a `strategyId` (default `'system'` for v1); on each daily run, write/update a `realized_outcomes` entry pairing the fired setup's prediction (strategyId, pair, decision_date, predicted direction, selected horizon, Earned_Confidence, empirical Stop_Loss/Take_Profit) with the actual matured forward outcome (terminal Direction_Class, MFE/MAE) once its Horizon window has closed
    - Populate the realized outcome only from Matured_Outcomes using candles dated after the Decision_Date via the shared Look-Ahead Guard; make the write idempotent per (strategyId, pair, decision_date); keep this entirely outside the directional probability, Earned_Confidence, retrieval, and Kill_Gate computations so recording it leaves them unchanged
    - _Requirements: 25.1, 25.2, 25.3, 25.4_

  - [~] 11.9 Write tests for strategy attribution and the realized-outcome journal
    - Unit/integration test: `strategy_id` defaults to `'system'` and participates in the `firing_setups` and `realized_outcomes` keys so multiple strategies can coexist; realized outcomes are populated only from matured, strictly-after-decision-date candles; journaling is idempotent per (strategyId, pair, decision_date) (re-running a day does not duplicate)
    - Boundary test: recording attribution and journal entries leaves the directional probability, Earned_Confidence, and Kill_Gate verdict byte-for-byte identical (the journal never feeds scoring)
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.7_

- [~] 12. Final checkpoint - full suite green
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- **Build-order discipline (Requirement 12):** the two-stage kill-gate harness (Task 6) is proven on the shape-only model before any candidate feature is introduced (Task 8). The checkpoint in Task 7 enforces this gate.
- The **Look-Ahead Guard** (Task 1.9) is a shared, tested primitive reused by ingestion, encoder, retrieval, resolver, and feature computations (Requirement 4).
- The **AI/deterministic boundary** (`LLM_Interface` + `ScoringInputGuard`, Tasks 9.1-9.2) structurally prevents any LLM output from reaching probability or verdict paths (Requirement 2).
- Each of the 40 Correctness Properties is implemented as one property-based test at >=100 iterations (fast-check authoritative; hypothesis cross-check where the design specifies), tagged with the exact comment format.
- Mandated named tests: deterministic reproducibility (1.10/3.4/4.6/5.8/6.15/8.6/10.6), look-ahead-guard (1.10), kill-gate fixture reproducibility (6.15), deliberately-null-feature-fails (6.16), AI-free-scoring guardrail (9.5), news fail-safe (9.10), symmetric-friction (6.12), cross-regime inclusion (6.18), similarity-radius silence (4.8), currency-concentration guard (10.9), empirical risk boundaries (10.8).
- Requirement coverage: R1 (10.1,10.2,5.2), R2 (9.1,9.2,9.4,9.5,9.6,9.7), R3 (1.1,all determinism tests), R4 (1.9,1.10), R5 (1.7,6.5), R6 (1.2,1.6,1.7), R7 (2.x), R8 (3.x), R9 (4.x incl. 9.8/9.9 via 4.1/4.8), R10 (5.x), R11 (6.x incl. 11.13 via 6.5/6.18), R12 (6.5,7,8.1,10.1), R13 (8.x incl. 13.8 via 2.7/8.1/8.2/8.8), R14 (9.3,9.8-9.11), R15 (9.4,9.5), R16 (10.x), R17 (2.1,11.1,11.2), R18 (1.1,1.3,1.4,1.5), R19 (6.2,6.5,6.17,6.18), R20 (4.1,4.8), R21 (10.7,10.8,10.10), R22 (10.1,10.9,10.10), R23 (11.3,11.4), R24 (11.5,11.6), R25 (2.9,11.8,11.9).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.6", "1.7", "1.9"] },
    { "id": 2, "tasks": ["1.4", "1.5", "1.8", "1.10", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.7"] },
    { "id": 4, "tasks": ["2.4", "2.5", "2.6", "2.8", "2.9", "3.1"] },
    { "id": 5, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 6, "tasks": ["3.5", "4.1", "4.2"] },
    {
      "id": 7,
      "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "5.1", "5.2"]
    },
    {
      "id": 8,
      "tasks": ["5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "6.1", "6.2"]
    },
    { "id": 9, "tasks": ["6.3", "6.4"] },
    { "id": 10, "tasks": ["6.5"] },
    {
      "id": 11,
      "tasks": [
        "6.6",
        "6.7",
        "6.8",
        "6.9",
        "6.10",
        "6.11",
        "6.12",
        "6.13",
        "6.14",
        "6.15",
        "6.16",
        "6.17",
        "6.18"
      ]
    },
    { "id": 12, "tasks": ["8.1", "8.2"] },
    { "id": 13, "tasks": ["8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "9.1"] },
    { "id": 14, "tasks": ["9.2", "9.3", "9.4"] },
    {
      "id": 15,
      "tasks": [
        "9.5",
        "9.6",
        "9.7",
        "9.8",
        "9.9",
        "9.10",
        "9.11",
        "10.1",
        "10.7"
      ]
    },
    { "id": 16, "tasks": ["10.2", "10.3", "10.9", "10.10"] },
    { "id": 17, "tasks": ["10.4", "10.5", "10.6", "10.8", "11.1"] },
    { "id": 18, "tasks": ["11.2"] },
    { "id": 19, "tasks": ["11.3", "11.4"] },
    { "id": 20, "tasks": ["11.5", "11.6"] },
    { "id": 21, "tasks": ["11.8", "11.9"] }
  ]
}
```
