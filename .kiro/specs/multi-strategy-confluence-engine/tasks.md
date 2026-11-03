# Implementation Plan: Multi-Strategy Confluence Engine

## Overview

This plan turns the design into incremental, test-driven coding tasks grouped into
**deploy-safe stages**. It adds four deterministic classical strategies, a shared
`StrategySignal` contract, two adapters, a pure Confluence_Engine with "Stay Flat on
Conflict", a per-run matrix orchestrator, a `confluence` slice in `dashboard.json`
(schema v5), and a keyboard-accessible `ConfluencePanel`. The panel also carries the
folded-in honest-presentation improvements: a per-conflict plain-language "why flat"
sentence, a diverging Score_Gauge beside the numeric score, an aligned/conflict/neutral
count summary, de-emphasised FLAT/unavailable/zero-weight cells, and colour semantics
that stay suppressed until an out-of-sample measurement exists (Requirement 14).
Implementation language is TypeScript (backend `src/`, SPA `web/src/`), as in the design.

The feature is **additive and parallel**. It does not change the firing / suppression
decision, Earned_Confidence, the Confidence_Threshold (0.55), the Trade_Ledger, or any
pre-existing snapshot slice. No task touches live cloud resources; all tests inject
in-memory stores and stubs.

### Deploy-safety invariants (every stage)

- **Independently green.** `make check` (lint + typecheck + vitest) is green at the end
  of each stage. From Stage G onward, the web build and web tests must also pass
  (`cd web && npm run build && npm test`) until Stage H folds them into `make check`.
- **Live decision unchanged.** Modules added here are separate read-only consumers of
  already-produced data. Nothing feeds retrieval, confidence, firing, risk, or the
  Measurement_Engine.
- **Producer before consumer.** The backend v5 snapshot producer (Stage F) lands before
  the web parser, types, shapers, and `ConfluencePanel` (Stage G). The currently
  deployed SPA accepts any numeric `schemaVersion` and defaults unknown slices, so a v5
  document is safe for it.
- **Fail-safe daily run.** A confluence failure degrades to `EMPTY_CONFLUENCE` with a
  secret-free warning; the run still publishes `dashboard.json`.
- **No half-exposed contract.** No stage ships a reader of a field that an earlier
  stage has not created.

### Stage map

| Stage | Ships | Deploys | Live-decision impact | Requirements |
|-------|-------|---------|----------------------|--------------|
| **A** | Signal contract, candle prep, indicators, shared test generators | backend (unwired) | none | 1, 6 |
| **B** | Trend, Breakout, Range, Reversal strategies + cross-strategy properties | backend (unwired) | none | 2, 3, 4, 5, 6, 13 |
| **C** | `custom_pattern` and `third_party` adapters | backend (unwired) | none | 7 |
| **D** | Confluence_Engine, env config, LLM and import-boundary guardrails | backend (unwired) | none | 8, 9, 13 |
| **E** | Matrix orchestration (`buildConfluenceMatrix`) | backend (unwired) | none | 10, 7.10, 13 |
| **F** | Snapshot v5 slice + `persistView` wiring (producer) | backend | output only: additive `confluence` key; decision unchanged | 10, 11, 13 |
| **G** | Web parser/types, shapers, `ConfluencePanel` (consumer) | frontend | presentation only | 11, 12, 13, 14 |
| **H** | `make check` web step + final checkpoint | tooling | none | 13 |

Stages are strictly ordered A to H. Within a stage, tasks may be done in any order
unless noted.

## Task Dependency Graph

