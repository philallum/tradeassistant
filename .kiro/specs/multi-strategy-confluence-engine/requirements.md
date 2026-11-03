# Requirements Document

## Introduction

The FX Daily Pattern Trading Assistant currently produces one deterministic
signal per Pair: the Pattern_Vector analogue matcher (`src/encoder`,
`src/retrieval`, `src/confidence`), published through the Dashboard_Snapshot
(`dashboard.json`, schema v4, `src/scheduled-run/snapshot.ts`) and rendered by the
SPA under `web/src`. A third-party technical-analysis opinion
(`src/external-signal`) is shown beside it as display-only reference.

This feature adds four classical, fully deterministic technical strategies, namely
Trend Following, Breakout, Range / Mean Reversion, and Reversal / Exhaustion. It
puts all signal producers behind one standardized StrategySignal contract and
adds a Confluence_Engine that aggregates the signals per Pair. The engine
enforces a "Stay Flat on Conflict" rule. The Dashboard_Snapshot gains a
per-Pair Confluence_Matrix slice, and the SPA renders it so a user can audit why a
Pair is green, red, or neutral.

Constraints inherited from the parent specs and `LESSONS.md` bound every
requirement here:

- **AI never scores.** All strategy math, directions, strengths, weights,
  Confluence_Scores, and Confluence_Status values are computed by deterministic
  code. LLMs remain restricted to news filtering and plain-language summaries and
  are structurally excluded from every input to this feature.
- **Pure and Look_Ahead_Safe.** Every strategy is a pure function of candles
  strictly before the Decision_Date. No clock, randomness, network, or I/O.
- **Confluence over isolation.** No single strategy is an execution trigger.
- **Measure before believing.** The new strategies and the Confluence_Score are
  un-validated until measured out-of-sample, net of costs. They are labelled so
  wherever displayed. This feature adds no conviction to the existing firing
  decision.
- **Additive and non-regressive.** The existing firing / suppression decision,
  Earned_Confidence, Confidence_Threshold (0.55), and Trade_Ledger are not changed.
  The Confluence_Matrix is an additional, parallel view.

Two scoping decisions are recorded here for review:

1. The Third_Party_Signal is bound by the existing display-only rule
   (`src/external-signal`, parent Requirement 23: never an input to scoring). It
   is normalized into a StrategySignal and shown in the matrix, but its
   Confluence weight defaults to 0 and is only non-zero by explicit operator
   configuration.
2. The Confluence_Status is advisory and parallel. It does not gate or alter the
   existing Firing_Setup list in this feature.

## Glossary

- **System**: The FX Daily Pattern Trading Assistant (backend plus SPA).
- **Pair**: One of EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD (`PAIRS` in `src/ingestion/types.ts`).
- **Decision_Date**: The trading date a run decides for. Only candles dated strictly before it may be used.
- **Candle**: A daily OHLC record (`Candle` in `src/guard/types.ts`).
- **Look_Ahead_Safe**: Using no candle dated at or after the Decision_Date.
- **StrategySignal**: The standardized output of one signal producer: `strategyId`, `direction`, `strength`, `rationale`.
- **Strategy_Id**: One of `trend`, `breakout`, `range`, `reversal`, `custom_pattern`, `third_party`.
- **Signal_Direction**: `UP`, `DOWN`, or `FLAT`.
- **Strength**: A finite number in [0.0, 1.0] expressing the signal's own conviction. It is not a probability.
- **Rationale**: A deterministic, human-readable string stating the numeric trigger condition.
- **Trend_Strategy**: Pure function producing a StrategySignal from the Fast_EMA versus Slow_EMA relationship.
- **Breakout_Strategy**: Pure function producing a StrategySignal from a Donchian_Channel breakout.
- **Range_Strategy**: Pure function producing a StrategySignal from Bollinger_Bands combined with RSI.
- **Reversal_Strategy**: Pure function producing a StrategySignal from extreme extension, ATR scaling, and momentum exhaustion.
- **Fast_EMA / Slow_EMA**: Exponential moving averages of close with default periods 20 and 50.
- **Donchian_Channel**: The highest high and lowest low of the preceding N completed Candles (default N = 20), excluding the Decision_Date.
- **Bollinger_Bands**: SMA of close over N periods (default 20) plus and minus K standard deviations (default K = 2).
- **RSI**: Relative Strength Index over 14 periods; oversold below 30, overbought above 70.
- **ATR**: Average True Range over 14 periods (`computeAtr14` in `src/confidence/atr.ts`).
- **Baseline_MA**: The reference moving average for Reversal extension (default SMA of close, 20 periods).
- **Custom_Pattern_Signal**: The existing Pattern_Vector matcher's per-Pair direction and Earned_Confidence, adapted into a StrategySignal.
- **Third_Party_Signal**: The existing External_Reference_Signal (`BUY`/`SELL`/`HOLD`) adapted into a StrategySignal.
- **Confluence_Engine**: Pure function aggregating a Pair's StrategySignals into a Confluence_Result.
- **Confluence_Weights**: A configuration mapping each Strategy_Id to a non-negative weight.
- **Confluence_Score**: Signed weighted net score in [-1.0, +1.0]; positive favours UP, negative favours DOWN.
- **Conflict_Threshold**: The minimum Strength (default 0.6) at which a signal counts as strong for conflict detection.
- **Confluence_Status**: One of `ALIGNED_UP`, `ALIGNED_DOWN`, `NEUTRAL`, `CONFLICT_FLAT`, `INSUFFICIENT_DATA`.
- **Confluence_Result**: The per-Pair output: Confluence_Score, Confluence_Status, and the ordered input signals.
- **Confluence_Matrix**: The per-Pair grid of StrategySignals plus the Confluence_Result.
- **Dashboard_Snapshot**: The `dashboard.json` envelope built by `buildDashboardSnapshot`.
- **Confluence_Panel**: The SPA component rendering the Confluence_Matrix for all Pairs.
- **Validation_Label**: The explicit "un-validated" marker shown until the edge is measured out-of-sample.
- **Conflict_Summary**: A deterministic, human-readable one-line sentence, built purely from `opposingStrategyIds` and their directions and strengths, stating which strategies oppose each other and that the verdict is no-trade (shown for a `CONFLICT_FLAT` Pair).
- **Score_Gauge**: The view-model description of a diverging bar for a Pair's Confluence_Score over the interval [-1.0, +1.0], centred at 0, marking the positive and negative alignment thresholds; it is non-numeric presentation data derived purely from the score and the alignment threshold.
- **Confluence_Summary**: The aggregate count, across the rendered Pairs, of how many are `ALIGNED_UP`/`ALIGNED_DOWN` (aligned), `CONFLICT_FLAT` (conflict), and `NEUTRAL`/`INSUFFICIENT_DATA` (neutral).
- **Emphasis_Level**: A per-cell view-model hint — `signal` for a weighted, non-`FLAT`, available cell versus `muted` for a `FLAT`, unavailable, or zero-weight cell — so presentation can de-emphasise cells that carry no signal. It never changes any direction, strength, score, or status value.
- **Validated_State**: Whether an out-of-sample measurement exists for the Confluence_Matrix. Until it does, the Validation_Label is `unvalidated` and colour semantics are suppressed (see Requirement 14).

