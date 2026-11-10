<!-- LIVING-DOCS:RESEARCH-LOG -->
# RESEARCH-LOG.md — Experiments and Kill-Gate Verdicts

> Living research log (Requirement 5.2). Records every experiment and every
> Kill_Gate verdict. Kill-gate verdicts and cuts are auto-appended by the
> Living-Docs Writer (`appendVerdict()` / `appendCut()`, Requirements 5.4, 5.5).
> New entries are appended below the marker; existing entries are never
> rewritten.

## Entry Template

Every appended entry conforms to this structure (validated by
`LivingDocs.validateLogEntry()`, Requirement 6.5):

```
## [<KIND>] <configId> — <PASS|CUT>
- Date: <ISO-8601 timestamp>
- Verdict: <PASS|CUT>
- Gate 1: modelAccuracy=<n> baselineAccuracy=<n> deltaPp=<n> passed=<bool>
- Gate 2: modelRiskAdj=<n> baselineRiskAdj=<n> margin=<n> passed=<bool>
- Sample size: <n>
- Metrics: <freeform metrics summary>
```

<!-- BEGIN ENTRIES -->

## [EVALUATION] shape-only
- Date: 2026-10-08T11:11:28.849Z
- Split: trainEnd=2023-12-29 testStart=2024-01-02 testEnd=2024-12-31
- Sample size: 28470
- Predictions count: 28470
- Accuracy: model=0.499578503688093 baseline=0.487144362486828 delta=0.0124341412012645
- Friction-adjusted: model=0 baseline=0
- MFE/MAE: modelMfe=74.331 modelMae=25.2953 baselineMfe=94.3927 baselineMae=32.446
- Strength: weak=16071 moderate=12351 strong=48
- Uncertainty: accuracyDeltaCI=[0.0066, 0.0182] note=95% Wald interval on the accuracy delta from the matched subset (n=28470); half-width ±0.0058.
- Annotations (non-binding): deltaExceeds3pp=false riskAdjNonNegative=true

