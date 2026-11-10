# Pre-registration: finding and validating a conditional edge

Status: written 2026-11-10 for the programme "find and validate a conditional edge". This document restates what is fixed in `src/ops/research/researchProtocol.ts`; if the two ever differ, the code and its tests win. Nothing here changes the live system. Everything is offline measurement.

## Honesty note on timing

The hypotheses, windows, test statistics, correction method and minimum sample were written into `researchProtocol.ts` and `studies.ts` BEFORE the first report was produced. This prose document was written afterwards from that code. Two things were added after the first report run and are therefore exploratory by construction: the `patternVsWeeklyTrend` split (added because several cells showed model and baseline identical), and the report's labelling of strategy rows. Neither changes a pre-registered test.

## Question

Under what conditions, if any, does the existing pattern signal have a meaningful, repeatable, after-cost edge over the weekly-trend baseline?

## Outcomes (both reported in every slice)

1. **Direction hit at horizon 1:** the pattern call equals the sign of the session after the decision date (open to close), the live convention. Days whose realised sign is FLAT are excluded. Compared with the weekly-trend baseline on the same days (uplift = model hit minus baseline hit).
2. **After-cost return:** signed pips in the called direction, entry at the session open, exit at the session close, minus the `exec-v1` execution-model cost for the pair.

Sensitivity only (never a pre-registered test): the session labelled with the decision date.

## Costs

The fixed per-pair cost of the existing `DEFAULT_EXECUTION_MODEL` (`exec-v1`, spread plus commission plus slippage), in pips per trade: EURUSD 1.0, GBPUSD 1.4, USDJPY 1.1, USDCHF 1.5, USDCAD 1.5. No broker-specific spread was supplied; net results are sensitive to this assumption.

## Windows

| Window | Dates | Use |
|---|---|---|
| Existing discovery (already seen) | 2013-06-01 to 2024-12-31 | Counts as seen |
| Released into exploration | 2025-01-02 to 2025-09-15 | Never consulted before this programme; counts as seen once looked at |
| **Locked holdout** | **2025-09-16 to 2026-09-15** | **Last 12 months of the vendor-consistent CSV history. Not read by any analysis. Consulted once per frozen configuration, at the end.** |

The locked holdout is a strict subset of the existing untouched confirmation holdout (2025-01-02 to 2026-09-15, `evidenceProtocol.ts`, left unchanged). Releasing 2025-01-02 to 2025-09-15 into exploration is a deliberate narrowing of that earlier holdout to match the 12-month choice. The holdout guard (`assertExplorationWindow`, `assertNoHoldoutRows`) throws if an analysis reaches it.

Analogues for any date use all earlier history; only the dates being evaluated are restricted.

## Subsets

- **Directional days:** the pattern has an UP or DOWN call. Primary for the evidence-quality studies (more days).
- **Firing days:** the call also clears the 0.55 confidence line. Reported alongside.

## Hypotheses

| Id | Family | Statement | Test |
|---|---|---|---|
| H1 | evidence quality | Hit rate rises with analogue count n | Spearman(n, hit) > 0 |
| H2 | evidence quality | Hit rate falls as the nearest analogue gets farther | Spearman(nearest distance, hit) < 0 |
| H3 | evidence quality | Hit rate falls as the mean analogue distance grows | Spearman(mean distance, hit) < 0 |
| H4 | calibration | Hit rate rises with Earned_Confidence | Spearman(confidence, hit) > 0 |
| H5 | evidence quality | Hit rate rises with raw analogue agreement | Spearman(raw agreement, hit) > 0 |
| H6 | evidence quality | Hit rate rises with agreement among the closest 10 analogues (n >= 10) | Spearman > 0 |
| H7 | confluence | Hit rate rises with the number of the four rule strategies agreeing with the pattern call | Spearman(agree count, hit) > 0 |
| H8 | confluence | Hit rate falls with the number of rule strategies opposing it | Spearman(oppose count, hit) < 0 |
| H9 | regime | Hit rate differs with trend vs range (14-day efficiency ratio) | Spearman != 0 |
| H10 | regime | Hit rate differs with volatility (ATR percentile) | Spearman != 0 |
| H11 | intraday 4H | After a 4H SUPPORTS state the move remaining after the read agrees with the daily call more than after CONTRADICTS | Difference in remaining-move hit > 0; 2021 to 2024 only |

Correlation tests are two-sided against zero; the expected sign is recorded and a result only counts as "as expected" if it is significant with that sign.

**Pre-registered band cells:** the bands of each variable above (analogue count: <10, 10-19, 20-29, 30-49, 50-99, 100+; Earned_Confidence: 0.50-0.55, 0.55-0.60, 0.60-0.65, 0.65-0.70, 0.70+; others by fixed edges or quantiles as in `studies.ts`), plus the existing pre-registered slice dimensions pair and weekday, plus each rule strategy relative to the pattern call (agree, oppose, flat, unavailable) and the confluence status.

**Standalone and agree-vs-oppose tests:** accuracy of each rule strategy and of the pattern against a coin flip; for each rule strategy, hit rate when agreeing minus hit rate when opposing the pattern call.

## Exploratory (outside every correction family, always labelled)

USD exposure, FOMC/US-jobs-report on the target session, follows or fades yesterday, whether a stop/target could be derived, stop distance in ATR, and the pattern-versus-weekly-trend split. These orient further hypotheses and cannot confirm anything.

## Statistics

- **Intervals and p-values:** block bootstrap over calendar-week blocks, 2000 resamples, fixed seed. Blocks keep the five correlated pairs of a week and overlapping daily windows together. Spearman intervals reuse full-sample ranks across resamples.
- **Multiple testing:** Benjamini-Hochberg at q = 0.10, separately for (a) the ten correlation hypotheses, (b) the reportable pre-registered band cells, (c) the standalone accuracy tests, (d) the agree-vs-oppose tests. H11 is a single test.
- **Minimum sample:** a cell with fewer than 200 scored days (or fewer than 100 per side for a two-group difference) is exploratory and is never called significant.
- **Stability:** for each cell, the number of calendar years and of pairs (with at least 100 scored days) in which the uplift is positive.

## What counts as a candidate edge

A cell is a **candidate** only if ALL hold: reportable (>= 200 scored), BH-significant, positive uplift, positive mean net pips with a lower 95% bound above zero, and positive in at least 60% of years and 60% of pairs. A candidate is not a finding. It must still hold on the locked holdout.

## 4H study design (H11)

The live validation reads the forming 4H bar around 07:00 UTC on the morning of the target session. The study rebuilds that read from archived hourly bars (04:00 to 06:59 UTC) using the live classifier. Those hours lie inside the target session, so scoring against the full-session sign partly counts the same move twice. The pre-registered outcome is therefore the **remaining move**, from the 07:00 UTC price to the session close. The full-session figure is reported only to show the size of the mechanical inflation.

## Stopping rule

None. The programme continues whatever the outcome (operator decision). Negative results are recorded as findings. The next stage (pattern-variant work) is gated on a review of the first evidence report.
