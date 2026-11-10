# Evidence Report 3: multi-day horizons and target-before-stop

Generated 2026-11-10. Exploration window 2013-06-01..2025-09-15; every outcome window closes inside it. The locked holdout 2025-09-16..2026-09-15 was NOT read. No verdict is recorded; an unfavourable result is a valid outcome. Nothing here changes the live system. Design: docs/research/PRE-REGISTRATION-3.md (written before any result).

## How to read this

- **Outcomes:** H1 = next session (reference), H3 / H5 = hold 3 / 5 sessions (open of the session after the decision date to the close of the 3rd / 5th session), BR = symmetric bracket 1 x ATR14 either side of entry, at most 5 sessions; hit = side touched first. One daily candle touching both sides is ambiguous and counted as a loss in net; expired brackets close at the 5th session.
- **The call for each outcome** is the majority of the analogues' own result for that same outcome, counting only analogues whose outcome window had closed by the decision date. Confidence uses the live shrinkage (prior weight 10).
- **Sources:** V0 live retrieval (k=200, epsilon 0.2); V0b live shape with fixed k=30; V1 live shape plus chart features with k=30. All keep the weekly-trend prefilter.
- **Baseline:** the weekly-trend sign as the call for every outcome, same days. **Weekly-trend net:** the baseline's net per trade on the same days.
- **Costs:** xtb-standard-v1, pips per trade: EURUSD 1.0, GBPUSD 1.2, USDJPY 1.3, USDCHF 2.1, USDCAD 1.9. Paid once per trade. Overnight financing (swap) is NOT modelled.
- **Statistics:** block bootstrap over calendar MONTHS (2000 resamples). BH q within family U (uplift, 9 tests) and family C (confidence, 9 tests), level 0.1; H1 rows are reference ("ref") and outside both.
- Median ATR14 in pips over scored days (bracket width): EURUSD 80.9, GBPUSD 103.8, USDJPY 83.0, USDCHF 66.3, USDCAD 79.7. Bracket outcomes on directional V0 days: UP_FIRST 4047, EXPIRED 1302, DOWN_FIRST 3920, AMBIGUOUS 71.

## Summary

- Family U (uplift over weekly trend, H3 / H5 / BR x 3 sources): significant none.
- Family C (confidence ranks outcomes): significant none.
- Promising (significant positive uplift, net lower bound above zero, positive in at least 60% of years and pairs): none.

## Directional days