Waves group leaf sub-tasks. Tasks in a wave are independent and write to different
files. Stage boundaries are preserved: no wave mixes producer (F) and consumer (G) work.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4"] },
    { "id": 3, "tasks": ["4.1", "5.1", "6.1", "7.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "5.2", "5.3", "6.2", "6.3", "7.2", "7.3"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.6"] },
    { "id": 7, "tasks": ["10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 9, "tasks": ["12.1"] },
    { "id": 10, "tasks": ["12.2"] },
    { "id": 11, "tasks": ["12.3", "12.4", "12.5", "12.6", "12.7", "12.8", "13.1", "13.2"] },
    { "id": 12, "tasks": ["15.1"] },
    { "id": 13, "tasks": ["15.2", "15.3", "15.4", "15.5"] },
    { "id": 14, "tasks": ["17.1"] },
    { "id": 15, "tasks": ["17.2", "18.1"] },
    { "id": 16, "tasks": ["18.2", "18.3", "19.1"] },
    { "id": 17, "tasks": ["19.2"] },
    { "id": 18, "tasks": ["21.1"] },
    { "id": 19, "tasks": ["21.2"] },
    { "id": 20, "tasks": ["21.3", "21.4", "21.5", "22.1", "22.2"] },
    { "id": 21, "tasks": ["22.3", "22.4", "22.5", "23.1"] },
    { "id": 22, "tasks": ["23.2"] },
    { "id": 23, "tasks": ["23.3"] },
    { "id": 24, "tasks": ["25.1"] }
  ]
}
```

## Tasks

### Stage A: Shared contract, candle prep, indicators (backend, unwired)

Pure modules with no caller yet, so deploying them changes no behaviour.

- [x] 1. Define the StrategySignal contract
  - [x] 1.1 Implement `src/strategies/types.ts`
    - Export `STRATEGY_IDS`, `StrategyId`, `SIGNAL_DIRECTIONS`, `SignalDirection`, `StrategySignal` (exactly four fields), `RATIONALE_MAX_LENGTH`, `SignalViolation`, `StrategyError`, `StrategyResult`, `Strategy<C>`, `ConfigError`.
    - Implement `isStrategyId`, `isSignalDirection`, `validateStrategySignal` (check order: LLM brand via `isLlmTagged`, shape, strategyId, direction, strength, rationale; first failure names the field) and `buildSignal` (forces strength 0 for FLAT, accepts UP/DOWN with strength 0 unchanged).
    - Import only `../llm/types.js` from `src/llm`; reuse `Result`, `Candle`, `TradingDate` from `src/guard`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x] 1.2 Write unit tests in `src/strategies/types.test.ts`
    - Cover `buildSignal` and `validateStrategySignal` cases, including UP with strength 0 accepted, FLAT with non-zero strength rejected, and `@ts-expect-error` checks that unknown `strategyId` and `direction` values fail to compile.
    - _Requirements: 1.2, 1.3, 1.5, 1.8, 1.9_

  - [x] 1.3 Write property test for signal validation
    - **Property 2: Signal validation rejects exactly the invalid signals**
    - Put it in `src/strategies/signalValidation.property.test.ts`, tagged `// Feature: multi-strategy-confluence-engine, Property 2: ...`, `numRuns >= 100`.
    - **Validates: Requirements 1.1, 1.8, 1.9**

- [x] 2. Candle preparation, indicators, and shared test generators
  - [x] 2.1 Implement `src/strategies/candles.ts`
    - `prepareCandles(candles, decisionDate)` with the fixed check order: `assertPastOnly`, then empty (`insufficient_data`), then finite OHLC (`invalid_candle` with field and date), then return a stably date-sorted copy. Never mutate the input.
    - _Requirements: 6.1, 6.2, 6.6, 6.7, 6.8, 6.9_

  - [x] 2.2 Implement `src/strategies/indicators.ts`
    - `sma`, `populationStdDev`, `emaSeries` (SMA seed, `alpha = 2/(period+1)`), `rsiWilder` (Wilder smoothing; 100 when average loss is 0, 50 when both are 0), `roundTo` (normalises `-0`), `clamp01` (`NaN` gives 0), `atrUsable`. Reuse `computeAtr14` from `src/confidence/atr.ts`; do not re-implement ATR.
    - _Requirements: 2.1, 2.5, 3.5, 4.4, 5.1_

  - [x] 2.3 Write unit tests for candles and indicators
    - `src/strategies/candles.test.ts`: look-ahead wins over non-finite (6.9), empty array, first bad field and date named, input array and candle objects unchanged, output sorted.
    - `src/strategies/indicators.test.ts`: hand-checked EMA, SMA, std-dev, RSI (including the 100 and 50 edge cases), `roundTo(-0)`.
    - _Requirements: 6.1, 6.2, 6.6, 6.7, 6.8, 6.9_

  - [x] 2.4 Add shared fast-check generators
    - Create `src/strategies/testing/arbitraries.ts` (backend fast-check 4.10.0): `arbCandleSeries({min,max})` (ascending weekday dates, `low <= open,close <= high`, random-walk with optional flat segments), `arbDecisionDateAfter`, `arbFutureCandles`, `arbSignal`, `arbSignalSet`, `arbWeights`, `arbThresholds`, `arbInvalidSignal`, `arbLlmTagged` (via the existing `tagLlmOutput` helper).
    - Test-support only; excluded from the runtime import-boundary scan in task 13.2.
    - _Requirements: 13.2, 13.3, 13.4, 13.5_

- [x] 3. Checkpoint - Stage A green
  - Ensure all tests pass, ask the user if questions arise.

### Stage B: The four strategies (backend, unwired)

Each strategy is a pure factory returning `Result<Strategy<C>, ConfigError>`. Nothing in the daily run calls them yet.

