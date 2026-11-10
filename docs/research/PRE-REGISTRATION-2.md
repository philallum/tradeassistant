# Pre-registration 2: setup families, trader's-eye features and encoding variants

Status: written 2026-11-10, BEFORE any feature, setup-family or variant result was produced. Extends `PRE-REGISTRATION.md`; the windows, holdout, bootstrap, Benjamini-Hochberg level (q = 0.10) and minimum sample (200 scored days) are unchanged. The locked holdout 2025-09-16 to 2026-09-15 is not read by anything in this document.

Operator choices (2026-11-10): build BOTH the setup-family study and redesigned analogue encodings; price-only features (no tick volume); XTB standard-account spreads.

## Cost model: `xtb-standard-v1`

Spread from BrokerChooser's published XTB averages (standard accounts), commission 0 (XTB standard accounts charge spread only; not independently verified), slippage kept from `exec-v1` as a conservative extra. Pips per trade:

| Pair | Spread | Commission | Slippage | Total |
|---|---|---|---|---|
| EURUSD | 0.8 | 0 | 0.2 | 1.0 |
| GBPUSD | 0.9 | 0 | 0.3 | 1.2 |
| USDJPY | 1.1 | 0 | 0.2 | 1.3 |
| USDCHF | 1.8 | 0 | 0.3 | 2.1 |
| USDCAD | 1.6 | 0 | 0.3 | 1.9 |

The USDCHF figure comes from a search snippet; the page itself could not be opened. Spreads widen in fast markets and off-peak hours, so real costs are higher at those times. `exec-v1` stays the default elsewhere in the repo. Evidence Report 1 is re-run with this model (only the net-pips columns change).

## Price-only chart features

All are computed from candles strictly BEFORE the decision date (the same information the live signal uses). ATR is `computeAtr14` over the last 60 candles. Features that need more history than available are null and the row is not used for that feature.

| Feature | Definition |
|---|---|
| rangePos20 / 60 / 120 | (close - lowest low) / (highest high - lowest low) over the last N candles; 0.5 if the range is zero |
| distSma20Atr / distSma50Atr | (close - SMA of closes) / ATR |
| trend20Atr | (close - close 20 candles ago) / ATR |
| swing | Pivots of strength 2 (a high above the two candles either side), confirmed only once two later candles exist, over the last 60 candles. sH = +1 if the newest pivot high is above the previous one, -1 if below, else 0; sL likewise for lows. swing = (sH + sL) / 2; null with fewer than two pivots of either kind |
| body | (close - open) / (high - low) of the last completed candle; 0 if zero range |
| upperWick / lowerWick | (high - max(open, close)) / range, and (min(open, close) - low) / range |
| closePos | (close - low) / range of the last completed candle |
| compression | mean (high - low) of the last 5 candles / mean (high - low) of the last 40 |
| channelExcursion | If close is above the highest high of the 20 candles before it: (close - that high) / ATR; below the lowest low: (close - that low) / ATR (negative); otherwise 0 |

## Part A: setup-family study

A **setup** is a day on which one rule strategy (trend, breakout, range, reversal) gives UP or DOWN. Its direction is the strategy's direction. **Hit** = the strategy's direction equals the sign of the session after the decision date. **Net** = signed pips in that direction minus the pair's cost. A fifth family, **pattern**, uses the pattern's own call on directional days.

Features are **oriented** to the setup direction d (+1 UP, -1 DOWN) so that positive always means "in the setup's favour": rangePosDir (rangePos60 for UP, 1 - rangePos60 for DOWN), distDir = d * distSma20Atr, swingDir = d * swing, bodyDir = d * body, closePosDir (closePos for UP, 1 - closePos for DOWN), wickRejection (lowerWick for UP, upperWick for DOWN), trendDir = d * trend20Atr, excursionDir = d * channelExcursion. compression is not directional.

**Four pre-registered features per family** (20 tests in total), each tested as Spearman(feature, hit) on that family's setups, two-sided, block bootstrap, Benjamini-Hochberg across all 20:

| Family | Features |
|---|---|
| trend | trendDir, swingDir, rangePosDir, distDir |
| breakout | compression, excursionDir, bodyDir, closePosDir |
| range | rangePosDir, distDir, wickRejection, compression |
| reversal | distDir, wickRejection, swingDir, bodyDir |
| pattern | swingDir, rangePosDir, distDir, bodyDir |

Also reported per family (descriptive, not in the family): unconditional hit rate against 50%, net per trade, tercile cells for each feature, and the existing agree / oppose split against the pattern call.

## Part B: encoding variants

The analogue pipeline is run offline with alternative embeddings, same candles, same outcome labels, same confidence formula (`earnedConfidence`), same hit definition. Retrieval for variants is the k = 30 nearest analogues with no distance cutoff (the live k = 200 / epsilon = 0.2 gives a variable, often tiny neighbourhood, so a fixed-k control is needed to attribute any change to the encoding).

Feature vector f (13 numbers, fixed scaling, nothing fitted): 2*rangePos20-1, 2*rangePos60-1, 2*rangePos120-1, clip(distSma20Atr, +-4)/4, clip(distSma50Atr, +-6)/6, clip(trend20Atr, +-8)/8, swing, body, 2*upperWick-1, 2*lowerWick-1, 2*closePos-1, clip(ln compression, +-1), clip(channelExcursion, +-3)/3.

| Id | Embedding | Retrieval | Role |
|---|---|---|---|
| V0 | live 70-number shape | k=200, eps=0.2, weekly-trend prefilter | Live reference (already measured) |
| V0b | live shape | k=30, no cutoff, weekly-trend prefilter | Control |
| V1 | [shape/norm, f/norm] | k=30, prefilter | Shape + trader's-eye features |
| V2 | f/norm only | k=30, prefilter | Features only |
| V3 | [shape/norm, f/norm] | k=30, no prefilter | V1 without the weekly-trend prefilter |
| V4 | live shape | k=30, no prefilter | Control for dropping the prefilter |

**Four pre-registered comparisons** (paired, matched days where both variants call and the outcome is scoreable; statistic = difference in hit rate; block bootstrap; Benjamini-Hochberg across the four): V1 - V0b, V2 - V0b, V3 - V1, V4 - V0b. Primary subset: directional days. Firing days (confidence >= 0.55) reported alongside. Each variant is also scored against the weekly-trend baseline, with net after cost.

Why the prefilter matters: the live retrieval only compares with past days that have the same weekly-trend sign, which is a likely reason the pattern call equals the weekly-trend sign on about half of days. V3 and V4 test dropping it.

## What counts as promising

A variant is **promising** only if its paired improvement over its control is BH-significant, its hit rate beats the weekly-trend baseline, and its mean net per trade has a lower 95% bound above zero. Promising is not a finding. The best variant, if any, is frozen and taken to the locked holdout once, in Task 10, after a further check-in. If none is promising, that is recorded as a finding.

## Limits stated in advance

- Breakout, reversal and range setups are few (roughly 2,100, 1,100 and 600 scored days over twelve years), so only large effects (about 7pp or more) can be detected there.
- The live pipeline skips the candle labelled with the decision date (RISKS finding 3). Features follow the live signal's information set, so the same one-session gap applies.
- Five USD pairs are correlated. The week-block bootstrap helps but intervals remain optimistic.
- The analogue stores are built from all history, but retrieval for a date only sees strictly earlier dates, so nothing from the holdout period reaches an exploration result.
