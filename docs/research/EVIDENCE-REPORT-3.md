# Evidence Report 3: multi-day horizons and target-before-stop

Generated 2026-11-10. Exploration window 2013-06-01..2025-09-15; every outcome window closes inside it. The locked holdout 2025-09-16..2026-09-15 was NOT read. No verdict is recorded; an unfavourable result is a valid outcome. Nothing here changes the live system. Design: docs/research/PRE-REGISTRATION-3.md (written before any result).

## How to read this

- **Outcomes:** H1 = next session (reference), H3 / H5 = hold 3 / 5 sessions (open of the session after the decision date to the close of the 3rd / 5th session), BR = symmetric bracket 1 x ATR14 either side of entry, at most 5 sessions; hit = side touched first. One daily candle touching both sides is ambiguous and counted as a loss in net; expired brackets close at the 5th session.
- **The call for each outcome** is the majority of the analogues' own result for that same outcome, counting only analogues whose outcome window had closed by the decision date. Confidence uses the live shrinkage (prior weight 10).
- **Sources:** V0 live retrieval (k=200, epsilon 0.2); V0b live shape with fixed k=30; V1 live shape plus chart features with k=30. All keep the weekly-trend prefilter.
- **Baseline:** the weekly-trend sign as the call for every outcome, same days. **Weekly-trend net:** the baseline's net per trade on the same days.
- **Costs:** xtb-standard-v1, pips per trade: EURUSD 1.0, GBPUSD 1.2, USDJPY 1.3, USDCHF 2.1, USDCAD 1.9. Paid once per trade. Overnight financing (swap) is NOT modelled.
- **Statistics:** block bootstrap over calendar MONTHS (2000 resamples). BH q within family U (uplift, 9 tests) and family C (confidence, 9 tests), level 0.1; H1 rows are reference ("ref") and outside both.
- Median ATR14 in pips over scored days (bracket width): EURUSD 80.9, GBPUSD 103.8, USDJPY 83.0, USDCHF 66.3, USDCAD 79.7. Bracket outcomes on directional V0 days: UP_FIRST 4053, EXPIRED 1302, DOWN_FIRST 3918, AMBIGUOUS 71.

## Summary

- Family U (uplift over weekly trend, H3 / H5 / BR x 3 sources): significant none.
- Family C (confidence ranks outcomes): significant none.
- Promising (significant positive uplift, net lower bound above zero, positive in at least 60% of years and pairs): none.

## Directional days