- [x] 4. Trend Following strategy
  - [x] 4.1 Implement `src/strategies/trend.ts`
    - `createTrendStrategy(partial?)` with defaults 20/50/5, validation naming the invalid parameter, frozen config. Evaluate order: `prepareCandles`, history check (`n < slow + slopeWindow`), ATR check, direction from `diff` and `slope`, `strength = clamp01(|diff| / atr)`, rationale with fast, slow, slope at 5 dp.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [x] 4.2 Write unit tests in `src/strategies/trend.test.ts`
    - One hand-computed case each for UP, DOWN, FLAT, insufficient history (54 candles), and zero volatility (identical OHLC); assert direction and strength. Add the ATR-unavailable and invalid-config cases.
    - _Requirements: 13.1, 2.2, 2.3, 2.4, 2.8, 2.9, 2.11_

  - [x] 4.3 Write property test for Trend
    - **Property 8: Trend follows the EMA relation**
    - In `src/strategies/trend.property.test.ts` with an independent naive oracle; relative tolerance `1e-9`.
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7**

- [x] 5. Breakout strategy
  - [x] 5.1 Implement `src/strategies/breakout.ts`
    - `createBreakoutStrategy(partial?)` with `channelPeriod = 20`. Channel window is `candles[n-1-N .. n-2]`, excluding the latest candle. UP/DOWN/FLAT from the latest close. Strength is `clamp01(distance / atr)`; unusable ATR keeps the detected direction with strength 0 and an "ATR unavailable" rationale. Rationale includes channel high, channel low, close.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [x] 5.2 Write unit tests in `src/strategies/breakout.test.ts`
    - UP, DOWN, FLAT, insufficient history (20 candles), zero volatility, plus the ATR-unavailable path (3.10) and a breakout candle that cannot define its own channel.
    - _Requirements: 13.1, 3.2, 3.3, 3.4, 3.8, 3.9, 3.10_

  - [x] 5.3 Write property test for Breakout
    - **Property 9: Breakout compares the latest close with a channel that excludes it**
    - Include the metamorphic check that widening the latest candle's high/low leaves direction and channel values unchanged.
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.9**

- [x] 6. Range / Mean Reversion strategy
  - [x] 6.1 Implement `src/strategies/range.ts`
    - `createRangeStrategy(partial?)` with defaults 20/2/14/30/70 and validation. Bollinger bands over the last `bbPeriod` closes (population std-dev), zero std-dev returns FLAT "zero volatility", Wilder RSI, UP/DOWN require both band and RSI extremes, strength is the mean of clamped penetration and RSI-distance scores. Rationale: close, bands at 5 dp, RSI at 2 dp.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [x] 6.2 Write unit tests in `src/strategies/range.test.ts`
    - UP, DOWN, FLAT, insufficient history (19 candles), zero volatility (identical OHLC), invalid-config cases.
    - _Requirements: 13.1, 4.1, 4.2, 4.3, 4.6, 4.7, 4.9_

  - [x] 6.3 Write property test for Range
    - **Property 10: Range requires both band and RSI extremes**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

- [x] 7. Reversal / Exhaustion strategy
  - [x] 7.1 Implement `src/strategies/reversal.ts`
    - `createReversalStrategy(partial?)` with defaults 2.0/20/3, validated before any candle is read. Minimum candles `baselinePeriod + 2*momentumWindow`; distinct rationale for insufficient candles vs zero ATR. Unrounded `extension`, `rocRecent`, `rocPrev`; exhaustion rule per design; `strength = min(1, (|ext| - thr) / thr)`; rationale includes extension, ATR, both ROCs at 5 dp.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [x] 7.2 Write unit tests in `src/strategies/reversal.test.ts`
    - UP, DOWN, FLAT, insufficient history (25 candles), zero volatility (zero ATR), exhaustion absent, invalid-config cases (no candle evaluated).
    - _Requirements: 13.1, 5.2, 5.3, 5.4, 5.8, 5.10_

  - [x] 7.3 Write property test for Reversal
    - **Property 11: Reversal needs extreme extension and fading momentum**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7**

- [x] 8. Barrel and cross-strategy properties
  - [x] 8.1 Create `src/strategies/index.ts`
    - Export the contract, `prepareCandles`, the four factories, and their config types. Later stages append to this barrel.
    - _Requirements: 1.1, 6.1_

  - [x] 8.2 Write property test for signal validity across strategies
    - **Property 1: Strategy signals are always valid**
    - In `src/strategies/signalValidity.property.test.ts`.
    - **Validates: Requirements 1.4, 1.5, 1.6, 2.6, 3.6, 13.2**

  - [x] 8.3 Write property tests for look-ahead safety
    - **Property 3: Look-ahead candles are rejected**
    - **Property 4: Future candles never change a strategy's output**
    - In `src/strategies/lookAhead.property.test.ts`, run for each of the four strategies.
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.9, 2.1, 13.4**

  - [x] 8.4 Write property tests for determinism and invalid candles
    - **Property 5: Strategies are deterministic and do not mutate inputs**
    - **Property 6: Invalid candles produce typed errors**
    - In `src/strategies/determinism.property.test.ts`.
    - **Validates: Requirements 6.4, 6.6, 6.7, 6.8, 13.3**

  - [x] 8.5 Write property test for insufficient history
    - **Property 7: Insufficient history yields FLAT without error**
    - In `src/strategies/insufficientHistory.property.test.ts`.
    - **Validates: Requirements 2.9, 3.8, 4.6, 5.8**

  - [x] 8.6 Write property test for strategy configuration validation
    - **Property 12: Strategy configuration validation**
    - In `src/strategies/config.property.test.ts`.
    - **Validates: Requirements 2.10, 2.11, 4.8, 4.9, 5.9, 5.10**