## Requirements

### Requirement 1: Standardized Strategy Signal Contract

**User Story:** As a developer, I want one shared signal contract for every signal producer, so that the Confluence_Engine and the dashboard can treat all strategies uniformly.

#### Acceptance Criteria

1. THE System SHALL define a StrategySignal type with exactly four fields: `strategyId` (Strategy_Id), `direction` (Signal_Direction), `strength` (number), and `rationale` (string).
2. THE System SHALL restrict `strategyId` to exactly the six values `trend`, `breakout`, `range`, `reversal`, `custom_pattern`, and `third_party`, and SHALL reject any other value at compile time.
3. THE System SHALL restrict `direction` to exactly the three values `UP`, `DOWN`, and `FLAT`, and SHALL reject any other value at compile time.
4. THE System SHALL guarantee that every produced StrategySignal has a `strength` that is a finite number (not NaN, Infinity, or -Infinity) in the range 0.0 to 1.0 inclusive.
5. WHEN a StrategySignal has direction `FLAT`, THE System SHALL set its `strength` to exactly 0.0.
6. THE System SHALL guarantee that every produced StrategySignal has a `rationale` of 1 to 500 characters that contains at least one non-whitespace character.
7. THE System SHALL keep the StrategySignal type free of any LLM-tagged field, so that LLM output cannot be a StrategySignal input.
8. IF a signal producer would emit a StrategySignal with a `strength` outside 0.0 to 1.0, a non-finite `strength`, a `rationale` that is empty or whitespace-only, or a `strategyId` or `direction` outside the allowed values, THEN THE System SHALL reject that signal, SHALL NOT pass it to the Confluence_Engine or the dashboard, and SHALL return an error identifying the violated field.
9. IF a StrategySignal has direction `UP` or `DOWN` and a `strength` of 0.0, THEN THE System SHALL accept the signal unchanged and SHALL NOT convert its direction to `FLAT`.

### Requirement 2: Trend Following Strategy

**User Story:** As a trader, I want a trend-following signal from EMA alignment, so that I can see whether price momentum agrees with other inputs.

#### Acceptance Criteria

1. WHEN the Trend_Strategy is evaluated for a Pair and Decision_Date, THE Trend_Strategy SHALL compute the Fast_EMA and Slow_EMA of the close price using only Candles dated strictly before the Decision_Date, with the most recent such Candle being the latest input.
2. WHEN the Fast_EMA is strictly above the Slow_EMA and the Fast_EMA slope is strictly greater than 0, THE Trend_Strategy SHALL return direction `UP`, where the Fast_EMA slope is the Fast_EMA value at the most recent Candle minus the Fast_EMA value 5 Candles earlier (the configured slope window).
3. WHEN the Fast_EMA is strictly below the Slow_EMA and the Fast_EMA slope is strictly less than 0, THE Trend_Strategy SHALL return direction `DOWN`.
4. WHEN the Fast_EMA equals the Slow_EMA, OR the Fast_EMA slope equals 0, OR the sign of the Fast_EMA minus Slow_EMA difference differs from the sign of the Fast_EMA slope, THE Trend_Strategy SHALL return direction `FLAT`.
5. WHEN the Trend_Strategy returns direction `UP` or `DOWN`, THE Trend_Strategy SHALL set `strength` to the absolute difference between Fast_EMA and Slow_EMA divided by the ATR (14-period, computed from Candles before the Decision_Date), clamped to the range 0.0 to 1.0 inclusive.
6. WHEN the Trend_Strategy returns direction `FLAT` for a reason other than insufficient history, THE Trend_Strategy SHALL set `strength` to 0.0.
7. WHEN the Trend_Strategy returns a result with sufficient history, THE Trend_Strategy SHALL include the Fast_EMA, Slow_EMA, and slope numeric values, each rounded to 5 decimal places, in the `rationale`.
8. IF the ATR is 0 or cannot be computed, THEN THE Trend_Strategy SHALL return direction `FLAT`, `strength` 0.0, and a `rationale` stating that ATR is unavailable.
9. IF fewer than (Slow_EMA period + slope window) Candles dated before the Decision_Date are available (55 with defaults), THEN THE Trend_Strategy SHALL return direction `FLAT`, `strength` 0.0, and a `rationale` stating insufficient history, without raising an error.
10. THE Trend_Strategy SHALL accept the Fast_EMA period, Slow_EMA period, and slope window as configuration with defaults 20, 50, and 5, each as an integer of at least 1, with the Fast_EMA period less than the Slow_EMA period.
11. IF the supplied configuration has a non-integer value, a value below 1, or a Fast_EMA period not less than the Slow_EMA period, THEN THE Trend_Strategy SHALL reject the configuration with an error identifying the invalid parameter and SHALL leave the previously active configuration unchanged.