| Source | Outcome | Scored | Mean n | Model hit | Weekly-trend hit | Uplift [95% CI] | BH q | Net pips/trade [95% CI] | Weekly-trend net | UP share | Call = weekly trend | Hit when differs | Years + | Pairs + | Confidence rho [95% CI] | BH q | Flags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V0 | H1 | 9285 | 26.4 | 50.23% | 49.33% | +0.90pp [-0.58pp, +2.37pp] | ref | -1.28 [-2.66, +0.12] | -2.64 | 50.31% | 49.40% | 50.89% (n=4698) | 7/13 | 4/5 | 0.006 [-0.014, 0.026] | ref | - |
| V0b | H1 | 13617 | 30.0 | 49.75% | 48.99% | +0.76pp [-0.55pp, +2.12pp] | ref | -1.99 [-3.03, -0.94] | -2.37 | 50.47% | 46.04% | 50.71% (n=7348) | 7/13 | 4/5 | -0.002 [-0.020, 0.015] | ref | - |
| V1 | H1 | 13508 | 30.0 | 50.36% | 49.04% | +1.32pp [+0.10pp, +2.58pp] | ref | -0.75 [-1.77, +0.30] | -2.52 | 50.79% | 46.74% | 51.24% (n=7196) | 10/13 | 4/5 | -0.020 [-0.039, -0.002] | ref | - |
| V0 | H3 | 9545 | 26.1 | 50.38% | 49.03% | +1.35pp [-0.68pp, +3.38pp] | 0.732 | -1.66 [-4.15, +1.09] | -3.48 | 51.27% | 50.02% | 51.35% (n=4771) | 10/13 | 4/5 | 0.010 [-0.011, 0.033] | 0.981 | - |
| V0b | H3 | 14628 | 29.7 | 50.01% | 49.46% | +0.55pp [-1.07pp, +2.30pp] | 0.853 | -3.70 [-5.85, -1.49] | -2.66 | 50.81% | 48.00% | 50.53% (n=7607) | 6/13 | 3/5 | 0.001 [-0.017, 0.019] | 0.996 | - |
| V1 | H3 | 14735 | 29.6 | 50.87% | 49.53% | +1.34pp [-0.31pp, +3.07pp] | 0.732 | -0.27 [-2.44, +2.11] | -2.78 | 50.64% | 48.36% | 51.29% (n=7613) | 8/13 | 4/5 | 0.010 [-0.008, 0.027] | 0.981 | - |
| V0 | H5 | 9597 | 25.8 | 50.62% | 49.63% | +0.99pp [-1.45pp, +3.33pp] | 0.853 | -2.37 [-6.22, +1.48] | -4.80 | 50.73% | 48.64% | 50.96% (n=4929) | 8/13 | 4/5 | 0.011 [-0.016, 0.039] | 0.981 | - |
| V0b | H5 | 14668 | 29.6 | 49.81% | 49.34% | +0.47pp [-1.72pp, +2.61pp] | 0.853 | -3.73 [-7.04, -0.43] | -3.44 | 50.82% | 47.35% | 50.45% (n=7721) | 8/13 | 3/5 | -0.002 [-0.023, 0.018] | 0.996 | - |
| V1 | H5 | 14689 | 29.4 | 49.90% | 49.55% | +0.35pp [-1.81pp, +2.38pp] | 0.853 | -2.17 [-5.70, +1.35] | -3.25 | 50.58% | 46.63% | 50.33% (n=7840) | 7/13 | 3/5 | -0.007 [-0.029, 0.014] | 0.981 | - |
| V0 | BR | 7967 | 23.5 | 50.52% | 49.23% | +1.29pp [-0.89pp, +3.45pp] | 0.732 | -1.04 [-3.33, +1.36] | -3.30 | 50.80% | 50.14% | 51.29% (n=3999) | 8/13 | 4/5 | 0.009 [-0.015, 0.033] | 0.981 | - |
| V0b | BR | 12813 | 25.6 | 49.72% | 49.79% | -0.06pp [-2.00pp, +1.98pp] | 0.993 | -2.70 [-4.56, -0.86] | -2.22 | 50.64% | 47.95% | 49.94% (n=6668) | 7/13 | 3/5 | -0.000 [-0.023, 0.021] | 0.996 | - |
| V1 | BR | 12693 | 25.4 | 50.14% | 49.74% | +0.40pp [-1.62pp, +2.33pp] | 0.853 | -2.18 [-3.88, -0.51] | -2.36 | 50.31% | 47.23% | 50.38% (n=6691) | 6/13 | 2/5 | -0.002 [-0.022, 0.017] | 0.996 | - |

## Firing days (confidence >= 0.55; descriptive, outside the families)

