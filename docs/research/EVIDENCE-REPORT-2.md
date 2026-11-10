# Evidence Report 2: setup families and trader's-eye encodings

Generated 2026-11-10. Exploration window 2013-06-01..2025-09-15. The locked holdout 2025-09-16..2026-09-15 was NOT read. No verdict is recorded; an unfavourable result is a valid outcome. Nothing here changes the live system. Design: docs/research/PRE-REGISTRATION-2.md (written before any result).

## How to read this

- **Costs:** `xtb-standard-v1`, pips per trade: EURUSD 1.0, GBPUSD 1.2, USDJPY 1.3, USDCHF 2.1, USDCAD 1.9. XTB standard-account spreads from BrokerChooser averages plus the exec-v1 slippage; commission 0. Real costs rise in fast or off-peak markets. Evidence Report 1 was re-run with these costs.
- **Hit:** the direction equals the sign of the session after the decision date (open to close); days whose realised sign is FLAT are excluded. **Net:** signed pips in that direction minus cost, entry at the session open, exit at the close, no stop or target.
- **Intervals / p-values:** week-block bootstrap, 2000 resamples. **BH q:** Benjamini-Hochberg false-discovery-rate value inside each pre-registered family, level 0.1. Fewer than 200 scored days is exploratory and never called significant.

## Part A: setup families

A setup is a day on which one rule strategy gives UP or DOWN (or, for "pattern", the analogue pattern gives a call). Features are oriented so that positive means "in the setup's favour". Spearman rho is against the hit indicator.

### A1. Family results

| Family | Setups | Scored | Hit [95% CI] | p vs 50% | Net pips/trade [95% CI] | Agrees with pattern: hit (n) | Opposes pattern: hit (n) |
|---|---|---|---|---|---|---|---|
| trend | 11792 | 11785 | 50.42% [49.29%, 51.45%] | 0.477 | -1.41 [-2.82, +0.06] | 50.59% (3467) | 49.53% (3836) |
| breakout | 2097 | 2095 | 47.78% [45.46%, 50.21%] | 0.076 | -2.74 [-5.92, +0.56] | 49.66% (741) | 46.69% (724) |
| range | 581 | 580 | 51.55% [47.10%, 56.11%] | 0.528 | -3.29 [-10.78, +4.02] | 53.54% (254) | 47.69% (260) |
| reversal | 1143 | 1142 | 49.56% [46.34%, 52.86%] | 0.827 | -2.44 [-6.71, +1.73] | 50.29% (521) | 47.52% (484) |
| pattern | 9295 | 9288 | 50.20% [49.15%, 51.32%] | 0.647 | -1.31 [-2.64, -0.00] | 50.20% (9288) | 0.00% (0) |

### A2. Pre-registered feature tests (20 tests, one correction family)

Significant after correction: none.