### Requirement 3: Breakout Strategy

**User Story:** As a trader, I want a Donchian breakout signal, so that I can see whether price has escaped its recent range.

#### Acceptance Criteria

1. WHEN the Breakout_Strategy is evaluated with at least N plus 1 Candles available, THE Breakout_Strategy SHALL compute the Donchian_Channel from the N Candles immediately before the most recent completed Candle, where N is a positive integer defaulting to 20, the channel high is the maximum high price of those N Candles, and the channel low is the minimum low price of those N Candles.
2. WHEN the most recent completed Candle's close is strictly above the channel high, THE Breakout_Strategy SHALL return direction `UP`.
3. WHEN the most recent completed Candle's close is strictly below the channel low, THE Breakout_Strategy SHALL return direction `DOWN`.
4. WHEN the most recent completed Candle's close is greater than or equal to the channel low and less than or equal to the channel high, THE Breakout_Strategy SHALL return direction `FLAT`.
5. WHEN the Breakout_Strategy returns direction `UP` or `DOWN`, THE Breakout_Strategy SHALL set `strength` to the breakout distance (close minus channel high for `UP`, channel low minus close for `DOWN`) divided by the ATR, bounded to the range 0.0 to 1.0 inclusive.
6. WHEN the Breakout_Strategy returns direction `FLAT` after a successful channel computation, THE Breakout_Strategy SHALL set `strength` to 0.0.
7. WHEN the Breakout_Strategy returns a result after a successful channel computation, THE Breakout_Strategy SHALL include the channel high, channel low, and close values in the `rationale`.
8. IF fewer than N plus 1 Candles are available, THEN THE Breakout_Strategy SHALL return direction `FLAT`, `strength` 0.0, and a `rationale` indicating insufficient history, without throwing an error.
9. THE Breakout_Strategy SHALL exclude the most recent completed Candle from the channel window, so that the breakout Candle cannot define its own channel.
10. IF the ATR is zero, undefined, or not a finite number when `strength` is computed for direction `UP` or `DOWN`, THEN THE Breakout_Strategy SHALL return the detected direction, `strength` 0.0, and a `rationale` indicating that ATR is unavailable.

### Requirement 4: Range / Mean Reversion Strategy

**User Story:** As a trader, I want a mean-reversion signal from Bollinger Bands and RSI, so that I can see stretched conditions inside a range.

#### Acceptance Criteria

1. WHEN the most recent completed close is strictly below the lower Bollinger_Band and the RSI is strictly below the configured oversold threshold (default 30), THE Range_Strategy SHALL return direction `UP`.
2. WHEN the most recent completed close is strictly above the upper Bollinger_Band and the RSI is strictly above the configured overbought threshold (default 70), THE Range_Strategy SHALL return direction `DOWN`.
3. WHEN neither the oversold nor the overbought combined condition holds, THE Range_Strategy SHALL return direction `FLAT` and `strength` 0.0.
4. WHEN the Range_Strategy returns direction `UP` or `DOWN`, THE Range_Strategy SHALL compute `strength` as the arithmetic mean of a band penetration score and an RSI distance score, each clamped to the range 0.0 to 1.0, where the band penetration score is the distance of the close beyond the breached band divided by the band width (upper band minus lower band) and the RSI distance score is the RSI distance beyond its threshold divided by the threshold's distance from the RSI scale limit (30 for oversold and 30 for overbought at defaults), so that `strength` is within 0.0 to 1.0 inclusive.
5. WHEN the Range_Strategy returns a result with sufficient history, THE Range_Strategy SHALL include in the `rationale` the close, the lower and upper band values, and the RSI value, each as a number rounded to 5 decimal places for prices and 2 decimal places for RSI.
6. IF fewer Candles are available than the larger of the Bollinger_Bands period and the RSI period plus 1, THEN THE Range_Strategy SHALL return direction `FLAT`, `strength` 0.0, and a `rationale` stating insufficient history, without raising an error.
7. IF the Bollinger_Bands standard deviation is zero, THEN THE Range_Strategy SHALL return direction `FLAT`, `strength` 0.0, and a `rationale` stating zero volatility, without raising an error.
8. THE Range_Strategy SHALL accept the Bollinger_Bands period, K, RSI period, and RSI oversold and overbought thresholds as configuration with defaults 20, 2, 14, 30 and 70.
9. IF the configuration has a Bollinger_Bands period or RSI period that is not an integer of at least 2, a K that is not greater than 0, or an oversold threshold that is not strictly less than the overbought threshold within 0 to 100, THEN THE Range_Strategy SHALL reject the configuration with an error identifying the invalid parameter and SHALL leave any previously active configuration unchanged.

