# Evidence Report 1: where, if anywhere, does the pattern signal work?

Generated 2026-11-10. Exploration window 2013-06-01..2025-09-15. The locked holdout 2025-09-16..2026-09-15 was NOT read. No verdict is recorded here; an unfavourable result is a valid outcome. Nothing in this report changes the live system.

## How to read this

- **Rows:** one per pair per decision date, live convention (legacy FLAT band, label after the decision date), local in-memory stores built from data/*_D1.csv, hosted untouched.
- **Directional days:** the pattern has a UP/DOWN call. **Firing days:** the call also clears the 0.55 confidence line. Directional is the pre-registered primary subset for the evidence-quality studies because it has more days; firing is reported alongside.
- **Hit:** the call matches the sign of the session after the decision date (open to close); days whose realised sign is FLAT are excluded. **Baseline:** the weekly-trend rule on the same days. **Uplift:** model hit minus baseline hit on matched days.
- **Net pips/trade:** signed move in the called direction minus cost (xtb-standard-v1: XTB standard-account spreads from BrokerChooser averages, commission 0, exec-v1 slippage; pips per trade: EURUSD 1.0, GBPUSD 1.2, USDJPY 1.3, USDCHF 2.1, USDCAD 1.9). Entry at the session open, exit at the session close, no stop or target.
- **Intervals and p-values:** block bootstrap (2000 resamples, calendar-week blocks, so the five pairs of a week and overlapping windows stay together). **BH q:** Benjamini-Hochberg false-discovery-rate adjusted value inside each pre-registered family (level 0.1). A cell with fewer than 200 scored days is exploratory and is never called significant.
- **Years + / Pairs +:** in how many calendar years / pairs (with at least 100 scored days) the uplift is positive.
- Pre-registration: docs/research/PRE-REGISTRATION.md. Hypotheses: H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11.

## 1. Reconciliation with the recorded evaluation

Rows dated on or before 2024-12-31 (the existing discovery window) must reproduce the recorded local evidence run, because each date is evaluated only on earlier information.

| Measure | This dataset | Recorded in RESEARCH-LOG.md |
|---|---|---|
| Pair-days | 15095 | 15095 |
| Directional (model has a call) | 8746 | 8746 |
| Firing (>= 0.55) | 3796 | 3796 |
| Directional scored | 8739 | 8739 |
| Directional model hit | 50.10% | 50.10% |

## 2. Headline

| Subset | Scored | Model hit | Weekly-trend hit | Uplift [95% CI] | Net pips/trade [95% CI] | Years + | Pairs + |
|---|---|---|---|---|---|---|---|
| Directional | 9288 | 50.20% | 49.27% | +0.94pp [-0.67pp, +2.56pp] | -1.31 [-2.65, +0.01] | 7/13 | 4/5 |
| Firing | 4060 | 50.27% | 49.21% | +1.06pp [-1.16pp, +3.37pp] | -1.03 [-2.98, +1.02] | 8/13 | 3/5 |

## 3. Where does the signal work? (summary)

Cells examined in the pre-registered correction family: directional 63, firing 58. Correlation hypotheses that are significant after correction (both subsets): 0 of 20.

**Candidate edges** (reportable, BH-significant, positive uplift, positive net with the lower bound above zero, positive in at least 60% of years and pairs):

Directional:
None.

Firing:
None.

Reportable directional cells with a positive mean net (not necessarily significant, listed so nothing is hidden): n=n30-49 (+0.14); confidence=0.60-0.65 (+0.09); rawAgreement=0.80-0.89 (+2.08); rawAgreement=0.90+ (+0.87); closest10Agreement=0.7-0.8 (+0.74); opposeCount=oppose=1 (+0.26); opposeCount=oppose=2 (+0.16); atrPercentile=atr-q3 (+0.80); pair=EURUSD (+0.27); weekday=Fri (+0.26); strategy:breakout=oppose (+0.40); strategy:range=oppose (+0.13); strategy:reversal=oppose (+2.74); confluenceStatus=CONFLICT_FLAT (+0.27).

## 4. Evidence quality and calibration (H1-H6)

### 4.1 Correlations with hit rate

Directional days:

| Hyp | Variable | Expected | n | Spearman rho vs hit [95% CI] | p | BH q | Result |
|---|---|---|---|---|---|---|---|
| H1 | n | + | 9288 | 0.001 [-0.020, 0.022] | 0.879 | 0.885 | - |
| H2 | nearestDistance | - | 9288 | -0.001 [-0.022, 0.021] | 0.885 | 0.885 | - |
| H3 | meanDistance | - | 9288 | -0.010 [-0.032, 0.011] | 0.386 | 0.740 | - |
| H4 | confidence | + | 9288 | 0.007 [-0.015, 0.027] | 0.494 | 0.740 | - |
| H5 | rawAgreement | + | 9288 | 0.007 [-0.013, 0.028] | 0.528 | 0.740 | - |
| H6 | closest10Agreement | + | 4812 | -0.020 [-0.047, 0.007] | 0.157 | 0.606 | - |
| H7 | agreeCount | + | 9288 | 0.006 [-0.015, 0.028] | 0.592 | 0.740 | - |
| H8 | opposeCount | - | 9288 | 0.015 [-0.007, 0.038] | 0.182 | 0.606 | - |
| H9 | efficiencyRatio | either | 9288 | 0.012 [-0.008, 0.032] | 0.273 | 0.682 | - |
| H10 | atrPercentile | either | 9288 | -0.015 [-0.034, 0.004] | 0.141 | 0.606 | - |

Firing days:

| Hyp | Variable | Expected | n | Spearman rho vs hit [95% CI] | p | BH q | Result |
|---|---|---|---|---|---|---|---|
| H1 | n | + | 4060 | 0.004 [-0.028, 0.036] | 0.847 | 0.999 | - |
| H2 | nearestDistance | - | 4060 | -0.002 [-0.034, 0.029] | 0.896 | 0.999 | - |
| H3 | meanDistance | - | 4060 | -0.000 [-0.029, 0.030] | 0.999 | 0.999 | - |
| H4 | confidence | + | 4060 | 0.003 [-0.028, 0.032] | 0.831 | 0.999 | - |
| H5 | rawAgreement | + | 4060 | -0.003 [-0.035, 0.030] | 0.861 | 0.999 | - |
| H6 | closest10Agreement | + | 2215 | -0.012 [-0.054, 0.031] | 0.580 | 0.999 | - |
| H7 | agreeCount | + | 4060 | 0.002 [-0.029, 0.032] | 0.907 | 0.999 | - |
| H8 | opposeCount | - | 4060 | 0.015 [-0.019, 0.047] | 0.396 | 0.999 | - |
| H9 | efficiencyRatio | either | 4060 | 0.006 [-0.024, 0.036] | 0.653 | 0.999 | - |
| H10 | atrPercentile | either | 4060 | -0.010 [-0.042, 0.021] | 0.533 | 0.999 | - |

### 4.2 Bands, directional days

#### n (H1)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| n<10 | 4476 | 50.16% | 48.24% | +1.92pp [-0.47pp, +4.22pp] | 0.584 | -1.15 [-3.10, +0.75] | 10/13 | 3/5 | - |
| n10-19 | 1469 | 48.67% | 50.17% | -1.50pp [-5.49pp, +2.62pp] | 0.943 | -3.21 [-6.30, +0.01] | 5/10 | 1/5 | - |
| n20-29 | 842 | 50.83% | 48.34% | +2.49pp [-2.61pp, +7.57pp] | 0.839 | -0.27 [-4.50, +3.87] | 0/1 | 4/5 | - |
| n30-49 | 974 | 50.41% | 50.31% | +0.10pp [-4.10pp, +4.47pp] | 1.000 | +0.14 [-3.29, +3.49] | 1/2 | 3/5 | - |
| n50-99 | 902 | 51.44% | 53.55% | -2.11pp [-6.36pp, +2.51pp] | 0.839 | -1.88 [-6.68, +3.10] | 1/2 | 0/5 | - |
| n100+ | 625 | 51.20% | 48.00% | +3.20pp [-1.77pp, +8.65pp] | 0.661 | -0.84 [-5.89, +4.11] | 2/3 | 2/4 | - |

#### nearestDistance (H2)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| q1 <0.090 | 1858 | 51.24% | 50.59% | +0.65pp [-2.73pp, +4.10pp] | 0.979 | -1.30 [-4.47, +2.01] | 5/10 | 3/5 | - |
| q2 0.090-0.117 | 1856 | 47.95% | 48.60% | -0.65pp [-4.11pp, +2.94pp] | 0.979 | -3.14 [-5.77, -0.56] | 5/11 | 3/5 | - |
| q3 0.117-0.142 | 1859 | 52.72% | 50.08% | +2.64pp [-0.70pp, +5.87pp] | 0.584 | -0.31 [-3.27, +2.52] | 8/12 | 4/5 | - |
| q4 0.142-0.169 | 1858 | 49.62% | 48.92% | +0.70pp [-2.74pp, +4.07pp] | 0.979 | -1.51 [-4.26, +1.29] | 7/13 | 3/5 | - |
| q5 >=0.169 | 1857 | 49.49% | 48.14% | +1.35pp [-2.32pp, +4.72pp] | 0.885 | -0.30 [-3.17, +2.39] | 6/13 | 3/5 | - |

#### meanDistance (H3)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| q1 <0.157 | 1857 | 50.89% | 49.97% | +0.92pp [-2.05pp, +4.16pp] | 0.943 | -1.35 [-4.49, +1.68] | 4/9 | 4/5 | - |
| q2 0.157-0.165 | 1858 | 49.84% | 49.41% | +0.43pp [-2.72pp, +3.76pp] | 1.000 | -2.68 [-5.68, +0.16] | 6/12 | 2/5 | - |
| q3 0.165-0.173 | 1857 | 50.57% | 47.98% | +2.58pp [-0.74pp, +5.92pp] | 0.584 | -0.87 [-3.81, +1.87] | 7/12 | 4/5 | - |
| q4 0.173-0.182 | 1859 | 50.56% | 48.79% | +1.78pp [-1.32pp, +4.95pp] | 0.805 | -0.92 [-3.46, +1.51] | 8/12 | 3/5 | - |
| q5 >=0.182 | 1857 | 49.17% | 50.19% | -1.02pp [-4.55pp, +2.42pp] | 0.943 | -0.74 [-3.62, +2.14] | 6/13 | 3/5 | - |

#### confidence (H4)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| 0.50-0.55 | 5228 | 50.15% | 49.31% | +0.84pp [-1.20pp, +2.87pp] | 0.839 | -1.53 [-3.41, +0.31] | 7/13 | 4/5 | - |
| 0.55-0.60 | 2788 | 50.54% | 49.39% | +1.15pp [-1.43pp, +3.90pp] | 0.839 | -1.22 [-3.66, +1.13] | 8/13 | 3/5 | - |
| 0.60-0.65 | 1100 | 49.27% | 49.00% | +0.27pp [-4.04pp, +4.43pp] | 1.000 | +0.09 [-3.60, +3.85] | 2/3 | 3/5 | - |
| 0.65-0.70 | 157 | 52.23% | 48.41% | +3.82pp [-6.88pp, +15.23pp] | n/a | -5.61 [-16.98, +5.58] | 0/0 | 0/0 | exploratory (n<200) |
| 0.70+ | 15 | 53.33% | 40.00% | +13.33pp [-33.33pp, +53.33pp] | n/a | -0.19 [-27.47, +29.93] | 0/0 | 0/0 | exploratory (n<200) |

#### rawAgreement (H5)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| <0.60 | 3706 | 50.13% | 49.97% | +0.16pp [-2.29pp, +2.66pp] | 1.000 | -1.58 [-3.61, +0.48] | 5/12 | 4/5 | - |
| 0.60-0.69 | 2485 | 49.38% | 49.01% | +0.36pp [-2.47pp, +3.10pp] | 1.000 | -2.96 [-5.55, -0.32] | 7/13 | 3/5 | - |
| 0.70-0.79 | 699 | 49.64% | 50.07% | -0.43pp [-5.86pp, +5.19pp] | 1.000 | -2.01 [-6.86, +3.02] | 0/0 | 1/5 | - |
| 0.80-0.89 | 282 | 53.19% | 45.04% | +8.16pp [-1.07pp, +16.89pp] | 0.584 | +2.08 [-6.00, +9.68] | 0/0 | 0/0 | - |
| 0.90+ | 2116 | 51.09% | 48.63% | +2.46pp [-0.90pp, +5.65pp] | 0.584 | +0.87 [-1.65, +3.33] | 8/12 | 4/5 | - |

#### closest10Agreement (H6)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| <=0.6 | 3423 | 50.45% | 50.37% | +0.09pp [-2.40pp, +2.40pp] | 1.000 | -2.04 [-4.26, +0.17] | 8/12 | 3/5 | - |
| 0.7-0.8 | 1321 | 50.26% | 49.81% | +0.45pp [-3.76pp, +4.90pp] | 1.000 | +0.74 [-2.43, +4.07] | 1/6 | 3/5 | - |
| 0.9+ | 68 | 39.71% | 51.47% | -11.76pp [-28.36pp, +5.88pp] | n/a | -14.95 [-32.96, +2.38] | 0/0 | 0/0 | exploratory (n<200) |

#### agreeCount (H7)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| agree=0 | 4994 | 49.94% | 48.24% | +1.70pp [-0.64pp, +4.11pp] | 0.584 | -0.79 [-2.62, +1.18] | 10/13 | 4/5 | - |
| agree=1 | 3605 | 50.43% | 50.37% | +0.06pp [-2.24pp, +2.51pp] | 1.000 | -1.69 [-4.14, +0.69] | 5/13 | 2/5 | - |
| agree=2 | 689 | 50.94% | 50.94% | +0.00pp [-2.05pp, +2.10pp] | 1.000 | -3.13 [-8.05, +1.53] | 0/0 | 1/5 | - |

#### opposeCount (H8)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| oppose=0 | 4645 | 49.58% | 49.64% | -0.06pp [-2.09pp, +2.02pp] | 1.000 | -2.87 [-4.98, -0.73] | 6/13 | 2/5 | - |
| oppose=1 | 3982 | 50.43% | 49.12% | +1.31pp [-1.12pp, +3.78pp] | 0.826 | +0.26 [-1.94, +2.50] | 7/13 | 4/5 | - |
| oppose=2 | 661 | 53.25% | 47.50% | +5.75pp [-1.60pp, +12.85pp] | 0.584 | +0.16 [-4.82, +5.37] | 0/0 | 4/5 | - |

#### efficiencyRatio (H9)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| q1 <0.214 | 3096 | 49.97% | 50.58% | -0.61pp [-3.26pp, +2.11pp] | 0.974 | -1.74 [-3.97, +0.50] | 6/13 | 1/5 | - |
| q2 0.214-0.403 | 3097 | 50.31% | 49.63% | +0.68pp [-1.98pp, +3.42pp] | 0.974 | -0.51 [-2.82, +1.80] | 6/13 | 3/5 | - |
| q3 >=0.403 | 3095 | 50.34% | 47.59% | +2.75pp [+0.35pp, +5.35pp] | 0.584 | -1.69 [-4.01, +0.42] | 8/13 | 5/5 | - |

#### atrPercentile (H10)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| atr-q1(low) | 3190 | 51.16% | 48.75% | +2.41pp [-0.13pp, +4.83pp] | 0.584 | -0.36 [-2.03, +1.39] | 9/10 | 4/5 | - |
| atr-q2 | 1796 | 50.84% | 47.94% | +2.90pp [-0.43pp, +6.16pp] | 0.584 | -1.66 [-4.06, +0.80] | 7/9 | 4/5 | - |
| atr-q3 | 1729 | 50.49% | 51.13% | -0.64pp [-4.06pp, +2.82pp] | 0.979 | +0.80 [-2.40, +3.83] | 4/9 | 2/5 | - |
| atr-q4(high) | 2573 | 48.39% | 49.59% | -1.20pp [-4.63pp, +1.98pp] | 0.885 | -3.68 [-6.90, -0.72] | 6/11 | 1/5 | - |

#### pair (pre-registered slice dimension)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| EURUSD | 1900 | 51.32% | 49.00% | +2.32pp [-0.58pp, +5.11pp] | 0.584 | +0.27 [-2.02, +2.62] | 9/12 | 1/1 | - |
| GBPUSD | 1915 | 50.03% | 49.35% | +0.68pp [-2.29pp, +3.93pp] | 0.974 | -0.86 [-3.97, +2.34] | 6/12 | 1/1 | - |
| USDCAD | 1827 | 47.35% | 50.47% | -3.12pp [-6.48pp, +0.17pp] | 0.584 | -3.30 [-6.08, -0.45] | 2/11 | 0/1 | - |
| USDCHF | 1886 | 51.33% | 48.94% | +2.39pp [-1.25pp, +5.82pp] | 0.640 | -2.10 [-4.38, +0.10] | 9/12 | 1/1 | - |
| USDJPY | 1760 | 50.97% | 48.58% | +2.39pp [-0.73pp, +5.44pp] | 0.584 | -0.61 [-4.44, +3.14] | 6/10 | 1/1 | - |

#### weekday (pre-registered slice dimension)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| Mon | 1867 | 50.03% | 49.01% | +1.02pp [-2.66pp, +4.55pp] | 0.973 | -0.92 [-3.71, +1.86] | 6/12 | 3/5 | - |
| Tue | 1856 | 48.71% | 50.38% | -1.67pp [-5.45pp, +2.25pp] | 0.839 | -3.77 [-7.08, -0.44] | 2/12 | 2/5 | - |
| Wed | 1867 | 50.24% | 49.87% | +0.37pp [-2.85pp, +4.10pp] | 1.000 | -0.35 [-3.63, +2.82] | 8/12 | 3/5 | - |
| Thu | 1869 | 49.97% | 48.85% | +1.12pp [-2.56pp, +4.76pp] | 0.943 | -1.77 [-4.78, +1.29] | 6/12 | 2/5 | - |
| Fri | 1829 | 52.10% | 48.22% | +3.88pp [+0.39pp, +7.30pp] | 0.584 | +0.26 [-2.23, +2.71] | 10/12 | 4/5 | - |

### 4.3 Bands, firing days

#### n (H1)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| n<10 | 1845 | 50.08% | 48.29% | +1.79pp [-1.79pp, +5.48pp] | 1.000 | -1.04 [-4.02, +1.91] | 6/13 | 3/5 | - |
| n10-19 | 901 | 49.06% | 49.94% | -0.89pp [-6.17pp, +4.27pp] | 1.000 | -3.97 [-8.20, +0.13] | 0/0 | 1/5 | - |
| n20-29 | 434 | 50.92% | 46.54% | +4.38pp [-3.32pp, +11.73pp] | 1.000 | +0.43 [-4.88, +5.56] | 0/0 | 0/1 | - |
| n30-49 | 450 | 50.44% | 50.67% | -0.22pp [-6.80pp, +6.44pp] | 1.000 | +2.17 [-3.27, +7.26] | 0/0 | 1/2 | - |
| n50-99 | 298 | 54.36% | 52.68% | +1.68pp [-6.92pp, +10.07pp] | 1.000 | +0.81 [-6.70, +8.69] | 0/0 | 0/0 | - |
| n100+ | 132 | 49.24% | 53.03% | -3.79pp [-14.29pp, +5.43pp] | n/a | -0.76 [-9.87, +7.77] | 0/0 | 0/0 | exploratory (n<200) |

#### nearestDistance (H2)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| q1 <0.096 | 810 | 51.23% | 51.60% | -0.37pp [-5.58pp, +4.99pp] | 1.000 | -0.49 [-5.20, +4.00] | 0/0 | 3/5 | - |
| q2 0.096-0.118 | 813 | 47.48% | 45.63% | +1.85pp [-3.02pp, +6.77pp] | 1.000 | -3.39 [-7.80, +0.99] | 0/0 | 3/5 | - |
| q3 0.118-0.137 | 812 | 53.08% | 49.88% | +3.20pp [-2.00pp, +8.21pp] | 1.000 | +0.51 [-3.87, +4.69] | 1/1 | 4/5 | - |
| q4 0.137-0.158 | 813 | 50.92% | 51.29% | -0.37pp [-5.17pp, +4.26pp] | 1.000 | -0.43 [-4.56, +3.61] | 0/0 | 3/5 | - |
| q5 >=0.158 | 812 | 48.65% | 47.66% | +0.99pp [-3.97pp, +6.06pp] | 1.000 | -1.36 [-5.60, +2.84] | 0/0 | 3/5 | - |

#### meanDistance (H3)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| q1 <0.159 | 810 | 50.86% | 50.00% | +0.86pp [-3.99pp, +5.77pp] | 1.000 | -1.05 [-6.18, +4.32] | 0/1 | 3/5 | - |
| q2 0.159-0.166 | 813 | 49.20% | 49.20% | +0.00pp [-4.98pp, +5.08pp] | 1.000 | -2.52 [-6.82, +1.75] | 0/0 | 3/5 | - |
| q3 0.166-0.172 | 812 | 50.25% | 48.77% | +1.48pp [-3.85pp, +6.89pp] | 1.000 | -1.75 [-6.42, +2.92] | 0/0 | 4/5 | - |
| q4 0.172-0.180 | 813 | 52.03% | 49.08% | +2.95pp [-2.24pp, +7.92pp] | 1.000 | +1.82 [-1.99, +5.77] | 0/0 | 3/5 | - |
| q5 >=0.180 | 812 | 49.01% | 49.01% | +0.00pp [-4.90pp, +4.99pp] | 1.000 | -1.66 [-5.93, +2.57] | 0/1 | 3/5 | - |

#### confidence (H4)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| 0.55-0.60 | 2788 | 50.54% | 49.39% | +1.15pp [-1.32pp, +3.79pp] | 1.000 | -1.22 [-3.64, +1.14] | 8/13 | 3/5 | - |
| 0.60-0.65 | 1100 | 49.27% | 49.00% | +0.27pp [-4.13pp, +4.74pp] | 1.000 | +0.09 [-3.57, +3.66] | 2/3 | 3/5 | - |
| 0.65-0.70 | 157 | 52.23% | 48.41% | +3.82pp [-6.58pp, +14.77pp] | n/a | -5.61 [-17.11, +5.29] | 0/0 | 0/0 | exploratory (n<200) |
| 0.70+ | 15 | 53.33% | 40.00% | +13.33pp [-33.33pp, +53.33pp] | n/a | -0.19 [-27.49, +28.95] | 0/0 | 0/0 | exploratory (n<200) |

#### rawAgreement (H5)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| <0.60 | 757 | 51.25% | 50.73% | +0.53pp [-4.23pp, +5.60pp] | 1.000 | -0.39 [-5.44, +4.25] | 0/0 | 2/5 | - |
| 0.60-0.69 | 1601 | 49.09% | 49.16% | -0.06pp [-3.19pp, +3.43pp] | 1.000 | -2.22 [-5.36, +0.89] | 6/12 | 2/5 | - |
| 0.70-0.79 | 699 | 49.64% | 50.07% | -0.43pp [-5.91pp, +4.89pp] | 1.000 | -2.01 [-6.82, +2.71] | 0/0 | 1/5 | - |
| 0.80-0.89 | 282 | 53.19% | 45.04% | +8.16pp [-1.06pp, +16.60pp] | 1.000 | +2.08 [-5.40, +9.22] | 0/0 | 0/0 | - |
| 0.90+ | 721 | 51.32% | 48.54% | +2.77pp [-2.71pp, +8.10pp] | 1.000 | +0.66 [-3.60, +5.21] | 0/0 | 3/5 | - |

#### closest10Agreement (H6)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| <=0.6 | 1272 | 50.47% | 49.61% | +0.86pp [-3.11pp, +4.70pp] | 1.000 | -2.34 [-6.08, +1.56] | 4/5 | 4/5 | - |
| 0.7-0.8 | 887 | 50.85% | 50.39% | +0.45pp [-4.65pp, +5.99pp] | 1.000 | +1.58 [-1.78, +5.09] | 1/1 | 2/5 | - |
| 0.9+ | 56 | 42.86% | 51.79% | -8.93pp [-26.79pp, +9.68pp] | n/a | -12.36 [-32.71, +7.47] | 0/0 | 0/0 | exploratory (n<200) |

#### agreeCount (H7)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| agree=0 | 2300 | 50.35% | 47.70% | +2.65pp [-0.55pp, +5.71pp] | 1.000 | +0.12 [-2.62, +2.75] | 8/12 | 3/5 | - |
| agree=1 | 1479 | 49.63% | 50.91% | -1.28pp [-5.34pp, +2.33pp] | 1.000 | -2.88 [-6.98, +1.02] | 5/11 | 1/5 | - |
| agree=2 | 281 | 53.02% | 52.67% | +0.36pp [-2.57pp, +3.19pp] | 1.000 | -0.70 [-7.65, +6.12] | 0/0 | 0/0 | - |

#### opposeCount (H8)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| oppose=0 | 1978 | 49.44% | 49.44% | +0.00pp [-3.28pp, +3.24pp] | 1.000 | -3.36 [-6.59, -0.41] | 4/12 | 3/5 | - |
| oppose=1 | 1806 | 51.16% | 48.89% | +2.27pp [-1.15pp, +5.77pp] | 1.000 | +1.69 [-1.39, +4.70] | 6/12 | 4/5 | - |
| oppose=2 | 276 | 50.36% | 49.64% | +0.72pp [-10.32pp, +11.81pp] | 1.000 | -2.20 [-9.50, +4.68] | 0/0 | 0/0 | - |

#### efficiencyRatio (H9)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| q1 <0.215 | 1354 | 49.78% | 50.37% | -0.59pp [-4.27pp, +3.30pp] | 1.000 | -1.76 [-5.21, +1.83] | 3/7 | 2/5 | - |
| q2 0.215-0.401 | 1354 | 50.96% | 50.15% | +0.81pp [-3.03pp, +4.67pp] | 1.000 | +0.56 [-2.75, +3.84] | 3/7 | 3/5 | - |
| q3 >=0.401 | 1352 | 50.07% | 47.12% | +2.96pp [-0.92pp, +6.82pp] | 1.000 | -1.90 [-5.72, +1.76] | 4/7 | 5/5 | - |

#### atrPercentile (H10)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| atr-q1(low) | 1386 | 50.58% | 47.84% | +2.74pp [-1.04pp, +6.70pp] | 1.000 | +0.12 [-2.71, +2.99] | 5/7 | 4/5 | - |
| atr-q2 | 826 | 50.12% | 47.34% | +2.78pp [-2.23pp, +7.52pp] | 1.000 | -3.49 [-6.95, -0.01] | 1/1 | 4/5 | - |
| atr-q3 | 738 | 52.30% | 52.17% | +0.14pp [-5.11pp, +5.39pp] | 1.000 | +2.97 [-2.50, +8.14] | 0/0 | 2/5 | - |
| atr-q4(high) | 1110 | 48.65% | 50.36% | -1.71pp [-6.12pp, +3.01pp] | 1.000 | -3.31 [-8.50, +1.93] | 2/3 | 1/5 | - |

#### pair (pre-registered slice dimension)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| EURUSD | 869 | 52.24% | 49.71% | +2.53pp [-1.95pp, +6.94pp] | 1.000 | +0.24 [-3.27, +3.69] | 0/0 | 1/1 | - |
| GBPUSD | 875 | 49.26% | 50.29% | -1.03pp [-5.57pp, +3.21pp] | 1.000 | +0.37 [-4.24, +4.87] | 0/1 | 0/1 | - |
| USDCAD | 744 | 46.51% | 50.00% | -3.49pp [-8.61pp, +1.95pp] | 1.000 | -4.81 [-9.07, -0.61] | 0/0 | 0/1 | - |
| USDCHF | 894 | 50.67% | 47.99% | +2.68pp [-2.09pp, +7.51pp] | 1.000 | -3.09 [-6.66, +0.36] | 0/0 | 1/1 | - |
| USDJPY | 678 | 52.65% | 47.94% | +4.72pp [-1.18pp, +10.58pp] | 1.000 | +2.38 [-4.01, +8.47] | 0/0 | 1/1 | - |

#### weekday (pre-registered slice dimension)

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| Mon | 851 | 52.17% | 50.06% | +2.12pp [-3.10pp, +7.13pp] | 1.000 | +0.14 [-3.94, +4.36] | 0/0 | 4/5 | - |
| Tue | 796 | 48.99% | 50.25% | -1.26pp [-6.87pp, +4.48pp] | 1.000 | -2.53 [-7.60, +2.66] | 0/0 | 1/5 | - |
| Wed | 808 | 48.51% | 49.63% | -1.11pp [-6.01pp, +3.93pp] | 1.000 | -3.48 [-8.54, +1.48] | 0/0 | 3/5 | - |
| Thu | 796 | 48.62% | 49.87% | -1.26pp [-6.42pp, +4.17pp] | 1.000 | -0.66 [-4.81, +3.60] | 0/0 | 2/5 | - |
| Fri | 809 | 52.90% | 46.23% | +6.67pp [+1.67pp, +11.54pp] | 0.638 | +1.28 [-2.39, +4.96] | 0/0 | 5/5 | - |

## 5. Confluence strategies (H7-H8)

Standalone accuracy against a coin flip (all days on which the strategy gives a direction, not only pattern days). `third_party` has no history and is excluded; `custom_pattern` is the pattern call itself.

| Signal | Scored | Hit rate [95% CI] | BH q (vs 50%) | Agrees with pattern when both call | Both-call days | Flag |
|---|---|---|---|---|---|---|
| trend | 11785 | 50.42% [49.34%, 51.48%] | 0.792 | 47.49% | 7307 | - |
| breakout | 2095 | 47.78% [45.32%, 50.24%] | 0.350 | 50.55% | 1466 | - |
| range | 580 | 51.55% [46.98%, 56.47%] | 0.792 | 49.42% | 514 | - |
| reversal | 1142 | 49.56% [46.28%, 52.95%] | 0.792 | 51.79% | 1006 | - |
| pattern (all directional days) | 9288 | 50.20% [49.19%, 51.23%] | 0.792 | 100.00% | 9295 | - |

Agreeing vs opposing the pattern call (directional days):

| Strategy | Agree n / hit | Oppose n / hit | Agree - Oppose [95% CI] | BH q | Flag |
|---|---|---|---|---|---|
| trend | 3467 / 50.59% | 3836 / 50.47% | +0.12pp [-2.41pp, +2.73pp] | 0.922 | - |
| breakout | 741 / 49.66% | 724 / 53.31% | -3.65pp [-9.19pp, +1.61pp] | 0.668 | - |
| range | 254 / 53.54% | 260 / 52.31% | +1.24pp [-7.28pp, +11.06pp] | 0.922 | - |
| reversal | 521 / 50.29% | 484 / 52.48% | -2.19pp [-8.95pp, +4.75pp] | 0.922 | - |

Cells relative to the pattern call (directional days):

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| strategy:trend: agree | 3467 | 50.59% | 51.20% | -0.61pp [-2.57pp, +1.26pp] | 0.943 | -2.07 [-4.57, +0.27] | 5/13 | 1/5 | - |
| strategy:trend: oppose | 3836 | 50.47% | 48.46% | +2.01pp [-0.80pp, +4.76pp] | 0.584 | -0.10 [-2.43, +2.15] | 8/13 | 3/5 | - |
| strategy:trend: flat | 1985 | 49.02% | 47.46% | +1.56pp [-1.90pp, +5.24pp] | 0.839 | -2.33 [-5.18, +0.42] | 7/12 | 3/5 | - |
| strategy:breakout: agree | 741 | 49.66% | 49.66% | +0.00pp [+0.00pp, +0.00pp] | 1.000 | -2.33 [-6.99, +2.51] | 0/0 | 0/5 | - |
| strategy:breakout: oppose | 724 | 53.31% | 46.69% | +6.63pp [-1.27pp, +13.54pp] | 0.584 | +0.40 [-4.48, +5.45] | 0/0 | 5/5 | - |
| strategy:breakout: flat | 7823 | 49.97% | 49.47% | +0.50pp [-1.28pp, +2.22pp] | 0.973 | -1.37 [-2.90, +0.14] | 9/13 | 4/5 | - |
| strategy:range: agree | 254 | 53.54% | 46.46% | +7.09pp [-3.96pp, +17.59pp] | 0.666 | -5.90 [-15.43, +2.92] | 0/0 | 0/0 | - |
| strategy:range: oppose | 260 | 52.31% | 52.31% | +0.00pp [+0.00pp, +0.00pp] | 1.000 | +0.13 [-9.74, +9.95] | 0/0 | 0/0 | - |
| strategy:range: flat | 8774 | 50.05% | 49.26% | +0.79pp [-0.83pp, +2.37pp] | 0.839 | -1.22 [-2.59, +0.24] | 8/13 | 4/5 | - |
| strategy:reversal: agree | 521 | 50.29% | 49.33% | +0.96pp [-7.89pp, +9.42pp] | 1.000 | -0.05 [-5.45, +5.72] | 0/0 | 2/2 | - |
| strategy:reversal: oppose | 484 | 52.48% | 51.86% | +0.62pp [+0.00pp, +1.41pp] | 0.584 | +2.74 [-4.34, +9.49] | 0/0 | 1/3 | - |
| strategy:reversal: flat | 8283 | 50.07% | 49.11% | +0.95pp [-0.78pp, +2.74pp] | 0.805 | -1.63 [-3.13, -0.16] | 7/13 | 4/5 | - |
| confluenceStatus: ALIGNED_DOWN | 46 | 47.83% | 47.83% | +0.00pp [+0.00pp, +0.00pp] | n/a | -3.05 [-30.13, +19.38] | 0/0 | 0/0 | exploratory (n<200) |
| confluenceStatus: ALIGNED_UP | 82 | 53.66% | 53.66% | +0.00pp [+0.00pp, +0.00pp] | n/a | -0.49 [-16.89, +16.32] | 0/0 | 0/0 | exploratory (n<200) |
| confluenceStatus: CONFLICT_FLAT | 3315 | 51.13% | 48.87% | +2.26pp [-0.78pp, +5.34pp] | 0.584 | +0.27 [-2.06, +2.70] | 10/13 | 4/5 | - |
| confluenceStatus: NEUTRAL | 5845 | 49.65% | 49.44% | +0.21pp [-1.76pp, +2.04pp] | 1.000 | -2.21 [-4.03, -0.48] | 6/13 | 4/5 | - |

Cells relative to the pattern call (firing days):

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| strategy:trend: agree | 1413 | 50.53% | 52.51% | -1.98pp [-5.27pp, +1.22pp] | 1.000 | -2.02 [-5.80, +1.76] | 3/10 | 1/5 | - |
| strategy:trend: oppose | 1757 | 50.77% | 48.95% | +1.82pp [-1.86pp, +5.47pp] | 1.000 | +1.01 [-2.13, +4.08] | 8/11 | 3/5 | - |
| strategy:trend: flat | 890 | 48.88% | 44.49% | +4.38pp [-0.98pp, +9.66pp] | 1.000 | -3.49 [-8.02, +0.78] | 1/1 | 4/5 | - |
| strategy:breakout: agree | 313 | 49.52% | 49.52% | +0.00pp [+0.00pp, +0.00pp] | 1.000 | -2.55 [-8.43, +3.45] | 0/0 | 0/0 | - |
| strategy:breakout: oppose | 313 | 51.76% | 48.24% | +3.51pp [-7.33pp, +14.74pp] | 1.000 | -0.80 [-7.46, +6.06] | 0/0 | 0/0 | - |
| strategy:breakout: flat | 3434 | 50.20% | 49.27% | +0.93pp [-1.57pp, +3.52pp] | 1.000 | -0.92 [-3.25, +1.33] | 7/13 | 3/5 | - |
| strategy:range: agree | 96 | 51.04% | 48.96% | +2.08pp [-17.24pp, +21.43pp] | n/a | -13.65 [-31.84, +2.02] | 0/0 | 0/0 | exploratory (n<200) |
| strategy:range: oppose | 98 | 50.00% | 50.00% | +0.00pp [+0.00pp, +0.00pp] | n/a | +0.62 [-9.63, +11.26] | 0/0 | 0/0 | exploratory (n<200) |
| strategy:range: flat | 3866 | 50.26% | 49.20% | +1.06pp [-1.18pp, +3.34pp] | 1.000 | -0.76 [-2.80, +1.33] | 8/13 | 3/5 | - |
| strategy:reversal: agree | 219 | 52.05% | 47.95% | +4.11pp [-9.91pp, +17.26pp] | 1.000 | +1.39 [-8.62, +11.31] | 0/0 | 0/0 | - |
| strategy:reversal: oppose | 190 | 52.11% | 51.05% | +1.05pp [+0.00pp, +2.65pp] | n/a | +1.37 [-9.61, +12.21] | 0/0 | 0/0 | exploratory (n<200) |
| strategy:reversal: flat | 3651 | 50.07% | 49.19% | +0.88pp [-1.67pp, +3.37pp] | 1.000 | -1.30 [-3.62, +0.79] | 8/13 | 3/5 | - |
| confluenceStatus: ALIGNED_DOWN | 19 | 52.63% | 52.63% | +0.00pp [+0.00pp, +0.00pp] | n/a | +1.24 [-31.39, +30.07] | 0/0 | 0/0 | exploratory (n<200) |
| confluenceStatus: ALIGNED_UP | 32 | 65.63% | 65.63% | +0.00pp [+0.00pp, +0.00pp] | n/a | +12.62 [-3.58, +32.25] | 0/0 | 0/0 | exploratory (n<200) |
| confluenceStatus: CONFLICT_FLAT | 1509 | 50.83% | 48.91% | +1.92pp [-2.05pp, +5.83pp] | 1.000 | +0.78 [-2.54, +3.94] | 5/10 | 3/5 | - |
| confluenceStatus: NEUTRAL | 2500 | 49.72% | 49.16% | +0.56pp [-2.38pp, +3.43pp] | 1.000 | -2.32 [-5.02, +0.38] | 6/13 | 2/5 | - |

## 6. 4H confirmation (H11), provisional

#### directional days

Rows in hourly range 3475; observed 3445; skipped for missing hours 30.

| 4H state | Days | Remaining-move hit | Full-session hit (overlaps the read) | Mean remaining pips |
|---|---|---|---|---|
| supports | 1280 | 50.78% (n=1278) | 59.00% (n=1278) | -1.49 |
| neutral | 902 | 51.66% (n=902) | 50.06% (n=901) | -0.58 |
| contradicts | 1263 | 50.00% (n=1262) | 41.11% (n=1260) | -0.33 |

Supports minus contradicts, remaining move: +0.78pp [-3.80pp, +5.40pp], p=0.749 (n supports 1278, contradicts 1262). Same difference on the full session (mechanically inflated): +17.89pp. Sample adequate.

#### firing days

Rows in hourly range 3475; observed 1533; skipped for missing hours 30.

| 4H state | Days | Remaining-move hit | Full-session hit (overlaps the read) | Mean remaining pips |
|---|---|---|---|---|
| supports | 571 | 53.86% (n=570) | 61.93% (n=570) | +1.07 |
| neutral | 382 | 52.36% (n=382) | 50.26% (n=382) | +0.42 |
| contradicts | 580 | 52.59% (n=580) | 44.64% (n=578) | +4.31 |

Supports minus contradicts, remaining move: +1.27pp [-4.95pp, +7.32pp], p=0.706 (n supports 570, contradicts 580). Same difference on the full session (mechanically inflated): +17.29pp. Sample adequate.

## 7. Exploratory conditions (NOT pre-registered; outside the correction family)

The `patternVsWeeklyTrend` split was added after the first run (it showed model and baseline identical in several cells), so it is exploratory by construction.

Directional days:

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| patternVsWeeklyTrend: pattern = weekly trend | 4595 | 49.47% | 49.47% | +0.00pp [+0.00pp, +0.00pp] | n/a | -2.49 [-4.43, -0.38] | 0/13 | 0/5 | - |
| patternVsWeeklyTrend: pattern differs from weekly trend | 4693 | 50.93% | 49.07% | +1.85pp [-1.29pp, +5.24pp] | n/a | -0.15 [-2.36, +2.05] | 7/13 | 4/5 | - |
| usdExposure: USD long | 5239 | 51.08% | 48.58% | +2.50pp [+0.44pp, +4.58pp] | n/a | -1.06 [-3.22, +0.98] | 12/13 | 4/5 | - |
| usdExposure: USD short | 4049 | 49.07% | 50.16% | -1.09pp [-3.44pp, +1.45pp] | n/a | -1.64 [-3.92, +0.74] | 5/13 | 3/5 | - |
| eventOnTargetSession: FOMC/NFP session | 311 | 45.98% | 45.98% | +0.00pp [-9.56pp, +9.32pp] | n/a | -6.38 [-15.23, +3.04] | 0/0 | 0/0 | - |
| eventOnTargetSession: ordinary session | 3715 | 50.82% | 50.07% | +0.75pp [-1.83pp, +3.54pp] | n/a | -1.62 [-3.68, +0.36] | 3/5 | 3/5 | - |
| yesterday: call fades yesterday | 4526 | 51.19% | 48.59% | +2.61pp [-0.04pp, +5.17pp] | n/a | -0.92 [-2.97, +1.13] | 10/13 | 4/5 | - |
| yesterday: call follows yesterday | 4755 | 49.27% | 49.93% | -0.65pp [-2.43pp, +1.24pp] | n/a | -1.68 [-3.64, +0.23] | 7/13 | 3/5 | - |
| yesterday: flat | 7 | 42.86% | 42.86% | +0.00pp [-71.43pp, +71.43pp] | n/a | -0.14 [-26.31, +31.70] | 0/0 | 0/0 | exploratory (n<200) |
| hasStopTarget: no stop/target (n<30) | 6787 | 49.92% | 48.67% | +1.25pp [-0.56pp, +3.07pp] | n/a | -1.49 [-2.96, +0.02] | 10/13 | 3/5 | - |
| hasStopTarget: stop/target derived (n>=30) | 2501 | 50.98% | 50.90% | +0.08pp [-2.69pp, +2.83pp] | n/a | -0.84 [-3.22, +1.61] | 4/12 | 2/5 | - |
| stopOverAtr: stop<0.5 ATR | 1851 | 50.57% | 49.49% | +1.08pp [-1.96pp, +4.18pp] | n/a | -1.40 [-4.45, +1.46] | 5/9 | 3/5 | - |
| stopOverAtr: stop 0.5-0.8 ATR | 614 | 52.12% | 55.21% | -3.09pp [-9.00pp, +2.43pp] | n/a | +0.20 [-3.14, +3.64] | 1/1 | 0/4 | - |
| stopOverAtr: stop 0.8-1.2 ATR | 30 | 46.67% | 46.67% | +0.00pp [-25.00pp, +21.74pp] | n/a | +8.10 [-9.17, +23.04] | 0/0 | 0/0 | exploratory (n<200) |
| stopOverAtr: stop>=1.2 ATR | 6 | 83.33% | 66.67% | +16.67pp [+0.00pp, +20.00pp] | n/a | +23.05 [+5.50, +26.56] | 0/0 | 0/0 | exploratory (n<200) |

Firing days:

| Cell | Scored | Model hit | Weekly-trend hit | Uplift vs baseline [95% CI] | BH q | Net pips/trade [95% CI] | Years + | Pairs + | Flag |
|---|---|---|---|---|---|---|---|---|---|
| patternVsWeeklyTrend: pattern = weekly trend | 1991 | 49.47% | 49.47% | +0.00pp [+0.00pp, +0.00pp] | n/a | -1.36 [-3.93, +1.25] | 0/12 | 0/5 | - |
| patternVsWeeklyTrend: pattern differs from weekly trend | 2069 | 51.04% | 48.96% | +2.08pp [-2.43pp, +6.55pp] | n/a | -0.72 [-4.09, +2.62] | 8/13 | 3/5 | - |
| usdExposure: USD long | 2380 | 50.92% | 48.91% | +2.02pp [-1.03pp, +5.17pp] | n/a | -0.43 [-3.45, +2.40] | 8/12 | 4/5 | - |
| usdExposure: USD short | 1680 | 49.35% | 49.64% | -0.30pp [-3.88pp, +3.30pp] | n/a | -1.89 [-5.78, +1.84] | 6/12 | 3/5 | - |
| eventOnTargetSession: FOMC/NFP session | 135 | 51.11% | 44.44% | +6.67pp [-5.84pp, +20.00pp] | n/a | +0.31 [-13.36, +14.29] | 0/0 | 0/0 | exploratory (n<200) |
| eventOnTargetSession: ordinary session | 1677 | 52.12% | 49.19% | +2.92pp [-0.83pp, +6.56pp] | n/a | -0.10 [-3.02, +2.80] | 4/5 | 3/5 | - |
| yesterday: call fades yesterday | 1941 | 51.16% | 49.10% | +2.06pp [-1.45pp, +5.54pp] | n/a | -2.01 [-5.31, +1.09] | 5/12 | 4/5 | - |
| yesterday: call follows yesterday | 2114 | 49.48% | 49.34% | +0.14pp [-2.57pp, +2.87pp] | n/a | -0.14 [-2.99, +2.58] | 7/13 | 3/5 | - |
| yesterday: flat | 5 | 40.00% | 40.00% | +0.00pp [-80.00pp, +80.00pp] | n/a | +3.80 [-34.00, +48.38] | 0/0 | 0/0 | exploratory (n<200) |
| hasStopTarget: no stop/target (n<30) | 3180 | 49.91% | 48.52% | +1.38pp [-1.28pp, +3.99pp] | n/a | -1.67 [-3.94, +0.50] | 8/13 | 3/5 | - |
| hasStopTarget: stop/target derived (n>=30) | 880 | 51.59% | 51.70% | -0.11pp [-4.88pp, +4.57pp] | n/a | +1.27 [-2.72, +5.58] | 1/2 | 2/5 | - |
| stopOverAtr: stop<0.5 ATR | 634 | 52.52% | 49.84% | +2.68pp [-2.54pp, +8.05pp] | n/a | +2.43 [-2.67, +7.77] | 0/0 | 3/5 | - |
| stopOverAtr: stop 0.5-0.8 ATR | 230 | 49.13% | 56.96% | -7.83pp [-17.97pp, +1.20pp] | n/a | -1.99 [-7.67, +3.05] | 0/0 | 0/0 | - |
| stopOverAtr: stop 0.8-1.2 ATR | 13 | 38.46% | 38.46% | +0.00pp [-50.00pp, +31.58pp] | n/a | -3.47 [-27.04, +12.17] | 0/0 | 0/0 | exploratory (n<200) |
| stopOverAtr: stop>=1.2 ATR | 3 | 100.00% | 100.00% | +0.00pp [+0.00pp, +0.00pp] | n/a | +25.40 [+5.50, +35.35] | 0/0 | 0/0 | exploratory (n<200) |

## 8. Caveats

- Five USD pairs and overlapping daily windows are not independent. The block bootstrap helps but does not remove this; treat intervals as optimistic.
- The correction covers only pre-registered cells. Exploratory cells are listed for orientation; any pattern found there needs its own hypothesis and the holdout.
- Spearman intervals reuse full-sample ranks across resamples (a standard shortcut).
- Costs are published average XTB standard-account spreads (USDCHF from a search snippet); real spreads widen in fast or off-peak markets. Net expectancy is sensitive to this. The first version of this report used exec-v1 costs; hit rates are unchanged, only net pips differ.
- The hourly archive covers 2021-2024 only, so the 4H study cannot use the 2025 data and has a short history.
- The target is the session after the decision date, the live convention; RESEARCH-LOG.md shows aligning to the session labelled with the decision date does not change accuracy.
