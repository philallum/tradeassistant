# Tasks: Codebase Housekeeping

Status: all 12 tasks implemented locally (2026-11-08). Not committed, not deployed.
Gate at completion: backend `npm run check` green (1317 passed, 7 skipped), `node scripts/version-policy.mjs` OK,
web `npm run build` + `npm test` green (288 passed). A before/after harness (pristine `HEAD` vs working tree)
produced **byte-identical** output for a fixed scenario: pipeline evaluations, firing view, persisted rows,
snapshot JSON, confluence slice and the 23 recorded scorecard rows (including `third_party`).

- [x] 1. Pin the horizon contract (R1), no source change
  - `src/retrieval/horizonContract.test.ts` (3 tests). Confirmed both stores return all three horizons per date
    and `retrieve()` collapses to the smallest horizon.
- [x] 2. Shared firing predicate `fires()` (S1) with boundary tests
  - `fires()` exported from `dashboard/dashboard.ts`; used by persistence, the snapshot rows, the daily-note input and
    the walk-forward regenerator. `displayOnly` takes an optional `confidenceThreshold`.
  - `src/dashboard/fires.test.ts` (8 tests, incl. every consumer agreeing at three thresholds).
- [x] 3. Repo hygiene
  - `supabase/.temp/` and `web/.firebase/` untracked + ignored (`web/.firebaserc` kept: deploy config).
  - `recharts` removed from `web/package.json` and lockfile (removals only); ceiling, Dependabot rule and tests updated.
- [x] 4. Re-point the four boundary oracle tests to `composeEvaluationReport`
  - Mutation check: a temporary hidden-state leak in `composeEvaluationReport` failed 5 tests across all 4 suites; reverted.
- [x] 5. Remove the legacy verdict path
  - Removed: `composeGateVerdict`/`GateVerdict`/`GateVerdictStore`/`persistGateVerdict`/`logGateVerdict`, the Supabase
    `gate_verdicts` adapter (+3 tests), `ops/gate-run`, and the staged-runner `backtest`, `forwardLook` and `runAll` stages.
  - **Deviation from the plan:** `forwardLook`/`runAll` had no production caller either, so they went too, and
    `StagedRunnerDeps` was pruned of the fields only they read (`gateVerdictStore`, `docs`, `config`, `loadEvaluations`,
    `persistView`, `configId`); `HostedBackfillDeps` and `ops/evaluation-run` lost the matching stubs.
  - Tests that protected gate math through the verdict function were **ported to the report** (`killGateFixture`,
    `nullFeatureFails`, `sampleSizeFloor`, `outOfSampleOnly`); `verdictComposition` and `crossRegimeInclusion` asserted
    PASS/CUT-only semantics and were deleted.
  - Left (flagged): `LivingDocs.appendVerdict/appendCut` now have no caller.
- [x] 6. Remove the seed job's deploy surface
  - `ops/seed-job.config.json` deleted; Dockerfile no longer copies `data/`; `.dockerignore` excludes it. `csv-loader`,
    `ops/seed-run` and `data/*.csv` stay. Verified nothing in the daily/intraday path reads `data/`.
- [x] 7. Dead code and small dedupes
  - Done: `previousCalendarDate` (guard), duplicate `nonNegativeInt`, shared `warnEvent` (10 copies, log lines byte-identical),
    dead fallback in `dailyRun`, `createDashboard`/`Dashboard`, `SCAFFOLD_READY`+`scaffold.test.ts`, `src/news-filter/`
    (+ re-export, + the boundary-test fixture entry), `nonFiring` -> `buildEvaluation`.
  - **Deviation:** `makePipelineLoader` was left alone - it has no unused parameter (only the returned lambda omits `supabase`).
- [x] 8. No silent skips and the R2 guard
  - Reported now: failed vector write/encode (`candle_freshness.encode_skipped`), expected-range read
    (`scheduled_run.pipeline_warning`), intraday fallback read, deadline-truncated track record.
  - **Deviations:** the scorecard's silent candle-load swallow lived in `buildMatrix`, which Task 9 deleted (the shared
    builder warns); `snapshotHistory.safeSlice` already warned under a stable event name, so it was left.
  - **Extended:** the key-in-URL hazard exists in all five provider clients (FCS x2, Twelve Data x2, Massive), not just FCS;
    `redactSecrets` is applied in all of them. A test with hostile fetches failed 3 cases when redaction was removed.
  - R2: `isLiveDecisionDate`, `recordPredictions(..., { excludeStrategyIds })`, `recordThirdParty` on the step.
- [x] 9. Build the confluence matrix once (S5)
  - `buildRunMatrix` / `sliceFromRunMatrix`; `makePersistView` builds once (new `buildMatrix` seam) and shares it.
  - Finding recorded: for a failed candle load the scorecard already recorded nothing for that pair (it only records
    available cells), so the real change is one assembly path and a warning instead of silence.
- [x] 10. Per-step timing logs
  - `scheduled_run.step_timing {step, durationMs, outcome}` for 10 persist steps plus `freshen_candles` and
    `pipeline_and_persist_total`. Observation only; no memoisation.
- [x] 11. Documentation
  - New: `README.md`, `docs/DASHBOARD-SNAPSHOT-CONTRACT.md`, `docs/RUNBOOK.md`; `.env.example` rewritten (every variable
    verified as read by code or `deploy.yml`); Decision Index + entry in `DECISIONS.md`; PROJECT-STATE section 12
    (confidence, schedule, limitations, non-goals) and the R1 note; banners on `PROJECT-PLAN.md` and the partner brief;
    CODE-MAP, RISKS, NEXT-STEPS updated; `web/README.md` corrected.
  - Fixed: scheduler cron drift in `ops/scheduler-job.config.json` and the keep-list manifest (`0 17` -> `30 17`, matching the
    operator-confirmed live cron; cloud side not verifiable from the repo).
  - Link/anchor check over the edited docs: 0 problems.
- [x] 12. Final verification
  - Gates green; byte-identical before/after harness; diff reviewed.
  - **Intended behaviour changes (exactly two):** (a) a replayed Decision_Date no longer records `third_party`;
    (b) the per-run matrix is built once and a failed candle load is warned.