### Requirement 5: Reversal / Exhaustion Strategy

**User Story:** As a trader, I want a reversal signal from extreme extension and fading momentum, so that I can see when a move looks exhausted.

#### Acceptance Criteria

1. WHEN the Reversal_Strategy is evaluated with sufficient Candles, THE Reversal_Strategy SHALL compute the extension as (the close of the most recent completed Candle minus the Baseline_MA value at that Candle) divided by the ATR value at that Candle, as an unrounded decimal number.
2. WHEN the extension is greater than the extension threshold and momentum exhaustion is present, THE Reversal_Strategy SHALL return direction `DOWN`.
3. WHEN the extension is less than the negative of the extension threshold and momentum exhaustion is present, THE Reversal_Strategy SHALL return direction `UP`.
4. WHEN the absolute extension is less than or equal to the extension threshold, or momentum exhaustion is absent, THE Reversal_Strategy SHALL return direction `FLAT` with `strength` 0.0.
5. THE Reversal_Strategy SHALL define momentum exhaustion as present when the absolute rate of change over the most recent momentum window of Candles is strictly smaller than the absolute rate of change over the immediately preceding momentum window of Candles, and both rates of change have the same sign as the extension (positive for a positive extension, negative for a negative extension). Rate of change over a window is the close at the window's end minus the close at the window's start.
6. WHEN the Reversal_Strategy returns direction `UP` or `DOWN`, THE Reversal_Strategy SHALL set `strength` to the minimum of 1.0 and (the absolute extension minus the extension threshold) divided by the extension threshold, yielding a value from 0.0 to 1.0 inclusive.
7. WHEN the Reversal_Strategy returns a result, THE Reversal_Strategy SHALL include the extension value, the ATR value, and both momentum rate-of-change values in the `rationale`.
8. IF the ATR is zero, or fewer Candles are available than the Baseline_MA period plus 2 times the momentum window (26 with defaults), THEN THE Reversal_Strategy SHALL return direction `FLAT`, `strength` 0.0, and a `rationale` stating whether the cause was zero ATR or insufficient Candles, and SHALL leave the input Candles unmodified.
9. THE Reversal_Strategy SHALL accept the extension threshold, Baseline_MA period, and momentum window as configuration with defaults 2.0, 20, and 3 respectively.
10. IF the configured extension threshold is not greater than 0, or the Baseline_MA period or momentum window is not a positive integer, THEN THE Reversal_Strategy SHALL reject the configuration with an error indicating the invalid parameter and SHALL NOT evaluate any Candles.

### Requirement 6: Look-Ahead Safety and Purity of Strategies

**User Story:** As a developer, I want every strategy to be pure and free of lookahead, so that backtests and live runs cannot leak future data.

#### Acceptance Criteria

1. WHEN any of the Trend_Strategy, Breakout_Strategy, Range_Strategy, or Reversal_Strategy is called with Candles and a Decision_Date, THE System SHALL pass those Candles through the Look-Ahead Guard (`assertPastOnly`) for the Decision_Date before computing any StrategySignal.
2. IF any supplied Candle is dated at or after the Decision_Date, THEN THE System SHALL reject the call with a `look_ahead_violation` result, return no StrategySignal, and leave the input Candles unchanged.
3. FOR ALL candle series and Decision_Dates, appending any Candles dated at or after the Decision_Date SHALL leave every strategy's output unchanged (the rejection path aside).
4. FOR ALL inputs, calling a strategy twice with identical arguments SHALL produce deeply equal StrategySignals, or deeply equal typed error results (determinism).
5. THE System SHALL implement the Trend_Strategy, Breakout_Strategy, Range_Strategy, and Reversal_Strategy without reading the system clock, random number sources, environment variables, network, or storage.
6. THE System SHALL NOT mutate the input Candle array or any Candle object in it in any strategy, such that the array length, element order, and every Candle field value are identical before and after the call.
7. IF an input Candle contains a non-finite (NaN, Infinity, or -Infinity) or missing open, high, low, or close value, THEN THE System SHALL return a typed error result identifying the invalid field and Candle date, and return no StrategySignal.
8. IF the supplied Candle array is empty, THEN THE System SHALL return a typed error result indicating insufficient data, and return no StrategySignal.
9. IF an input Candle contains both a non-finite value and a date at or after the Decision_Date, THEN THE System SHALL return the `look_ahead_violation` result.

### Requirement 7: Signal Adapters for Existing Producers

**User Story:** As a trader, I want the existing pattern matcher and third-party feed expressed in the same contract, so that I can compare all inputs side by side.

#### Acceptance Criteria

