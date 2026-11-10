# Evidence Report 4: the four rule strategies held 3 and 5 sessions, and with a bracket

Generated 2026-11-10. Exploration window 2013-06-01..2025-09-15; every outcome window closes inside it. The locked holdout 2025-09-16..2026-09-15 was NOT read. No verdict is recorded; an unfavourable result is a valid outcome. Nothing here changes the live system. Design: docs/research/PRE-REGISTRATION-4.md (written before any result).

## How to read this

- **Trade:** any day the strategy (live default configuration) says UP or DOWN; entry at the next session's open. Outcomes as in Report 3: H1 next session (reference), H3 / H5 hold 3 / 5 sessions, BR 1 x ATR target and stop within 5 sessions (ambiguous = loss).
- **Expected from long/short mix:** the hit rate a call with no timing skill would get, given how often the strategy was long and how often the market went up on those same days. **Excess** = hit minus that. This is the pre-registered test (family of 12, BH at q = 0.1), because a strategy can beat 50% just by leaning with a trend.
- **Costs:** xtb-standard-v1 (EURUSD 1.0, GBPUSD 1.2, USDJPY 1.3, USDCHF 2.1, USDCAD 1.9 pips per trade); swap not modelled. Signals on consecutive days give overlapping trades; intervals use month blocks (2000 resamples).

## Summary

- Significant excess (family of 12): none.
- Promising (significant positive excess, net lower bound above zero, positive in at least 60% of years and pairs): none.

## Results

| Strategy | Outcome | Trades | Scored | Hit [95% CI] | Expected from long/short mix | Excess [95% CI] | BH q (12) | Uplift vs weekly trend | Net pips/trade [95% CI] | UP calls / UP outcomes | Years + | Pairs + | Flags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| trend | H1 | 11770 | 11763 | 50.40% [49.17%, 51.51%] | 50.05% | +0.35pp [-0.75pp, +1.47pp] | ref | +0.72pp | -1.44 [-3.01, +0.13] | 53.36% / 50.72% | 9/13 | 4/5 | - |
| trend | H3 | 11770 | 11762 | 49.80% [48.13%, 51.45%] | 50.05% | -0.25pp [-1.93pp, +1.53pp] | 0.945 | -0.04pp | -0.83 [-4.84, +3.20] | 53.37% / 50.72% | 6/13 | 2/5 | - |
| trend | H5 | 11770 | 11766 | 50.13% [47.87%, 52.33%] | 50.04% | +0.09pp [-2.06pp, +2.22pp] | 0.945 | +0.70pp | +0.50 [-5.76, +6.56] | 53.35% / 50.58% | 5/13 | 2/5 | - |
| trend | BR | 11770 | 9995 | 50.27% [48.04%, 52.36%] | 50.04% | +0.22pp [-1.85pp, +2.31pp] | 0.945 | +0.54pp | -1.76 [-4.95, +1.60] | 53.78% / 50.57% | 7/13 | 3/5 | - |
| breakout | H1 | 2095 | 2093 | 47.78% [45.25%, 50.29%] | 50.06% | -2.28pp [-4.80pp, +0.32pp] | ref | +0.00pp | -2.73 [-6.42, +0.62] | 53.56% / 50.84% | 5/12 | 0/5 | - |
| breakout | H3 | 2095 | 2092 | 48.33% [45.01%, 51.52%] | 50.15% | -1.82pp [-5.07pp, +1.31pp] | 0.722 | +0.00pp | -3.51 [-11.29, +3.97] | 53.54% / 52.06% | 3/12 | 2/5 | - |
| breakout | H5 | 2095 | 2095 | 48.26% [44.62%, 51.51%] | 50.07% | -1.81pp [-5.58pp, +1.73pp] | 0.722 | +0.00pp | -8.76 [-19.46, +1.06] | 53.56% / 50.98% | 4/12 | 1/5 | - |
| breakout | BR | 2095 | 1782 | 49.16% [45.41%, 52.56%] | 50.13% | -0.97pp [-4.76pp, +2.60pp] | 0.873 | +0.00pp | -4.09 [-9.81, +1.07] | 53.48% / 51.91% | 5/11 | 1/5 | - |
| range | H1 | 581 | 580 | 51.55% [46.83%, 56.95%] | 49.84% | +1.71pp [-2.80pp, +6.64pp] | ref | +3.10pp | -3.29 [-9.11, +3.38] | 45.34% / 51.72% | 0/0 | 3/5 | - |
| range | H3 | 581 | 581 | 50.26% [45.06%, 55.99%] | 49.58% | +0.67pp [-4.95pp, +6.49pp] | 0.945 | +0.52pp | -6.51 [-20.72, +8.35] | 45.27% / 54.39% | 0/0 | 3/5 | - |
| range | H5 | 581 | 581 | 51.46% [45.15%, 57.90%] | 49.60% | +1.86pp [-4.32pp, +7.85pp] | 0.873 | +2.93pp | +1.57 [-20.10, +22.86] | 45.27% / 54.22% | 0/0 | 3/5 | - |
| range | BR | 581 | 505 | 47.92% [41.87%, 54.35%] | 49.57% | -1.65pp [-7.82pp, +4.46pp] | 0.873 | -4.16pp | -5.47 [-15.23, +5.18] | 44.95% / 54.26% | 0/0 | 1/3 | - |
| reversal | H1 | 1143 | 1142 | 49.56% [46.40%, 52.87%] | 49.86% | -0.29pp [-3.50pp, +3.04pp] | ref | -0.44pp | -2.44 [-6.94, +2.10] | 45.45% / 51.58% | 2/4 | 3/5 | - |
| reversal | H3 | 1143 | 1143 | 53.02% [49.19%, 56.85%] | 49.81% | +3.20pp [-0.40pp, +6.86pp] | 0.474 | +6.30pp | +5.40 [-3.83, +14.84] | 45.49% / 52.06% | 1/4 | 5/5 | - |
| reversal | H5 | 1143 | 1143 | 54.94% [50.34%, 59.41%] | 49.91% | +5.03pp [+0.94pp, +9.44pp] | 0.228 | +9.80pp | +17.30 [+3.37, +31.91] | 45.49% / 51.01% | 2/4 | 5/5 | - |
| reversal | BR | 1143 | 996 | 52.71% [48.06%, 57.47%] | 49.76% | +2.95pp [-1.32pp, +7.73pp] | 0.722 | +5.42pp | +3.53 [-4.28, +11.35] | 45.08% / 52.41% | 0/1 | 4/5 | - |

## Caveats

- Range and reversal signal rarely, so only large effects are detectable for them.
- The strategies are tested with their live settings and fixed exits; nothing was tuned.
- Swap is not modelled; over 3 to 5 sessions it can add or subtract a little.
- Overlapping trades mean the per-trade numbers are a per-signal edge, not a portfolio return.
