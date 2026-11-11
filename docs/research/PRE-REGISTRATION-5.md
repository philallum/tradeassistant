# Pre-registration 5: volatility and structure context (evidence for a context dashboard)

Status: written 2026-11-10, BEFORE any result for these tests was produced. Unchanged settings: exploration window 2013-06-01..2025-09-15, locked holdout unread, month-block bootstrap (2000 resamples, fixed seed), Benjamini-Hochberg at q = 0.10, 200 scored days minimum, rows kept only if the 5-session outcome window closes inside the exploration window.

## Question

Direction is not predictable in the forms tested (Reports 1 to 4). A context dashboard would instead show volatility and structure. Which context statements are measurably true, and large enough to matter?

## Timing (what is known when)

The daily job runs after day D's close and labels its decision X, the next session (`i` = candle X). At run time candles up to `i-1` are known; candle `i` is not. Every predictor uses candles strictly before `i` (as the live features do). Outcomes use the sessions `i+1 .. i+5`, the convention of all earlier reports; this is one session later than a trader acting on the card would trade, which makes the volatility tests slightly conservative.

## Tests (one Benjamini-Hochberg family of 6)

| Id | Question | Predictor (known at run time) | Outcome | Statistic | Expected | Practical threshold |
|---|---|---|---|---|---|---|
| V1 | Does compression predict next-week range beyond ATR? | compression = mean(high-low) of last 5 candles / last 40 | y = ln(mean(high-low) over i+1..i+5 / ATR14), ATR14 from the 60 candles before i | Spearman(compression, y) | negative | mean of exp(y) differs by >= 10% between the low and high compression terciles |
| V2 | Does the ATR level mean-revert? | ATR percentile (rank of ATR14 among the prior 250 values) | same y | Spearman(percentile, y) | negative | same, by ATR-percentile tercile |
| S1 | Do CONFLICT_FLAT days have less follow-through? | confluence status (four rule strategies + pattern call, offline engine, no third party) | ER5 = abs(close i+5 - open i+1) / (abs(close i+1 - open i+1) + sum of abs(close k - close k-1), k = i+2..i+5) | mean ER5 on CONFLICT_FLAT minus mean ER5 on all other days with a status | negative | absolute difference >= 0.02 |
| S2 | Does trendiness persist? | 14-day efficiency ratio (closes before i) | ER5 | Spearman(ER14, ER5) | positive | mean ER5 differs by >= 0.02 between the low and high ER14 terciles |
| E1 | Are FOMC / US jobs report sessions wider? | event on the date of candle i+1 (FOMC decision or US jobs report; from 2021-01-01 only, when the calendar is maintained) | (high-low of candle i+1) / ATR14 | ln(mean ratio on event sessions / mean ratio on ordinary sessions) | positive | ratio >= 1.15 |
| Q1 | Is a plain ATR-scaled stop better than the analogue stop? | (a) analogue stop = live `stopLossPips` (P75 of neighbourhood MAE; exists only with 30+ analogues); (b) ATR-scaled: P75 of the pair's historical ratio adverse(k) / ATR14(before k-1), over sessions k <= i-1 (at least 250), times ATR14 | realised adverse excursion of session i+1 against the pattern's call (UP: open - low; DOWN: high - open) | paired mean difference in quantile (pinball) loss at 0.75, both in ATR units: loss(a) - loss(b) | positive (b better) | report both coverages (target 75%) |

V1, V2, S2 and E1 use all exploration pair-days with the inputs available. S1 uses all days with a confluence status other than INSUFFICIENT_DATA. Q1 uses directional days where the analogue stop exists.

Also reported, outside the family: tercile tables with the practical multiples (for the dashboard wording), event results split into FOMC and jobs-report days, and for Q1 a third predictor (c) the pair's unconditional historical P75 adverse excursion in pips, with coverage for all three.

## What counts as usable for the dashboard

A statement is **usable** only if ALL hold: BH-significant in the expected direction; the practical threshold is met; and the effect has the same sign in at least 60% of calendar years and 60% of pairs (each with at least 100 rows). Usable means "can be shown as a measured fact with its number"; it does not imply any trading edge.

## Erratum to Report 3 (found while writing this document, fixed before this stage)

`PRE-REGISTRATION-3.md` let an analogue at candle j vote when `j + span <= i`, on the stated belief that candle i had closed at run time. It has not: the live guard (`isMatured`) requires the analogue's outcome window to close strictly before the decision date, i.e. `j + span <= i - 1`. The rule is corrected to `j + span < i` and Report 3 is re-run; both results are recorded in RESEARCH-LOG. Reports 1, 2 and 4 used the live guard or candles before i only and are unaffected. A look-ahead can only flatter a result, and Report 3 found nothing, so its conclusion cannot reverse.