1. WHEN a Pair has a Pattern_Vector evaluation with a Direction_Class of `UP` or `DOWN`, THE System SHALL adapt it into exactly one StrategySignal for that Pair with `strategyId` `custom_pattern`, `direction` equal to the evaluation's Direction_Class, and `strength` equal to its Earned_Confidence, where Earned_Confidence is in the range [0.0, 1.0].
2. WHEN the Pattern_Vector evaluation's Direction_Class is `FLAT`, THE System SHALL adapt it into exactly one `custom_pattern` StrategySignal with direction `FLAT` and `strength` 0.0, regardless of the evaluation's Earned_Confidence value.
3. WHEN a Third_Party_Signal with a value of `BUY`, `SELL`, or `HOLD` is available for a Pair, THE System SHALL adapt it into exactly one StrategySignal with `strategyId` `third_party`, mapping `BUY` to `UP`, `SELL` to `DOWN`, and `HOLD` to `FLAT`.
4. WHEN the Third_Party_Signal carries a numeric provider score and its direction is `UP` or `DOWN`, THE System SHALL set `strength` using a documented deterministic linear normalization of the score over the provider's stated score range, clamped to [0.0, 1.0], such that the same score always yields the same `strength`.
5. WHEN the Third_Party_Signal carries a numeric provider score and its direction is `FLAT`, THE System SHALL set `strength` to 0.0.
6. WHEN the Third_Party_Signal carries no provider score, THE System SHALL set `strength` to 0.5 for `UP` or `DOWN` and 0.0 for `FLAT`.
7. IF the Third_Party_Signal is unavailable for a Pair, THEN THE System SHALL produce no `third_party` StrategySignal for that Pair, record the Pair's third-party input as unavailable, and continue adapting the Pair's `custom_pattern` signal and all other Pairs.
8. IF the Third_Party_Signal value is not one of `BUY`, `SELL`, or `HOLD`, or its provider score is NaN or infinite, THEN THE System SHALL produce no `third_party` StrategySignal for that Pair and record the Pair's third-party input as unavailable.
9. THE System SHALL leave the Pattern_Vector evaluation, Earned_Confidence, and Third_Party_Signal values unchanged by the adaptation, such that the values compared before and after adaptation are identical.
10. THE System SHALL adapt the Third_Party_Signal outside the scoring path, preserving the parent rule that the external reference is never an input to Earned_Confidence or the Kill_Gate verdict, such that Earned_Confidence and the Kill_Gate verdict are identical whether the Third_Party_Signal is present, absent, or changed.

### Requirement 8: Confluence Aggregation

**User Story:** As a trader, I want one net score per Pair from all signals, so that I can see the overall agreement level.

#### Acceptance Criteria

1. WHEN the Confluence_Engine receives a Pair's StrategySignals and the sum of weights of those signals is greater than zero, THE Confluence_Engine SHALL compute the Confluence_Score as the sum of (weight × signed strength) over all signals divided by the sum of weights of those signals, where UP is +1, DOWN is -1, and FLAT is 0.
2. THE Confluence_Engine SHALL return a Confluence_Score in the closed interval [-1.0, +1.0] for every valid input, where a valid input is a list of 0 to 6 StrategySignals (at most one per Strategy_Id) whose weights are finite and greater than or equal to 0.0.
3. WHEN the sum of weights of the supplied signals is zero, including when the signal list is empty, THE Confluence_Engine SHALL return Confluence_Score 0.0 and Confluence_Status `INSUFFICIENT_DATA`.
4. THE Confluence_Engine SHALL read weights from the Confluence_Weights configuration with defaults of 1.0 for `trend`, `breakout`, `range`, `reversal`, and `custom_pattern`, and 0.0 for `third_party`.
5. WHERE the operator configures a non-zero weight for `third_party`, THE Confluence_Engine SHALL include the `third_party` signal in the Confluence_Score with that weight.
6. IF a Confluence_Weights entry is negative, NaN, or infinite, THEN THE System SHALL reject the configuration with a typed error naming the Strategy_Id, and THE System SHALL keep the previously active Confluence_Weights unchanged.
7. IF the Confluence_Engine receives two or more StrategySignals with the same Strategy_Id for one Pair, THEN THE Confluence_Engine SHALL return a typed error naming the duplicate Strategy_Id and SHALL NOT return a Confluence_Score.
8. THE Confluence_Engine SHALL return an identical Confluence_Result (Confluence_Score and Confluence_Status) for every permutation of the same set of input signals.
9. THE Confluence_Engine SHALL be a pure function that reads no clock, randomness, environment, network, or storage, so that identical inputs always produce identical outputs.
10. THE Confluence_Engine SHALL accept only StrategySignal values, and IF an input value is not a StrategySignal, THEN THE Confluence_Engine SHALL reject it with a typed error so that no LLM-tagged value can enter the computation.

### Requirement 9: Conflict Resolution and Stay Flat

**User Story:** As a trader, I want opposing strong signals to force a flat verdict, so that I am never nudged into a trade the inputs disagree on.

#### Acceptance Criteria

