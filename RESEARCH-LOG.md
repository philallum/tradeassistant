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
<!-- END ENTRIES -->
