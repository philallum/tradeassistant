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
<!-- END ENTRIES -->
