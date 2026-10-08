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

<!-- END ENTRIES -->