| Source | Outcome | Scored | Mean n | Model hit | Weekly-trend hit | Uplift [95% CI] | BH q | Net pips/trade [95% CI] | Weekly-trend net | UP share | Call = weekly trend | Hit when differs | Years + | Pairs + | Confidence rho [95% CI] | BH q | Flags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V0 | H1 | 9282 | 26.4 | 50.23% | 49.31% | +0.92pp [-0.57pp, +2.38pp] | ref | -1.28 [-2.66, +0.12] | -2.66 | 50.32% | 49.39% | 50.90% (n=4697) | 7/13 | 4/5 | 0.006 [-0.014, 0.026] | ref | - |
| V0b | H1 | 13618 | 30.0 | 49.75% | 48.99% | +0.76pp [-0.55pp, +2.12pp] | ref | -2.00 [-3.04, -0.95] | -2.37 | 50.46% | 46.04% | 50.70% (n=7349) | 7/13 | 4/5 | -0.002 [-0.020, 0.015] | ref | - |
| V1 | H1 | 13511 | 30.0 | 50.36% | 49.05% | +1.31pp [+0.09pp, +2.56pp] | ref | -0.74 [-1.77, +0.33] | -2.50 | 50.79% | 46.75% | 51.23% (n=7197) | 10/13 | 4/5 | -0.020 [-0.039, -0.002] | ref | - |
| V0 | H3 | 9561 | 26.0 | 50.45% | 49.06% | +1.39pp [-0.62pp, +3.43pp] | 0.828 | -1.61 [-4.15, +1.18] | -3.41 | 51.22% | 49.90% | 51.39% (n=4791) | 10/13 | 4/5 | 0.007 [-0.015, 0.030] | 0.984 | - |
| V0b | H3 | 14538 | 29.6 | 49.99% | 49.39% | +0.59pp [-1.05pp, +2.36pp] | 0.880 | -3.76 [-5.95, -1.54] | -2.69 | 50.81% | 47.85% | 50.57% (n=7582) | 6/13 | 3/5 | 0.001 [-0.017, 0.019] | 0.984 | - |
| V1 | H3 | 14674 | 29.5 | 50.79% | 49.55% | +1.24pp [-0.42pp, +2.98pp] | 0.828 | -0.36 [-2.51, +1.98] | -2.71 | 50.65% | 48.05% | 51.19% (n=7626) | 8/13 | 3/5 | 0.012 [-0.006, 0.030] | 0.984 | - |
| V0 | H5 | 9599 | 25.7 | 50.60% | 49.64% | +0.96pp [-1.44pp, +3.29pp] | 0.880 | -2.41 [-6.31, +1.45] | -4.73 | 50.74% | 48.53% | 50.93% (n=4940) | 8/13 | 4/5 | 0.012 [-0.015, 0.040] | 0.984 | - |
| V0b | H5 | 14655 | 29.6 | 49.80% | 49.32% | +0.48pp [-1.70pp, +2.60pp] | 0.880 | -3.70 [-7.04, -0.41] | -3.47 | 50.84% | 47.29% | 50.45% (n=7724) | 8/13 | 3/5 | -0.001 [-0.022, 0.019] | 0.984 | - |
| V1 | H5 | 14686 | 29.4 | 49.89% | 49.60% | +0.29pp [-1.87pp, +2.30pp] | 0.901 | -2.21 [-5.74, +1.25] | -3.11 | 50.59% | 46.51% | 50.27% (n=7855) | 7/13 | 3/5 | -0.006 [-0.028, 0.015] | 0.984 | - |
| V0 | BR | 7971 | 23.4 | 50.47% | 49.27% | +1.20pp [-1.00pp, +3.37pp] | 0.840 | -1.11 [-3.39, +1.25] | -3.23 | 50.85% | 50.05% | 51.20% (n=4008) | 8/13 | 4/5 | 0.012 [-0.013, 0.035] | 0.984 | - |
| V0b | BR | 12818 | 25.6 | 49.73% | 49.80% | -0.06pp [-2.00pp, +1.98pp] | 0.990 | -2.66 [-4.53, -0.81] | -2.23 | 50.61% | 47.90% | 49.94% (n=6678) | 7/13 | 3/5 | -0.001 [-0.023, 0.020] | 0.984 | - |
| V1 | BR | 12696 | 25.4 | 50.10% | 49.69% | +0.41pp [-1.62pp, +2.35pp] | 0.880 | -2.25 [-3.95, -0.56] | -2.42 | 50.24% | 47.09% | 50.39% (n=6710) | 6/13 | 2/5 | -0.001 [-0.020, 0.018] | 0.984 | - |

## Firing days (confidence >= 0.55; descriptive, outside the families)