| Family | Feature (oriented to setup) | n | Spearman rho vs hit [95% CI] | p | BH q (20 tests) | Flag | Terciles low / mid / high: hit |
|---|---|---|---|---|---|---|---|
| trend | trendDir | 11785 | -0.012 [-0.032, 0.008] | 0.233 | 0.704 | - | low: 50.71% (n=3926, net -0.18); mid: 51.04% (n=3930, net -1.10); high: 49.50% (n=3929, net -2.94) |
| trend | swingDir | 11785 | -0.000 [-0.019, 0.019] | 0.949 | 0.949 | - | low: 49.89% (n=1393, net -1.21); mid: 50.71% (n=4202, net -0.88); high: 50.34% (n=6190, net -1.81) |
| trend | rangePosDir | 11785 | -0.006 [-0.027, 0.014] | 0.566 | 0.870 | - | low: 50.87% (n=3928, net -1.13); mid: 50.37% (n=3929, net -0.98); high: 50.03% (n=3928, net -2.11) |
| trend | distDir | 11785 | -0.012 [-0.032, 0.009] | 0.240 | 0.704 | - | low: 50.81% (n=3928, net -0.23); mid: 51.29% (n=3929, net -0.74); high: 49.16% (n=3928, net -3.25) |
| breakout | compression | 2095 | -0.035 [-0.085, 0.013] | 0.151 | 0.704 | - | low: 51.93% (n=699, net +4.24); mid: 44.70% (n=698, net -7.27); high: 46.70% (n=698, net -5.17) |
| breakout | excursionDir | 2095 | -0.024 [-0.071, 0.028] | 0.338 | 0.704 | - | low: 50.36% (n=699, net -0.20); mid: 46.42% (n=698, net -4.26); high: 46.56% (n=698, net -3.75) |
| breakout | bodyDir | 2095 | 0.021 [-0.025, 0.067] | 0.352 | 0.704 | - | low: 46.21% (n=699, net -4.92); mid: 47.93% (n=699, net -4.28); high: 49.21% (n=697, net +0.99) |
| breakout | closePosDir | 2095 | 0.009 [-0.036, 0.055] | 0.713 | 0.891 | - | low: 45.49% (n=699, net -6.62); mid: 50.79% (n=699, net -0.48); high: 47.06% (n=697, net -1.11) |
| range | rangePosDir | 580 | 0.072 [-0.014, 0.165] | 0.104 | 0.704 | - | low: 49.48% (n=192, net -10.65); mid: 47.94% (n=194, net -4.97); high: 57.22% (n=194, net +5.70) |
| range | distDir | 580 | 0.011 [-0.067, 0.092] | 0.797 | 0.927 | - | low: 49.74% (n=193, net +2.21); mid: 53.61% (n=194, net -2.22); high: 51.30% (n=193, net -9.84) |
| range | wickRejection | 580 | 0.030 [-0.056, 0.115] | 0.463 | 0.775 | - | low: 50.52% (n=192, net -10.11); mid: 50.52% (n=194, net -1.47); high: 53.61% (n=194, net +1.66) |
| range | compression | 580 | -0.004 [-0.087, 0.078] | 0.937 | 0.949 | - | low: 51.30% (n=193, net -4.23); mid: 53.89% (n=193, net -1.16); high: 49.48% (n=194, net -4.50) |
| reversal | distDir | 1142 | -0.013 [-0.071, 0.041] | 0.658 | 0.891 | - | low: 49.47% (n=380, net -3.50); mid: 49.61% (n=381, net -1.84); high: 49.61% (n=381, net -1.97) |
| reversal | wickRejection | 1142 | -0.022 [-0.080, 0.035] | 0.465 | 0.775 | - | low: 52.11% (n=380, net -2.83); mid: 45.93% (n=381, net -4.39); high: 50.66% (n=381, net -0.09) |
| reversal | swingDir | 1142 | 0.032 [-0.026, 0.088] | 0.292 | 0.704 | - | low: 0.00% (n=0, net +0.00); mid: 48.89% (n=585, net -1.51); high: 50.27% (n=557, net -3.41) |
| reversal | bodyDir | 1142 | -0.048 [-0.110, 0.018] | 0.144 | 0.704 | - | low: 51.71% (n=381, net -3.16); mid: 51.18% (n=381, net +0.24); high: 45.79% (n=380, net -4.38) |
| pattern | swingDir | 9288 | 0.002 [-0.020, 0.022] | 0.835 | 0.927 | - | low: 0.00% (n=0, net +0.00); mid: 50.00% (n=3206, net -0.88); high: 50.31% (n=6082, net -1.54) |
| pattern | rangePosDir | 9288 | -0.005 [-0.028, 0.018] | 0.680 | 0.891 | - | low: 50.71% (n=3098, net +0.55); mid: 49.58% (n=3094, net -3.24); high: 50.32% (n=3096, net -1.24) |
| pattern | distDir | 9288 | -0.018 [-0.042, 0.005] | 0.125 | 0.704 | - | low: 51.16% (n=3096, net +0.01); mid: 49.92% (n=3097, net -1.83); high: 49.53% (n=3095, net -2.11) |
| pattern | bodyDir | 9288 | -0.013 [-0.036, 0.009] | 0.258 | 0.704 | - | low: 50.40% (n=3095, net -2.10); mid: 51.16% (n=3096, net -0.39); high: 49.05% (n=3097, net -1.45) |

## Part B: encoding variants

- **V0b:** live shape, k=30, no cutoff, weekly-trend prefilter (control)
- **V1:** shape + chart features, k=30, prefilter (compared with V0b)
- **V2:** chart features only, k=30, prefilter (compared with V0b)
- **V3:** shape + chart features, k=30, NO prefilter (compared with V1)
- **V4:** live shape, k=30, NO prefilter (control for dropping the prefilter) (compared with V0b)
- **V0:** the live pipeline (k=200, epsilon 0.2, prefilter), from Evidence Report 1, for reference only.

Variant row counts: V0 16015, V0b 16015, V1 16015, V2 16015, V3 16015, V4 16015.

### B1. Directional days

| Variant | Scored | Mean n | Hit | Weekly-trend hit | Uplift [95% CI] | Net pips/trade [95% CI] | Call = weekly trend | Hit when it differs | Hit when it equals |
|---|---|---|---|---|---|---|---|---|---|
| V0 | 9288 | 26.4 | 50.20% | 49.27% | +0.94pp [-0.65pp, +2.55pp] | -1.31 [-2.72, -0.00] | 49.47% | 50.93% (n=4693) | 49.47% (n=4595) |
| V0b | 13704 | 30.0 | 49.77% | 49.04% | +0.73pp [-0.69pp, +2.11pp] | -1.98 [-3.06, -0.99] | 46.07% | 50.68% (n=7392) | 48.70% (n=6312) |
| V1 | 13622 | 30.0 | 50.37% | 49.05% | +1.32pp [-0.04pp, +2.64pp] | -0.68 [-1.80, +0.30] | 46.82% | 51.24% (n=7246) | 49.39% (n=6376) |
| V2 | 13664 | 30.0 | 48.69% | 49.30% | -0.61pp [-1.96pp, +0.70pp] | -2.83 [-3.85, -1.82] | 46.69% | 49.42% (n=7286) | 47.85% (n=6378) |
| V3 | 13695 | 30.0 | 49.82% | 50.70% | -0.88pp [-1.94pp, +0.22pp] | -1.28 [-2.28, -0.21] | 50.02% | 49.12% (n=6843) | 50.53% (n=6852) |
| V4 | 13702 | 30.0 | 49.74% | 50.55% | -0.82pp [-1.93pp, +0.23pp] | -1.75 [-2.75, -0.68] | 51.40% | 49.16% (n=6658) | 50.28% (n=7044) |