- [x] 9. Checkpoint - Stage B green
  - Ensure all tests pass, ask the user if questions arise.

### Stage C: Adapters (backend, unwired)

- [x] 10. Existing-producer adapters
  - [x] 10.1 Implement `src/strategies/adapters.ts`
    - `adaptCustomPattern(evaluation)` (UP/DOWN strength equals Earned_Confidence; FLAT strength 0; input never mutated) and `adaptThirdParty(reference, scale?)` with `DEFAULT_THIRD_PARTY_SCALE = { fullScaleAbs: 1.0 }`: BUY/SELL/HOLD mapping, linear clamped normalisation, 0.5 when no score, `unavailable` with a non-empty reason for null/undefined, LLM-tagged, unknown direction, or non-finite score.
    - Import nothing from `confidence/` or `kill-gate/` (types of `PairEvaluation` only). Update the barrel.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_

  - [x] 10.2 Write unit tests in `src/strategies/adapters.test.ts`
    - Hand-checked mappings, 0.5 default strength, FLAT ignoring confidence, each unavailable reason, and input unchanged.
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x] 10.3 Write property test for the custom-pattern adapter
    - **Property 13: Custom-pattern adapter preserves direction and confidence**
    - In `src/strategies/adapters.property.test.ts`.
    - **Validates: Requirements 7.1, 7.2, 7.9**

  - [x] 10.4 Write property test for the third-party adapter
    - **Property 14: Third-party adapter maps and normalises deterministically**
    - In `src/strategies/adaptersThirdParty.property.test.ts`; include monotonicity in `|score|`.
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.6, 7.8, 7.9**

- [x] 11. Checkpoint - Stage C green
  - Ensure all tests pass, ask the user if questions arise.

### Stage D: Confluence_Engine and guardrails (backend, unwired)

- [x] 12. Confluence engine and configuration
  - [x] 12.1 Implement `src/strategies/confluenceEngine.ts`
    - `DEFAULT_CONFLUENCE_CONFIG` (weights 1,1,1,1,1,0; conflict 0.6; alignment 0.4), `createConfluenceEngine(partial?)` with `ConfigError` naming the Strategy_Id or parameter, and `aggregate(signals)` with the design's steps: re-validate every input, reject duplicates, sort into `STRATEGY_IDS` order, `W === 0` gives `INSUFFICIENT_DATA`, clamped weighted mean with `-0` normalised, conflict detection, classification, opposing ids only for `CONFLICT_FLAT`. All positive-weight signals FLAT gives `NEUTRAL`.
    - Accept `Deterministic<StrategySignal>` at the type level. Update the barrel.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

  - [x] 12.2 Implement `src/strategies/config.ts`
    - `confluenceConfigFromEnv(env = process.env)` reading `CONFLUENCE_WEIGHTS` (JSON, unknown keys rejected with the key named), `CONFLUENCE_CONFLICT_THRESHOLD`, `CONFLUENCE_ALIGNMENT_THRESHOLD`. Returns `Result<Partial<...>, ConfigError>`; the engine itself never reads the environment. Update the barrel.
    - _Requirements: 8.4, 8.5, 8.6, 8.9, 9.6, 9.7_

  - [x] 12.3 Write unit tests for the engine and env config
    - `src/strategies/confluenceEngine.test.ts`: default weights and thresholds, hand-checked scores, empty list, all-FLAT NEUTRAL, single contributor NEUTRAL, non-zero `third_party` weight included.
    - `src/strategies/envConfig.test.ts`: valid parsing, invalid JSON, unknown key, out-of-range threshold, fallback to defaults.
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 9.6, 9.7, 9.10_

  - [x] 12.4 Write property tests for score and zero-weight behaviour
    - **Property 15: Confluence score is the bounded weighted mean**
    - **Property 16: Zero total weight means insufficient data**
    - In `src/strategies/engineScore.property.test.ts`.
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5, 13.5**

  - [x] 12.5 Write property tests for order independence and symmetry
    - **Property 17: Aggregation is order independent**
    - **Property 20: UP/DOWN symmetry**
    - In `src/strategies/engineMetamorphic.property.test.ts`; exact equality, not tolerance.
    - **Validates: Requirements 8.8, 8.9, 9.8, 13.5**

  - [x] 12.6 Write property tests for conflict and classification
    - **Property 18: Strong opposition forces Stay Flat**
    - **Property 19: Non-conflict classification follows the thresholds**
    - In `src/strategies/engineStatus.property.test.ts`; generators must hit values at and around the thresholds.
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.9, 9.10, 11.3, 11.4, 13.5**

  - [x] 12.7 Write the third-party weight-0 neutrality test
    - **Property 21: A zero-weight third-party signal has no effect**
    - In `src/strategies/thirdPartyNeutrality.property.test.ts` (fast-check, `numRuns >= 100`): adding, removing, or changing the `third_party` signal leaves score, status, and opposing ids unchanged when its weight is 0. Required by Requirement 13.6.
    - **Validates: Requirements 8.4, 13.6**

  - [x] 12.8 Write property test for engine input and config rejection
    - **Property 22: Invalid engine input or configuration is rejected**
    - In `src/strategies/engineRejection.property.test.ts`.
    - **Validates: Requirements 8.6, 8.7, 8.10, 9.7**

