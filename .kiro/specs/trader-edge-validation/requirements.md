# Requirements Document

## Introduction

The daily loop is engineering-complete: the Cloud Run Job keeps candles fresh,
runs the deterministic analogue pipeline, publishes `dashboard.json`, and the
SPA renders it. An experienced discretionary-FX reviewer assessed the system and
reached a clear verdict: the engineering discipline is real (determinism,
Look_Ahead_Safe guards, outcome journalling, silent-by-default, AI-never-scores),
but the system **has not demonstrated a repeatable, cost-adjusted trading edge**,
and in one place it presents numbers that can mislead a trader. The gap is
**validation and honest presentation**, not construction.

This spec turns that review into testable requirements. It does NOT add trading
features, more AI, more providers, or more tabs. It does the opposite: it builds
the evidence layer that must exist before anyone trades real money from a signal,
and it corrects the one methodological defect that makes a displayed number
misleading today.

The review produced findings in three buckets, and this spec addresses all three:

1. **One methodological defect to fix.** Stop_Loss (75th percentile of analogue
   MAE) and Take_Profit (median of analogue MFE) are computed from two
   independent distributions. Neither the computation nor anything downstream
   checks whether, within a given analogue, the adverse move happened BEFORE the
   favourable one. MFE/MAE describe magnitude, not order. The displayed SL/TP
   therefore imply a tradeable risk/reward that the data does not establish. This
   must be corrected or explicitly caveated before those pips are presented as
   risk management.

2. **Evidence the system cannot currently produce.** There is no path-aware trade
   simulation, no net-of-cost expectancy, no confidence calibration test, no
   walk-forward evaluation with frozen parameters, and no comparison against
   simple baselines under identical execution assumptions. The Gate report shows
   directional accuracy versus a trend baseline and nothing about profitability.

3. **Presentation that over-states what is known.** Confidence reads like a
   probability; the dashboard is organised around the system's internals rather
   than a trader's decision; aggregate USD exposure across correlated pairs is
   invisible; data-freshness and signal timing are not surfaced.

Two non-negotiables from `LESSONS.md` and the parent specs bound every
requirement here and are never weakened:

- **Measure before believing.** No new number drives a displayed signal until it
  is measured out-of-sample against a defined baseline. This spec ADDS
  measurement; it does not add conviction.
- **AI explains and filters; deterministic code decides and scores.** Every
  artifact this spec introduces (trade ledger, expectancy, calibration,
  walk-forward results, exposure) is deterministic. The LLM never computes, ranks,
  or gates any of them.

A third principle governs honesty of presentation, promoted here to a first-class
constraint because the review's central risk is a trader trusting an unproven
number:

- **Nothing is presented as more certain than the evidence supports.** A
  confidence score is labelled as a historical agreement statistic, not a
  probability, until calibration is demonstrated. Backtest limitations are shown
  next to backtest results. An un-validated risk level is marked as such.

## Glossary

Terms from the parent specs (`fx-daily-pattern-assistant`,
`simplify-to-cloud-minimal`, `daily-candle-freshness-and-cleanup`) are reused
as-is: **System**, **Pair / Asset**, **Decision_Date**, **Session_Close /
NY_Close**, **Candle**, **Look_Ahead_Safe**, **Pattern_Vector**, **Analogue /
Analogue_Neighborhood**, **Horizon**, **Earned_Confidence**, **Confidence_Threshold**,
**Direction_Class (UP/DOWN/FLAT)**, **MFE / MAE**, **Excursion_Profile**,
**Stop_Loss / Take_Profit**, **Choppiness_Metric**, **Firing / Suppression**,
**Baseline**, **Measurement_Engine**, **Evaluation_Report**, **Realized_Outcome_Journal**,
**dashboard.json**, **Public_Read_Path**. New terms:

- **Trade_Simulation**: A deterministic, path-aware replay of a single proposed
  trade (entry, Stop_Loss, Take_Profit, Horizon expiry) against the ACTUAL
  chronological price path, producing one labelled outcome: `target_first`,
  `stop_first`, `expired`, or `ambiguous`.
- **Path_Resolution**: The rule set that decides, for one candle in a
  Trade_Simulation, whether Stop_Loss, Take_Profit, both, or neither were touched,
  and in what order. When both levels fall inside the same daily candle and the
  intra-candle sequence is unknown, the outcome is `ambiguous`.
- **Trade_Ledger**: The deterministic record of every simulated trade over an
  evaluation window — one row per eligible forecast — carrying entry assumption,
  SL/TP, horizon, Path_Resolution outcome, realised pips, and applied costs.