### B2. Firing days (confidence >= 0.55)

| Variant | Scored | Mean n | Hit | Weekly-trend hit | Uplift [95% CI] | Net pips/trade [95% CI] | Call = weekly trend | Hit when it differs | Hit when it equals |
|---|---|---|---|---|---|---|---|---|---|
| V0 | 4060 | 21.4 | 50.27% | 49.21% | +1.06pp [-1.19pp, +3.42pp] | -1.03 [-3.06, +0.85] | 49.03% | 51.04% (n=2069) | 49.47% (n=1991) |
| V0b | 8934 | 30.0 | 49.70% | 48.81% | +0.88pp [-0.92pp, +2.61pp] | -1.82 [-3.03, -0.63] | 44.88% | 50.80% (n=4925) | 48.34% (n=4009) |
| V1 | 8946 | 30.0 | 49.58% | 49.37% | +0.20pp [-1.55pp, +1.84pp] | -1.15 [-2.35, +0.11] | 45.61% | 50.18% (n=4866) | 48.85% (n=4080) |
| V2 | 8934 | 30.0 | 48.41% | 49.49% | -1.07pp [-2.63pp, +0.58pp] | -2.97 [-4.30, -1.71] | 45.36% | 49.02% (n=4882) | 47.68% (n=4052) |
| V3 | 8989 | 30.0 | 49.65% | 50.56% | -0.91pp [-2.36pp, +0.53pp] | -1.40 [-2.63, -0.08] | 50.29% | 49.08% (n=4466) | 50.21% (n=4523) |
| V4 | 8923 | 30.0 | 49.18% | 50.06% | -0.89pp [-2.22pp, +0.48pp] | -2.01 [-3.28, -0.68] | 51.88% | 49.08% (n=4293) | 49.27% (n=4630) |

### B3. Pre-registered paired comparisons (BH across four), directional days

| Comparison | Matched scored days | Variant hit | Control hit | Difference [95% CI] | p | BH q | Flag |
|---|---|---|---|---|---|---|---|
| V1 - V0b | 11693 | 50.23% | 49.53% | +0.69pp [-0.33pp, +1.77pp] | 0.198 | 0.264 | - |
| V2 - V0b | 11704 | 48.50% | 49.87% | -1.37pp [-2.50pp, -0.21pp] | 0.020 | 0.080 | **q<=0.10** |
| V3 - V1 | 12288 | 49.98% | 50.57% | -0.59pp [-1.24pp, +0.07pp] | 0.075 | 0.150 | - |
| V4 - V0b | 12350 | 49.80% | 50.14% | -0.34pp [-0.96pp, +0.27pp] | 0.269 | 0.269 | - |

Firing days (descriptive; separate correction):

| Comparison | Matched scored days | Variant hit | Control hit | Difference [95% CI] | p | BH q | Flag |
|---|---|---|---|---|---|---|---|
| V1 - V0b | 5214 | 49.31% | 49.21% | +0.10pp [-1.11pp, +1.37pp] | 0.878 | 0.878 | - |
| V2 - V0b | 5047 | 48.13% | 49.26% | -1.13pp [-2.85pp, +0.60pp] | 0.189 | 0.756 | - |
| V3 - V1 | 6847 | 49.41% | 49.60% | -0.19pp [-0.67pp, +0.33pp] | 0.478 | 0.816 | - |
| V4 - V0b | 6890 | 49.49% | 49.64% | -0.15pp [-0.65pp, +0.38pp] | 0.612 | 0.816 | - |

**Promising variants** (significant improvement over its control, uplift over the weekly-trend baseline above zero, net lower bound above zero): none.

## Caveats

- Rare setups (breakout, range, reversal) give wide intervals; only large effects are detectable.
- Five USD pairs and overlapping windows are not independent; intervals are optimistic.
- The live pipeline skips the candle labelled with the decision date, so features and signals describe the day before the decision date and the outcome is the session after it (RISKS finding 3). Variants share that gap.
- Variants that use chart features have no vectors for roughly the first 121 candles of each pair, so their analogue pool starts a little later.
- A promising variant is a candidate, not a finding. It must be frozen and taken to the locked holdout once.
