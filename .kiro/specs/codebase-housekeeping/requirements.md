# Requirements: Codebase Housekeeping and Peer-Review Remediation

## Introduction

A senior peer review of the whole project found documentation drift, a duplicated firing
predicate, a few duplicated helpers and dead modules, a dormant legacy kill-gate verdict path,
silent-failure gaps and an FCS replay hazard. This spec is housekeeping, NOT a redesign: same
behaviour, less complexity, better documentation and tests. Existing behaviour is the contract.

## Out of scope

Real 1/2/3-day horizon selection, candle-store memoization, a "data behind" banner, moving
conviction tiers server-side, a web linter, dependency upgrades, a change to the
`buildDashboardSnapshot` signature, and any live-cloud / Supabase / deploy action.

## Requirements

1. **Behaviour preservation.** Firing, confidence, horizon, SL/TP, confluence output, snapshot
   bytes and schedules are unchanged. The only intended exceptions are the R2 replay guard
   (Req 7) and the failed-pair labelling in the shared confluence matrix (Req 8); both are tested.
2. **Horizon contract (R1).** The system is documented and tested as horizon-1 only. `retrieve`
   is not changed. A characterization test pins the behaviour.
3. **Single firing predicate.** One exported `fires(evaluation, confidenceThreshold)` replaces
   every copy; the threshold comes from `DashboardConfig`, not a hard-wired 0.55.
4. **Boundary safety.** The four AI/deterministic and confluence-isolation oracle tests are
   re-pointed from `composeGateVerdict` to `composeEvaluationReport` BEFORE any removal.
5. **Legacy removal.** `composeGateVerdict`, `GateVerdict`, `GateVerdictStore`,
   `persistGateVerdict`, the `gateVerdictStore` adapter, `ops/gate-run` and the `staged-runner`
   `backtest` stage are removed. `staged-runner` `backfill`, its test helpers,
   `composeEvaluationReport`, `gate1`, `gate2` and `walkForward` are kept.
6. **Seed job.** Only the deploy surface is removed (`ops/seed-job.config.json`, Dockerfile
   `data/` copy, `.dockerignore` entries). `csv-loader` and `data/*.csv` stay.
7. **FCS replay guard (R2).** The `third_party` prediction is not recorded when
   `RUN_DECISION_DATE` is not the current NY trading date; a named event is logged. The normal
   scheduled path is byte-identical.
8. **Confluence matrix built once.** `makePersistView` builds it once and shares it with the
   confluence slice and the scorecard step; a failed candle load is labelled
   `candles_unavailable` in both.
9. **No silent skips.** Each swallowed failure listed in the design emits a named,
   secret-free event. FCS errors never contain the URL or the `access_key` query string.
10. **Repo hygiene.** Scratch files are untracked and ignored; the unused `recharts`
    dependency is removed.
11. **Dead code and dedupes.** Duplicated helpers are shared; dead exports and
    `src/news-filter/` are removed.
12. **Measurement.** Per-step timing events are logged in the daily run.
13. **Documentation.** The docs match the final state of the code (see design).
14. **Safety.** No live-cloud action; no secret values in any file; LESSONS.md untouched;
    kill-gate verdicts only in RESEARCH-LOG.md; no commits unless asked.
15. **Verification.** Before each deletion, grep for importers. After each task run the backend
    gate (`npm run check`) and the web build and tests (`cd web && npm run build && npm test`).