## [MEASUREMENT] confluence threshold calibration — 2026-11-04
- Method: replayed the four classical strategies day by day over data/*_D1.csv (5 pairs, last ~1500 trading days each, 7500 pair-days), using only candles strictly before each day; outcome = sign of the next session's open-to-close move (resolver convention). The pattern matcher cannot be replayed from candles; its reachable strength band was derived analytically from the shrinkage formula (a firing pattern, confidence >= 0.55, has strength about 0.55-0.65).
- Realized base rates: UP 0.508, DOWN 0.491, FLAT 0.001. With a true 0.5 x ATR_14 dead-band (price units) FLAT would be 0.595.
- Strength of directional calls (p50 / p75): trend 0.97 / 1.00, breakout 0.34 / 0.63, reversal 0.28 / 0.50, range 0.12 / 0.17.
- Sweep (conflict 0.3-0.6 x alignment 0.2-0.4): aligned-call hit rate 45.0%-48.0% at every setting (n=96-626 aligned calls), at or below the ~51% base rate; no threshold pair improved accuracy. Classical-only CONFLICT_FLAT frequency: 2.9% (0.3), 1.9% (0.4), 1.5% (0.5), 1.0% (0.6). ALIGNED days at alignment 0.4: 102 of 7500.
- Decision (clarity, not accuracy): conflictThreshold 0.6 -> 0.5 so a firing pattern call can count as a strong side of a conflict; alignmentThreshold unchanged at 0.4. See docs/state/DECISIONS.md.
- Caveats: classical strategies only; sample is small for the aligned subset; no edge is claimed for any setting.
## [EDGE-EVAL] evidence protocol registered - 2026-11-10
- Type: PROTOCOL (no measurement, no verdict). Source of truth: src/walk-forward/evidenceProtocol.ts (pinned by evidenceProtocol.test.ts).
- Forward test (operator-confirmed 2026-11-10): live forward evaluation begins 2026-11-11 with the params-v1 parameter set frozen (threshold 0.55, k=200, epsilon=0.2, shrinkage 10, window 60). Changing a pinned parameter resets the clock.
- Discovery window: 2013-06-01..2024-12-31 (the span the recorded [EVALUATION] pools over; all of it counts as seen). Confirmation holdout (untouched): 2025-01-02..2026-09-15.
- Pre-registered slice dimensions: pair, direction, confidenceBand, neighbourhoodSize, meanCosineDistance, atrPercentileBucket, weekday. Dimensions added later are exploratory.
- Pre-registered questions: (1) does ALIGNED_* confluence plus a firing signal beat the firing signal alone; (2) do STRONGLY_SUPPORTS days resolve better than CONTRADICTS days; (3) does the ATR-band FLAT definition beat the sign-based one on the same windows.
- Multiple testing: the number of slices examined is recorded with each result; a pocket counts only if it also holds on the confirmation holdout.
## [EDGE-EVAL] FLAT definition and label-alignment A/B 2024-01-02..2024-12-31
- Window: 2024-01-02..2024-12-31 (local in-memory stores built from data/*_D1.csv; hosted untouched). Yardstick: sign of the realised session's open-to-close move (FLAT/unavailable days excluded). Live behaviour unchanged.
- Arm live_legacy (flatBand=legacy, label=after_decision_date): analogue classes UP 51.76% DOWN 47.70% FLAT 0.54% (n=1304); days=1304 directional=916 firing(>=0.55)=416
-   directional days vs own session: scored=913 model=52.35% baseline=52.46% delta=-0.11pp raw95=[-3.35, 3.13]pp discounted(/5)95=[-7.36, 7.14]pp; UP-calls 53.54% (n=495) DOWN-calls 50.96% (n=418)
-   firing days vs own session: scored=415 model=54.22% [49.41, 58.95] baseline=52.77% delta=1.45pp discounted95=[-9.31, 12.20]pp
-   directional days vs the OTHER session (on_decision_date): scored=913 model=50.38% baseline=52.68% delta=-2.30pp
- Arm atr_band (flatBand=atr_pips, label=after_decision_date): analogue classes UP 20.32% DOWN 19.25% FLAT 60.43% (n=1304); days=1304 directional=116 firing(>=0.55)=10
-   directional days vs own session: scored=116 model=55.17% baseline=50.86% delta=4.31pp raw95=[-4.79, 13.41]pp discounted(/5)95=[-16.04, 24.66]pp; UP-calls 52.83% (n=53) DOWN-calls 57.14% (n=63)
-   firing days vs own session: scored=10 model=30.00% [10.78, 60.32] baseline=50.00% delta=-20.00pp discounted95=[-89.30, 49.30]pp
-   directional days vs the OTHER session (on_decision_date): scored=116 model=52.59% baseline=55.17% delta=-2.59pp
- Arm aligned_label (flatBand=legacy, label=on_decision_date): analogue classes UP 51.69% DOWN 47.85% FLAT 0.46% (n=1304); days=1304 directional=931 firing(>=0.55)=433
-   directional days vs own session: scored=928 model=50.54% baseline=51.83% delta=-1.29pp raw95=[-4.51, 1.92]pp discounted(/5)95=[-8.49, 5.90]pp; UP-calls 51.77% (n=508) DOWN-calls 49.05% (n=420)
-   firing days vs own session: scored=431 model=48.26% [43.58, 52.97] baseline=49.42% delta=-1.16pp discounted95=[-11.72, 9.40]pp
-   directional days vs the OTHER session (after_decision_date): scored=930 model=49.14% baseline=52.69% delta=-3.55pp
- Arm atr_band_aligned (flatBand=atr_pips, label=on_decision_date): analogue classes UP 20.48% DOWN 19.48% FLAT 60.05% (n=1304); days=1304 directional=123 firing(>=0.55)=11
-   directional days vs own session: scored=123 model=52.03% baseline=53.66% delta=-1.63pp raw95=[-10.46, 7.21]pp discounted(/5)95=[-21.38, 18.13]pp; UP-calls 50.00% (n=60) DOWN-calls 53.97% (n=63)
-   firing days vs own session: scored=11 model=36.36% [15.17, 64.62] baseline=54.55% delta=-18.18pp discounted95=[-84.25, 47.89]pp
-   directional days vs the OTHER session (after_decision_date): scored=123 model=43.90% baseline=61.79% delta=-17.89pp
- Note: evidence for human interpretation; the operator decides whether any live definition changes.

## [EDGE-EVAL] FLAT definition and label-alignment A/B 2013-06-01..2026-09-15
- Window: 2013-06-01..2026-09-15 (local in-memory stores built from data/*_D1.csv; hosted untouched). Yardstick: sign of the realised session's open-to-close move (FLAT/unavailable days excluded). Live behaviour unchanged.
- Arm live_legacy (flatBand=legacy, label=after_decision_date): analogue classes UP 50.57% DOWN 49.21% FLAT 0.22% (n=17314); days=17319 directional=10140 firing(>=0.55)=4450
-   directional days vs own session: scored=10131 model=50.09% baseline=49.06% delta=1.04pp raw95=[0.06, 2.01]pp discounted(/5)95=[-1.14, 3.21]pp; UP-calls 50.49% (n=5441) DOWN-calls 49.64% (n=4690)
-   firing days vs own session: scored=4447 model=50.51% [49.04, 51.97] baseline=48.89% delta=1.62pp discounted95=[-1.67, 4.91]pp
-   directional days vs the OTHER session (on_decision_date): scored=10132 model=49.72% baseline=49.83% delta=-0.11pp
- Arm atr_band (flatBand=atr_pips, label=after_decision_date): analogue classes UP 19.83% DOWN 20.16% FLAT 60.02% (n=17314); days=17319 directional=1833 firing(>=0.55)=176
-   directional days vs own session: scored=1831 model=49.81% baseline=49.15% delta=0.66pp raw95=[-1.63, 2.95]pp discounted(/5)95=[-4.47, 5.78]pp; UP-calls 50.78% (n=892) DOWN-calls 48.88% (n=939)
-   firing days vs own session: scored=176 model=46.59% [39.37, 53.95] baseline=49.43% delta=-2.84pp discounted95=[-19.36, 13.68]pp
-   directional days vs the OTHER session (on_decision_date): scored=1832 model=48.96% baseline=48.69% delta=0.27pp
- Arm aligned_label (flatBand=legacy, label=on_decision_date): analogue classes UP 50.57% DOWN 49.22% FLAT 0.21% (n=17314); days=17319 directional=10089 firing(>=0.55)=4319
-   directional days vs own session: scored=10082 model=50.10% baseline=50.13% delta=-0.03pp raw95=[-1.01, 0.95]pp discounted(/5)95=[-2.21, 2.15]pp; UP-calls 50.44% (n=5476) DOWN-calls 49.70% (n=4606)
-   firing days vs own session: scored=4314 model=49.70% [48.21, 51.19] baseline=49.72% delta=-0.02pp discounted95=[-3.36, 3.31]pp
-   directional days vs the OTHER session (after_decision_date): scored=10080 model=49.81% baseline=49.42% delta=0.39pp
- Arm atr_band_aligned (flatBand=atr_pips, label=on_decision_date): analogue classes UP 19.86% DOWN 20.23% FLAT 59.91% (n=17314); days=17319 directional=1802 firing(>=0.55)=150
-   directional days vs own session: scored=1801 model=48.70% baseline=50.58% delta=-1.89pp raw95=[-4.20, 0.42]pp discounted(/5)95=[-7.05, 3.28]pp; UP-calls 49.89% (n=904) DOWN-calls 47.49% (n=897)
-   firing days vs own session: scored=150 model=48.67% [40.80, 56.60] baseline=61.33% delta=-12.67pp discounted95=[-30.56, 5.23]pp
-   directional days vs the OTHER session (after_decision_date): scored=1797 model=50.25% baseline=49.08% delta=1.17pp
- Note: evidence for human interpretation; the operator decides whether any live definition changes.

## [EDGE-EVAL] local evidence run (baselines, net expectancy, pre-registered slices)
- Discovery window 2013-06-01..2024-12-31; live convention (legacy FLAT band, label after the decision date); local in-memory stores from data/*_D1.csv; hosted untouched; confirmation holdout 2025-01-02..2026-09-15 NOT consulted. Execution model exec-v1; yardstick: sign of the target session's open-to-close move.
- Records: 15095 pair-days; directional (model has a call) 8746; firing (>=0.55) 3796.
- Target = session AFTER the decision date (what the live labels and track record measure):
-   [directional] scored=8739: model 50.10% vs weekly-trend 49.42% (delta +0.68pp; raw95 [-0.37pp, +1.72pp], discounted(/5) [-1.67pp, +3.02pp])
-     model: trades=8746 hit=50.10% [49.05, 51.15] (UP-calls 50.54% n=4711, DOWN-calls 49.58% n=4028) gross=+0.12 net=-1.18 pips/trade [-2.49, +0.13] (mean cost 1.30)
-     weekly_trend: trades=8746 hit=49.42% [48.37, 50.47] (UP-calls 49.91% n=4506, DOWN-calls 48.90% n=4233) gross=-1.13 net=-2.43 pips/trade [-3.74, -1.11] (mean cost 1.30)
-     follow_yesterday: trades=8739 hit=49.23% [48.18, 50.28] (UP-calls 49.74% n=4383, DOWN-calls 48.72% n=4349) gross=-0.06 net=-1.36 pips/trade [-2.67, -0.05] (mean cost 1.30)
-     random_direction: trades=8746 hit=50.00% [48.95, 51.05] (UP-calls 0.00% n=0, DOWN-calls 0.00% n=0) gross=+0.00 net=-1.30 pips/trade [-1.30, -1.30] (mean cost 1.30)
-     always_long: trades=8746 hit=50.49% [49.44, 51.53] (UP-calls 50.49% n=8739, DOWN-calls 0.00% n=0) gross=-0.52 net=-1.83 pips/trade [-3.14, -0.51] (mean cost 1.30)
-     always_short: trades=8746 hit=49.51% [48.47, 50.56] (UP-calls 0.00% n=0, DOWN-calls 49.51% n=8739) gross=+0.52 net=-0.78 pips/trade [-2.09, +0.53] (mean cost 1.30)
-   [firing] scored=3793: model 50.33% vs weekly-trend 49.17% (delta +1.16pp; raw95 [-0.43pp, +2.75pp], discounted(/5) [-2.40pp, +4.72pp])
-     model: trades=3796 hit=50.33% [48.74, 51.92] (UP-calls 51.54% n=2045, DOWN-calls 48.91% n=1748) gross=+0.54 net=-0.76 pips/trade [-2.72, +1.19] (mean cost 1.31)
-     weekly_trend: trades=3796 hit=49.17% [47.58, 50.76] (UP-calls 50.48% n=1965, DOWN-calls 47.76% n=1828) gross=-0.52 net=-1.82 pips/trade [-3.78, +0.13] (mean cost 1.31)
-     follow_yesterday: trades=3791 hit=49.16% [47.56, 50.75] (UP-calls 50.52% n=1908, DOWN-calls 47.77% n=1880) gross=+0.97 net=-0.33 pips/trade [-2.29, +1.62] (mean cost 1.31)
-     random_direction: trades=3796 hit=50.00% [48.41, 51.59] (UP-calls 0.00% n=0, DOWN-calls 0.00% n=0) gross=+0.00 net=-1.31 pips/trade [-1.31, -1.31] (mean cost 1.31)
-     always_long: trades=3796 hit=51.33% [49.74, 52.92] (UP-calls 51.33% n=3793, DOWN-calls 0.00% n=0) gross=+1.06 net=-0.25 pips/trade [-2.20, +1.71] (mean cost 1.31)
-     always_short: trades=3796 hit=48.67% [47.08, 50.26] (UP-calls 0.00% n=0, DOWN-calls 48.67% n=3793) gross=-1.06 net=-2.36 pips/trade [-4.32, -0.41] (mean cost 1.31)
-   Directional delta vs weekly-trend by year: 2013:+3.27pp(n=397) 2014:-0.15pp(n=686) 2015:+2.40pp(n=626) 2016:+0.71pp(n=707) 2017:+1.92pp(n=781) 2018:-0.83pp(n=719) 2019:+2.94pp(n=680) 2020:-0.45pp(n=669) 2021:+2.00pp(n=751) 2022:-1.15pp(n=869) 2023:-0.43pp(n=936) 2024:+0.00pp(n=918)
- Target = session labelled WITH the decision date (the next session a trader acting on the card would actually trade):
-   [directional] scored=8739: model 49.53% vs weekly-trend 50.03% (delta -0.50pp; raw95 [-1.55pp, +0.54pp], discounted(/5) [-2.85pp, +1.84pp])
-     model: trades=8746 hit=49.53% [48.48, 50.57] (UP-calls 50.01% n=4707, DOWN-calls 48.96% n=4032) gross=-0.62 net=-1.92 pips/trade [-3.21, -0.63] (mean cost 1.30)
-     weekly_trend: trades=8746 hit=50.03% [48.98, 51.08] (UP-calls 50.50% n=4505, DOWN-calls 49.53% n=4234) gross=-0.13 net=-1.43 pips/trade [-2.72, -0.14] (mean cost 1.30)
-     follow_yesterday: trades=8739 hit=48.47% [47.42, 49.51] (UP-calls 48.93% n=4384, DOWN-calls 48.00% n=4348) gross=-1.46 net=-2.76 pips/trade [-4.05, -1.47] (mean cost 1.30)
-     random_direction: trades=8746 hit=50.00% [48.95, 51.05] (UP-calls 0.00% n=0, DOWN-calls 0.00% n=0) gross=+0.00 net=-1.30 pips/trade [-1.30, -1.30] (mean cost 1.30)
-     always_long: trades=8746 hit=50.49% [49.44, 51.53] (UP-calls 50.49% n=8739, DOWN-calls 0.00% n=0) gross=-0.31 net=-1.61 pips/trade [-2.90, -0.32] (mean cost 1.30)
-     always_short: trades=8746 hit=49.51% [48.47, 50.56] (UP-calls 0.00% n=0, DOWN-calls 49.51% n=8739) gross=+0.31 net=-0.99 pips/trade [-2.28, +0.30] (mean cost 1.30)
-   [firing] scored=3792: model 49.53% vs weekly-trend 49.21% (delta +0.32pp; raw95 [-1.27pp, +1.91pp], discounted(/5) [-3.24pp, +3.87pp])
-     model: trades=3796 hit=49.53% [47.94, 51.12] (UP-calls 49.88% n=2043, DOWN-calls 49.11% n=1749) gross=-0.96 net=-2.26 pips/trade [-4.16, -0.37] (mean cost 1.31)
-     weekly_trend: trades=3796 hit=49.21% [47.62, 50.80] (UP-calls 49.57% n=1965, DOWN-calls 48.82% n=1827) gross=-0.12 net=-1.42 pips/trade [-3.32, +0.47] (mean cost 1.31)
-     follow_yesterday: trades=3791 hit=48.64% [47.05, 50.23] (UP-calls 48.95% n=1908, DOWN-calls 48.32% n=1879) gross=-1.35 net=-2.66 pips/trade [-4.56, -0.76] (mean cost 1.31)
-     random_direction: trades=3796 hit=50.00% [48.41, 51.59] (UP-calls 0.00% n=0, DOWN-calls 0.00% n=0) gross=+0.00 net=-1.31 pips/trade [-1.31, -1.31] (mean cost 1.31)
-     always_long: trades=3796 hit=50.34% [48.75, 51.93] (UP-calls 50.34% n=3792, DOWN-calls 0.00% n=0) gross=-0.09 net=-1.40 pips/trade [-3.30, +0.50] (mean cost 1.31)
-     always_short: trades=3796 hit=49.66% [48.07, 51.25] (UP-calls 0.00% n=0, DOWN-calls 49.66% n=3792) gross=+0.09 net=-1.21 pips/trade [-3.11, +0.69] (mean cost 1.31)
-   Directional delta vs weekly-trend by year: 2013:-3.78pp(n=397) 2014:-2.77pp(n=686) 2015:+2.72pp(n=626) 2016:-3.95pp(n=708) 2017:-0.90pp(n=781) 2018:-1.11pp(n=719) 2019:+5.88pp(n=680) 2020:+2.24pp(n=669) 2021:-1.73pp(n=751) 2022:-1.50pp(n=869) 2023:+0.75pp(n=935) 2024:-2.18pp(n=918)
- Slices [directional, target=after_decision_date]: dimensions pair, direction, confidenceBand, neighbourhoodSize, meanCosineDistance, atrPercentileBucket, weekday; cells examined=28; candidate pockets (scored>=100 and delta>0)=20 (expect about half by chance alone).
-     pair=EURUSD: scored=1781 model 51.15% vs baseline 48.74% delta +2.41pp (discounted95 [-2.78pp, +7.61pp]) net -0.03 pips/trade CANDIDATE
-     pair=GBPUSD: scored=1793 model 49.58% vs baseline 50.03% delta -0.45pp (discounted95 [-5.62pp, +4.73pp]) net -1.85 pips/trade
-     pair=USDCAD: scored=1735 model 47.38% vs baseline 50.43% delta -3.05pp (discounted95 [-8.32pp, +2.21pp]) net -2.88 pips/trade
-     pair=USDCHF: scored=1776 model 51.30% vs baseline 49.27% delta +2.03pp (discounted95 [-3.17pp, +7.23pp]) net -1.04 pips/trade CANDIDATE
-     pair=USDJPY: scored=1654 model 51.09% vs baseline 48.61% delta +2.48pp (discounted95 [-2.91pp, +7.87pp]) net -0.07 pips/trade CANDIDATE
-     direction=DOWN: scored=4028 model 49.58% vs baseline 49.18% delta +0.40pp (discounted95 [-3.06pp, +3.85pp]) net -0.60 pips/trade CANDIDATE
-     direction=UP: scored=4711 model 50.54% vs baseline 49.63% delta +0.91pp (discounted95 [-2.28pp, +4.11pp]) net -1.68 pips/trade CANDIDATE
-     confidenceBand=0.50-0.55: scored=4946 model 49.92% vs baseline 49.62% delta +0.30pp (discounted95 [-2.81pp, +3.42pp]) net -1.50 pips/trade CANDIDATE
-     confidenceBand=0.55-0.60: scored=2606 model 50.50% vs baseline 49.16% delta +1.34pp (discounted95 [-2.95pp, +5.64pp]) net -1.00 pips/trade CANDIDATE
-     confidenceBand=0.60-0.65: scored=1026 model 49.42% vs baseline 49.32% delta +0.10pp (discounted95 [-6.74pp, +6.94pp]) net +0.21 pips/trade CANDIDATE
-     confidenceBand=0.65-0.70: scored=146 model 53.42% vs baseline 49.32% delta +4.11pp (discounted95 [-14.03pp, +22.24pp]) net -3.37 pips/trade CANDIDATE
-     confidenceBand=0.70-0.75: scored=15 model 53.33% vs baseline 40.00% delta +13.33pp (discounted95 [-43.25pp, +69.91pp]) net +0.07 pips/trade
-     neighbourhoodSize=n100-149: scored=378 model 52.65% vs baseline 49.21% delta +3.44pp (discounted95 [-7.83pp, +14.71pp]) net +2.21 pips/trade CANDIDATE
-     neighbourhoodSize=n150+: scored=190 model 48.42% vs baseline 46.32% delta +2.11pp (discounted95 [-13.79pp, +18.00pp]) net -6.75 pips/trade CANDIDATE
-     neighbourhoodSize=n30-59: scored=1156 model 50.78% vs baseline 51.47% delta -0.69pp (discounted95 [-7.14pp, +5.75pp]) net -0.32 pips/trade
-     neighbourhoodSize=n60-99: scored=590 model 50.17% vs baseline 53.73% delta -3.56pp (discounted95 [-12.58pp, +5.46pp]) net -1.88 pips/trade
-     neighbourhoodSize=n<30: scored=6425 model 49.87% vs baseline 48.76% delta +1.11pp (discounted95 [-1.63pp, +3.84pp]) net -1.30 pips/trade CANDIDATE
-     meanCosineDistance=dist0.10-0.15: scored=986 model 51.12% vs baseline 47.97% delta +3.14pp (discounted95 [-3.83pp, +10.12pp]) net -1.15 pips/trade CANDIDATE
-     meanCosineDistance=dist0.15+: scored=7753 model 49.97% vs baseline 49.61% delta +0.36pp (discounted95 [-2.13pp, +2.85pp]) net -1.18 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q1(low): scored=3145 model 51.13% vs baseline 48.90% delta +2.23pp (discounted95 [-1.68pp, +6.13pp]) net -0.23 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q2: scored=1677 model 50.86% vs baseline 48.48% delta +2.39pp (discounted95 [-2.97pp, +7.74pp]) net -1.39 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q3: scored=1550 model 50.19% vs baseline 51.42% delta -1.23pp (discounted95 [-6.79pp, +4.34pp]) net +0.72 pips/trade
-     atrPercentileBucket=atr-q4(high): scored=2367 model 48.12% vs baseline 49.47% delta -1.35pp (discounted95 [-5.86pp, +3.15pp]) net -3.55 pips/trade
-     weekday=Fri: scored=1718 model 52.39% vs baseline 48.14% delta +4.25pp (discounted95 [-1.04pp, +9.54pp]) net +0.72 pips/trade CANDIDATE
-     weekday=Mon: scored=1758 model 50.11% vs baseline 49.66% delta +0.46pp (discounted95 [-4.77pp, +5.68pp]) net -0.72 pips/trade CANDIDATE
-     weekday=Thu: scored=1757 model 49.52% vs baseline 48.66% delta +0.85pp (discounted95 [-4.37pp, +6.08pp]) net -2.28 pips/trade CANDIDATE
-     weekday=Tue: scored=1747 model 48.31% vs baseline 50.77% delta -2.46pp (discounted95 [-7.70pp, +2.78pp]) net -3.66 pips/trade
-     weekday=Wed: scored=1759 model 50.20% vs baseline 49.86% delta +0.34pp (discounted95 [-4.88pp, +5.57pp]) net +0.06 pips/trade CANDIDATE
- Slices [firing, target=after_decision_date]: dimensions pair, direction, confidenceBand, neighbourhoodSize, meanCosineDistance, atrPercentileBucket, weekday; cells examined=27; candidate pockets (scored>=100 and delta>0)=15 (expect about half by chance alone).
-     pair=EURUSD: scored=815 model 52.27% vs baseline 49.20% delta +3.07pp (discounted95 [-4.61pp, +10.74pp]) net +0.67 pips/trade CANDIDATE
-     pair=GBPUSD: scored=816 model 48.77% vs baseline 50.74% delta -1.96pp (discounted95 [-9.63pp, +5.71pp]) net -0.32 pips/trade
-     pair=USDCAD: scored=691 model 46.89% vs baseline 49.64% delta -2.75pp (discounted95 [-11.09pp, +5.59pp]) net -4.53 pips/trade
-     pair=USDCHF: scored=847 model 50.89% vs baseline 48.17% delta +2.72pp (discounted95 [-4.81pp, +10.24pp]) net -1.80 pips/trade CANDIDATE
-     pair=USDJPY: scored=624 model 52.88% vs baseline 47.92% delta +4.97pp (discounted95 [-3.80pp, +13.74pp]) net +2.36 pips/trade CANDIDATE
-     direction=DOWN: scored=1748 model 48.91% vs baseline 49.20% delta -0.29pp (discounted95 [-5.53pp, +4.96pp]) net -1.86 pips/trade
-     direction=UP: scored=2045 model 51.54% vs baseline 49.14% delta +2.40pp (discounted95 [-2.45pp, +7.24pp]) net +0.18 pips/trade CANDIDATE
-     confidenceBand=0.55-0.60: scored=2606 model 50.50% vs baseline 49.16% delta +1.34pp (discounted95 [-2.95pp, +5.64pp]) net -1.00 pips/trade CANDIDATE
-     confidenceBand=0.60-0.65: scored=1026 model 49.42% vs baseline 49.32% delta +0.10pp (discounted95 [-6.74pp, +6.94pp]) net +0.21 pips/trade CANDIDATE
-     confidenceBand=0.65-0.70: scored=146 model 53.42% vs baseline 49.32% delta +4.11pp (discounted95 [-14.03pp, +22.24pp]) net -3.37 pips/trade CANDIDATE
-     confidenceBand=0.70-0.75: scored=15 model 53.33% vs baseline 40.00% delta +13.33pp (discounted95 [-43.25pp, +69.91pp]) net +0.07 pips/trade
-     neighbourhoodSize=n100-149: scored=86 model 55.81% vs baseline 56.98% delta -1.16pp (discounted95 [-24.79pp, +22.47pp]) net +4.14 pips/trade
-     neighbourhoodSize=n150+: scored=26 model 38.46% vs baseline 38.46% delta +0.00pp (discounted95 [-42.98pp, +42.98pp]) net -5.97 pips/trade
-     neighbourhoodSize=n30-59: scored=505 model 50.89% vs baseline 51.49% delta -0.59pp (discounted95 [-10.35pp, +9.16pp]) net +1.64 pips/trade
-     neighbourhoodSize=n60-99: scored=179 model 54.19% vs baseline 51.40% delta +2.79pp (discounted95 [-13.59pp, +19.17pp]) net +1.55 pips/trade CANDIDATE
-     neighbourhoodSize=n<30: scored=2997 model 49.95% vs baseline 48.52% delta +1.43pp (discounted95 [-2.57pp, +5.44pp]) net -1.40 pips/trade CANDIDATE
-     meanCosineDistance=dist0.10-0.15: scored=311 model 52.09% vs baseline 49.84% delta +2.25pp (discounted95 [-10.17pp, +14.68pp]) net +2.05 pips/trade CANDIDATE
-     meanCosineDistance=dist0.15+: scored=3482 model 50.17% vs baseline 49.11% delta +1.06pp (discounted95 [-2.65pp, +4.78pp]) net -1.01 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q1(low): scored=1365 model 50.70% vs baseline 47.91% delta +2.78pp (discounted95 [-3.15pp, +8.72pp]) net +0.33 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q2: scored=756 model 50.40% vs baseline 47.88% delta +2.51pp (discounted95 [-5.46pp, +10.48pp]) net -3.11 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q3: scored=654 model 52.14% vs baseline 53.06% delta -0.92pp (discounted95 [-9.49pp, +7.65pp]) net +3.08 pips/trade
-     atrPercentileBucket=atr-q4(high): scored=1018 model 48.62% vs baseline 49.31% delta -0.69pp (discounted95 [-7.56pp, +6.18pp]) net -2.95 pips/trade
-     weekday=Fri: scored=749 model 53.40% vs baseline 46.06% delta +7.34pp (discounted95 [-0.66pp, +15.35pp]) net +2.02 pips/trade CANDIDATE
-     weekday=Mon: scored=799 model 52.19% vs baseline 50.94% delta +1.25pp (discounted95 [-6.50pp, +9.00pp]) net -0.22 pips/trade CANDIDATE
-     weekday=Thu: scored=734 model 48.77% vs baseline 49.18% delta -0.41pp (discounted95 [-8.50pp, +7.68pp]) net -0.99 pips/trade
-     weekday=Tue: scored=750 model 48.67% vs baseline 50.27% delta -1.60pp (discounted95 [-9.60pp, +6.40pp]) net -1.91 pips/trade
-     weekday=Wed: scored=761 model 48.49% vs baseline 49.28% delta -0.79pp (discounted95 [-8.73pp, +7.16pp]) net -2.72 pips/trade
- Note: evidence for human interpretation; no verdict is recorded, an unfavourable result is a valid outcome, and a candidate pocket is not a finding until it holds on the confirmation holdout.

## [MEASUREMENT] neighbourhood size at firing and what the numbers mean - 2026-11-10
- Source: the local evidence run above (discovery window 2013-06-01..2024-12-31, live convention, holdout not consulted). Nothing here changes the live system and no verdict is recorded.
- Neighbourhood size: 2,997 of 3,793 scored firing days (79%) rest on fewer than 30 analogues, so the documented "30-analogue floor enforced by the shrinkage math" does not hold in practice. With a fixed prior weight of 10, a unanimous neighbourhood of 5 earns 0.667 and one of 3 earns 0.615, both above the 0.55 firing line. The 30-analogue figure only gates the empirical SL/TP derivation. Firing days with n >= 30 scored 51.8% (about 796 days) versus 49.95% for n < 30; the difference is within noise.
- Confidence range: only 161 of 8,739 scored directional days sit at 0.65 or above (146 in 0.65-0.70, 15 in 0.70-0.75), so a "confidence >= 0.65" slice has almost no days to measure.
- Headline reproduction: on the full walk-forward span the live definition gives model 50.09% vs weekly-trend 49.06% (delta +1.04pp, raw 95% [+0.06, +2.01]pp), close to the recorded +1.24pp. The lead comes from the weekly-trend baseline sitting below 50% (anti-predictive at one session), not from the model beating a coin: the model is at 50.1%, below always-long (50.5%). Discounting n by 5 for overlap and correlated pairs widens the interval to [-1.14, +3.21]pp, which includes zero.
- After costs: model net expectancy is -1.18 pips/trade (directional) and -0.76 (firing) against a mean friction of about 1.3 pips; every comparator is also negative or within noise.
- Label alignment: moving the label to the session labelled with the decision date (aligned_label arm) gives model 50.10% and delta -0.03pp, so the one-session gap in RISKS finding 3 does not change accuracy; the live labels are internally consistent. The product copy now says "next session" while the live labels measure the session after the decision date; see RISKS.
- FLAT definition: the ATR-band arm (about 60% FLAT) gives model 49.81% vs 49.15% (delta +0.66pp, raw interval includes zero) on 1,831 directional days and 176 firing days. It does not beat the sign-based definition on any measure; the operator decides whether to change it.
- Slices: 28 cells examined in the directional subset (27 in the firing subset); 20 and 15 are "candidates" (positive delta, >= 100 scored days), about what chance alone produces. No cell's overlap-discounted interval excludes zero. Candidates have NOT been taken to the confirmation holdout.


## [EDGE-EVAL] offline ATR post-filter experiment (regime-aware neighbours)
- Window 2013-06-01..2024-12-31 (discovery only; confirmation holdout not consulted). Local in-memory stores; hosted untouched; live behaviour unchanged. Post-filter keeps neighbours whose stored ATR_14 is within the ratio of today's. Yardstick: sign of the session after the decision date, model vs weekly-trend on the same days.
- Arm off: mean n=16.2; directional days=8746 (scored 8739) model 50.10% delta +0.68pp net -1.18 pips/trade; firing days=3796 (scored 3793) model 50.33% delta +1.16pp net -0.76 pips/trade
- Arm atr_within_2x: mean n=13.8; directional days=8284 (scored 8278) model 50.11% delta +0.42pp net -1.54 pips/trade; firing days=3594 (scored 3591) model 49.68% delta +0.45pp net -1.97 pips/trade
- Arm atr_within_1.5x: mean n=9.8; directional days=7554 (scored 7547) model 50.11% delta -0.07pp net -1.04 pips/trade; firing days=3373 (scored 3369) model 50.82% delta +1.04pp net 0.14 pips/trade
- Arm atr_within_1.25x: mean n=6.0; directional days=6641 (scored 6635) model 49.48% delta -0.80pp net -2.03 pips/trade; firing days=2938 (scored 2936) model 48.98% delta -1.77pp net -2.12 pips/trade
- Note: evidence for human interpretation; a gain here is a candidate for confirmation on the untouched holdout, not a finding. Nothing is applied to the live system.
- Reading: the mean neighbourhood is only about 16 analogues at baseline (cosine radius 0.2 over 200 candidates), and every ATR band shrinks it further (to about 6 at 1.25x). None of the bands improves the delta against weekly-trend; the tightest is worst on both subsets. Within this evidence a volatility-regime post-filter is not worth promoting; it was run on the discovery window only and the confirmation holdout was not consulted.

## [EDGE-EVAL] hourly-resolved trade simulation vs close-out expectancy
- Window 2021-01-01..2024-12-31 (inside the discovery period; confirmation holdout not consulted). Hourly bars: Twelve Data, archived to local files only. Entry = open of the first session after the decision date; stop = P75 of neighbourhood MAE, target = P50 of neighbourhood MFE (RISKS finding 1 may skew both); costs exec-v1. Live behaviour unchanged.
- Firing days 1547; simulated 401; skipped: no stop/target (fewer than 30 analogues) 1146, no entry candle 0, no hourly coverage 0.
- Daily bars only: trades=401 target_first=65 stop_first=164 expired=149 ambiguous=23 (5.7%) mean net -0.39 pips/trade
- Hourly-resolved: trades=401 target_first=72 stop_first=179 expired=149 ambiguous=1 (0.2%) mean net -0.49 pips/trade
- Ambiguous daily candles: 22 ordered by the hourly bars, 1 still open (one hour touched both levels, or no usable bars).
- Same days, no stop or target (enter open, exit close): mean net +0.58 pips/trade.
- Note: evidence for human interpretation; a small simulated sample, no verdict recorded. An unfavourable result is a valid outcome.
- Reading: hourly bars order the touches on 22 of the 23 ambiguous daily candles (5.7% of simulated trades), leaving 1 still open. Only 401 of 1,547 firing days (26%) have a stop and target at all, because the empirical stop/target needs 30 or more analogues (see the neighbourhood-size finding above); the other 74% could not be simulated as stop/target trades. Mean net expectancy is -0.39 pips/trade on daily bars only (ambiguous counted as zero gross), -0.49 once ordered from hourly bars, against +0.58 for the same days with no stop or target; all three are within noise at this sample size. Hourly data covers 2021-01-01..2024-12-31 only (this plan served 2021 onward and refused a 2019 probe), so nothing earlier could be simulated.

## [EDGE-EVAL] local evidence run 2021-01-01..2024-12-31 (baselines, net expectancy, pre-registered slices, event-day split)
- Discovery window 2021-01-01..2024-12-31; live convention (legacy FLAT band, label after the decision date); local in-memory stores from data/*_D1.csv; hosted untouched; confirmation holdout 2025-01-02..2026-09-15 NOT consulted. Execution model exec-v1; yardstick: sign of the target session's open-to-close move.
- Records: 5209 pair-days; directional (model has a call) 3480; firing (>=0.55) 1547.
- Target = session AFTER the decision date (what the live labels and track record measure):
-   [directional] scored=3474: model 50.20% vs weekly-trend 50.17% (delta +0.03pp; raw95 [-1.63pp, +1.69pp], discounted(/5) [-3.69pp, +3.75pp])
-     model: trades=3480 hit=50.20% [48.54, 51.86] (UP-calls 50.34% n=1901, DOWN-calls 50.03% n=1573) gross=-0.78 net=-2.07 pips/trade [-4.20, +0.05] (mean cost 1.29)
-     weekly_trend: trades=3480 hit=50.17% [48.51, 51.83] (UP-calls 50.33% n=1830, DOWN-calls 50.00% n=1644) gross=-1.10 net=-2.38 pips/trade [-4.51, -0.26] (mean cost 1.29)
-     follow_yesterday: trades=3474 hit=48.10% [46.44, 49.76] (UP-calls 48.34% n=1746, DOWN-calls 47.85% n=1722) gross=-2.69 net=-3.98 pips/trade [-6.11, -1.85] (mean cost 1.29)
-     random_direction: trades=3480 hit=50.00% [48.34, 51.66] (UP-calls 0.00% n=0, DOWN-calls 0.00% n=0) gross=+0.00 net=-1.29 pips/trade [-1.29, -1.29] (mean cost 1.29)
-     always_long: trades=3480 hit=50.17% [48.51, 51.83] (UP-calls 50.17% n=3474, DOWN-calls 0.00% n=0) gross=-1.00 net=-2.29 pips/trade [-4.42, -0.17] (mean cost 1.29)
-     always_short: trades=3480 hit=49.83% [48.17, 51.49] (UP-calls 0.00% n=0, DOWN-calls 49.83% n=3474) gross=+1.00 net=-0.29 pips/trade [-2.41, +1.84] (mean cost 1.29)
-   [firing] scored=1544: model 52.46% vs weekly-trend 48.64% (delta +3.82pp; raw95 [+1.33pp, +6.32pp], discounted(/5) [-1.76pp, +9.40pp])
-     model: trades=1547 hit=52.46% [49.97, 54.94] (UP-calls 53.17% n=837, DOWN-calls 51.63% n=707) gross=+1.76 net=+0.46 pips/trade [-2.51, +3.44] (mean cost 1.30)
-     weekly_trend: trades=1547 hit=48.64% [46.15, 51.13] (UP-calls 49.64% n=830, DOWN-calls 47.48% n=714) gross=-1.87 net=-3.17 pips/trade [-6.14, -0.20] (mean cost 1.30)
-     follow_yesterday: trades=1542 hit=47.04% [44.56, 49.54] (UP-calls 48.15% n=783, DOWN-calls 45.90% n=756) gross=-3.42 net=-4.71 pips/trade [-7.69, -1.74] (mean cost 1.30)
-     random_direction: trades=1547 hit=50.03% [47.54, 52.52] (UP-calls 0.00% n=0, DOWN-calls 0.00% n=0) gross=+0.00 net=-1.30 pips/trade [-1.30, -1.30] (mean cost 1.30)
-     always_long: trades=1547 hit=50.97% [48.48, 53.46] (UP-calls 50.97% n=1544, DOWN-calls 0.00% n=0) gross=+1.18 net=-0.12 pips/trade [-3.09, +2.86] (mean cost 1.30)
-     always_short: trades=1547 hit=49.03% [46.54, 51.52] (UP-calls 0.00% n=0, DOWN-calls 49.03% n=1544) gross=-1.18 net=-2.47 pips/trade [-5.45, +0.50] (mean cost 1.30)
-   Directional delta vs weekly-trend by year: 2021:+2.00pp(n=751) 2022:-1.15pp(n=869) 2023:-0.43pp(n=936) 2024:+0.00pp(n=918)
- Target = session labelled WITH the decision date (the next session a trader acting on the card would actually trade):
-   [directional] scored=3473: model 49.96% vs weekly-trend 51.08% (delta -1.12pp; raw95 [-2.79pp, +0.54pp], discounted(/5) [-4.84pp, +2.60pp])
-     model: trades=3480 hit=49.96% [48.29, 51.62] (UP-calls 50.55% n=1897, DOWN-calls 49.24% n=1576) gross=-0.23 net=-1.52 pips/trade [-3.59, +0.55] (mean cost 1.29)
-     weekly_trend: trades=3480 hit=51.08% [49.42, 52.74] (UP-calls 51.64% n=1828, DOWN-calls 50.46% n=1645) gross=+0.21 net=-1.08 pips/trade [-3.15, +0.99] (mean cost 1.29)
-     follow_yesterday: trades=3474 hit=49.93% [48.26, 51.59] (UP-calls 50.52% n=1746, DOWN-calls 49.33% n=1721) gross=-0.12 net=-1.41 pips/trade [-3.48, +0.66] (mean cost 1.29)
-     random_direction: trades=3480 hit=50.00% [48.34, 51.66] (UP-calls 0.00% n=0, DOWN-calls 0.00% n=0) gross=+0.00 net=-1.29 pips/trade [-1.29, -1.29] (mean cost 1.29)
-     always_long: trades=3480 hit=50.65% [48.99, 52.31] (UP-calls 50.65% n=3473, DOWN-calls 0.00% n=0) gross=-0.08 net=-1.37 pips/trade [-3.44, +0.70] (mean cost 1.29)
-     always_short: trades=3480 hit=49.35% [47.69, 51.01] (UP-calls 0.00% n=0, DOWN-calls 49.35% n=3473) gross=+0.08 net=-1.21 pips/trade [-3.28, +0.86] (mean cost 1.29)
-   [firing] scored=1543: model 49.77% vs weekly-trend 51.26% (delta -1.49pp; raw95 [-3.99pp, +1.00pp], discounted(/5) [-7.07pp, +4.09pp])
-     model: trades=1547 hit=49.77% [47.28, 52.27] (UP-calls 52.46% n=835, DOWN-calls 46.61% n=708) gross=-0.74 net=-2.04 pips/trade [-4.95, +0.87] (mean cost 1.30)
-     weekly_trend: trades=1547 hit=51.26% [48.77, 53.75] (UP-calls 53.86% n=830, DOWN-calls 48.25% n=713) gross=+0.77 net=-0.52 pips/trade [-3.43, +2.38] (mean cost 1.30)
-     follow_yesterday: trades=1542 hit=50.65% [48.15, 53.14] (UP-calls 53.38% n=783, DOWN-calls 47.81% n=755) gross=+1.13 net=-0.16 pips/trade [-3.07, +2.75] (mean cost 1.30)
-     random_direction: trades=1547 hit=50.03% [47.54, 52.52] (UP-calls 0.00% n=0, DOWN-calls 0.00% n=0) gross=+0.00 net=-1.30 pips/trade [-1.30, -1.30] (mean cost 1.30)
-     always_long: trades=1547 hit=52.88% [50.39, 55.36] (UP-calls 52.88% n=1543, DOWN-calls 0.00% n=0) gross=+2.02 net=+0.73 pips/trade [-2.18, +3.63] (mean cost 1.30)
-     always_short: trades=1547 hit=47.12% [44.64, 49.61] (UP-calls 0.00% n=0, DOWN-calls 47.12% n=1543) gross=-2.02 net=-3.32 pips/trade [-6.22, -0.41] (mean cost 1.30)
-   Directional delta vs weekly-trend by year: 2021:-1.73pp(n=751) 2022:-1.50pp(n=869) 2023:+0.75pp(n=935) 2024:-2.18pp(n=918)
- Slices [directional, target=after_decision_date]: dimensions pair, direction, confidenceBand, neighbourhoodSize, meanCosineDistance, atrPercentileBucket, weekday; cells examined=28; candidate pockets (scored>=100 and delta>0)=13 (expect about half by chance alone).
-     pair=EURUSD: scored=736 model 49.46% vs baseline 48.91% delta +0.54pp (discounted95 [-7.53pp, +8.62pp]) net -2.94 pips/trade CANDIDATE
-     pair=GBPUSD: scored=718 model 49.44% vs baseline 50.97% delta -1.53pp (discounted95 [-9.71pp, +6.65pp]) net -3.80 pips/trade
-     pair=USDCAD: scored=615 model 48.78% vs baseline 49.92% delta -1.14pp (discounted95 [-9.97pp, +7.70pp]) net -1.78 pips/trade
-     pair=USDCHF: scored=678 model 50.88% vs baseline 52.36% delta -1.47pp (discounted95 [-9.89pp, +6.94pp]) net -2.10 pips/trade
-     pair=USDJPY: scored=727 model 52.27% vs baseline 48.83% delta +3.44pp (discounted95 [-4.69pp, +11.57pp]) net +0.28 pips/trade CANDIDATE
-     direction=DOWN: scored=1573 model 50.03% vs baseline 49.08% delta +0.95pp (discounted95 [-4.57pp, +6.48pp]) net -1.04 pips/trade CANDIDATE
-     direction=UP: scored=1901 model 50.34% vs baseline 51.08% delta -0.74pp (discounted95 [-5.76pp, +4.29pp]) net -2.93 pips/trade
-     confidenceBand=0.50-0.55: scored=1930 model 48.39% vs baseline 51.40% delta -3.01pp (discounted95 [-7.99pp, +1.98pp]) net -4.10 pips/trade
-     confidenceBand=0.55-0.60: scored=1063 model 53.43% vs baseline 48.54% delta +4.89pp (discounted95 [-1.83pp, +11.61pp]) net -0.26 pips/trade CANDIDATE
-     confidenceBand=0.60-0.65: scored=403 model 50.62% vs baseline 49.38% delta +1.24pp (discounted95 [-9.67pp, +12.16pp]) net +3.63 pips/trade CANDIDATE
-     confidenceBand=0.65-0.70: scored=71 model 47.89% vs baseline 47.89% delta +0.00pp (discounted95 [-26.01pp, +26.01pp]) net -6.67 pips/trade
-     confidenceBand=0.70-0.75: scored=7 model 57.14% vs baseline 28.57% delta +28.57pp (discounted95 [-54.25pp, +111.40pp]) net +0.56 pips/trade
-     neighbourhoodSize=n100-149: scored=204 model 53.92% vs baseline 50.98% delta +2.94pp (discounted95 [-12.40pp, +18.28pp]) net -0.91 pips/trade CANDIDATE
-     neighbourhoodSize=n150+: scored=169 model 49.70% vs baseline 46.75% delta +2.96pp (discounted95 [-13.90pp, +19.81pp]) net -5.00 pips/trade CANDIDATE
-     neighbourhoodSize=n30-59: scored=564 model 50.18% vs baseline 51.42% delta -1.24pp (discounted95 [-10.47pp, +7.99pp]) net -3.41 pips/trade
-     neighbourhoodSize=n60-99: scored=270 model 49.26% vs baseline 50.74% delta -1.48pp (discounted95 [-14.82pp, +11.85pp]) net -3.00 pips/trade
-     neighbourhoodSize=n<30: scored=2267 model 50.02% vs baseline 49.98% delta +0.04pp (discounted95 [-4.56pp, +4.65pp]) net -1.51 pips/trade CANDIDATE
-     meanCosineDistance=dist0.10-0.15: scored=295 model 50.85% vs baseline 47.12% delta +3.73pp (discounted95 [-9.03pp, +16.49pp]) net -3.63 pips/trade CANDIDATE
-     meanCosineDistance=dist0.15+: scored=3179 model 50.14% vs baseline 50.46% delta -0.31pp (discounted95 [-4.20pp, +3.57pp]) net -1.93 pips/trade
-     atrPercentileBucket=atr-q1(low): scored=1277 model 52.94% vs baseline 48.94% delta +3.99pp (discounted95 [-2.14pp, +10.13pp]) net -0.85 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q2: scored=664 model 50.75% vs baseline 51.05% delta -0.30pp (discounted95 [-8.81pp, +8.20pp]) net -1.16 pips/trade
-     atrPercentileBucket=atr-q3: scored=550 model 48.18% vs baseline 52.73% delta -4.55pp (discounted95 [-13.89pp, +4.80pp]) net -2.98 pips/trade
-     atrPercentileBucket=atr-q4(high): scored=983 model 47.41% vs baseline 49.75% delta -2.34pp (discounted95 [-9.33pp, +4.65pp]) net -3.77 pips/trade
-     weekday=Fri: scored=681 model 51.25% vs baseline 49.78% delta +1.47pp (discounted95 [-6.93pp, +9.87pp]) net -1.41 pips/trade CANDIDATE
-     weekday=Mon: scored=693 model 52.96% vs baseline 52.53% delta +0.43pp (discounted95 [-7.89pp, +8.76pp]) net +0.60 pips/trade CANDIDATE
-     weekday=Thu: scored=711 model 47.82% vs baseline 47.26% delta +0.56pp (discounted95 [-7.66pp, +8.78pp]) net -4.35 pips/trade CANDIDATE
-     weekday=Tue: scored=678 model 49.41% vs baseline 49.41% delta +0.00pp (discounted95 [-8.42pp, +8.42pp]) net -2.02 pips/trade
-     weekday=Wed: scored=711 model 49.65% vs baseline 51.90% delta -2.25pp (discounted95 [-10.47pp, +5.97pp]) net -3.08 pips/trade
- Slices [firing, target=after_decision_date]: dimensions pair, direction, confidenceBand, neighbourhoodSize, meanCosineDistance, atrPercentileBucket, weekday; cells examined=27; candidate pockets (scored>=100 and delta>0)=19 (expect about half by chance alone).
-     pair=EURUSD: scored=352 model 51.70% vs baseline 48.86% delta +2.84pp (discounted95 [-8.84pp, +14.52pp]) net +0.20 pips/trade CANDIDATE
-     pair=GBPUSD: scored=337 model 48.96% vs baseline 51.63% delta -2.67pp (discounted95 [-14.61pp, +9.27pp]) net -0.98 pips/trade
-     pair=USDCAD: scored=245 model 50.20% vs baseline 46.12% delta +4.08pp (discounted95 [-9.92pp, +18.08pp]) net -0.38 pips/trade CANDIDATE
-     pair=USDCHF: scored=345 model 53.62% vs baseline 48.70% delta +4.93pp (discounted95 [-6.87pp, +16.73pp]) net -1.70 pips/trade CANDIDATE
-     pair=USDJPY: scored=265 model 58.49% vs baseline 46.79% delta +11.70pp (discounted95 [-1.76pp, +25.16pp]) net +6.25 pips/trade CANDIDATE
-     direction=DOWN: scored=707 model 51.63% vs baseline 48.09% delta +3.54pp (discounted95 [-4.71pp, +11.78pp]) net -0.66 pips/trade CANDIDATE
-     direction=UP: scored=837 model 53.17% vs baseline 49.10% delta +4.06pp (discounted95 [-3.51pp, +11.64pp]) net +1.42 pips/trade CANDIDATE
-     confidenceBand=0.55-0.60: scored=1063 model 53.43% vs baseline 48.54% delta +4.89pp (discounted95 [-1.83pp, +11.61pp]) net -0.26 pips/trade CANDIDATE
-     confidenceBand=0.60-0.65: scored=403 model 50.62% vs baseline 49.38% delta +1.24pp (discounted95 [-9.67pp, +12.16pp]) net +3.63 pips/trade CANDIDATE
-     confidenceBand=0.65-0.70: scored=71 model 47.89% vs baseline 47.89% delta +0.00pp (discounted95 [-26.01pp, +26.01pp]) net -6.67 pips/trade
-     confidenceBand=0.70-0.75: scored=7 model 57.14% vs baseline 28.57% delta +28.57pp (discounted95 [-54.25pp, +111.40pp]) net +0.56 pips/trade
-     neighbourhoodSize=n100-149: scored=44 model 63.64% vs baseline 65.91% delta -2.27pp (discounted95 [-35.31pp, +30.76pp]) net +3.84 pips/trade
-     neighbourhoodSize=n150+: scored=22 model 40.91% vs baseline 40.91% delta +0.00pp (discounted95 [-46.72pp, +46.72pp]) net -5.75 pips/trade
-     neighbourhoodSize=n30-59: scored=244 model 51.64% vs baseline 50.82% delta +0.82pp (discounted95 [-13.21pp, +14.85pp]) net +0.05 pips/trade CANDIDATE
-     neighbourhoodSize=n60-99: scored=90 model 56.67% vs baseline 45.56% delta +11.11pp (discounted95 [-11.99pp, +34.21pp]) net +2.03 pips/trade
-     neighbourhoodSize=n<30: scored=1144 model 52.10% vs baseline 47.90% delta +4.20pp (discounted95 [-2.28pp, +10.67pp]) net +0.42 pips/trade CANDIDATE
-     meanCosineDistance=dist0.10-0.15: scored=71 model 52.11% vs baseline 49.30% delta +2.82pp (discounted95 [-23.19pp, +28.82pp]) net -2.31 pips/trade
-     meanCosineDistance=dist0.15+: scored=1473 model 52.48% vs baseline 48.61% delta +3.87pp (discounted95 [-1.84pp, +9.58pp]) net +0.60 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q1(low): scored=576 model 54.34% vs baseline 46.01% delta +8.33pp (discounted95 [-0.80pp, +17.46pp]) net -0.48 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q2: scored=325 model 53.54% vs baseline 52.00% delta +1.54pp (discounted95 [-10.62pp, +13.69pp]) net +0.85 pips/trade CANDIDATE
-     atrPercentileBucket=atr-q3: scored=231 model 48.92% vs baseline 51.52% delta -2.60pp (discounted95 [-17.02pp, +11.82pp]) net -1.79 pips/trade
-     atrPercentileBucket=atr-q4(high): scored=412 model 50.97% vs baseline 48.06% delta +2.91pp (discounted95 [-7.88pp, +13.71pp]) net +2.75 pips/trade CANDIDATE
-     weekday=Fri: scored=314 model 51.27% vs baseline 46.82% delta +4.46pp (discounted95 [-7.91pp, +16.82pp]) net -0.74 pips/trade CANDIDATE
-     weekday=Mon: scored=317 model 55.21% vs baseline 53.00% delta +2.21pp (discounted95 [-10.10pp, +14.52pp]) net -1.50 pips/trade CANDIDATE
-     weekday=Thu: scored=303 model 51.49% vs baseline 44.88% delta +6.60pp (discounted95 [-5.99pp, +19.19pp]) net +2.16 pips/trade CANDIDATE
-     weekday=Tue: scored=315 model 53.02% vs baseline 48.57% delta +4.44pp (discounted95 [-7.90pp, +16.79pp]) net +3.34 pips/trade CANDIDATE
-     weekday=Wed: scored=295 model 51.19% vs baseline 49.83% delta +1.36pp (discounted95 [-11.40pp, +14.11pp]) net -0.95 pips/trade CANDIDATE
- Event-day split [directional, from 2021-01-01; event = FOMC decision or US jobs report (rule-derived; ECB excluded, its history is not listed)]:
-     event days: days=269 scored=266 model 51.88% vs weekly-trend 47.74% (delta +4.14pp) net -1.35 pips/trade
-     ordinary days: days=3211 scored=3208 model 50.06% vs weekly-trend 50.37% (delta -0.31pp) net -2.13 pips/trade
- Event-day split [firing, from 2021-01-01; event = FOMC decision or US jobs report (rule-derived; ECB excluded, its history is not listed)]:
-     event days: days=100 scored=99 model 50.51% vs weekly-trend 43.43% (delta +7.07pp) net +1.21 pips/trade
-     ordinary days: days=1447 scored=1445 model 52.60% vs weekly-trend 49.00% (delta +3.60pp) net +0.41 pips/trade
- Note: evidence for human interpretation; no verdict is recorded, an unfavourable result is a valid outcome, and a candidate pocket is not a finding until it holds on the confirmation holdout.
- Reading (event-day split): this split was NOT in the pre-registered dimension list, so it is exploratory. Event days are few (266 directional / 99 firing scored days), the model-vs-baseline delta on event days (+4.14pp directional, +7.07pp firing) comes with intervals that include zero, and the same direction of difference is present on ordinary days for the firing subset (+3.60pp). No conclusion; the calendar stays a caution flag. ECB history is not in the list, so "event day" here is FOMC decisions and rule-derived US jobs reports only.

## [EDGE-EVAL] research evidence report 1 (conditional performance, exploration 2013-06-01..2025-09-15)
- Exploration window 2013-06-01..2025-09-15; locked holdout NOT read. Full report: docs/research/EVIDENCE-REPORT-1.md.
- Directional: scored=9288 model 50.20% vs weekly-trend 49.27% (uplift 0.94pp), net -1.11 pips/trade after exec-v1 costs.
- Firing: scored=4060 model 50.27% vs weekly-trend 49.21% (uplift 1.06pp), net -0.84 pips/trade after exec-v1 costs.
- Cells examined in the pre-registered family: directional 63, firing 58. Candidate edges passing every bar (BH-significant, net > 0 with lower bound > 0, stable): directional 0, firing 0.
- Note: evidence for human interpretation; no verdict is recorded and an unfavourable result is a valid outcome. Candidates are not findings until they hold on the locked holdout.

## [EDGE-EVAL] research evidence report 1 (conditional performance, exploration 2013-06-01..2025-09-15)
- Exploration window 2013-06-01..2025-09-15; locked holdout NOT read. Full report: docs/research/EVIDENCE-REPORT-1.md.
- Directional: scored=9288 model 50.20% vs weekly-trend 49.27% (uplift 0.94pp), net -1.31 pips/trade after xtb-standard-v1 costs.
- Firing: scored=4060 model 50.27% vs weekly-trend 49.21% (uplift 1.06pp), net -1.03 pips/trade after xtb-standard-v1 costs.
- Cells examined in the pre-registered family: directional 63, firing 58. Candidate edges passing every bar (BH-significant, net > 0 with lower bound > 0, stable): directional 0, firing 0.
- Note: evidence for human interpretation; no verdict is recorded and an unfavourable result is a valid outcome. Candidates are not findings until they hold on the locked holdout.

## [EDGE-EVAL] research evidence report 2 (setup families, chart features, encoding variants; xtb-standard-v1 costs)
- Exploration window 2013-06-01..2025-09-15; locked holdout NOT read. Costs xtb-standard-v1. Full report: docs/research/EVIDENCE-REPORT-2.md.
- Setup families: trend scored=11785 hit 50.42% net -1.41; breakout scored=2095 hit 47.78% net -2.74; range scored=580 hit 51.55% net -3.29; reversal scored=1142 hit 49.56% net -2.44; pattern scored=9288 hit 50.20% net -1.31.
- Feature tests significant after Benjamini-Hochberg (20 tests): none.
- Encoding variants promising (significant over control, uplift > 0, net lower bound > 0): none.
- Note: evidence for human interpretation; no verdict is recorded and an unfavourable result is a valid outcome. Candidates are not findings until they hold on the locked holdout.

## [EDGE-EVAL] research evidence report 3 (multi-day horizons and target-before-stop; xtb-standard-v1 costs)
- Exploration window 2013-06-01..2025-09-15 (every outcome window closes inside it); locked holdout NOT read. Costs xtb-standard-v1, swap not modelled. Full report: docs/research/EVIDENCE-REPORT-3.md.
- Directional uplift over weekly trend (H3/H5/BR x V0/V0b/V1): V0/H3 +1.35pp net -1.66; V0/H5 +0.99pp net -2.37; V0/BR +1.29pp net -1.04; V0b/H3 +0.55pp net -3.70; V0b/H5 +0.47pp net -3.73; V0b/BR -0.06pp net -2.70; V1/H3 +1.34pp net -0.27; V1/H5 +0.35pp net -2.17; V1/BR +0.40pp net -2.18.
- Family U significant: none; family C (confidence ranks) significant: none; promising: none.
- Note: evidence for human interpretation; no verdict is recorded and an unfavourable result is a valid outcome. Candidates are not findings until they hold on the locked holdout.

## [EDGE-EVAL] research evidence report 4 (rule strategies on 3/5-session and bracket outcomes; xtb-standard-v1 costs)
- Exploration window 2013-06-01..2025-09-15 (every outcome window closes inside it); locked holdout NOT read. Costs xtb-standard-v1, swap not modelled. Full report: docs/research/EVIDENCE-REPORT-4.md.
- Excess hit over long/short-mix expectation (H3/H5/BR): trend/H3 -0.25pp net -0.83; trend/H5 +0.09pp net 0.50; trend/BR +0.22pp net -1.76; breakout/H3 -1.82pp net -3.51; breakout/H5 -1.81pp net -8.76; breakout/BR -0.97pp net -4.09; range/H3 +0.67pp net -6.51; range/H5 +1.86pp net 1.57; range/BR -1.65pp net -5.47; reversal/H3 +3.20pp net 5.40; reversal/H5 +5.03pp net 17.30; reversal/BR +2.95pp net 3.53.
- Significant (BH, 12 tests): none; promising: none.
- Note: evidence for human interpretation; no verdict is recorded and an unfavourable result is a valid outcome. Candidates are not findings until they hold on the locked holdout.

## [MEASUREMENT] edge research programme - consolidated summary - 2026-11-10
- Purpose: one self-contained summary of the four research reports above, for readers who do not have `docs/research/`. Measurement only; no verdict.
- Reading the entries above: the FIRST "research evidence report 1" entry used the older exec-v1 costs (1.0-1.5 pips per trade); the SECOND supersedes it for net figures (xtb-standard-v1). Hit rates are identical in both.
- Data and windows: daily candles for EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD from data/*_D1.csv (2010-09 to 2026-09-15). Exploration 2013-06-01..2025-09-15 (16,015 pair-days). Locked holdout 2025-09-16..2026-09-15, not read by any analysis (2025-09-16 was read once as an outcome in Reports 1 and 2). Analogues for a date only ever come from strictly earlier dates. Reconciliation: rows up to 2024-12-31 reproduce the earlier local evidence run exactly (15,095 pair-days, 8,746 directional, 3,796 firing, 8,739 scored, 50.10%).
- Conventions: the trade enters at the open of the session after the decision date. Hit = the call's direction equals the realised sign (zero moves excluded). Net = signed pips in the call's direction minus cost (xtb-standard-v1: EURUSD 1.0, GBPUSD 1.2, USDJPY 1.3, USDCHF 2.1, USDCAD 1.9 pips; spread-only standard account from BrokerChooser averages, plus 0.2-0.3 pips slippage). Overnight swap not modelled. Baseline = weekly-trend sign (5-day change) on the same days.
- Statistics: block bootstrap (2000 resamples, fixed seed) with calendar-week blocks (Reports 1-2) or calendar-month blocks (Reports 3-4, for overlapping multi-day windows); Benjamini-Hochberg at q = 0.10 within each pre-registered family; a cell needs 200 scored days to be called significant. A null-data calibration check rejected a true null at 3-6% (nominal 5%).
- Report 1 (pattern, next session, 2013-06..2025-09): directional days model 50.20% vs weekly-trend 49.27% (+0.94pp, 95% CI -0.68 to +2.55), net -1.31 pips/trade; firing days (confidence >= 0.55) 50.27% vs 49.21%, net -1.03. Hypotheses H1-H10 (hit rises with analogue count, nearest/mean similarity, Earned_Confidence, raw and closest-10 agreement, rule-strategy agreement; differs with efficiency ratio and ATR percentile): all Spearman rho within +-0.02, none significant. Confidence bands: 0.50-0.55 50.15%, 0.55-0.60 50.54%, 0.60-0.65 49.27% (0.65+ has 172 days). Analogue-count bands: no gradient (n<10 50.16%, n100+ 51.20%, all CIs straddle zero uplift). The pattern call equals the weekly-trend sign on 49.5% of directional days (uplift zero there by construction); on the other half it hits 50.93% vs 49.07%. 4H validation (2021-2024 hourly archive): supports-minus-contradicts on the full session +17.9pp is mechanical (the 04:00-07:00 UTC read is inside the scored session); on the move remaining after the read +0.78pp (CI -3.68 to +5.52, p = 0.72).
- Report 2 (rule-strategy setups and chart features, next session): standalone hit on their own signal days: trend 50.42% (n = 11,785), breakout 47.78% (2,095), range 51.55% (580), reversal 49.56% (1,142); net -1.4 to -3.3 pips/trade. 20 pre-registered feature tests (4 per family: e.g. compression and channel excursion for breakout, range position and wick rejection for range, distance from SMA20 and wick rejection for reversal): none significant (largest rho 0.072, q = 0.69). Encodings at fixed k = 30: live shape 49.77%; shape + 13 chart features 50.37% (+0.69pp paired, q = 0.25); features only 48.69% (significantly worse, -1.37pp, q = 0.09); no weekly-trend prefilter 49.74-49.82% (no help).
- Report 3 (pattern on 3- and 5-session holds and a symmetric 1 x ATR target-before-stop bracket within 5 sessions; each call from the analogues' own result for that outcome, an analogue voting only once its outcome window had closed): all hit rates 49.7%-50.9%; best uplift live pattern 3-session +1.35pp (q = 0.73); net negative in all 9 pre-registered cells (best -0.27 pips/trade); confidence does not rank outcomes at any horizon. Bracket: 71 of 9,340 days had a candle touching both sides (counted as losses).
- Report 4 (four rule strategies, live settings, fixed exits; statistic = hit minus the hit expected from the strategy's own long/short mix on the same days): trend excess -0.25 / +0.09 / +0.22pp (3-session / 5-session / bracket); breakout -1.82 / -1.81 / -0.97pp (5-session net -8.76); range +0.67 / +1.86 / -1.65pp (only 581 trades); reversal +3.20 / +5.03 / +2.95pp. None significant after correction (12 tests). Reversal 5-session detail: 1,143 trades, hit 54.94% vs 49.91% expected, excess CI +0.94 to +9.44pp, net +17.30 pips/trade (CI +3.37 to +31.91), positive on 5/5 pairs, BH q = 0.23, only 4 calendar years with 100+ trades (2 positive). Its 3-session, 5-session and bracket cells share entries, so they are not independent.
- Interpretation offered for review (not a verdict): no tested combination of the analogue pattern, the four rule strategies, trader's-eye chart features, longer holds or a bracket shows a cost-surviving edge that survives multiple-testing correction at daily frequency on these pairs. The reversal 5-session result is the only lead; the 12-month holdout would hold about 95 such trades, too few to confirm a 5pp effect, so a forward paper record of that single frozen rule is the proposed way to test it. Not tested: intraday timing, other instruments, carry/swap, non-price inputs, parameter tuning.

<!-- END ENTRIES -->