1. IF at least one `UP` signal and at least one `DOWN` signal each have `strength` greater than or equal to the Conflict_Threshold and each have a weight greater than 0, THEN THE Confluence_Engine SHALL set Confluence_Status to `CONFLICT_FLAT`.
2. WHEN Confluence_Status is set to `CONFLICT_FLAT`, THE Confluence_Engine SHALL report the computed Confluence_Score (unmodified by the conflict) and the Strategy_Ids of every `UP` and `DOWN` signal that met the Conflict_Threshold condition in criterion 1.
3. WHEN no conflict exists, more than one signal has a weight greater than 0 and a non-`FLAT` direction, and the Confluence_Score is greater than or equal to the alignment threshold, THE Confluence_Engine SHALL set Confluence_Status to `ALIGNED_UP`.
4. WHEN no conflict exists, more than one signal has a weight greater than 0 and a non-`FLAT` direction, and the Confluence_Score is less than or equal to the negative of the alignment threshold, THE Confluence_Engine SHALL set Confluence_Status to `ALIGNED_DOWN`.
5. WHEN no conflict exists, more than one signal has a weight greater than 0 and a non-`FLAT` direction, and the absolute Confluence_Score is strictly less than the alignment threshold, THE Confluence_Engine SHALL set Confluence_Status to `NEUTRAL`.
6. THE Confluence_Engine SHALL accept the Conflict_Threshold and the alignment threshold as configuration values, each defaulting to 0.6 and 0.4 respectively when not supplied.
7. IF the Conflict_Threshold or the alignment threshold is less than 0.0, greater than 1.0, or non-finite (NaN or infinite), THEN THE System SHALL reject the configuration with a typed error identifying the offending parameter, and SHALL retain the previously active configuration unchanged.
8. FOR ALL signal sets that do not produce `INSUFFICIENT_DATA`, flipping every `UP` to `DOWN` and every `DOWN` to `UP` SHALL negate the Confluence_Score and swap `ALIGNED_UP` with `ALIGNED_DOWN`, leaving `CONFLICT_FLAT` and `NEUTRAL` unchanged; signal sets that produce `INSUFFICIENT_DATA` SHALL still produce `INSUFFICIENT_DATA` after flipping (symmetry).
9. WHEN the conflict condition in criterion 1 is met, THE Confluence_Engine SHALL set Confluence_Status to `CONFLICT_FLAT` for any Confluence_Score value in [-1.0, 1.0], including values at or beyond the alignment threshold.
10. WHEN exactly one signal has a weight greater than 0 and a non-`FLAT` direction, THE Confluence_Engine SHALL set Confluence_Status to `NEUTRAL`, regardless of that signal's strength.

### Requirement 10: Per-Pair Evaluation Orchestration

**User Story:** As an operator, I want the daily run to evaluate every Pair through all strategies, so that the Confluence_Matrix is complete and consistent.

#### Acceptance Criteria

1. WHEN the daily run completes the Pair evaluations, THE System SHALL evaluate the Trend_Strategy, Breakout_Strategy, Range_Strategy, and Reversal_Strategy for each of the five Pairs using only stored Candles dated strictly before the Decision_Date.
2. WHEN the four strategy signals and the Custom_Pattern_Signal have been produced for a Pair, THE System SHALL pass them, together with the Third_Party_Signal if one is available for that Pair, to the Confluence_Engine exactly once for that Pair per daily run.
3. IF a strategy fails for a Pair because of a typed error or a look-ahead rejection, THEN THE System SHALL record that strategy as unavailable for that Pair with a reason identifying the failure type, retain the signals of the other strategies for that Pair, and continue evaluating the remaining strategies and Pairs.
4. IF a Pair has zero stored Candles dated before the Decision_Date, THEN THE System SHALL emit Confluence_Status `INSUFFICIENT_DATA` for that Pair and continue evaluating the remaining Pairs.
5. WHEN the Confluence evaluation completes for a daily run, THE System SHALL produce firing / suppression decisions, Earned_Confidence values, and Confidence_Threshold values identical to those produced for the same inputs without the Confluence evaluation.
6. IF the Confluence evaluation raises an unexpected error, THEN THE System SHALL log a warning containing no secrets (no credentials, keys, or tokens), complete the rest of the daily run, and emit an empty Confluence_Matrix slice (zero entries) in the Dashboard_Snapshot.
7. WHEN the daily run produces a Dashboard_Snapshot, THE System SHALL evaluate the Confluence_Matrix for the same Decision_Date as every other section of that Dashboard_Snapshot.
8. IF all four strategies are recorded as unavailable for a Pair, THEN THE System SHALL still pass that Pair to the Confluence_Engine with all four strategy signals marked unavailable and SHALL NOT omit the Pair from the Confluence_Matrix.

### Requirement 11: Dashboard Snapshot Extension

**User Story:** As a developer, I want the matrix carried in the snapshot envelope, so that the SPA can render it from the existing static asset.

#### Acceptance Criteria

1. THE System SHALL add a `confluence` slice to the Dashboard_Snapshot and set `SNAPSHOT_SCHEMA_VERSION` to 5 (previously 4).
2. WHEN a run supplies a Confluence evaluation, THE System SHALL include in the `confluence` slice, for each of the five Pairs, exactly one entry per Strategy_Id containing either the StrategySignal or an explicit unavailable marker with a non-empty reason, together with the Confluence_Score, the Confluence_Status, and the list of opposing Strategy_Ids.
3. IF the Confluence_Status for a Pair is not `CONFLICT_FLAT`, THEN THE System SHALL emit an empty list of opposing Strategy_Ids for that Pair.
4. IF a Pair's Confluence_Status is `CONFLICT_FLAT`, THEN THE System SHALL list in the opposing Strategy_Ids at least one Strategy_Id from each opposing direction.
5. WHEN a run supplies a Confluence evaluation, THE System SHALL include in the slice the Confluence_Weights, Conflict_Threshold, and alignment threshold used for that run, with the same numeric values the evaluation used.
6. THE System SHALL set the Validation_Label in the slice to the string `unvalidated` for every snapshot until an out-of-sample measurement exists.
7. WHEN a run supplies no Confluence evaluation, THE System SHALL emit the `confluence` slice with its defined empty default (an empty Pair collection, the Validation_Label `unvalidated`, and no missing keys), so that consumers need not guard for a missing key.
8. THE System SHALL leave every pre-existing snapshot slice, other than the schema version field, byte-for-byte identical in serialized output to the output produced for the same inputs before this change.
9. FOR ALL Confluence slices, serializing with `serializeSnapshot`, parsing with `JSON.parse`, and re-serializing SHALL produce a document identical to the first serialization (round-trip).
10. THE System SHALL emit the `confluence` slice with no LLM provenance fields.
11. WHEN the web client receives a snapshot with `schemaVersion` below 5, THE `parseSnapshot` function SHALL return a snapshot whose `confluence` slice equals the empty default and SHALL NOT throw or report an error.
12. IF the web client receives a snapshot with `schemaVersion` of 5 whose `confluence` slice is missing or structurally invalid, THEN THE `parseSnapshot` function SHALL reject the snapshot with an error indicating the invalid `confluence` slice and SHALL NOT return a partially populated snapshot.