- [x] 13. Guardrail tests
  - [x] 13.1 Write the LLM-tagged rejection guardrail test
    - **Property 23: LLM-tagged values never enter strategies, adapters, or the engine**
    - `src/strategies/llmGuardrail.test.ts`: an LLM-tagged value passed to `validateStrategySignal`, `aggregate`, and as the `adaptThirdParty` reference is rejected (or `unavailable`) and does not alter the outputs for the valid inputs. Use the real brand via `tagLlmOutput`. Required by Requirement 13.8.
    - **Validates: Requirements 1.7, 8.10, 13.8**

  - [x] 13.2 Write the import-boundary and purity static scan
    - Add to `src/strategies/llmGuardrail.test.ts` (or `importBoundary.test.ts`): no non-test file under `src/strategies/` imports from `../llm/` other than `../llm/types.js`, imports a provider SDK, or references `Date`, `Math.random`, `process.env` (except `config.ts`, which takes `env` as a parameter), `fetch`, or `fs`. Test files and `testing/` are exempt. Must pass alongside the existing `importBoundary.smoke.test.ts`.
    - _Requirements: 6.5, 8.9, 13.8_

- [x] 14. Checkpoint - Stage D green
  - Ensure all tests pass, ask the user if questions arise.

### Stage E: Matrix orchestration (backend, unwired)

- [x] 15. Per-run matrix builder
  - [x] 15.1 Implement `src/strategies/confluenceMatrix.ts`
    - `buildConfluenceMatrix({ decisionDate, inputs, strategies, engine, thirdPartyScale? })`: per Pair run the four strategies with isolated failure handling (unavailable cell with reason `look_ahead_violation`, `insufficient_data`, `invalid_candle:<field>@<date>`, `invalid_signal:<field>`), adapt `custom_pattern` and `third_party`, call `engine.aggregate` once per Pair, always return six cells in `STRATEGY_IDS` order and Pairs in `PAIRS` order. Zero candles gives `INSUFFICIENT_DATA` without calling the engine. An aggregate error is converted, not thrown. Never mutate inputs. Update the barrel.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8, 7.7_

  - [x] 15.2 Write unit tests in `src/strategies/confluenceMatrix.test.ts`
    - Wrap the engine to assert exactly one `aggregate` call per Pair with candles; zero-candle Pair; all four strategies failing still present; missing evaluation and missing reference; single shared `decisionDate`.
    - _Requirements: 10.2, 10.3, 10.4, 10.7, 10.8_

  - [x] 15.3 Write property test for matrix completeness and failure isolation
    - **Property 24: Matrix construction is complete and isolates failures**
    - In `src/strategies/confluenceMatrix.property.test.ts`.
    - **Validates: Requirements 7.7, 10.1, 10.2, 10.3, 10.4, 10.8**

  - [x] 15.4 Write property test for input immutability
    - **Property 25: Confluence evaluation does not change firing inputs**
    - Deep-freeze evaluations, candles, and references; assert no throw and unchanged values.
    - **Validates: Requirements 10.5, 7.10**

  - [x] 15.5 Write the firing / Earned_Confidence unchanged test
    - `src/strategies/firingUnchanged.test.ts`: call the real `earnedConfidence` selector (and Kill_Gate verdict where cheaply callable) with and without a third-party reference present and with and without `buildConfluenceMatrix` run on the same inputs; assert identical results. Required by Requirement 13.7.
    - _Requirements: 7.10, 10.5, 13.7_

- [x] 16. Checkpoint - Stage E green
  - Ensure all tests pass, ask the user if questions arise.

### Stage F: Snapshot v5 slice and persistView wiring (producer, backend deploy)

Deploying this stage grows only the output: `dashboard.json` gains an appended `confluence` key and `schemaVersion: 5`. Firing, persisted rows, and every earlier slice stay byte-identical.