| Source | Outcome | Scored | Mean n | Model hit | Weekly-trend hit | Uplift [95% CI] | BH q | Net pips/trade [95% CI] | Weekly-trend net | UP share | Call = weekly trend | Hit when differs | Years + | Pairs + | Confidence rho [95% CI] | BH q | Flags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V0 | H1 | 4093 | 21.4 | 50.28% | 49.23% | +1.05pp [-1.20pp, +3.26pp] | ref | -0.97 [-3.01, +1.14] | -1.76 | 50.99% | 48.80% | 51.03% (n=2095) | 8/13 | 3/5 | 0.003 [-0.023, 0.030] | ref | - |
| V0b | H1 | 8998 | 30.0 | 49.69% | 48.71% | +0.98pp [-0.64pp, +2.62pp] | ref | -1.80 [-2.98, -0.64] | -2.20 | 50.24% | 44.81% | 50.89% (n=4966) | 8/13 | 3/5 | -0.002 [-0.024, 0.018] | ref | - |
| V1 | H1 | 8994 | 30.0 | 49.61% | 49.37% | +0.24pp [-1.35pp, +1.85pp] | ref | -1.13 [-2.29, +0.04] | -2.07 | 50.81% | 45.54% | 50.22% (n=4898) | 8/13 | 3/5 | -0.005 [-0.026, 0.016] | ref | - |
| V0 | H3 | 5229 | 26.2 | 50.95% | 49.28% | +1.66pp [-0.79pp, +4.17pp] | ref | -0.03 [-4.16, +3.98] | -1.33 | 51.64% | 49.18% | 51.64% (n=2659) | 7/13 | 4/5 | -0.005 [-0.034, 0.023] | ref | - |
| V0b | H3 | 10129 | 29.7 | 49.62% | 49.46% | +0.16pp [-1.68pp, +2.04pp] | ref | -4.38 [-7.19, -1.77] | -3.00 | 50.80% | 46.97% | 50.15% (n=5372) | 5/13 | 2/5 | 0.017 [-0.004, 0.041] | ref | - |
| V1 | H3 | 9919 | 29.6 | 51.17% | 49.33% | +1.84pp [-0.12pp, +3.77pp] | ref | +0.46 [-2.48, +3.27] | -2.89 | 50.65% | 47.61% | 51.76% (n=5199) | 8/13 | 3/5 | 0.002 [-0.017, 0.020] | ref | - |
| V0 | H5 | 5527 | 27.0 | 51.20% | 49.88% | +1.32pp [-1.63pp, +4.36pp] | ref | -2.04 [-8.05, +4.00] | -3.93 | 50.50% | 48.34% | 51.28% (n=2855) | 9/13 | 4/5 | 0.002 [-0.029, 0.032] | ref | - |
| V0b | H5 | 10652 | 29.6 | 49.85% | 49.66% | +0.19pp [-2.13pp, +2.43pp] | ref | -4.02 [-8.11, -0.12] | -1.97 | 51.05% | 46.28% | 50.17% (n=5722) | 7/13 | 3/5 | -0.004 [-0.030, 0.021] | ref | - |
| V1 | H5 | 10198 | 29.4 | 49.54% | 50.23% | -0.69pp [-2.86pp, +1.41pp] | ref | -2.93 [-7.41, +1.22] | -1.78 | 50.52% | 45.28% | 49.37% (n=5580) | 4/13 | 3/5 | 0.001 [-0.021, 0.024] | ref | - |
| V0 | BR | 4408 | 23.8 | 51.09% | 49.27% | +1.81pp [-1.07pp, +4.63pp] | ref | -0.77 [-3.72, +2.27] | -3.31 | 50.50% | 49.25% | 51.78% (n=2250) | 9/13 | 4/5 | 0.014 [-0.018, 0.049] | ref | - |
| V0b | BR | 7975 | 25.6 | 49.74% | 49.93% | -0.19pp [-2.51pp, +2.21pp] | ref | -2.80 [-5.07, -0.56] | -1.82 | 50.38% | 47.77% | 49.82% (n=4177) | 6/13 | 3/5 | 0.003 [-0.021, 0.028] | ref | - |
| V1 | BR | 7861 | 25.4 | 49.75% | 50.54% | -0.79pp [-2.96pp, +1.48pp] | ref | -3.11 [-5.19, -0.98] | -1.26 | 50.38% | 45.78% | 49.27% (n=4258) | 6/13 | 2/5 | 0.020 [-0.004, 0.044] | ref | - |

## Caveats

- Overnight financing is not modelled; over 3 to 5 sessions it can matter, in either direction.
- Neighbouring days' multi-day windows overlap; month blocks help but intervals remain optimistic.
- The bracket's ambiguous days are counted as losses (conservative). Hourly bars could resolve them but cover only 2021 to 2024.
- UP share shows the drift in each outcome. Over 2013 to 2025 the USD trends make multi-day hit rates partly a drift question; the weekly-trend baseline is the comparator for that reason.
- A promising cell is a candidate, not a finding; it must be frozen and taken to the locked holdout once.