### Requirement 12: Confluence Matrix Rendering

**User Story:** As a trader, I want a grid showing every strategy's call for each Pair, so that I can audit why a Pair is green, red, or neutral.

#### Acceptance Criteria

1. WHEN the snapshot's `confluence` slice contains at least one Pair, THE Confluence_Panel SHALL render exactly one row per Pair and exactly one column per Strategy_Id, with each cell showing its direction as a text label and its strength as a numeric value.
2. WHEN the snapshot's `confluence` slice contains at least one Pair, THE Confluence_Panel SHALL show each Pair's Confluence_Score and Confluence_Status as text in that Pair's row.
3. WHEN a Pair's Confluence_Status is `ALIGNED_UP`, THE Confluence_Panel SHALL mark the Pair green; WHEN `ALIGNED_DOWN`, red; WHEN `NEUTRAL` or `INSUFFICIENT_DATA`, neutral; WHEN `CONFLICT_FLAT`, a distinct conflict marker labelled "Stay Flat" that differs from the green, red, and neutral markers.
4. THE Confluence_Panel SHALL convey every direction and every Confluence_Status through a visible text label, so that no direction or status is distinguishable by colour alone.
5. WHEN the user selects a cell by pointer click, Enter key, or Space key, THE Confluence_Panel SHALL show that signal's `rationale` within 200 ms, and SHALL keep it visible until the user selects another cell or dismisses it.
6. IF a signal is unavailable, THEN THE Confluence_Panel SHALL show an "unavailable" cell containing a text reason, and SHALL NOT leave the cell empty.
7. WHEN a Pair's Confluence_Status is `CONFLICT_FLAT`, THE Confluence_Panel SHALL visually highlight every cell of the strategies whose direction opposes another contributing strategy, and SHALL mark each highlighted cell with a text label.
8. THE Confluence_Panel SHALL display the Validation_Label and the text "Strength is not a probability" in every view region in which strengths or the Confluence_Score appear.
9. WHILE the `third_party` weight is 0, THE Confluence_Panel SHALL label the `third_party` column "display-only" in its column header.
10. THE Confluence_Panel SHALL allow every cell, and every control that selects or dismisses a rationale, to be reached and operated using only the keyboard (Tab, Shift+Tab, arrow keys, Enter, Space, Escape), with a visible focus indicator on the focused element.
11. THE Confluence_Panel SHALL expose for each cell an accessible name that includes the Pair, Strategy_Id, direction, and strength (or the unavailable reason).
12. IF the snapshot's `confluence` slice is empty, THEN THE Confluence_Panel SHALL show the text "no confluence data for this run" and SHALL NOT render any Pair rows.
13. THE Confluence_Panel SHALL shape snapshot data through a pure view-model function that performs no I/O and returns identical output for identical input, so that it is unit-testable without a DOM.
14. WHEN a Pair's Confluence_Status is `CONFLICT_FLAT`, THE Confluence_Panel SHALL show a Conflict_Summary sentence for that Pair that names at least one opposing `UP` Strategy_Id and at least one opposing `DOWN` Strategy_Id with their directions, and states that the verdict is no-trade; the sentence SHALL be derived only from the Pair's `opposingStrategyIds` and its cells, and SHALL contain no value absent from the slice.
15. WHEN a Pair's Confluence_Status is not `CONFLICT_FLAT`, THE Confluence_Panel SHALL NOT show a Conflict_Summary sentence for that Pair.
16. WHEN the snapshot's `confluence` slice contains at least one Pair, THE Confluence_Panel SHALL render, for each Pair, a Score_Gauge spanning the fixed interval [-1.0, +1.0] centred at 0 with the positive and negative alignment thresholds marked, AND SHALL also keep the numeric Confluence_Score text required by criterion 2 (the gauge supplements, never replaces, the number).
17. WHEN the snapshot's `confluence` slice contains at least one Pair, THE Confluence_Panel SHALL display a Confluence_Summary giving the count of aligned, conflict, and neutral Pairs across the rendered Pairs, where aligned counts `ALIGNED_UP` and `ALIGNED_DOWN`, conflict counts `CONFLICT_FLAT`, and neutral counts `NEUTRAL` and `INSUFFICIENT_DATA`, and the three counts sum to the number of rendered Pairs.
18. THE Confluence_Panel SHALL assign each cell an Emphasis_Level of `signal` when the cell is available, has a non-`FLAT` direction, and its Strategy_Id has a weight greater than 0, and `muted` otherwise, AND the Emphasis_Level SHALL NOT alter the cell's direction, strength, rationale, Confluence_Score, or Confluence_Status, NOR suppress any text label required by criteria 1, 4, 6, or 11.

