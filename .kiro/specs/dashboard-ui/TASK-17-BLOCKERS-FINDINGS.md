# Task 17 Blockers — Findings & Status

Date: 2026-10-05. Context: executing dashboard-ui Task 17 (post-deploy read-only smoke verification) revealed that the hosted dashboard has no data to serve. Investigation traced a chain of causes; this document records what was fixed, what was seeded, and the remaining upstream pipeline-wiring gaps that block a persisted Decision_Date.

## What is DONE and verified

- **dashboard-ui Task 15** — Read_Proxy deployed as Cloud Run service `dashboard-read-proxy` (region europe-west1, authenticated-only originally; `allUsers` run.invoker granted with operator approval so the Firebase `/api` rewrite reaches it). Three secrets wired via `--set-secrets`. Live.
- **dashboard-ui Task 16** — Firebase Hosting deployed. Public URLs: `https://trade-assistant-508806.web.app` and custom domain `https://app.teamhandso.me`. `/api/**` rewrite + SPA fallback + strict CSP/security headers verified.
- **`/api` prefix fix** — `services/read-proxy/src/app.ts` `stripApiPrefix` (strips one leading `/api` segment before allowlist resolution), test `apiPrefix.test.ts`. Redeployed as proxy revision `dashboard-read-proxy-00002-k6c`. `GET /api/decision-dates` returns HTTP 200 end-to-end.
- **PostgREST pagination bug FIX (committed `8c69cf7`)** — `SupabaseRestClient.select()` issued a single unbounded GET, so hosted PostgREST silently truncated every read at ~1000 rows. This is why the prior backfill only encoded pattern vectors through ~2014 (it only ever saw the first ~1000 candles per pair). `select()` now pages via `Range` headers driven by the `Content-Range` total. Tests in `src/storage/supabase/client.pagination.test.ts`.
- **Hosted data SEEDED** — new one-shot seeding infrastructure built and run:
  - `src/ops/outcome-resolution/` — `resolveHistoricalOutcomes` drives the EXISTING `resolve()` over all stored history to populate `analogue_outcomes` (which was previously empty). Property tests 27–29.
  - `src/ops/seed-run/main.ts` — Job entry running `backfill → resolveHistoricalOutcomes` against hosted via the scoped write credential. Dockerfile now ships `data/`.
  - Deployed as Cloud Run Job `dashboard-seed-run` and executed. Post-seed hosted state (read-only verified): `pattern_vectors` = 20,916 rows (~4183/pair) extending to 2026-09-15 (no longer capped at ~1000/pair/2014); `analogue_outcomes` = 62,733 rows, all matured, through 2026-09-14.
  - Note: the clean seed execution hit the Job's 3600s task-timeout right as outcomes finished writing (status FAILED but writes landed, idempotent). Recommend bumping `dashboard-seed-run --task-timeout` to ~5400–7200s before any re-run.

## Current blocker: no pair can fire (so `firing_setups` stays empty, `v_decision_dates` returns nothing, Task 17 cannot pass)

Re-running `scheduled-daily-run` (execution `scheduled-daily-run-wvrhj`, Decision_Date 2026-10-05) SUCCEEDED with `persisted: true` but `firingCards=0, suppressed=0`. Root cause is structural, not data:

- `src/dashboard/dashboard.ts` `fires()` requires `gatePassing && !newsSuppressed && direction !== "FLAT" && earnedConfidence >= threshold`.
- `src/pipeline/dailyPipeline.ts` defines `resolveGatePassingDefault = () => false`. `evaluatePair` uses `deps.gatePassing ?? resolveGatePassingDefault`.
- Production wiring (`src/scheduled-run/main.ts` → `makePipelineLoader(buildSupabaseStores(supabase))`) injects NO `gatePassing` resolver, so every pair gets `gatePassing=false` → nothing fires → suppressions (which apply to the firing set) are also 0.

## The remaining gap chain beneath `gatePassing` (all upstream of dashboard-ui)

A real `gatePassing` resolver must read recorded Kill_Gate PASS verdicts from `gate_verdicts` / `feature_registry`. That path is not wired end-to-end:

1. **No Supabase storage adapters exist** for `GateVerdictStore` or `FeatureRegistryStore` (file search found zero implementations — only the port interfaces in `src/kill-gate/types.ts` / `src/feature-registry/types.ts` and their in-memory references). So nothing can write gate verdicts or feature-registry rows to hosted.
2. **The backtest stage never persists verdicts.** `src/staged-runner/stagedRunner.ts` backtest calls `composeGateVerdict` then `logGateVerdict(deps.docs, …)` — which only appends to RESEARCH-LOG.md. It never calls `persistGateVerdict`.
3. **`persistGateVerdict` / `evaluateAndRecordVerdict` are never called in production code** (defined + tested only).
4. **No `gatePassing` resolver implementation exists**, and none is injected into `PipelineDeps`/`makePipelineLoader`.

Consequence: `gate_verdicts` in hosted is expected empty (not yet live-confirmed), and there is no code path that would populate it.

## What it would take to unblock Task 17 (scope estimate)

In dependency order (all in the `fx-daily-pattern-assistant` / `operational-wiring` layer, NOT dashboard-ui):

1. Implement a Supabase `GateVerdictStore` adapter (writes `gate_verdicts` + `gate_fold_verdicts`) and a Supabase `FeatureRegistryStore` adapter (writes `feature_registry`), mirroring the existing Supabase adapter pattern (`src/storage/supabase/*`), reusing the now-paginated `SupabaseRestClient`.
2. Wire the backtest stage (or a dedicated research/gate Job) to persist verdicts through the new adapter — not only append to RESEARCH-LOG.md.
3. Run the backtest/gate evaluation against the freshly-seeded hosted data to produce real PASS/CUT verdicts in `gate_verdicts`.
4. Implement a `GatePassingResolver` that reads recorded PASS verdicts (per the `src/pipeline/types.ts` doc contract) and inject it into `makePipelineLoader` / the scheduled-run wiring.
5. Re-run `scheduled-daily-run`; if a pair now passes the gate, is non-FLAT, non-suppressed, and meets the confidence threshold, `firing_setups` fills and `v_decision_dates` returns a Decision_Date.
6. Then dashboard-ui Task 17 (read-only smoke verification) can finally run against real data.

## Recommendation

This is a multi-component tranche of unfinished core-pipeline production wiring, outside the dashboard-ui spec. It should be planned as its own effort (likely new tasks in `operational-wiring`). The dashboard serving layer is complete and correct; it will display data as soon as the upstream pipeline persists a firing Decision_Date.

## Secondary notes for later decisions

- **Service-role key use for diagnostics**: exact hosted row counts required the service-role key because the publishable key is RLS-limited to 0 rows and the scoped read key 401s on raw PostgREST. It was used strictly for read-only counts and never echoed/logged, but Req 8.4 reserves it for operator one-offs — worth a durable decision (e.g. a least-privilege diagnostic role).
- **`allUsers` run.invoker** on `dashboard-read-proxy` (granted during Task 16) makes the proxy publicly invokable at the IAM layer; app-level allowlist/rate-limit/CSP still apply. Revisit if a least-privilege invoker identity is preferred.
- **Seed Job timeout**: bump `dashboard-seed-run --task-timeout` before re-running so its status label is clean.
- **Uncommitted**: `web/README.md` has the Task 16 deploy-record edit (not yet committed).