- **Execution_Model**: The explicit, configurable set of assumptions converting a
  forecast into a tradeable position: assumed entry reference and timestamp,
  spread, commission, and slippage.
- **Net_Expectancy**: The deterministic average result per simulated trade AFTER
  Execution_Model costs, expressed in pips and in R-multiples.
- **R_Multiple**: A trade's realised result expressed as a multiple of its own
  risked distance (entry→Stop_Loss), so trades with different stops are comparable.
- **Calibration**: The measured relationship between Earned_Confidence bands and
  the out-of-sample fraction of forecasts that actually resolve in the predicted
  direction.
- **Walk_Forward_Evaluation**: A chronological evaluation in which all tunable
  parameters are selected on an in-sample window, FROZEN, then measured on the
  immediately following out-of-sample window; the window advances and repeats.
- **Parameter_Set**: The full set of tunable choices behind a forecast
  (pattern scales, similarity cutoff, analogue floor, weekly-trend filter,
  shrinkage weight, Confidence_Threshold, Horizon selection rule, SL/TP
  percentiles). A frozen Parameter_Set is a Frozen_Baseline.
- **Frozen_Baseline**: A fully-specified, version-stamped Parameter_Set captured
  so later changes can be compared against it and so an out-of-sample window is
  provably independent of development decisions.
- **Comparator_Strategy**: A simple reference strategy evaluated under the SAME
  Execution_Model as the analogue System — at minimum a recent-trend-continuation
  rule and a returns/volatility rule — used to test whether the analogue method
  adds value beyond simple alternatives.
- **Aggregate_Exposure**: The net directional exposure to a single currency (e.g.
  USD) implied by the set of currently firing setups across the five Pairs.
- **Signal_Provenance**: The explicit timing metadata of a forecast: the exact
  last completed candle timestamp (with timezone), the time the forecast was
  computed, the earliest realistic entry reference, and the exact start/end of the
  Horizon window.

## Requirements

### Requirement 1: Path-aware Trade_Simulation (fix the SL/TP sequencing defect)

**User Story:** As a trader, I want each proposed trade replayed against the real
price path so I know whether the stop or the target would have been hit first,
not merely how far price travelled each way.

#### Acceptance Criteria

1. WHEN simulating one trade THEN the System SHALL replay the ACTUAL
   chronological candle path from the assumed entry forward to the Horizon expiry
   and classify the outcome as exactly one of `target_first`, `stop_first`,
   `expired`, or `ambiguous` (Path_Resolution).
2. WHEN a single candle's range contains BOTH the Stop_Loss and the Take_Profit
   and the intra-candle order is unknown THEN the System SHALL classify the
   outcome `ambiguous` and SHALL NOT silently assume the favourable fill.
3. WHEN only one level is touched within a candle THEN the System SHALL resolve
   that candle to `stop_first` or `target_first` accordingly; WHEN neither level
   is touched by Horizon expiry THEN the outcome SHALL be `expired` with the
   realised close-to-close pips recorded.
4. WHERE lower-timeframe data is available to disambiguate a same-candle hit THE
   System MAY use it to resolve order; WHERE it is not available the outcome
   SHALL remain `ambiguous` and the ambiguity SHALL be counted and reported,
   never dropped.
5. The Trade_Simulation SHALL be deterministic (identical inputs yield identical
   outcomes) and Look_Ahead_Safe (it uses only candles at or after the entry and
   never information from beyond the Horizon window to decide an earlier candle).
6. The Trade_Simulation SHALL take NO LLM input and SHALL NOT alter any firing,
   scoring, or confidence computation.
7. Realised MFE/MAE magnitudes MAY continue to be displayed, but the System SHALL
   NOT present the independently-derived Stop_Loss/Take_Profit as a validated
   risk/reward until a Trade_Simulation establishes the stop-first-versus-
   target-first outcome for the relevant analogues.

### Requirement 2: An explicit, configurable Execution_Model

**User Story:** As a trader, I want the exact entry, cost, and slippage
assumptions stated and applied, so a simulated result reflects a trade I could
actually have taken rather than an idealised fill.

#### Acceptance Criteria

