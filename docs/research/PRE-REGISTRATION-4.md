# Pre-registration 4: the four rule strategies on multi-day and bracket outcomes

Status: written 2026-11-10, BEFORE any result for these tests was produced. Reuses the outcomes of `PRE-REGISTRATION-3.md` (H1 reference, H3, H5, BR) and all unchanged settings: exploration window, locked holdout unread, `xtb-standard-v1` costs, swap not modelled, month-block bootstrap (2000 resamples), Benjamini-Hochberg at q = 0.10, minimum 200 scored days, rows kept only if the 5-session window closes inside the exploration window.

## Question

Trend and breakout systems are normally held for days. Report 2 scored the four rule strategies only on the next session. Do they show timing skill, and make money after costs, when held 3 or 5 sessions or traded with a 1 x ATR target and stop?

## Trades

A trade is any exploration day on which the strategy (live default configuration, candles before the decision date) gives UP or DOWN. Entry is the open of the session after the decision date, as before. A strategy that signals on consecutive days produces overlapping trades; each is scored (this is the per-signal edge, not a portfolio return), and month blocks absorb the overlap.

## Tests

**Primary statistic: excess hit rate over the direction-mix expectation.** On a strategy's scored days, let u = share of UP calls and r = share of UP outcomes. A call with no timing skill would hit `E = u x r + (1 - u) x (1 - r)`. Excess = hit rate - E, recomputed inside every bootstrap resample. This removes the credit a strategy gets just by leaning long or short through a trending period.

**Family S (12 tests):** excess for 4 strategies (trend, breakout, range, reversal) x 3 outcomes (H3, H5, BR). Two-sided, BH across the 12.

Reported, outside the family: H1 (reference, should match Report 2), hit rate against 50%, uplift over the weekly-trend baseline on the same days, net per trade with interval, UP share of calls and of outcomes, years and pairs with positive excess.

## What counts as promising

A (strategy, outcome) cell is promising only if ALL hold: family-S excess is BH-significant and positive; mean net per trade has a lower 95% bound above zero; excess is positive in at least 60% of calendar years and 60% of pairs (each with at least 100 scored days). Promising is a candidate for the locked holdout, not a finding.

## Limits stated in advance

- Range (about 580 signal days) and reversal (about 1,140) can only show large effects.
- The live configurations are tested as they are; no parameter is tuned. Tuning would need its own pre-registration and would use up exploration credibility.
- Exits are fixed (3 or 5 sessions, or the bracket), not each strategy's own exit logic, which the strategies do not define.
