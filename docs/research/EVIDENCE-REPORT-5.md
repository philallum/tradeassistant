# Evidence Report 5: volatility and structure context

Generated 2026-11-10. Exploration window 2013-06-01..2025-09-15; every outcome window closes inside it. The locked holdout 2025-09-16..2026-09-15 was NOT read. No verdict is recorded. Nothing here changes the live system. Design: docs/research/PRE-REGISTRATION-5.md (written before any result).

## How to read this

- Predictors use candles strictly before the decision-date candle (the last candle known when the job runs). Outcomes use the five sessions after the decision date.
- **V1/V2 outcome:** ln(mean daily high-low over the next 5 sessions / ATR14); terciles show exp of the mean, i.e. the typical next-week range as a multiple of ATR14. **S outcome:** 5-session efficiency ratio (net move / path; 1 = straight line, near 0 = chop). **E1:** next-session range / ATR14 on FOMC / US jobs report sessions vs others (2021 onward). **Q1:** quantile (pinball, 0.75) loss of two stop rules in ATR units; positive = the ATR-scaled rule is better.
- One Benjamini-Hochberg family of 6 tests (q = 0.1); month-block bootstrap (2000 resamples). **Usable** = significant in the expected direction, meets the pre-registered practical threshold, and same sign in at least 60% of years and pairs.

## Summary

Usable for the dashboard: V2 (range multiple, low tercile / high tercile 1.165); E1 (range multiple, event / ordinary 1.311); Q1 (relative loss reduction vs analogue stop 0.206).

## Tests

| Id | Test | Expected | n | Estimate [95% CI] | p | BH q | Practical size | Years same sign | Pairs same sign | Flag |
|---|---|---|---|---|---|---|---|---|---|---|
| V1 | compression vs next 5 sessions' range / ATR14 | - | 15990 | -0.080 [-0.117, -0.041] | <0.001 | 0.001 | range multiple, low tercile / high tercile: 1.048 (below threshold) | 11/13 | 5/5 | significant; fails practical or stability bar |
| V2 | ATR percentile vs next 5 sessions' range / ATR14 | - | 15990 | -0.272 [-0.317, -0.226] | <0.001 | 0.001 | range multiple, low tercile / high tercile: 1.165 (meets threshold) | 13/13 | 5/5 | **USABLE** |
| S1 | CONFLICT_FLAT minus other days, mean 5-session efficiency ratio | - | 15990 | -0.010 [-0.025, 0.006] | 0.200 | 0.240 | absolute ER5 difference: -0.010 (below threshold) | 10/13 | 4/5 | - |
| S2 | 14-day efficiency ratio vs next 5 sessions' efficiency ratio | + | 15990 | 0.002 [-0.024, 0.028] | 0.929 | 0.929 | ER5, high tercile minus low tercile: -0.001 (below threshold) | 6/13 | 3/5 | - |
| E1 | FOMC / US jobs report sessions vs ordinary sessions, range / ATR14 (from 2021) | + | 465 | 0.271 [0.194, 0.344] | <0.001 | 0.001 | range multiple, event / ordinary: 1.311 (meets threshold) | 5/5 | 5/5 | **USABLE** |
| Q1 | stop quality: analogue P75 MAE loss minus ATR-scaled P75 loss (pinball 0.75, ATR units) | + | 2504 | 0.042 [0.034, 0.050] | <0.001 | 0.001 | relative loss reduction vs analogue stop: 0.206 (meets threshold) | 11/12 | 5/5 | **USABLE** |

## Terciles (for dashboard wording)

**V1** (compression vs next 5 sessions' range / ATR14):

| Predictor tercile | Rows | Mean outcome |
|---|---|---|
| low (0.355 to 0.886) | 5330 | 1.003 |
| mid (0.886 to 1.054) | 5330 | 0.976 |
| high (1.054 to 2.881) | 5330 | 0.957 |

**V2** (ATR percentile vs next 5 sessions' range / ATR14):

| Predictor tercile | Rows | Mean outcome |
|---|---|---|
| low (0.000 to 0.236) | 5330 | 1.060 |
| mid (0.236 to 0.652) | 5330 | 0.971 |
| high (0.652 to 1.000) | 5330 | 0.910 |

**S2** (14-day efficiency ratio vs next 5 sessions' efficiency ratio):

| Predictor tercile | Rows | Mean outcome |
|---|---|---|
| low (0.000 to 0.153) | 5330 | 0.457 |
| mid (0.153 to 0.332) | 5330 | 0.454 |
| high (0.332 to 0.981) | 5330 | 0.456 |

## Event split (next-session range / ATR14, 2021 onward)

| Session | Rows | Mean range / ATR14 |
|---|---|---|
| FOMC | 185 | 1.302 |
| US_NFP | 280 | 1.301 |
| ordinary | 5644 | 0.993 |

## Confluence status vs follow-through (mean 5-session efficiency ratio)

| Status | Rows | Mean ER5 |
|---|---|---|
| ALIGNED_DOWN | 50 | 0.435 |
| ALIGNED_UP | 82 | 0.417 |
| CONFLICT_FLAT | 3338 | 0.448 |
| NEUTRAL | 12520 | 0.458 |

## Stop rules on directional days with an analogue stop (ATR units; target coverage 75%)

| Predictor | Rows | Coverage (share of sessions whose adverse move stayed inside) | Mean pinball loss | Mean stop distance (x ATR14) |
|---|---|---|---|---|
| (a) analogue P75 MAE (live stopLossPips) | 2504 | 49.1% | 0.204 | 0.415 |
| (b) ATR-scaled historical P75 | 2504 | 74.3% | 0.162 | 0.707 |
| (c) unconditional historical P75 (pips) | 2504 | 74.7% | 0.176 | 0.767 |

## Caveats

- Outcomes start one session after the one a trader acting on the card would trade; volatility forecasts one session closer would be slightly stronger, not weaker.
- The confluence status here is the offline engine (four rule strategies plus the pattern call, no third party).
- The event calendar covers FOMC decisions and US jobs reports from 2021; other events are not included.
- Usable means "a measured fact that can be shown with its number"; none of these is a directional edge.