| Source | Outcome | Scored | Mean n | Model hit | Weekly-trend hit | Uplift [95% CI] | BH q | Net pips/trade [95% CI] | Weekly-trend net | UP share | Call = weekly trend | Hit when differs | Years + | Pairs + | Confidence rho [95% CI] | BH q | Flags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V0 | H1 | 4093 | 21.4 | 50.31% | 49.23% | +1.08pp [-1.18pp, +3.26pp] | ref | -0.95 [-2.98, +1.15] | -1.76 | 50.99% | 48.83% | 51.05% (n=2094) | 8/13 | 3/5 | 0.002 [-0.024, 0.029] | ref | - |
| V0b | H1 | 8999 | 30.0 | 49.69% | 48.72% | +0.98pp [-0.64pp, +2.62pp] | ref | -1.79 [-2.96, -0.63] | -2.19 | 50.25% | 44.82% | 50.89% (n=4966) | 8/13 | 3/5 | -0.002 [-0.024, 0.018] | ref | - |
| V1 | H1 | 8997 | 30.0 | 49.61% | 49.36% | +0.24pp [-1.35pp, +1.85pp] | ref | -1.15 [-2.32, +0.02] | -2.09 | 50.82% | 45.54% | 50.22% (n=4900) | 8/13 | 3/5 | -0.005 [-0.026, 0.017] | ref | - |
| V0 | H3 | 5239 | 26.4 | 50.85% | 49.30% | +1.55pp [-0.92pp, +4.04pp] | ref | -0.33 [-4.49, +3.60] | -1.70 | 51.42% | 49.43% | 51.53% (n=2651) | 7/13 | 4/5 | -0.001 [-0.029, 0.026] | ref | - |
| V0b | H3 | 10048 | 29.8 | 49.61% | 49.48% | +0.13pp [-1.76pp, +2.03pp] | ref | -4.52 [-7.33, -1.91] | -2.91 | 50.87% | 47.19% | 50.12% (n=5307) | 6/13 | 2/5 | 0.019 [-0.002, 0.042] | ref | - |
| V1 | H3 | 9881 | 29.7 | 51.22% | 49.49% | +1.73pp [-0.19pp, +3.66pp] | ref | +0.54 [-2.30, +3.37] | -2.58 | 50.59% | 47.99% | 51.66% (n=5141) | 9/13 | 3/5 | -0.002 [-0.021, 0.015] | ref | - |
| V0 | H5 | 5524 | 27.1 | 51.12% | 49.87% | +1.25pp [-1.75pp, +4.30pp] | ref | -2.21 [-8.26, +3.82] | -4.15 | 50.58% | 48.49% | 51.21% (n=2845) | 9/13 | 4/5 | 0.004 [-0.027, 0.034] | ref | - |
| V0b | H5 | 10649 | 29.6 | 49.86% | 49.69% | +0.18pp [-2.14pp, +2.42pp] | ref | -4.00 [-8.05, -0.11] | -1.94 | 51.07% | 46.31% | 50.17% (n=5717) | 7/13 | 3/5 | -0.005 [-0.031, 0.020] | ref | - |
| V1 | H5 | 10214 | 29.5 | 49.52% | 50.34% | -0.82pp [-3.01pp, +1.25pp] | ref | -3.11 [-7.51, +1.01] | -1.48 | 50.54% | 45.45% | 49.25% (n=5572) | 4/13 | 3/5 | 0.002 [-0.020, 0.024] | ref | - |
| V0 | BR | 4419 | 23.9 | 51.12% | 49.29% | +1.83pp [-1.08pp, +4.66pp] | ref | -0.73 [-3.68, +2.31] | -3.26 | 50.60% | 49.38% | 51.80% (n=2249) | 9/13 | 4/5 | 0.012 [-0.020, 0.047] | ref | - |
| V0b | BR | 7980 | 25.6 | 49.74% | 49.94% | -0.20pp [-2.50pp, +2.20pp] | ref | -2.81 [-5.10, -0.56] | -1.81 | 50.44% | 47.85% | 49.81% (n=4172) | 6/13 | 3/5 | 0.004 [-0.020, 0.028] | ref | - |
| V1 | BR | 7871 | 25.5 | 49.78% | 50.53% | -0.75pp [-2.93pp, +1.50pp] | ref | -3.07 [-5.17, -0.90] | -1.27 | 50.37% | 46.01% | 49.31% (n=4245) | 6/13 | 2/5 | 0.019 [-0.005, 0.043] | ref | - |

## Caveats

- Overnight financing is not modelled; over 3 to 5 sessions it can matter, in either direction.
- Neighbouring days' multi-day windows overlap; month blocks help but intervals remain optimistic.
- The bracket's ambiguous days are counted as losses (conservative). Hourly bars could resolve them but cover only 2021 to 2024.
- UP share shows the drift in each outcome. Over 2013 to 2025 the USD trends make multi-day hit rates partly a drift question; the weekly-trend baseline is the comparator for that reason.
- A promising cell is a candidate, not a finding; it must be frozen and taken to the locked holdout once.