### Requirement 14: Honest Presentation Until Validated

**User Story:** As a trader, I want an un-validated Confluence_Matrix to never look like a high-conviction trade signal, so that agreement between strategies is not mistaken for a proven edge (the standing "nothing shown as more certain than the evidence" guard).

#### Acceptance Criteria

1. WHILE the Validation_Label is `unvalidated`, THE Confluence_Panel SHALL render every Pair's status marker in a single neutral colour treatment, so that `ALIGNED_UP`, `ALIGNED_DOWN`, `NEUTRAL`, `INSUFFICIENT_DATA`, and `CONFLICT_FLAT` are NOT distinguishable from one another by colour.
2. WHILE the Validation_Label is `unvalidated`, THE Confluence_Panel SHALL still distinguish every status through the visible text label required by Requirement 12.4 and the distinct `CONFLICT_FLAT` "Stay Flat" marker required by Requirement 12.3, so that suppressing colour never suppresses meaning.
3. WHEN the Validation_Label is any value other than `unvalidated`, THE Confluence_Panel SHALL apply the green / red / neutral / conflict colour treatment described in Requirement 12.3.
4. THE Confluence_Panel SHALL derive the colour-suppression decision solely from the slice's Validation_Label, through the pure view-model function, so that it is deterministic and unit-testable without a DOM.
5. THE System SHALL keep the Validation_Label at `unvalidated` for this feature, because no out-of-sample measurement of the Confluence_Matrix exists; a future measurement capability (the `trader-edge-validation` Trade_Ledger) is the only thing that may set it otherwise, and that capability is out of scope here.

### Requirement 13: Testing and Verification

**User Story:** As a developer, I want thorough unit and property tests, so that strategy math and confluence rules are trustworthy.

#### Acceptance Criteria

1. THE System SHALL include, for each strategy, at least one unit test per case for each of the following: UP, DOWN, FLAT, insufficient-history (fewer candles than the strategy's documented minimum), and zero-volatility (all candles with identical OHLC values), where each test asserts the expected direction and `strength` value.
2. THE System SHALL include fast-check property tests, each running at least 100 generated cases, asserting for each strategy that `strength` is in [0.0, 1.0], that FLAT implies `strength` equals 0.0, and that `rationale` is a string of 1 to 500 characters containing at least one non-whitespace character.
3. THE System SHALL include fast-check property tests, each running at least 100 generated cases, asserting for each strategy that two calls with deeply equal input return deeply equal output, and that the input candle array is deeply equal to a pre-call copy after the call.
4. THE System SHALL include a fast-check look-ahead property test for each strategy, running at least 100 generated cases, asserting that candles dated on or after the Decision_Date are rejected with an error, and that the result for the accepted candles (dated before the Decision_Date) is deeply equal with and without such candles appended.
5. THE System SHALL include fast-check property tests for the Confluence_Engine, each running at least 100 generated cases, asserting that the Confluence_Score is within its documented bounds, that permuting the order of input signals yields an identical result, that swapping UP and DOWN on all signals yields a mirrored result with equal score magnitude, and that any set of signals containing at least one UP and at least one DOWN signal that each have strength at or above the Conflict_Threshold and a non-zero weight yields `CONFLICT_FLAT` status.
6. THE System SHALL include a test asserting that, when the `third_party` weight is 0, the Confluence_Score and Confluence_Status are identical with and without the `third_party` signal present.
7. THE System SHALL include a test asserting that the firing decision and Earned_Confidence produced for the same input are identical with and without the Confluence evaluation.
8. THE System SHALL include a guardrail test asserting that an LLM-tagged value supplied to a strategy, to an adapter output, or to the Confluence_Engine is rejected with an error and does not alter the output of any of them.
9. THE System SHALL include a fast-check snapshot round-trip property test, running at least 100 generated cases, asserting that serializing then parsing the `confluence` slice yields a deeply equal value, and a web test asserting that `parseSnapshot` accepts both a v4 document and a v5 document without error.
10. THE System SHALL include web tests for the Confluence_Panel view-model covering each Confluence_Status value, a cell whose signal is unavailable, and the empty state with no confluence data, each asserting the expected view-model output.
10a. THE System SHALL include web tests asserting: a `CONFLICT_FLAT` Pair yields a Conflict_Summary naming an opposing UP and an opposing DOWN Strategy_Id while a non-`CONFLICT_FLAT` Pair yields none (Requirements 12.14, 12.15); the Score_Gauge spans [-1.0, +1.0] with both alignment thresholds marked and the numeric score text is still present (Requirement 12.16); the Confluence_Summary counts partition the rendered Pairs and sum to their count (Requirement 12.17); each cell's Emphasis_Level is `signal` only for an available, non-`FLAT`, positive-weight cell and `muted` otherwise, with no text label removed (Requirement 12.18); and that WHILE the Validation_Label is `unvalidated` the view-model marks every status with one neutral colour treatment yet still carries each status's text label, while a non-`unvalidated` label restores the per-status colour treatment (Requirement 14.1-14.4).
11. WHEN `make check` runs on a tree where all tests pass, THE System SHALL run lint, type-check, and the full test suite (backend, plus web where the existing check includes it) and exit with code 0.
12. IF lint, type-check, or any test fails during `make check`, THEN THE System SHALL exit with a non-zero code and report the failing step and test names.