- [x] 17. Snapshot v5 types and builder
  - [x] 17.1 Extend `src/scheduled-run/snapshot.ts`
    - Add `SnapshotConfluenceStrategyId`, `SnapshotConfluenceStatus`, `SnapshotConfluenceCell`, `SnapshotConfluencePair`, `SnapshotConfluenceSlice`, and `EMPTY_CONFLUENCE`. Set `SNAPSHOT_SCHEMA_VERSION = 5`. Add an optional seventh parameter `confluence = EMPTY_CONFLUENCE` to `buildDashboardSnapshot` and assign `confluence` as the last key so earlier keys keep order and bytes.
    - _Requirements: 11.1, 11.5, 11.6, 11.7, 11.8, 11.10_

  - [x] 17.2 Update `src/scheduled-run/snapshot.test.ts`
    - Change the version assertions from 4 to 5 and nothing else. Add: `confluence` defaults to `EMPTY_CONFLUENCE` when omitted; serialising with and without a confluence slice differs only in `schemaVersion` and `confluence`.
    - _Requirements: 11.1, 11.7, 11.8_

- [ ] 18. Fail-safe confluence slice
  - [~] 18.1 Implement `src/scheduled-run/confluenceSlice.ts`
    - Pure `toSnapshotConfluence(matrix)` (copies weights and thresholds from `engine.config`, `validationLabel: "unvalidated"`, zero or five Pairs, six cells each). `buildConfluenceSlice(deps)` never throws: resolve config via `confluenceConfigFromEnv` (fallback to defaults with a secret-free warning), load candles per Pair with `candleStore.getCandles(pair, windowStart, dayBefore(decisionDate))` using `HISTORY_WINDOW_DAYS` and `windowStartDate`, read third-party refs from `displayOnly?.comparisons`, run `buildConfluenceMatrix`. A per-Pair load failure yields all-unavailable cells with reason `candles_unavailable`; any other failure logs slice name and `err.message` only and returns `EMPTY_CONFLUENCE`.
    - _Requirements: 10.1, 10.4, 10.6, 10.7, 11.2, 11.3, 11.4, 11.5, 11.6, 11.10_

  - [~] 18.2 Write unit tests in `src/scheduled-run/confluenceSlice.test.ts`
    - Throwing candle store returns `EMPTY_CONFLUENCE` and logs a warning with no secret-like substrings (store error carrying a fake key); per-Pair candle-load failure; third-party extraction from `displayOnly`; one shared `decisionDate`; invalid env falls back to defaults.
    - _Requirements: 10.4, 10.6, 10.7_

  - [~] 18.3 Write the snapshot round-trip property test
    - **Property 26: Snapshot slice invariants and serialization round trip**
    - In `src/scheduled-run/confluenceSlice.property.test.ts` (fast-check 4.10.0, `numRuns >= 100`): slice invariants, then serialise, `JSON.parse`, serialise is a fixed point and parse is deeply equal. Required by Requirement 13.9.
    - **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.6, 11.9, 11.10, 13.9**

- [ ] 19. Wire into `persistView`
  - [~] 19.1 Update `src/scheduled-run/main.ts`
    - After the v4 edge slices, call `buildConfluenceSlice` with the cached evaluations, `displayOnly`, and `buildSupabaseStores(supabase).candleStore`; pass the result as the new trailing argument to `buildDashboardSnapshot`. The step writes nothing to the DB and returns nothing that firing reads.
    - _Requirements: 10.1, 10.2, 10.5, 10.6, 10.7, 11.1_

  - [~] 19.2 Extend `src/scheduled-run/main.test.ts`
    - The firing view, persisted rows, and `cards` passed to the persister are identical whether the confluence step succeeds or throws; the snapshot still publishes with an empty slice when it throws.
    - _Requirements: 10.5, 10.6, 13.7_

- [~] 20. Checkpoint - Stage F green (producer ready to deploy first)
  - Ensure all tests pass, ask the user if questions arise.

### Stage G: Web parser, shapers, and ConfluencePanel (consumer, frontend deploy)

Web tests use the web workspace's fast-check 3.23.1; generators use only the stable API (`fc.property`, `fc.assert`, `fc.record`, `fc.array`, `fc.float`). Run `cd web && npm run build && npm test` at the end of the stage.

