# Pre-registration 3: multi-day horizons and target-before-stop outcomes

Status: written 2026-11-10, BEFORE any result for these outcomes was produced. Extends `PRE-REGISTRATION.md` and `PRE-REGISTRATION-2.md`. Unchanged: exploration window, locked holdout (2025-09-16 to 2026-09-15, not read), Benjamini-Hochberg at q = 0.10, minimum 200 scored days, `xtb-standard-v1` costs, block bootstrap (2000 resamples, fixed seed).

## Question

The pattern shows no edge on the next session's close-to-close move. Does it have one on a longer or path-based outcome, where daily noise matters less and costs are paid once over a larger move?

## Outcomes

Indexes refer to the pair's daily candles. `i` is the candle labelled with the decision date. The live convention is kept: features and the analogue query use candles before `i`, and the trade enters at the OPEN of candle `i+1`.

| Id | Outcome | Hit | Net per trade |
|---|---|---|---|
| H1 | Close of `i+1` vs entry (reference only, same as Reports 1 and 2) | call = sign of the move | signed pips - cost |
| H3 | Close of `i+3` vs entry (hold 3 sessions) | call = sign of the move | signed pips - cost (one round trip) |
| H5 | Close of `i+5` vs entry (hold 5 sessions) | call = sign of the move | signed pips - cost |
| BR | Symmetric bracket: target and stop both 1 x ATR14 from entry, at most 5 sessions | call = side touched first | +ATR or -ATR in pips, minus cost; if neither is touched, the signed close of `i+5` minus cost; if one daily candle touches both ("ambiguous"), counted as a LOSS (-ATR - cost) |

A move of exactly zero, and ambiguous or expired brackets, are excluded from the hit rate but kept in net. For the bracket, a 50% hit rate is break-even before cost.

ATR14 for a date is `computeAtr14` over the 60 candles before it (as in Reports 1 and 2).

**Overnight financing (swap) is NOT modelled.** Holding 3 to 5 sessions incurs it; it can be a cost or a credit depending on direction and rates. This is a stated limitation.

## How the pattern makes its call for each outcome

The neighbourhood (which past days are similar) comes from retrieval exactly as before. What changes is what the pattern learns from those analogues: **for each outcome, the call is the majority of the analogues' own result for that SAME outcome**, measured from candles:

- H3 / H5: sign of each analogue's own 3- or 5-session move.
- BR: which side each analogue's own bracket (with its own ATR) touched first. Ambiguous and expired analogues do not vote.
- H1: sign of each analogue's next-session move (sign-based, not the live FLAT band; so this H1 call can differ slightly from the live call).

**No look-ahead:** an analogue at candle `j` only votes if its whole outcome window has closed by the decision date: `j + H <= i` for H3/H5, `j + 5 <= i` for BR, `j + 1 <= i` for H1. (Candle `i` has closed when the live job runs.) A tie or no voting analogue means no call.

**Confidence** is the same shrinkage as `earnedConfidence`: `n/(n+10) x share + 10/(n+10) x 0.5`, where n = voting analogues and share = the majority's share. Firing = a call with confidence >= 0.55.

## Sources (which neighbourhoods)

| Id | Retrieval | Why |
|---|---|---|
| V0 | live (k=200, epsilon 0.2, weekly-trend prefilter, live shape) | the live system |
| V0b | live shape, fixed k=30, no cutoff, prefilter | live neighbourhoods are often tiny (mean about 16) |
| V1 | live shape + chart features, k=30, prefilter | the best (not significant) encoding in Report 2 |

## Baseline

Weekly-trend sign (the live baseline), used as the call for every outcome, scored on the same days. Also reported: the share of UP outcomes (drift check) and how often the pattern call equals the weekly-trend sign.

## Rows

Directional days of the exploration window, restricted so that the whole outcome window ends inside the exploration window: the date of candle `i+5` must be on or before 2025-09-15. No realised outcome therefore reads a holdout price. (Reports 1 and 2 scored the session after 2025-09-15 for the last exploration date, which is the first holdout session; that single day is a minor overlap, noted here and in RISKS.)

## Pre-registered tests

**Family U (9 tests):** for each source (V0, V0b, V1) and outcome (H3, H5, BR), on directional days: uplift = model hit rate minus weekly-trend hit rate on the same scored days. Two-sided block-bootstrap p-value, BH across the 9.

**Family C (9 tests):** same 9 cells: Spearman(confidence, hit). Two-sided, BH across the 9.

H1 and the firing subset are reported for reference and are outside both families.

**Bootstrap blocks are calendar MONTHS** (not weeks as before), because 5-session outcome windows of neighbouring days overlap and cross week boundaries.

## What counts as promising

A (source, outcome) cell is promising only if ALL hold: Family U uplift is BH-significant and positive; mean net per trade has a lower 95% bound above zero; uplift is positive in at least 60% of calendar years and 60% of pairs (each with at least 100 scored days). Promising is not a finding: the single best promising cell, if any, would be frozen and taken to the locked holdout once, after a check-in.

## Limits stated in advance

- Daily candles cannot say which side of a bracket was touched first when one candle touches both; treating that as a loss is conservative.
- Multi-day outcomes of neighbouring days overlap heavily; month blocks help but intervals stay optimistic.
- The analogue pool for H5 and BR is slightly smaller than for H1, because the most recent 5 analogue days cannot vote.
- Trends in USD over 2013 to 2025 make multi-day hit rates depend on drift; the weekly-trend baseline and the UP-share line are there to expose that.
