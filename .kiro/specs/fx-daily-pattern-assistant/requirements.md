# Requirements Document

## Introduction

The FX Daily Pattern Trading Assistant is a greenfield, local-first personal trading assistant for five major FX pairs (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD). It is the successor to a prior FX forecasting system that failed by chasing an unfalsifiable, high-dimensional, short-horizon signal. This system inverts that failure mode: it surfaces a small number of high-conviction, forward-looking daily directional setups ("over the next 1-3 days, direction X, with earned confidence C%") and stays silent otherwise. No feature or pattern class may drive a displayed signal until it beats a defined baseline out-of-sample.

Two ideas are non-negotiable and shape every requirement below:

1. **Measure before believing** — nothing reaches the dashboard until it passes a deterministic, out-of-sample kill-gate.
2. **AI explains and filters; deterministic code decides and scores** — an LLM may read news, write rationale, describe analogues, and help interpret results, but must never compute the directional probability or the kill-gate verdict.

This document specifies the requirements for the research-phase and v1 dashboard capabilities. A public serving layer / website is explicitly out of v1 scope but must be architecturally reserved.

## Glossary

- **System**: The FX Daily Pattern Trading Assistant as a whole.
- **Pair / Asset**: One of the five supported instruments: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD.
- **Decision_Date**: The trading date at which a signal is evaluated. Only data dated strictly before this date may inform features or retrieval.
- **Session_Close / NY_Close**: The daily candle boundary at 17:00 America/New_York (New York close), i.e. 22:00 UTC during US Eastern Standard Time. Daily candles run Monday–Friday (5 per week); Sunday partial candles are merged into Monday rather than stored separately. All feeds are normalized to this boundary before storage.
- **Horizon**: A forward evaluation window of 1, 2, or 3 trading days. The System evaluates all three and selects the horizon with the strongest historical resolution for the matched neighborhood.
- **Direction_Class**: One of UP, DOWN, or FLAT. UP/DOWN are directional moves beyond the FLAT_Dead_Band; FLAT is a move contained within it.
- **FLAT_Dead_Band**: An ATR_14-scaled band around zero net move that defines FLAT. It is scaled by the 14-trading-day Average True Range, not a fixed pip count.
- **ATR / ATR_14**: Average True Range computed over a 14-trading-day lookback (ATR_14), the standard volatility scalar used to scale the FLAT_Dead_Band.
- **Baseline / Weekly_Trend_Follow**: The null-hypothesis predictor whose predicted direction equals the Weekly_Trend_Sign (the 5-trading-day rolling rate-of-change sign of the close) at the Decision_Date.
- **Weekly_Trend_Sign**: A macro-regime label with value UP or DOWN, defined strictly as the sign of the 5-trading-day rolling rate of change of the close: UP when Close_T - Close_{T-5} >= 0, otherwise DOWN. Used both as baseline direction and as pre-filter metadata. This rolling definition is uniform on any weekday and removes calendar-week ambiguity.
- **Kill_Gate**: The two-stage, out-of-sample evaluation (Gate_1 and Gate_2) that a feature or pattern must pass to drive a displayed signal.
- **Gate_1 / Directional_Gate**: Pattern-model directional accuracy must beat the Weekly_Trend_Follow baseline accuracy by at least 3 percentage points on the out-of-sample test, where the baseline accuracy is computed on the same matched subset of Decision_Dates on which the model fires (conditional accuracy).
- **Gate_2 / Risk_Adjusted_Gate**: Using MFE/MAE over the selected Horizon, the pattern-model's excursion-weighted hit metric must be greater than or equal to the baseline's (margin >= 0), on the out-of-sample test, after Friction_Penalty deduction.
- **MFE/MAE**: Maximum Favorable Excursion and Maximum Adverse Excursion over a Horizon — the best favorable and worst adverse price movement reached within the window.
- **Friction_Penalty**: A spread/slippage deduction applied to excursions to account for 17:00 America/New_York (New York close) daily rollover liquidity thinning: 1.5 pips for EURUSD and GBPUSD, 2.0 pips for USDJPY, USDCHF, and USDCAD.
- **Sample_Size_Floor**: The minimum count of historical analogues (30) a pattern neighborhood must contain before earned confidence is displayed.
- **Sample_Size_Shrinkage**: The mechanism that pulls earned confidence toward neutral (0.5) for neighborhoods with fewer analogues, strongest below the Sample_Size_Floor.
- **Look_Ahead_Safe**: The property that no candle dated at or after a Decision_Date contributes to that date's features or retrieval, and only matured forward outcomes count in evaluation. Enforced by an explicit guard function.
- **Matured_Outcome**: A forward outcome whose full 1/2/3-day Horizon window has closed as of the evaluation date.
- **Earned_Confidence**: A value in [0,1] equal to the historical resolution rate of the analogue neighborhood, adjusted by Sample_Size_Shrinkage.
- **Pattern_Vector**: A fixed-dimension, shape-only representation of the daily candle pattern over fixed multi-scale windows (10/20/40 trading days), per-scale normalized, stored as a pgvector.
- **Analogue_Neighborhood**: The set of nearest historical Pattern_Vectors retrieved for a Decision_Date, pre-filtered to the same Weekly_Trend_Sign, excluding the query itself, and restricted to matured, pre-date analogues.
- **Structural_Liquidity_SR**: Structural support/resistance reference levels: Previous Day High/Low, Previous Week High/Low, and 20-Day High/Low; used as a distance-to-nearest-level feature candidate.
- **Data_Split**: The chronological, non-shuffled partition of history into a train/dev set (earliest ~70%) and a held-out out-of-sample test set (most recent ~30%), with fixed and recorded split dates. Under the Walk_Forward_Window scheme, the out-of-sample set is the union of all test folds rather than a single static most-recent partition.
- **Out_Of_Sample_Test**: The held-out partition on which all Kill_Gate verdicts are computed. Under the Walk_Forward_Window scheme, this is the union of all test folds.
- **Walk_Forward_Window**: A rolling/expanding out-of-sample validation scheme in which the model trains on an earlier window (e.g., 3 years) and tests on the immediately following window (e.g., 1 year), then rolls forward by the test period, producing multiple sequential train/test folds that each represent a distinct market regime. Replaces the single static split for feature evaluation.
- **Similarity_Radius / Epsilon_Cutoff**: A maximum cosine distance epsilon beyond which a retrieved analogue is rejected as too dissimilar; only analogues with cosine distance <= epsilon are admitted to the Analogue_Neighborhood.
- **Empirical_Risk_Boundaries**: Stop-Loss and Take-Profit levels derived directly from the retrieved Analogue_Neighborhood's excursion distribution rather than from generic ATR multipliers. Default: Stop_Loss = 75th percentile of neighborhood MAE; Take_Profit = 50th percentile of neighborhood MFE.
- **Currency_Concentration_Guard**: A portfolio-level rule that limits simultaneous directional exposure to the same base or quote currency across the five pairs by keeping only the highest-Earned_Confidence setups when multiple aligned setups fire.
- **Yield_Spread**: The 10-year government bond yield differential for a Pair (base-country 10Y minus quote-country 10Y), sourced from an additional daily yield data feed, used as a candidate macro feature.
- **Research_Log**: The living `RESEARCH-LOG.md` document recording every experiment and gate verdict.
- **LLM_Interface**: The thin, swappable, provider-agnostic interface through which all LLM calls pass, restricted to the four sanctioned roles. The v1 concrete provider is Google's Gemini Enterprise Agent Platform accessed via the Google Gen AI SDK and authenticated with Google Cloud IAM (Application Default Credentials or a service account); no standalone API key is used. The provider can be swapped without changing callers.
- **Confidence_Threshold**: The configurable Earned_Confidence level a firing setup must cross for the dashboard to surface a pair.
- **Latest_Stable**: The most recent generally-available, non-prerelease (no alpha, beta, release-candidate, nightly, or canary) release of a language, runtime, or library at the time a dependency is added or last reviewed.
- **Active_LTS**: For Node.js, the release line currently in its Active Long-Term Support phase (an even-numbered major line), used in preference to Current or odd-numbered lines for production stability.
- **External_Reference_Signal**: A third-party technical-analysis signal (recommended direction plus the provider's own confidence/score) fetched from an external forex signal API for a Pair, shown on the dashboard purely as a visual reference for human comparison. It is never an input to the directional probability, Earned_Confidence, Kill_Gate verdict, retrieval, or any scoring or decision path, and is fetched and compared outside the deterministic core.
- **Choppiness_Metric**: A deterministic, look-ahead-safe measure of directional efficiency over a fixed trailing window for a Pair — movement without net progress (for example the Kaufman Efficiency Ratio: net price move over the window divided by the sum of absolute per-step moves, or an equivalent Choppiness Index). A low efficiency / high choppiness value indicates a thrashing, range-bound regime; it is distinct from raw volatility magnitude and from the ATR_14-scaled FLAT_Dead_Band.
- **Choppiness_Guard**: A deterministic dashboard-level suppressor that, per Pair, silences an otherwise-firing setup when the Choppiness_Metric indicates conditions are too choppy (beyond a configurable threshold). It only suppresses; it never generates a signal and never affects the directional probability, Earned_Confidence, Direction_Class, retrieval, or the Kill_Gate verdict.
- **Strategy_Source**: An identifier attributing a produced signal (and its recorded outcome) to the strategy that generated it — for v1 the deterministic pattern system (e.g. `system`), reserved so that future strategies such as an LLM-taught trader (`llm`) or a Python algorithmic strategy (`algo`) can run alongside and be compared without ambiguity.
- **Realized_Outcome_Journal**: A growing record that pairs each fired setup (its Strategy_Source, Pair, Decision_Date, Direction_Class, selected Horizon, Earned_Confidence, and empirical risk boundaries) with the actual matured forward result once its Horizon window closes, forming a predicted-versus-actual corpus for later evaluation and for training or comparing additional strategies.

## Requirements

### Requirement 1: Silent-by-Default Directional Signals

**User Story:** As a personal trader, I want the assistant to surface only a small number of high-conviction daily directional setups and stay silent otherwise, so that I act only on genuinely earned signals and am not misled by noise.

#### Acceptance Criteria

1. WHERE a pattern has passed the Kill_Gate AND its Earned_Confidence crosses the Confidence_Threshold AND the news filter permits trading, THE System SHALL surface the corresponding Pair as a firing setup.
2. IF no Pair satisfies all firing conditions on a Decision_Date, THEN THE System SHALL display no setups for that Decision_Date.
3. WHEN the System surfaces a firing setup, THE System SHALL display the Pair, the Direction_Class, the selected Horizon, the Earned_Confidence, the excursion profile of expected favorable versus adverse movement, and the AI-generated rationale.
4. THE System SHALL classify each evaluated forward move as exactly one Direction_Class of UP, DOWN, or FLAT.
5. THE System SHALL state the selected Horizon explicitly for every firing setup.

### Requirement 2: AI Division of Labor (Hard Rule)

**User Story:** As the system owner, I want AI strictly confined to explaining and filtering while deterministic code decides and scores, so that the directional probability and gate verdict remain reproducible, falsifiable math.

#### Acceptance Criteria

1. THE System SHALL compute the directional probability using only deterministic code paths, taking no LLM output as an input to that computation.
2. THE System SHALL compute the Kill_Gate verdict using only deterministic code paths, taking no LLM output as an input to that computation.
3. THE System SHALL restrict all LLM usage to exactly the four sanctioned roles: news/event no-trade filter, signal rationale, pattern description, and research assistant.
4. THE System SHALL route all LLM calls through the LLM_Interface.
5. IF an LLM call requests a role other than one of the four sanctioned roles, THEN THE System SHALL reject the call before invocation and SHALL record the rejected role.
6. IF an LLM output would reach the directional probability computation or the Kill_Gate verdict computation, THEN THE System SHALL block that output before it reaches those paths, SHALL record the blocked attempt, and SHALL leave the directional probability and Kill_Gate verdict computations to proceed on their deterministic inputs unchanged.
7. THE System SHALL provide an automated test that asserts no LLM output feeds the directional probability path or the Kill_Gate verdict path, and that reports a failing status if any LLM output is detected on either path.
8. WHERE the research-assistant role proposes a feature hypothesis or backtest interpretation, THE System SHALL withhold acceptance of that proposal until explicit human approval is recorded, and IF human approval is absent, THEN THE System SHALL leave the current feature set and recorded interpretations unchanged.

### Requirement 3: Deterministic, Pure, Reproducible Computation

**User Story:** As the system owner, I want all scoring computation to be pure and deterministic, so that identical inputs always yield identical outputs and results are backtestable.

#### Acceptance Criteria

1. WHEN a scoring or evaluation function is invoked twice with identical inputs, THE System SHALL return identical outputs.
2. THE System SHALL implement pattern-vector construction, retrieval scoring, confidence computation, and gate evaluation as pure functions without hidden mutable state.
3. THE System SHALL implement pipeline and orchestration and dashboard code in TypeScript.
4. WHERE statistical or backtest tooling genuinely requires it, THE System SHALL implement that component in Python.

### Requirement 4: Look-Ahead Safety Guard

**User Story:** As a researcher, I want a tested guard preventing any future data from leaking into a historical decision, so that backtest results reflect only information available at decision time.

#### Acceptance Criteria

1. THE System SHALL exclude any candle dated at or after a Decision_Date from that date's feature computation and retrieval.
2. THE System SHALL count only Matured_Outcomes, whose full Horizon window has closed, in evaluation.
3. THE System SHALL enforce look-ahead safety through an explicit guard function.
4. IF a candle dated at or after a Decision_Date is submitted to that date's feature or retrieval computation, THEN THE guard function SHALL reject the input.
5. THE System SHALL provide an automated test proving that no future candle contributes to a historical window.

### Requirement 5: Living Documentation and Spec-Driven Discipline

**User Story:** As the system owner, I want living documentation of state, research history, and lessons, so that the rationale and progress survive context resets.

#### Acceptance Criteria

1. THE System SHALL maintain a `PROJECT-STATE.md` document recording current project state.
2. THE System SHALL maintain a `RESEARCH-LOG.md` document recording every experiment and every Kill_Gate verdict.
3. THE System SHALL maintain a `LESSONS.md` document capturing the hard-won lessons that constrain the project.
4. WHEN the Kill_Gate produces a verdict, THE System SHALL append that verdict and its metrics to the Research_Log.
5. WHEN a feature or pattern is cut by the Kill_Gate, THE System SHALL log the failure and its metrics in the Research_Log.

### Requirement 6: Project Bootstrap and Quality Harness

**User Story:** As a developer, I want a project scaffold with automated quality checks and configurable storage, so that every change is linted, type-checked, and tested before it lands.

#### Acceptance Criteria

1. THE System SHALL run lint, type-check, and the test runner in continuous integration.
2. IF lint, type-check, or the test suite fails, THEN THE continuous integration pipeline SHALL report a failing status.
3. THE System SHALL read Supabase connection configuration from environment-based configuration supporting both a local and a hosted target.
4. THE System SHALL provide a Supabase connectivity check that performs a round-trip write and read.
5. THE System SHALL validate that a templated Research_Log entry conforms to the expected structure.

### Requirement 7: Daily OHLC Ingestion

**User Story:** As a researcher, I want deterministic, look-ahead-safe daily OHLC ingestion for the five majors, so that all downstream computation runs on clean, validated history.

#### Acceptance Criteria

1. THE System SHALL ingest daily OHLC candles for EURUSD, GBPUSD, USDJPY, USDCHF, and USDCAD into Supabase.
2. THE System SHALL key each stored candle by the pair of (Asset, Date).
3. IF an ingested candle violates OHLC validity such that the high is less than the low or the open or close falls outside the high-low range, THEN THE System SHALL reject that candle.
4. WHEN ingestion runs more than once over the same source data, THE System SHALL produce the same stored result without duplicating candles.
5. THE System SHALL apply the look-ahead guard so that no future candle leaks into a historical window during ingestion-adjacent processing.
6. THE System SHALL produce a per-pair coverage summary of ingested daily history.
7. THE System SHALL define each daily candle on the Session_Close boundary of 17:00 America/New_York (22:00 UTC during US Eastern Standard Time), producing Monday-through-Friday daily candles, and SHALL merge any Sunday partial candle into the Monday candle rather than storing it as a separate candle.
8. THE System SHALL normalize every source feed to the Session_Close boundary before storage so that pattern shapes are consistent across data feeds.

### Requirement 8: Minimal Daily Pattern Vector

**User Story:** As a researcher, I want a shape-only daily pattern vector over fixed multi-scale windows, so that pattern matching starts from the minimum viable representation and avoids high-dimensional signal dilution.

#### Acceptance Criteria

1. THE System SHALL encode the daily candle-pattern shape over fixed windows of 10, 20, and 40 trading days.
2. THE System SHALL normalize each scale independently so that absolute price level does not dominate the Pattern_Vector.
3. THE System SHALL store macro-regime metadata including the Weekly_Trend_Sign with value UP or DOWN alongside each Pattern_Vector.
4. THE System SHALL store each Pattern_Vector as a pgvector row.
5. WHEN two input windows are identical, THE System SHALL produce identical Pattern_Vectors.
6. WHERE an input window is degenerate such as containing zero price variation, THE System SHALL produce a defined, non-error Pattern_Vector result.

### Requirement 9: Similarity Retrieval and Forward-Outcome Resolution

**User Story:** As a researcher, I want look-ahead-safe nearest-pattern retrieval with resolved forward outcomes, so that each analogue contributes both a terminal direction and an excursion profile.

#### Acceptance Criteria

1. THE System SHALL retrieve nearest historical Pattern_Vectors using pgvector similarity search.
2. THE System SHALL pre-filter the Analogue_Neighborhood to analogues sharing the query's Weekly_Trend_Sign.
3. THE System SHALL restrict retrieved analogues to those dated strictly before the query Decision_Date.
4. THE System SHALL exclude the query pattern itself from the retrieved Analogue_Neighborhood.
5. THE System SHALL restrict retrieved analogues to Matured_Outcomes only.
6. WHEN resolving an analogue's forward outcome, THE System SHALL capture the terminal Direction_Class and the MFE/MAE at each of the 1, 2, and 3-day Horizons.
7. WHEN retrieval is invoked twice with identical inputs, THE System SHALL return identical analogue sets.
8. THE System SHALL admit an analogue to the Analogue_Neighborhood only WHERE its cosine distance to the query is less than or equal to the configurable Similarity_Radius epsilon.
9. IF fewer than 30 analogues fall within the Similarity_Radius for a Decision_Date, THEN THE System SHALL shrink Earned_Confidence toward neutral and SHALL NOT surface a setup for that Pair on similarity grounds alone.

### Requirement 10: Earned Confidence, FLAT Band, and Horizon Selection

**User Story:** As a trader, I want confidence that reflects the neighborhood's historical resolution and shrinks when evidence is thin, so that thin or ambiguous patterns do not masquerade as high-conviction.

#### Acceptance Criteria

1. THE System SHALL compute Earned_Confidence by shrinking the Analogue_Neighborhood's raw historical resolution rate toward the neutral prior 0.5 using the formula Earned_Confidence = (n / (n + k)) * C_raw + (k / (n + k)) * 0.5, where n is the analogue count, C_raw is the raw historical resolution rate, and k is a fixed prior weight of 10.
2. THE System SHALL constrain Earned_Confidence to the range [0,1].
3. IF an Analogue_Neighborhood contains fewer than 30 analogues, THEN THE System SHALL apply the fixed-prior shrinkage so Earned_Confidence is pulled toward 0.5 and SHALL NOT display it as crossing the Confidence_Threshold on sample size alone.
4. THE System SHALL define the FLAT_Dead_Band as a band scaled by the 14-trading-day Average True Range (ATR_14) rather than a fixed pip count.
5. THE System SHALL classify a forward move contained within the FLAT_Dead_Band as FLAT.
6. THE System SHALL select the Horizon among 1, 2, and 3 trading days with the strongest historical resolution for the matched Analogue_Neighborhood.
7. WHEN Earned_Confidence is computed twice with identical inputs, THE System SHALL return identical values.

### Requirement 11: Two-Stage Kill-Gate Backtest Harness

**User Story:** As a researcher, I want a deterministic two-stage kill-gate scored on out-of-sample data, so that the core premise is proven or disproven before any features are added.

#### Acceptance Criteria

1. THE System SHALL implement the Weekly_Trend_Follow baseline whose predicted direction equals the Weekly_Trend_Sign at the Decision_Date.
2. THE System SHALL evaluate configurations using a Walk_Forward_Window scheme with sequential, non-overlapping, chronologically ordered train/test folds (default: train on approximately 3 years, test on the immediately following approximately 1 year, then roll forward by the test period), and SHALL treat the union of all test folds as the out-of-sample evaluation set.
3. THE System SHALL compute every Kill_Gate verdict on the Out_Of_Sample_Test only.
4. THE System SHALL record the exact Data_Split dates, and IF a subsequent run attempts to change the recorded Data_Split dates, THEN THE System SHALL reject the change and retain the recorded dates.
5. THE System SHALL evaluate a configuration through the Kill_Gate only WHERE its matched Analogue_Neighborhood contains at least 30 analogues.
6. THE System SHALL pass Gate_1 for a configuration only WHERE its directional accuracy on the Out_Of_Sample_Test exceeds, by at least 3 percentage points, the Weekly_Trend_Follow baseline accuracy computed on the same matched subset of Decision_Dates on which the model produces a firing setup, and WHERE that matched firing subset contains at least 30 Decision_Dates.
7. WHEN computing Gate_2, THE System SHALL deduct the Friction_Penalty of 1.5 pips for EURUSD and GBPUSD and 2.0 pips for USDJPY, USDCHF, and USDCAD from the MFE/MAE excursions of both the pattern-model outcomes and the Weekly_Trend_Follow baseline outcomes.
8. THE System SHALL evaluate Gate_2 only after Gate_1 has passed, and SHALL pass Gate_2 for a configuration only WHERE its excursion-weighted hit metric over the selected Horizon is greater than or equal to the baseline's excursion-weighted hit metric after Friction_Penalty deduction.
9. WHERE a configuration passes both Gate_1 and Gate_2, THE System SHALL assign a pass verdict and SHALL log the verdict and metrics in the Research_Log.
10. IF a configuration fails Gate_1 or Gate_2, THEN THE System SHALL assign a cut verdict and SHALL log the failure and metrics in the Research_Log.
11. WHEN the Kill_Gate harness runs, THE System SHALL emit a verdict with accuracy-versus-baseline and risk-adjusted-versus-baseline metrics and auto-append them to the Research_Log.
12. WHEN the harness runs on a fixed fixture, THE System SHALL reproduce the known metrics for that fixture.
13. THE System SHALL pass a configuration through the Kill_Gate only WHERE it passes both Gate_1 and Gate_2 on every Walk_Forward_Window test fold that satisfies the >=30-sample floor, and SHALL record the per-fold verdicts and metrics in the Research_Log.

### Requirement 12: Build-Order Discipline

**User Story:** As the system owner, I want the kill-gate built before feature discovery, so that the project learns whether shape-only matching beats the weekly trend before any features are added.

#### Acceptance Criteria

1. THE System SHALL deliver the Kill_Gate backtest harness before any feature-discovery capability is introduced.
2. THE System SHALL admit each candidate feature into the model only through a passing Kill_Gate verdict.
3. THE System SHALL NOT allow a feature or pattern that has not passed the Kill_Gate to drive a displayed signal.

### Requirement 13: Feature Discovery Through the Gate

**User Story:** As a researcher, I want to add candidate features one at a time and re-run the gate, so that only features that earn inclusion remain and dimensionality stays minimal.

#### Acceptance Criteria

1. THE System SHALL evaluate candidate features one at a time by re-running the Kill_Gate harness.
2. WHERE a candidate feature passes both Gate_1 and Gate_2 on the Out_Of_Sample_Test, THE System SHALL retain that feature in the model.
3. IF a candidate feature fails Gate_1 or Gate_2, THEN THE System SHALL cut that feature and log the failure with metric deltas in the Research_Log.
4. THE System SHALL limit the total number of included features to at most 12.
5. THE System SHALL support the candidate features %B, RSI, a volume proxy used as regime rather than magnitude, weekly-trend context, distance-to-SMA, Structural_Liquidity_SR distance, and 10-year government bond yield spread (e.g., US10Y minus DE10Y for EURUSD).
6. THE System SHALL express the Structural_Liquidity_SR feature as the distance to the nearest of Previous Day High/Low, Previous Week High/Low, and 20-Day High/Low.
7. WHEN a feature is toggled independently and the configuration is otherwise unchanged, THE System SHALL reproduce the prior verdict for that configuration.
8. THE System SHALL express the Yield_Spread feature as the applicable 10-year government bond yield differential for the Pair (base-country 10Y minus quote-country 10Y) and SHALL pass it through the Kill_Gate like any other candidate, subject to the at-most-12 feature ceiling.

### Requirement 14: News and Event No-Trade Filter

**User Story:** As a trader, I want elevated event risk to suppress signals, so that I never trade into high-impact news even when a pattern would otherwise fire.

#### Acceptance Criteria

1. THE System SHALL ingest structured economic calendar JSON supplying event name, currency, impact rating, and timestamp.
2. WHEN calendar data is processed for a Decision_Date, THE LLM_Interface SHALL emit a structured risk flag containing a risk level and a reason.
3. THE System SHALL decide signal suppression using deterministic code that consumes the structured risk flag.
4. WHERE the news filter indicates elevated event risk for a Pair on a Decision_Date, THE System SHALL suppress any otherwise-firing setup for that Pair and SHALL record the stated reason.
5. THE System SHALL treat event risk only as a suppressor and SHALL NOT allow the news filter to generate a directional signal.
6. IF the economic calendar JSON feed is unavailable, times out, or fails validation for a Decision_Date, THEN THE System SHALL flag the missing news context, SHALL log an ingestion error, and SHALL suppress all setup cards for that Decision_Date.

### Requirement 15: Signal Rationale and Pattern Description

**User Story:** As a trader, I want plain-language rationale and qualitative analogue labels on a firing card, so that I understand why a setup fired without those descriptions affecting the score.

#### Acceptance Criteria

1. WHEN a setup fires, THE System SHALL generate plain-language rationale text from the deterministic signal inputs of pattern, trend context, Structural_Liquidity_SR distance, selected Horizon, and Earned_Confidence.
2. THE System SHALL derive rationale text from the numeric signal and SHALL NOT allow rationale generation to alter the numeric signal.
3. THE System SHALL generate qualitative labels describing matched historical analogues.
4. THE System SHALL exclude rationale text and analogue labels from the directional probability and Kill_Gate verdict computations.

### Requirement 16: Silent-by-Default Dashboard and Scheduled Runs

**User Story:** As a trader, I want a local dashboard that runs the validated model daily and surfaces only qualifying setups, so that I get an accurate, unattended daily read across the five pairs.

#### Acceptance Criteria

1. THE System SHALL run the validated model daily across all five Pairs on the local dashboard.
2. WHEN no Pair crosses the Confidence_Threshold with a gate-passing pattern permitted by the news filter, THE System SHALL render an empty dashboard for that Decision_Date.
3. WHEN a Pair crosses the Confidence_Threshold with a gate-passing pattern permitted by the news filter, THE System SHALL render a firing card showing the Pair, Direction_Class, selected Horizon, Earned_Confidence, excursion profile of expected favorable versus adverse movement, and AI rationale.
4. THE System SHALL treat the Confidence_Threshold as configurable and tunable against the Kill_Gate backtest.
5. THE System SHALL NOT display any feature or pattern that has not passed the Kill_Gate.
6. WHERE the news filter suppresses a Pair, THE System SHALL respect that suppression on the dashboard.
7. WHERE the model has been validated, THE System SHALL support a GCP-scheduled daily refresh that produces the same result unattended as an equivalent local run.

### Requirement 17: Compute/Storage Separation for Future Serving Layer

**User Story:** As the system owner, I want clean separation between compute, storage, and any future serving layer, so that a read-only public website can be added later without rearchitecting.

#### Acceptance Criteria

1. THE System SHALL separate compute concerns from storage concerns so that neither depends on a serving layer.
2. THE System SHALL run the same storage schema against both a local target and a hosted Supabase target.
3. THE System SHALL NOT include a public API or website in v1.
4. THE System SHALL reserve the architecture such that a read-only serving layer can be added without changing the compute or storage design.

### Requirement 18: Latest Stable Toolchain and Dependencies

**User Story:** As a developer and system owner, I want the project to use the latest stable versions of every language, runtime, and library, so that we avoid deprecated syntax and near-term forced upgrades and minimize technical debt.

#### Acceptance Criteria

1. THE System SHALL use the Latest_Stable version of each language and runtime it depends on, including TypeScript, Python, and Node.js.
2. THE System SHALL use the Active_LTS release line of Node.js rather than a Current or odd-numbered release line.
3. THE System SHALL pin every third-party dependency to a specific Latest_Stable version rather than an open-ended version range.
4. THE System SHALL NOT depend on any prerelease build, including alpha, beta, release-candidate, nightly, or canary releases.
5. THE System SHALL NOT use any API, syntax, or feature that is deprecated in the selected version of its language, runtime, or library.
6. WHEN a dependency, language, or runtime is added or reviewed, THE System SHALL record the selected version and the date it was verified as Latest_Stable.
7. IF a newer stable version of a language, runtime, or pinned dependency becomes available, THEN THE System SHALL surface the available upgrade for human review before adoption.
8. THE System SHALL provide an automated check that fails when a pinned dependency, language, or runtime is a prerelease build or uses an open-ended version range.

### Requirement 19: Walk-Forward Cross-Regime Validation

**User Story:** As a researcher, I want features validated across multiple historical market regimes via walk-forward folds, so that inclusion reflects robustness rather than fit to one recent period.

#### Acceptance Criteria

1. THE System SHALL construct sequential, chronologically ordered, non-overlapping Walk_Forward_Window folds with a default of approximately 3-year train and approximately 1-year test, rolling forward by the test period.
2. THE System SHALL record each fold's boundary dates and treat them as fixed once recorded.
3. THE System SHALL require a candidate feature or configuration to pass both Gate_1 and Gate_2 on every qualifying fold (those meeting the >=30-sample floor) before it is admitted to the feature registry.
4. THE System SHALL record per-fold verdicts and metrics in the Research_Log.
5. IF a fold does not meet the >=30-sample floor, THEN THE System SHALL exclude that fold from the pass/fail determination and SHALL record that it was skipped.

### Requirement 20: Similarity-Radius Retrieval Cutoff

**User Story:** As a trader, I want the engine to reject low-quality analogue matches in unprecedented conditions, so that confidence reflects genuinely similar history and the system stays silent when it lacks precedent.

#### Acceptance Criteria

1. THE System SHALL treat the Similarity_Radius epsilon as a configurable maximum cosine distance.
2. THE System SHALL admit an analogue to the Analogue_Neighborhood only WHERE its cosine distance to the query is less than or equal to epsilon.
3. IF fewer than 30 analogues fall within epsilon for a Decision_Date, THEN THE System SHALL shrink Earned_Confidence toward neutral and SHALL NOT surface a setup on similarity grounds alone.
4. WHEN retrieval applies the Similarity_Radius, THE System SHALL still enforce the weekly-trend-sign pre-filter, self-exclusion, strictly-pre-date, and matured-only constraints.

### Requirement 21: Empirical Analogue-Derived Risk Boundaries

**User Story:** As a trader, I want stop-loss and take-profit levels grounded in the matched analogues' actual excursion distribution, so that trade management reflects empirical outcomes rather than generic multipliers.

#### Acceptance Criteria

1. WHEN a setup fires, THE System SHALL derive the Stop_Loss from the Analogue_Neighborhood's MAE distribution and the Take_Profit from its MFE distribution.
2. THE System SHALL set the default Stop_Loss at the 75th percentile of neighborhood MAE and the default Take_Profit at the 50th percentile of neighborhood MFE, with both percentiles configurable.
3. THE System SHALL compute Empirical_Risk_Boundaries deterministically, taking no LLM input, as part of the deterministic core.
4. WHEN the System surfaces a firing setup, THE System SHALL display the derived Stop_Loss and Take_Profit alongside the existing card fields.
5. WHERE the Analogue_Neighborhood is below the 30-analogue floor, THE System SHALL NOT surface Empirical_Risk_Boundaries as actionable.

### Requirement 22: Multi-Pair Currency Concentration Guard

**User Story:** As a trader, I want simultaneous same-currency setups de-duplicated by conviction, so that I do not unknowingly multiply net exposure to a single currency.

#### Acceptance Criteria

1. WHEN more than one Pair fires on the same Decision_Date with directional alignment on the same base or quote currency, THE System SHALL apply the Currency_Concentration_Guard.
2. THE System SHALL, under the guard, retain only the highest-Earned_Confidence aligned setups up to a configurable maximum concurrent count (default 2) and SHALL suppress the remaining aligned setups.
3. WHEN the guard suppresses a setup, THE System SHALL record the reason of currency concentration and the competing Pairs.
4. THE System SHALL compute the Currency_Concentration_Guard deterministically, taking no LLM input.
5. THE System SHALL treat the maximum concurrent aligned-exposure count as configurable.
### Requirement 23: External Signal Cross-Reference (Display/Research Only)

**User Story:** As a personal trader, I want an independent third-party signal shown alongside my own output for each pair, so that I can visually compare the two, notice when they agree or diverge, and investigate divergences — without that third-party signal ever influencing my system's computation.

#### Acceptance Criteria

1. WHERE an External_Reference_Signal is available for a Pair on a Decision_Date, THE System SHALL display it on the dashboard alongside that Pair's own output for human comparison.
2. THE System SHALL NOT use any External_Reference_Signal as an input to the directional probability, Earned_Confidence, Direction_Class classification, Kill_Gate verdict, retrieval, or any other scoring or decision computation.
3. THE System SHALL fetch and compare External_Reference_Signals outside the deterministic core, such that including or omitting them leaves every computed probability and Kill_Gate verdict identical.
4. THE System SHALL access External_Reference_Signals only through a thin, swappable provider interface so the external provider can be changed without affecting any other component.
5. IF the external signal provider is unavailable, times out, or returns an invalid response, THEN THE System SHALL mark the reference as unavailable for that Pair and SHALL leave the System's own output unchanged.
6. THE System SHALL use only current External_Reference_Signals for the live daily run and SHALL NOT use External_Reference_Signals as inputs to any historical backtest or Kill_Gate evaluation.
7. WHERE the System's own output and the External_Reference_Signal are both present for a Pair, THE System SHALL present them so that agreement or divergence is visually apparent to the user.

### Requirement 24: Choppiness Volatility Silence Guard

**User Story:** As a trader, I want the assistant to stay silent on a pair when the market is too choppy to trade cleanly, so that I am not shown setups likely to be stopped out by directionless volatility.

#### Acceptance Criteria

1. THE System SHALL compute a deterministic Choppiness_Metric for each of the five Pairs over a fixed trailing window, using only candles dated strictly before the Decision_Date.
2. WHERE a Pair's Choppiness_Metric indicates conditions are too choppy relative to a configurable threshold, THE System SHALL suppress any otherwise-firing setup for that Pair and SHALL record the choppiness suppression reason.
3. THE System SHALL apply the Choppiness_Guard to all five Pairs.
4. THE System SHALL treat the Choppiness_Guard as a suppressor only and SHALL NOT allow it to generate a Direction_Class or any signal.
5. THE System SHALL NOT use the Choppiness_Metric or the Choppiness_Guard as an input to the directional probability, Earned_Confidence, Direction_Class classification, retrieval, or the Kill_Gate verdict, such that suppression leaves those computations unchanged.
6. THE System SHALL treat the Choppiness_Guard threshold as configurable and tunable against the Kill_Gate backtest.
7. WHEN the Choppiness_Metric is computed twice for a Pair with identical inputs, THE System SHALL return identical values.
8. THE System SHALL compute the Choppiness_Metric and the Choppiness_Guard deterministically, taking no LLM input.
### Requirement 25: Strategy Attribution and Realized-Outcome Journal for Future Extensibility

**User Story:** As the system owner, I want every produced signal attributed to its originating strategy and every fired setup's realized outcome recorded over time, so that I can later run an LLM-taught trader and a Python algorithmic strategy alongside the existing system, compare them fairly, and train from an accumulated predicted-versus-actual corpus — without rearchitecting.

#### Acceptance Criteria

1. THE System SHALL attribute every surfaced or suppressed signal to a Strategy_Source identifier, defaulting to the deterministic pattern system for v1.
2. THE System SHALL record, for each fired setup, a Realized_Outcome_Journal entry pairing the setup's prediction (Strategy_Source, Pair, Decision_Date, Direction_Class, selected Horizon, Earned_Confidence, and empirical risk boundaries) with its actual matured forward outcome once the Horizon window has closed.
3. THE System SHALL populate the realized forward outcome for a journal entry only from Matured_Outcomes, using only candles dated after the Decision_Date, consistent with the look-ahead safety guard.
4. THE System SHALL keep the Strategy_Source attribution and the Realized_Outcome_Journal outside the directional probability, Earned_Confidence, retrieval, and Kill_Gate verdict computations, such that recording them leaves those computations unchanged.
5. THE System SHALL support evaluating any Strategy_Source's recorded predictions through the same Kill_Gate harness and baseline comparison used for the deterministic pattern system, so that additional strategies are validated on the same terms.
6. THE System SHALL reserve the architecture such that an additional strategy (for example an LLM-taught trader or a Python algorithmic strategy) can be added as a separate consumer of the shared storage without changing the existing compute or storage design.
7. WHEN a Realized_Outcome_Journal entry is written twice for the same (Strategy_Source, Pair, Decision_Date), THE System SHALL produce the same stored result without duplicating the entry.