- [ ] 21. Web wire types and strict v5 parsing
  - [~] 21.1 Add Confluence wire types to `web/src/api/types.ts`
    - Independent structural copy of the backend slice types (`Confluence`, `ConfluencePair`, `ConfluenceCell`, ids, status). Do not import from `src/`.
    - _Requirements: 11.1, 11.2, 11.5, 11.6_

  - [~] 21.2 Update `web/src/api/snapshot.ts`
    - `SNAPSHOT_SCHEMA_VERSION = 5`, `confluence: Confluence` on `DashboardSnapshot`, `EMPTY_CONFLUENCE`, and `EMPTY_SNAPSHOT`. In `parseSnapshot`, `declared = typeof schemaVersion === "number" ? schemaVersion : 0`; `declared < 5` gives `EMPTY_CONFLUENCE` (never an error); `declared >= 5` runs `parseConfluenceStrict`, throwing `SnapshotError("The dashboard snapshot has an invalid confluence slice.")` on a missing or defective slice with no partial snapshot returned.
    - _Requirements: 11.11, 11.12_

  - [~] 21.3 Update existing web snapshot tests
    - Adjust only the assertions that depend on the default or current schema version; schemaVersion 1 to 4 fixtures must still yield the empty confluence default.
    - _Requirements: 11.11_

  - [~] 21.4 Write the parseSnapshot v4 / v5 test
    - `web/src/api/snapshot.confluence.test.ts`: a v4 document and a valid v5 document both parse without error; a document with no `schemaVersion` parses with the empty default; a v5 document with missing or defective `confluence` throws `SnapshotError`. Required by Requirement 13.9.
    - _Requirements: 11.11, 11.12, 13.9_

  - [~] 21.5 Write property test for snapshot parsing
    - **Property 27: Snapshot parsing is backward compatible and strict for v5**
    - In `web/src/api/snapshot.confluence.property.test.ts` using `arbConfluenceSlice` and `arbBrokenSlice` (single defect per case).
    - **Validates: Requirements 11.11, 11.12**

- [ ] 22. Pure shapers
  - [~] 22.1 Implement `web/src/pure/shapeConfluence.ts`
    - `shapeConfluence(slice)` returning `ConfluenceViewModel` per the design: empty state text, "Un-validated" label, "Strength is not a probability" note, columns in `STRATEGY_IDS` order with `third_party` "display-only" header while its weight is 0, rows in `PAIRS` order, marker mapping (green / red / neutral / conflict "Stay Flat"), direction words plus glyphs, conflict highlighting from `opposingStrategyIds` with "Conflicting" label, and accessible names. No DOM, clock, fetch, or `src/` imports.
    - Folded-in presentation fields (all pure, derived only from the slice): a per-`CONFLICT_FLAT`-row `conflictSummary` sentence naming an opposing UP and DOWN id (null otherwise); a per-row `gauge: GaugeVM` over [-1,1] with `value = score` and `±alignmentThreshold` ticks while keeping `scoreText`; a `summary: SummaryVM` with aligned/conflict/neutral counts summing to `rows.length`; a per-cell `emphasis` of `"signal"` only when available, non-FLAT, and `weights[strategyId] > 0`, else `"muted"` (never removing a label); and `validated = (slice.validationLabel !== "unvalidated")`. Always compute `marker`/`markerText` regardless of `validated`.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.9, 12.11, 12.12, 12.13, 12.14, 12.15, 12.16, 12.17, 12.18, 14.1, 14.2, 14.3, 14.4_

  - [~] 22.2 Implement `web/src/pure/confluenceNav.ts`
    - `nextCell(pos, key, rowCount, colCount)` mapping Arrow/Home/End to clamped positions and Escape to `"dismiss"`, otherwise `null`.
    - _Requirements: 12.10_

  - [~] 22.3 Write view-model unit tests
    - `web/src/pure/shapeConfluence.test.ts`: one case per Confluence_Status (`ALIGNED_UP`, `ALIGNED_DOWN`, `NEUTRAL`, `CONFLICT_FLAT`, `INSUFFICIENT_DATA`), an unavailable cell, and the empty state, each asserting the expected view-model output. Required by Requirement 13.10. The existing `purity.structural.test.ts` scans the new modules automatically.
    - Folded-in cases (Requirement 13.10a): a `CONFLICT_FLAT` row's `conflictSummary` names an opposing UP and DOWN id while a non-conflict row's is `null` (12.14, 12.15); `gauge` spans [-1,1] with both threshold ticks and `scoreText` is retained (12.16); `summary` counts partition the rows and sum to `rows.length` (12.17); `cell.emphasis` is `signal` only for an available non-FLAT positive-weight cell and labels are intact (12.18); and `validated` is false for an `unvalidated` slice with status text still present, true for any other label (14.1-14.4).
    - _Requirements: 12.1, 12.3, 12.6, 12.7, 12.9, 12.12, 12.14, 12.15, 12.16, 12.17, 12.18, 14.1, 14.2, 14.3, 14.4, 13.10, 13.10a_

  - [~] 22.4 Write property tests for the view-model
    - **Property 28: View-model is complete, labelled, and deterministic**
    - **Property 30: Supplementary presentation is faithful to the slice**
    - **Property 31: Colour is suppressed until validated**
    - In `web/src/pure/shapeConfluence.property.test.ts`.
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.9, 12.11, 12.12, 12.13, 12.14, 12.15, 12.16, 12.17, 12.18, 14.1, 14.2, 14.3, 14.4**

  - [~] 22.5 Write property test for grid navigation
    - **Property 29: Grid navigation stays inside the grid**
    - In `web/src/pure/confluenceNav.property.test.ts`.
    - **Validates: Requirements 12.10**