1. The System SHALL define an Execution_Model carrying, per Pair: the assumed
   entry reference (e.g. the next session's open after Signal_Provenance), spread,
   commission, and slippage, each configurable and version-stamped.
2. WHEN a Trade_Simulation computes a result THEN it SHALL apply the
   Execution_Model costs to produce the realised net pips; the gross (pre-cost)
   result SHALL also be retained for comparison.
3. WHEN the forecast only becomes available after a candle's close THEN the
   Execution_Model SHALL NOT assume entry at that same close; the earliest entry
   reference SHALL be a price obtainable strictly after the forecast is known.
4. The Execution_Model SHALL be a single named configuration reused identically
   by the System and every Comparator_Strategy, so comparisons are fair.
5. The System SHALL support varying the Execution_Model (spread/slippage
   sensitivity) and reporting how Net_Expectancy changes, so robustness to cost
   assumptions is measurable.

### Requirement 3: A deterministic Trade_Ledger over an evaluation window

**User Story:** As a trader, I want a complete record of every simulated trade so
I can audit the strategy's behaviour rather than trust a single summary number.

#### Acceptance Criteria

1. WHEN an evaluation runs over a date range THEN the System SHALL produce a
   Trade_Ledger with one row per eligible forecast, each row carrying: Pair,
   Decision_Date, Direction_Class, Horizon, Earned_Confidence, assumed entry
   (price + timestamp), Stop_Loss, Take_Profit, Path_Resolution outcome, gross
   pips, applied costs, net pips, and R_Multiple.
2. WHERE a forecast was SUPPRESSED (did not fire) THE System SHALL be able to
   include it in the ledger marked as such, so the selection rule itself can be
   evaluated — not only the trades it accepted.
3. The Trade_Ledger SHALL be deterministic and reproducible from stored inputs
   plus a stated Parameter_Set and Execution_Model.
4. The Trade_Ledger SHALL be the single source for every aggregate performance
   metric in this spec; no summary metric SHALL be computed by a path that
   bypasses the ledger.
5. `ambiguous` outcomes SHALL be carried as a distinct category in the ledger and
   SHALL never be silently counted as wins or losses.

### Requirement 4: Profitability metrics, not directional accuracy alone

**User Story:** As a trader, I want net-of-cost expectancy and the full
risk/reward picture, because a directionally-accurate system can still lose money.

#### Acceptance Criteria

1. WHEN summarising a Trade_Ledger THEN the System SHALL report Net_Expectancy
   per trade in pips AND in R-multiples.
2. The summary SHALL include: win rate, average win, average loss, profit factor,
   maximum drawdown, longest losing streak, number of trades, and time in market.
3. The summary SHALL break results down by Pair, Horizon, Direction_Class, and
   Earned_Confidence band, so concentration of profit in one slice is visible.
4. The System SHALL report the share of `ambiguous` and `expired` outcomes
   alongside wins and losses, so the headline metrics cannot hide unresolved
   trades.
5. Every profitability metric SHALL be reported NET of the Execution_Model costs,
   with the gross figure available for comparison.
6. The System SHALL NOT present any single metric (including directional accuracy)
   as the headline measure of edge; Net_Expectancy after costs SHALL be the
   primary measure.

### Requirement 5: Comparison against simple baselines under identical assumptions

**User Story:** As a trader, I want to know whether the analogue engine beats a
simple trend rule after costs, so I can tell whether its complexity buys any real
information.

#### Acceptance Criteria

1. WHEN evaluating the analogue System THEN the System SHALL evaluate, over the
   same dates and the same Execution_Model, at least two Comparator_Strategies: a
   recent-trend-continuation rule and a recent-returns/volatility rule.
2. WHERE a directional-only comparison is meaningful THE System MAY also report a
   50/50 directional reference, clearly labelled as directional-only.
3. The comparison SHALL report each strategy's Net_Expectancy and the full metric
   set from Requirement 4, side by side, on identical forecast timestamps.
4. IF the analogue System does not beat the Comparator_Strategies net of costs
   out-of-sample THEN the Evaluation_Report SHALL state this plainly; the System
   SHALL NOT obscure a negative result.
5. The Comparator_Strategies SHALL use the SAME entry timing and exit rules as the
   analogue System so the comparison isolates the signal, not the execution.

### Requirement 6: Confidence Calibration measurement

**User Story:** As a trader, I want to know whether a "60% confidence" forecast
actually resolves correctly about 60% of the time, so I know whether to read the
number as a probability or only as a ranking.

#### Acceptance Criteria

1. WHEN calibration is measured THEN the System SHALL bucket out-of-sample
   forecasts by Earned_Confidence band and report, per band, the actual fraction
   that resolved in the predicted Direction_Class.
2. The System SHALL report whether higher-confidence bands resolve correctly more
   often than lower-confidence bands (monotonicity / ranking value), separately
   from absolute calibration.
3. WHERE calibration is poor THE System SHALL present Earned_Confidence as a
   ranking heuristic and SHALL NOT label it a probability anywhere in the UI.
4. The calibration measurement SHALL account for analogue OVERLAP: it SHALL report
   the degree of non-independence among contributing analogues (shared windows /
   adjacent Decision_Dates) so a band's effective sample size is not overstated.
5. The calibration measurement SHALL be deterministic, out-of-sample, and take no
   LLM input.

### Requirement 7: Walk-forward evaluation with frozen parameters

**User Story:** As a trader, I want results produced by choosing parameters on
past data and then testing on untouched future data, so the reported edge is not
an artefact of fitting the whole history.

#### Acceptance Criteria

1. WHEN a Walk_Forward_Evaluation runs THEN the System SHALL select the
   Parameter_Set on an in-sample window, FREEZE it as a Frozen_Baseline, and
   measure it ONLY on the immediately following out-of-sample window, then advance
   the window and repeat.
2. The System SHALL record the Frozen_Baseline (all tunable choices, version
   stamped) used for each out-of-sample window, so each window's independence from
   its own result is auditable.
3. The System SHALL enumerate every tunable choice that constitutes the
   Parameter_Set (pattern scales, similarity cutoff, analogue floor, weekly-trend
   filter, shrinkage weight, Confidence_Threshold, Horizon selection, SL/TP
   percentiles) so no free parameter is silently fit outside the walk-forward.
4. WHERE Horizon selection currently picks the best of three on the same data THE
   System SHALL treat that selection as a Parameter_Set choice subject to the
   walk-forward freeze, so it cannot inflate out-of-sample results.
5. A final evaluation window SHALL be reservable as untouched and SHALL NOT be
   consulted until a Parameter_Set is settled; the System SHALL record whether a
   given result used that reserved window.
6. IF development has already tuned parameters against a window THEN the System
   SHALL mark that window as no longer independent in any report that uses it.

### Requirement 8: Aggregate currency exposure across correlated pairs

**User Story:** As a trader, I want to see that three "long USD" cards are one
macro bet, so I do not mistake correlated signals for diversification.

#### Acceptance Criteria

1. WHEN two or more Pairs fire THEN the System SHALL compute and surface the
   Aggregate_Exposure to each underlying currency (notably USD) implied by the
   firing set.
2. WHEN the firing set concentrates into effectively one directional currency bet
   THEN the dashboard SHALL warn that the signals are correlated, not independent.
3. The System SHALL make the strongest firing signal distinguishable from the
   alternatives rather than presenting all firing Pairs as equally independent
   opportunities.
4. This requirement SHALL surface exposure as information only; it SHALL NOT add
   automated position sizing or portfolio optimisation, and it SHALL NOT re-enter
   the firing or scoring decision.
5. The correlation/exposure computation SHALL be deterministic and take no LLM
   input.

### Requirement 9: Signal_Provenance and data-freshness on every forecast

**User Story:** As a trader, I want the exact timing of the data and the signal
shown, so I never act on a stale forecast or assume a price I could not have got.

#### Acceptance Criteria

1. WHEN a forecast is displayed THEN the dashboard SHALL show its Signal_Provenance:
   the last completed candle timestamp (with explicit timezone), the time the
   forecast was computed, the earliest realistic entry reference, and the exact
   start and end of the Horizon window.
2. WHEN any of the five Pairs has incomplete or stale input data for a
   Decision_Date THEN the dashboard SHALL mark the affected forecast as such and
   SHALL NOT present it as a normal, actionable signal.
3. The System SHALL state an explicit policy for holidays, missing candles,
   weekend gaps, and stale data, and SHALL apply it so an affected forecast is
   marked unavailable rather than quietly published.
4. The Signal_Provenance SHALL make unambiguous which daily candle convention and
   session boundary the forecast assumes, so daylight-saving shifts cannot
   silently change the entry assumption.
5. The freshness and provenance values SHALL be derived from stored data
   deterministically and SHALL carry no LLM-derived field.

### Requirement 10: Honest presentation — the dashboard serves the trader's decision

**User Story:** As a trader, I want the interface organised around whether a trade
is worth taking and what the evidence is, not around the system's internal
modules.

#### Acceptance Criteria

1. The Setups view SHALL remain the landing page and SHALL present, together for
   each firing Pair: Direction_Class, entry assumption, Stop_Loss, Take_Profit,
   Horizon expiry, estimated Net_Expectancy, analogue count, and historical
   agreement — with a clear distinction between a FORECAST worth watching and a
   TRADE worth entering.
2. The evaluation view SHALL lead with out-of-sample Net_Expectancy, drawdown,
   profit factor, trade count, and results after costs, alongside the baseline
   under identical assumptions; it SHALL show whether the sample is large enough
   to draw conclusions and whether results hold across time periods.
3. WHERE a confidence, risk level, or metric is not yet validated out-of-sample
   THE dashboard SHALL label it as un-validated rather than present it as proven.
4. The System SHALL show the historical evidence behind a signal (the analogues
   and their path-resolved outcomes) BEFORE, and more prominently than, any AI
   commentary.
5. AI commentary and Third-party comparison SHALL be moved out of the primary
   trading workflow and SHALL remain explicitly advisory and non-scoring; the
   suppression list SHALL explain exclusions WITHOUT being made more prominent
   than actual opportunities.
6. WHERE Choppiness_Metric (or any context-only field) has no demonstrated
   decision value THE dashboard SHALL NOT give it primary-screen prominence.
7. No presentation change in this requirement SHALL alter the deterministic firing
   or scoring decision, and none SHALL allow an LLM-derived value to drive a
   displayed decision.

### Requirement 11: Freeze the current strategy as a comparison baseline

**User Story:** As the operator, I want the current configuration captured and
frozen, so every future change can be measured against where we started.

#### Acceptance Criteria

1. WHEN this spec begins implementation THEN the System SHALL capture the current
   Parameter_Set (fingerprint scales, filters, shrinkage, Horizon rule, SL/TP
   percentiles, Confidence_Threshold) as a version-stamped Frozen_Baseline.
2. The Frozen_Baseline SHALL be stored so any later Evaluation_Report can be run
   against it for a like-for-like comparison.
3. The System SHALL NOT change the current scoring, confidence, or firing
   behaviour as part of capturing the baseline; capture is read-only with respect
   to the live decision path.
4. WHERE a future change alters the Parameter_Set THE System SHALL be able to
   report the new result beside the Frozen_Baseline result on identical data.

### Requirement 12: Research integrity and scope discipline

**User Story:** As the operator, I want this spec to add evidence and honesty
without weakening the guards or ballooning the feature set.

#### Acceptance Criteria

1. Every artifact introduced here (Trade_Simulation, Trade_Ledger, metrics,
   Calibration, Walk_Forward_Evaluation, Aggregate_Exposure, Signal_Provenance)
   SHALL be deterministic and SHALL take no LLM input; the AI-never-scores guard
   SHALL remain enforced and provable.
2. No requirement here SHALL introduce automated execution, broker integration,
   new LLM features, new third-party forecast providers, or new tunable
   parameters for the fingerprint/thresholds/risk levels.
3. The Confidence_Threshold SHALL NOT be lowered to manufacture signal frequency;
   signal frequency SHALL be reported as a metric evaluated alongside
   profitability and robustness, never optimised in isolation.
4. Reported out-of-sample results SHALL be provably independent of development
   decisions (Requirement 7); any result that is not SHALL be labelled accordingly.
5. Kill-gate / PASS-CUT style verdicts, where produced, SHALL continue to be
   recorded in RESEARCH-LOG.md and SHALL NOT be written into PROJECT-STATE.md.
6. Negative findings SHALL be reported plainly. IF the analogue method does not
   beat the Comparator_Strategies net of costs out-of-sample THEN that outcome
   SHALL be surfaced as a valid, acceptable result and SHALL NOT be grounds for
   adding complexity to force a better backtest.

## Priority and sequencing (non-normative)

The review ordered the work by dependency; the requirements inherit that order:

- **P0 — correctness and honesty that affect a trader today:** Requirement 1
  (fix SL/TP sequencing), Requirement 9 (freshness/provenance), Requirement 10
  criteria 3 (label un-validated numbers).
- **P0 — the evidence spine everything else depends on:** Requirements 2, 3, 4
  (Execution_Model → Trade_Ledger → profitability metrics).
- **P1 — does the signal actually carry information:** Requirements 5
  (baselines), 6 (calibration), 7 (walk-forward), 11 (frozen baseline).
- **P1 — portfolio honesty:** Requirement 8 (aggregate exposure).
- **P2 — the rest of the presentation re-org:** remaining Requirement 10 criteria.

Requirement 12 is a standing constraint across all of the above.