- [ ] 23. ConfluencePanel and SetupsTab integration
  - [~] 23.1 Implement `web/src/tabs/Setups/ConfluencePanel.tsx`
    - Props `{ viewModel }`. Render the `summary` line above a `<table role="grid">` with caption, `<th scope="col">` and `<th scope="row">`, one `<button type="button" aria-label={accessibleName}>` per cell with roving `tabIndex`, arrow keys via `nextCell` move focus without selecting, click/Enter/Space select, detail region (`role="region"`, `aria-live="polite"`) shows rationale as a React text child with a Dismiss button, Escape dismisses, visible `:focus-visible` outline. Validation label and "Strength is not a probability" in the header and the detail region. Empty view model renders only heading, label, and "no confluence data for this run".
    - Folded-in rendering: per-row `gauge` as a diverging bar over [-1,1] with both alignment-threshold ticks, shown beside the numeric `scoreText` (12.16); a `conflictSummary` sentence on each `CONFLICT_FLAT` row (12.14); each cell's `emphasis` as a style hook (e.g. `data-emphasis`) so `muted` cells are visually quiet without dropping labels (12.18); and the status colour treatment applied ONLY when `viewModel.validated` is true — while un-validated, one neutral treatment for every status, meaning carried by `markerText`/`statusLabel` and the "Stay Flat" marker (14.1-14.3).
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.14, 12.16, 12.17, 12.18, 14.1, 14.2, 14.3_

  - [~] 23.2 Render the panel from `SetupsTab`
    - Add an injected `loadConfluence` (default `getSnapshot` then `snapshot.confluence`), pass through `shapeConfluence`, render `<ConfluencePanel>` below `RunSummary` as a section (no sixth tab; `TAB_IDS` unchanged). A load failure renders the empty view model.
    - _Requirements: 12.1, 12.12, 12.13_

  - [~] 23.3 Write DOM tests for the panel
    - `web/src/tabs/Setups/ConfluencePanel.dom.test.tsx` (Testing Library): click, Enter, and Space each show the rationale synchronously and keep it until another cell or Dismiss/Escape; label and probability note in both regions; single tab stop with arrow-key focus movement; empty message; `SetupsTab` load failure renders the empty state.
    - Folded-in DOM checks: the Confluence_Summary line and a per-row Score_Gauge render alongside the numeric score (12.16, 12.17); a `CONFLICT_FLAT` row shows its conflict-summary sentence (12.14); muted-emphasis cells carry the style hook while keeping their labels (12.18); and with an `unvalidated` slice the status markers render in one neutral colour treatment yet stay distinguishable by text (14.1, 14.2).
    - _Requirements: 12.5, 12.8, 12.10, 12.12, 12.14, 12.16, 12.17, 12.18, 14.1, 14.2_

- [~] 24. Checkpoint - Stage G green
  - Ensure all tests pass (`cd web && npm run build && npm test`), ask the user if questions arise.

### Stage H: Build tooling and final verification

- [ ] 25. Extend `make check` to cover the web workspace
  - [~] 25.1 Update the `Makefile`
    - Add a `check-web` target (`cd web && npm run build && npm test`); make `check` run `npm run check` then `check-web`; add `check-web` to `.PHONY`. `make` stops at the first failing recipe, giving a non-zero exit that names the failing step.
    - _Requirements: 13.11, 13.12_

- [~] 26. Final checkpoint - Ensure all tests pass
  - Run `make check` and confirm exit code 0 with lint, typecheck, backend tests, web build, and web tests. Confirm the firing decision, Earned_Confidence, and every pre-existing snapshot slice are unchanged (tasks 15.5, 17.2, 19.2). Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property tests and can be skipped for a faster MVP. Required tests are those the requirements mandate explicitly: per-strategy unit tests (13.1), the third-party weight-0 neutrality test (13.6), the firing / Earned_Confidence unchanged test (13.7), the LLM-tagged rejection guardrail and import boundary (13.8), the snapshot round-trip property (13.9), the parseSnapshot v4/v5 test (13.9), and the view-model tests (13.10).
- Backend property tests use fast-check 4.10.0; web property tests use fast-check 3.23.1. Every property runs at least 100 iterations and is tagged `// Feature: multi-strategy-confluence-engine, Property N: <title>`.
- Floating-point oracle comparisons use relative tolerance `1e-9`; symmetry, permutation, determinism, and round trip use exact equality.
- Each property is implemented by a single property-based test; properties sharing a file are grouped by the headings above.
- No task touches live cloud resources, migrations, or credentials. No secret value appears in any code, log, or test fixture.
- Rollback: Stage F reverts by rolling back the backend job (it publishes a v4 snapshot again, which the SPA tolerates). Stage G reverts by rolling back the SPA (it ignores the extra `confluence` key).
- This workflow only produces planning artifacts. Begin execution by opening this file and choosing "Start task" on a task item.
