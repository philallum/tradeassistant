<!-- LIVING-DOCS:PROJECT-STATE -->
# PROJECT-STATE.md — Current Project State

> Living state document (Requirement 5.1). This file is the single place anyone
> — a teammate or Kiro picking the project up cold — can read to understand the
> full picture: what the project is, the technology stack, how the code is laid
> out, what is actually built vs. merely planned, the obstacles hit, and the
> strategic decisions made.
>
> **How this file stays live.** There are two update paths and they must not
> fight each other:
> 1. The machine-managed block delimited by the BEGIN/END STATE HTML comment
>    markers (see them just below) is rewritten by the Living-Docs Writer
>    (`LivingDocs.updateState()` in `src/living-docs/livingDocs.ts`) and by the
>    `update-living-docs` agent hook. Treat it as generated — do not hand-edit
>    its three lines except to correct a factual error. Note: the literal marker
>    strings must appear exactly once each in this file (the writer locates them
>    with a first-match search), so this preamble intentionally does not repeat
>    them verbatim.
> 2. Everything **outside** those markers is human/agent-authored prose and is
>    preserved verbatim across machine updates. When a change, fix, or decision
>    lands, update the relevant prose section below (and append gate verdicts to
>    RESEARCH-LOG.md, never here).
>
> Rule of thumb: the one-line "where we are right now" lives in the STATE block;
> the durable "how and why" lives in the prose. Keep both honest.

<!-- BEGIN STATE -->
- **Phase:** v1 feature-complete; `simplify-to-cloud-minimal` COMPLETE. `daily-candle-freshness-and-cleanup` IN IMPLEMENTATION: Phases 1-3 (tasks 1-11, the Candle_Freshness_Stage wired into the daily run) DONE and merged (operator GitHub); Phase 4 tasks 12 + 13 DONE. The hosted candle GAP IS NOW CLOSED: the operator-approved ☁️ run of `dist/ops/candle-backfill/main.js` against hosted (`bffzhjnpzxxuqvmnmylk`, 2026-10-08) advanced all five pairs from 2026-09-15 to 2026-10-06 (Twelve Data served the range; FCS skipped; 15 accepted/0 rejected per pair), leaving a benign one-day residual to target 2026-10-07 (provider had not yet published that close) that the next Daily_Top_Up will take. Phase 5 tasks 14 + 15 DONE: the operator-approved ☁️ read-only run of `dist/ops/freshness-verify/main.js` against hosted (`bffzhjnpzxxuqvmnmylk`, Decision_Date 2026-10-08) confirmed `dashboard.json`'s Decision_Date (2026-10-08) reflects fresh history (`snapshotReflectsFreshHistory: true`, R6.1) and reported the known benign one-day residual on all five pairs (latest 2026-10-06 vs target 2026-10-07, R6.2 — a provider-availability FINDING the next Daily_Top_Up takes, not a defect). REMAINING: Phase 6 cleanup (R7-R11), Phase 7. Also fully specced + ready: `dashboard-ui` Req 8 criterion 8 (the "All pairs" fix). Delivery cadence (operator): incremental — implement a milestone, operator merges dev→main to deploy, verify, next; the agent builds/verifies locally and does not run GitHub.
- **Updated:** 2026-10-09
- **Summary:** FIXED a flaky CI property test that failed post-merge on `main` (the operator reported it as a "lint fail"; it was actually the fast-check property in `src/ops/safety/operationalSafety.secretRedaction.property.test.ts`, UNRELATED to the Gemini change — the same commit's CI passed on `dev` and only `main` hit the bad seed `-1400392596`, counterexample a secret named `A` with value `TIN`). ROOT CAUSE: the test asserts a secret VALUE never appears as a substring on any output surface, but the surfaces intentionally PRESERVE secret NAMES + fixed `gcloud`/record tokens, and `redactSecrets` only scrubs whole literal VALUE occurrences — so a generated value that was a substring of a surviving name/token tripped `surface.includes(value)` on benign structural text, not a real leak. The redaction CODE is correct; the test's generators were too loose. FIX (test-only): added `STRUCTURAL_TOKENS` + `confusableWithStructural(value, names)` and filtered `secretSetArb` (plus an `fc.pre()` on the stdin-transport property) to exclude values confusable (substring, either direction) with names/tokens — keeping the wide-character redaction stress, removing only the substring-coincidence false positives. VERIFIED: the exact failing seed now passes, 15 fresh runs pass, `npm run check` GREEN (795 tests). This ships alongside the (still PENDING-DEPLOY) Gemini truncation fix below. GEMINI FIX (backend-only; locally verified, PENDING operator deploy+Job run): ROOT CAUSE confirmed via a direct live Vertex call: `gemini-2.5-flash` is a THINKING model — with `maxOutputTokens: 512` it spent 491 tokens on hidden reasoning (`thoughtsTokenCount: 491`), leaving only 17 for the visible answer (`finishReason: MAX_TOKENS`), so the note cut off mid-sentence. FIX (`src/llm/geminiProvider.ts` + `src/scheduled-run/main.ts`): added an optional `thinkingBudget` to `GeminiProviderConfig` (sent as `generationConfig.thinkingConfig.thinkingBudget` only when set — back-compat), raised `DEFAULT_MAX_OUTPUT_TOKENS` 512→1024, and the daily run now constructs the provider with `thinkingBudget: 0` + `maxOutputTokens: 1024` (all its roles are short display-only text, so hidden thinking adds no value). Hardened: the provider logs a secret-free `gemini.generation_truncated` warning if a `MAX_TOKENS` cutoff ever recurs (still returns text — display-only + fail-safe preserved). Verified LIVE that `thinkingBudget: 0` yields `finishReason: STOP` + a complete 3-sentence note; backend `npm run check` GREEN (795 tests, +5). No web change (the SPA renders whatever `note_text` arrives). Goes live after the operator deploys the backend + re-runs the Job; until then the live note is the prior truncated one. PRIOR (this session, LIVE): Shipped + LIVE-VERIFIED a DAILY AI COMMENTARY note so the LLM path has a visible liveness signal every trading day — previously the AI only ran for firing pairs, so a no-fire day looked identical whether the AI worked or was broken. The operator deployed both halves and re-ran the Cloud Run Job; the live `dashboard.json` is now schema v3 (generatedAt 2026-10-09T11:26:54Z) with `dailyCommentary.generated=true` and a real note ("No setups cleared the confidence threshold today. The GBPUSD UP setup, with an earned confidence…") — proving the Gemini/Vertex path actually ran on a no-fire day (0 firing, 5 pairEvaluations). No LLM provenance leaked into the public JSON (brand stripped at the snapshot boundary), and the `app.teamhandso.me` fetch returns `access-control-allow-origin`. KNOWN FOLLOW-UP (cosmetic, not a defect): the live note reads truncated mid-sentence — the pipeline published the model's output verbatim; likely a low `maxOutputTokens` in `geminiProvider.ts` or an early model stop. FULL-STACK, schema v3: a new pair-INDEPENDENT `dailyCommentary` snapshot slice `{ decision_date, note_text, generated }` carries a short display-only note produced EVERY trading day. Backend — NEW `src/rationale/dailyCommentary.ts` (`generateDailyCommentary` → `llm.invoke("signal_rationale", …)`, REUSING the sanctioned role — no new role; prompt built ONLY from deterministic `PairEvaluation` numbers); NEW `buildDailyNote` producer in `displayOnly.ts` (runs every trading day, NOT gated on firing, fail-safe → undefined on no-LLM/error); `DailyNoteWrite` on `DisplayOnlyWrite`; `snapshot.ts` bumped v2→v3 with the `dailyCommentary` record (unwraps `LlmTagged.value`; emits `generated:false` + empty text when no note). Web — `DailyCommentary` type + `parseSnapshot` default (object, not array), NEW pure `shapeDailyNote.ts` (`generated`/`unavailable`/`absent`, never fabricates), NEW `DailyNote.tsx` (AI-generated·advisory·non-scoring banner), rendered FIRST in the Setups panel in BOTH silent and content states. BOUNDARY RESPECTED: the note is `LlmTagged`, structurally excluded from scoring (`Deterministic<T>` + `ScoringInputGuard`; `@ts-expect-error` + guardrail suite confirm). VERIFIED LOCALLY: backend `npm run check` GREEN (790 tests, +7); web `npm run build` + `npm run test` GREEN (167 tests, +11). NOT yet live: needs an operator deploy of BOTH halves + a Cloud Run Job run to publish schema v3; until then the live snapshot is v2 (no slice) and the web parser defaults it so `DailyNote` renders nothing (safe). The note only carries real text when the Gemini/Vertex path works (that IS the liveness signal); otherwise `generated:false` → an explicit "AI commentary unavailable" marker. DESIGN DECISIONS: reuse `signal_rationale` (no new sanctioned role); render on every trading day; pair-independent slice (the AI tab is pair-gated and blank on "All pairs"). PRIOR (this session, locally verified / pending deploy): a RUN-COMPLETION READOUT — schema v2 `pairEvaluations` slice carrying EVERY evaluated pair (fired or not) with its deterministic direction + earned confidence + choppiness + a `fired` flag, Backend — `src/scheduled-run/snapshot.ts` (bumped `SNAPSHOT_SCHEMA_VERSION` 1→2, added `SnapshotPairEvaluationRow`, added the slice to the envelope + an optional `pairEvaluations` param on `buildDashboardSnapshot`, and an exported `pairEvaluationRows(decisionDate, evaluations, threshold=DEFAULT_CONFIDENCE_THRESHOLD)` mapper) and `src/scheduled-run/main.ts` `persistView` (maps `cached.get()` — the full `PairEvaluation[]` captured before firing filters it — into the slice; the run uses `DEFAULT_DASHBOARD_CONFIG` so the default 0.55 threshold is correct). Web — `web/src/api/types.ts` + `snapshot.ts` mirror the slice (schema v2, `parseSnapshot` defaults `[]`); new pure `web/src/pure/shapeRunSummary.ts` (per-pair direction/confidence/choppiness + `gapToThreshold` + evaluated/fired counts; absent on empty); new `web/src/tabs/Setups/RunSummary.tsx` (affirmative headline + per-pair table, direction by glyph+text per Req 18.3, `role=status` live region); `SetupsTab.tsx` loads the slice beside firing setups (one shared snapshot) and the SILENT state now renders `<RunSummary>` when present, else falls back to the plain "No setups fired" message (older v1 snapshot safe). VERIFIED LOCALLY: backend `npm run check` GREEN (783 tests, +3); web `npm run build` + `npm run test` GREEN (156 tests, +4). NOT yet live: the slice appears only after the operator commits+deploys BOTH backend and web and re-runs the Cloud Run Job to regenerate `dashboard.json`; until then the live snapshot is v1 without the slice and the SPA shows the plain message (safe). DESIGN DECISION: the readout is scoped to the no-fire silent state (the ambiguous case); firing days render cards as before. PRIOR TURN (dashboard-empty, DONE + LIVE): (1) CORS: `gsutil cors set` added the custom domain `https://app.teamhandso.me` to the snapshot bucket `trade-assistant-508806-dashboard` CORS `origin` allow-list (saved at `ops/dashboard-bucket-cors.json`; one-time out-of-band — `deploy.yml` does not manage bucket CORS). (2) Empty data tabs: `src/scheduled-run/snapshotHistory.ts` (`loadSnapshotHistory`) + the `firingSetups`/`decisionDates` history merge in `snapshot.ts`, wired into `main.ts` `persistView`; operator deployed + ran the Job, live `dashboard.json` regenerated (generatedAt 2026-10-09T09:54:24Z, ~970 KiB) carrying firingSetups=4, decisionDates=4, analogueOutcomes=4020, candles=1430 (400-day window), realizedOutcomes=2, evaluationReports=1, externalComparison=5 — VERIFIED LIVE, and the `app.teamhandso.me` GET/preflight return `access-control-allow-origin` for that origin. `aiRationale=0` is EXPECTED on a no-fire day. NOTE (earlier): Completed `daily-candle-freshness-and-cleanup` Phase 6 task 16 (☁️ Vertex AI 403, R7) — marked `[x]`. Read-only diagnostics had already established the fix was in place: `roles/aiplatform.user` (includes `aiplatform.endpoints.predict`) is bound to `job-runtime@` (IAM audit: ADDED 2026-10-08 17:58Z) and the logged 403 (2026-10-08 12:34Z) predated that grant; `gemini-2.5-flash` reachable in `europe-west1` (countTokens HTTP 200). `ops/required-resources.manifest.json` `rolesNote` records the verified least-privilege grant (R7.3). VERIFICATION (R7.1/R7.2): an operator-approved ☁️ manual Job run `gcloud run jobs execute scheduled-daily-run` (execution `scheduled-daily-run-962h6`, exit 0, under the operational-safety protocol) produced NO `aiplatform.endpoints.predict` 403 — the denial is resolved — and published `dashboard.json` with `decisionDate: 2026-10-09`. Zero pairs fired that day (`firingSetups: 0`, so `aiRationale: 0` correctly), so the per-firing-pair rationale (R7.2) was not exercised; operator accepted the 403 resolution as sufficient — the display-only rationale will self-confirm on the next run with a firing pair. The AI/Deterministic boundary is untouched (rationale stays display-only). REMAINING in `daily-candle-freshness-and-cleanup`: Phase 6 tasks 17-20 (backup untrack R8, Dependabot triage R9, ☁️ secret rotation R10, cross-spec checkpoint reconcile R11) + Phase 7 (living docs 21, final checkpoint 22). SECURITY (standing): `.env` holds live production secrets in plaintext — rotate + untrack (R10); gitignored `ops/fx-writer-key/` holds the `fx_writer` private signing key. Stack unchanged.
<!-- END STATE -->

## 1. What this project is

A personal, local-first **FX Daily Pattern Trading Assistant** for the five
major pairs (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD). It surfaces a small number
of high-conviction, forward-looking daily directional setups ("a pattern is
emerging; over the next 1–3 days, direction X, earned confidence C%") and stays
silent otherwise. It is the successor to a prior forecasting system that failed
instructively; the lessons from that failure are hard constraints and live in
`LESSONS.md`.

Two non-negotiables govern every design choice:
- **Measure before believing.** Nothing drives a displayed signal until it beats
  a defined baseline out-of-sample through a two-stage kill-gate.
- **AI explains and filters; deterministic code decides and scores.** An LLM may
  read news, write rationale, label analogues, and help interpret results. It
  must never compute the directional probability or the kill-gate verdict.

The authoritative design and task breakdown live in `PROJECT-PLAN.md` and under
`.kiro/specs/`. This file tracks the *state*, not the plan.

## 2. Technology stack (what is actually in use)

- **Core language:** TypeScript, Node `>=22 <23` (`.nvmrc` pins the line), ESM
  (`"type": "module"`). The core has **no runtime dependencies** — it uses Node
  22 built-in `fetch`/`http`.
- **TypeScript config:** ES2022 / NodeNext, `strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `isolatedModules`. Deliberately strict.
- **Testing:** Vitest + fast-check (property-based testing) for TypeScript —
  the sole authority. The former isolated Python (`pytest` + `hypothesis`)
  cross-check of the confidence-shrinkage formula was removed in
  `simplify-to-cloud-minimal` Phase 3 (task 4); the TS property test in
  `src/confidence/` is now the only check of that formula.
- **Tooling:** ESLint 9 + typescript-eslint. Dependencies are exact-pinned
  (no ranges) in every `package.json`. A custom `version-policy` audit
  (`scripts/version-policy.mjs`) guards version drift.
- **Storage:** Supabase Postgres + **pgvector** for pattern-vector ANN
  retrieval. Local and hosted targets selected via `SUPABASE_TARGET`. Schema
  managed by SQL migrations under `supabase/migrations/`.
- **Cloud (GCP, project `trade-assistant-508806`):** Cloud Run **Job** for the
  scheduled daily refresh (the dashboard read-proxy Cloud Run service was
  live-DELETED in `simplify-to-cloud-minimal` Phase 6 task 7.2);
  Cloud Scheduler (daily `0 17 * * *` America/New_York); Secret Manager for all
  runtime secrets; Cloud Build + Artifact Registry (SHA-pinned images); keyless
  CI auth via Workload Identity Federation / OIDC (no stored SA key).
- **Serving / UI:** React + Vite + TypeScript SPA (`web/`) on Firebase Hosting,
  strictly read-only. Under `simplify-to-cloud-minimal` Phase 5 task 6 the SPA
  reads the Public_Read_Path: a single `dashboard.json` snapshot the Cloud Run
  Job writes at the end of each daily run, fetched via `web/src/api/snapshot.ts`
  `loadSnapshot()` (one shared `snapshotCache` across all tabs). As of task 8,
  the SPA fetches that snapshot CROSS-ORIGIN from a public-read GCS bucket: the
  fetch URL comes from a build-time `VITE_SNAPSHOT_URL` (fallback same-origin
  `/dashboard.json`), and the daily Cloud Run Job writes the object through the
  new GCS `SnapshotSink` (`src/scheduled-run/gcsSnapshotSink.ts`). The CSP
  `connect-src` includes `https://storage.googleapis.com`. The former
  `services/read-proxy/` Node `http` service + its `/api` rewrite + ten-endpoint
  allowlist are DELETED in code; the live GCP read-proxy resource was also
  DELETED in the Phase 6 R11 reconcile (task 7.2).
- **External providers (keys in Secret Manager, read at runtime):** market-data
  and news/calendar providers plus Gemini for the LLM layer. Data/LLM inputs
  only — never scoring.

## 3. Repository / code map

Top-level TypeScript modules under `src/` (see each module's `index.ts` for the
authoritative export surface):

- `guard/` — Look-ahead safety guard: rejects any candle dated at/after a
  decision date; enforces matured-only outcomes.
- `ingestion/` — OHLC ingestion + session-boundary normalization, idempotent
  `(asset, date)` upsert.
- `ingestion/ohlcFeed/` — the OHLC_Feed_Provider port + `ohlcFeedConfigFromEnv`
  + FCS/Twelve Data/Massive adapters (zero-SDK `fetch`) + `buildProviderChain`
  fallback resolver (FCS→Twelve Data→Massive, first-usable-wins per pair,
  capability-aware: a date-range backfill skips latest-only FCS). Feeds the
  Candle_Freshness_Stage; output goes through the existing `OhlcIngestion`.
- `encoder/` — Shape-only, per-scale-normalized pattern-vector encoder
  (10/20/40-day windows).
- `retrieval/` — pgvector analogue retrieval (weekly-trend pre-filter,
  self-exclusion, matured-only, similarity radius) + forward-outcome resolver.
- `baseline/` — Weekly-trend-follow baseline (the null hypothesis to beat).
- `confidence/` — Earned confidence with sample-size shrinkage, ATR-scaled FLAT
  band, horizon (1/2/3-day) selection.
- `kill-gate/` — Two-stage kill-gate: Gate 1 (directional ≥ 3pp over baseline),
  Gate 2 (risk-adjusted MFE/MAE after friction); walk-forward verdict
  composition; `GateVerdictStore` port. As of `simplify-to-cloud-minimal`
  tasks 1-2, a human-read `EvaluationReport` path is the ACTIVE evaluation
  write path: `composeEvaluationReport()` reuses the unchanged gate math but
  emits metrics + a deterministic Wald CI + non-binding `annotations` and NO
  `verdict` field; `evaluateAndRecordReport()` persists it via the new
  `EvaluationReportStore` (`evaluation_reports` table, no verdict column) and
  appends a verdict-free RESEARCH-LOG entry. The legacy
  `composeGateVerdict`/`GateVerdict` PASS/CUT path + `gate_verdicts` table
  survive DORMANT (still wired into `src/staged-runner/`, `src/ops/gate-run/`,
  `web/`) and are dropped in Phase 4 (task 5).
- `llm/` — Role-gated, provenance-tagged LLM interface + `ScoringInputGuard`.
  The v1 production backend `geminiProvider.ts` (Vertex AI `generateContent`
  over built-in `fetch`, ADC/metadata bearer token, no SDK) implements the
  `LlmProvider` port — `src/llm` is the sole SDK-aware layer and still imports
  no SDK package, so the import-boundary smoke test stays green. It supports an
  optional `thinkingBudget` (sent as `generationConfig.thinkingConfig` only when
  set) so a 2.5 thinking model does not spend the output budget on hidden
  reasoning and truncate short display text; the daily run sets `thinkingBudget:0`
  + `maxOutputTokens:1024`, and a `MAX_TOKENS` finish logs a secret-free
  `gemini.generation_truncated` warning.
- `news-filter/` — Calendar ingestion, LLM risk flag, deterministic
  suppression with fail-safe.
- `rationale/` — Display-only signal rationale + pattern description, plus
  `dailyCommentary.ts` (`generateDailyCommentary`): a whole-day display-only AI
  note produced every trading day (fired or not) as an LLM-path liveness signal.
  It REUSES the sanctioned `signal_rationale` role (no new role), builds its
  prompt only from deterministic `PairEvaluation` numbers, and returns
  `LlmTagged<string>` — so it is excluded from scoring by the same
  `Deterministic<T>`/`ScoringInputGuard` boundary as the other rationale output.
- `dashboard/` — Silent-by-default dashboard, per-pair `fires()` decision
  (now `direction !== "FLAT" && earnedConfidence >= threshold` only — the
  gate/news/choppiness/concentration suppressors were removed in
  `simplify-to-cloud-minimal` task 3), firing-setup persistence, realized-outcome
  journal. `choppinessMetric.ts` retains the choppiness/efficiency computation as
  a DISPLAYED field on each observation (never a suppressor).
- `risk-boundaries/` — Empirical analogue-derived risk boundaries.
- `external-signal/` — External cross-reference, display/research-only, never
  feeds scoring. `fcsProvider.ts` is the real FCS adapter (`/forex/latest` over
  `fetch`); it batches all five pairs into one request (memoized per
  Decision_Date) to respect the FCS free-plan 3-req/min limit, deriving
  BUY/SELL/HOLD from the daily change %.
- `pipeline/` — End-to-end deterministic daily-run wiring; `makePipelineLoader`.
  (`gatePassingResolver.ts` and the news-resolver wiring were removed in
  `simplify-to-cloud-minimal` task 3; the daily path no longer gates or
  suppresses firing.)
- `scheduled-run/` — GCP-scheduled unattended daily entry (`main.ts`), reuses
  the same daily-run path. `main.ts` now builds the optional Gemini + FCS
  collaborators from env, skips non-trading days (`isTradingDay`), and persists
  the display-only values beside the firing view. It also now runs the
  Candle_Freshness_Stage (`candleFreshness.ts` `runCandleFreshnessStage`, with
  `completedTradingDay.ts` + `candleGap.ts`) BEFORE `runScheduledDaily`,
  fail-safe, to top-up/gap-backfill candles via the provider chain through the
  existing `OhlcIngestion`; `encodeStoredCandles.ts` is the shared
  look-ahead-safe candle→vector encode helper now reused by both the stage and
  `stagedRunner.backfill()`. `freshnessVerification.ts` (added by
  `daily-candle-freshness-and-cleanup` task 14) is a strictly READ-ONLY
  `verifyFreshness(deps)` check (R6): per pair it compares the latest stored
  candle date from `candleStore.getCoverageSummary()` against
  `mostRecentCompletedTradingDay(decisionDate)` and confirms the provided
  `dashboard.json` snapshot's `decisionDate` reflects fresh history — fully
  injectable, mutates nothing, writes nothing (touches no decision path or the
  Measurement_Engine). `src/ops/freshness-verify/main.ts` (added by task 15) is
  the read-only OPERATOR entry wrapping it: it builds the hosted stores (uses
  ONLY the read-only candle store), fetches the published `dashboard.json` from
  the public-read GCS object (`DASHBOARD_SNAPSHOT_BUCKET`), drives
  `verifyFreshness` once, and emits secret-free logs; executing it against
  hosted is the operator-gated ☁️ step (task 15, DONE). `displayOnly.ts` composes the
  rationale + comparison writes (fail-safe per pair); `accessToken.ts` resolves
  the GCP token (Cloud Run metadata server in prod, `gcloud` ADC locally).
  `snapshot.ts` (added `simplify-to-cloud-minimal` task 6) builds + serialises
  the `dashboard.json` Public_Read_Path snapshot and writes it fail-safely
  through an injected `SnapshotSink` AFTER the DB rows persist (a failed write is
  logged and swallowed, never corrupting the source-of-truth rows). Its sink is
  NO LONGER a no-op: `gcsSnapshotSink.ts` (added task 8) is the GCS-backed
  `SnapshotSink` that uploads `dashboard.json` to the public-read bucket via the
  GCS JSON media-upload REST API over built-in `fetch`, authed by the shared
  `AccessTokenProvider` (runtime SA metadata token in prod / `gcloud` ADC
  locally); `resolveSnapshotSink()` returns it when the non-secret
  `DASHBOARD_SNAPSHOT_BUCKET` env is set, else the existing fail-safe no-op.
  `snapshotHistory.ts` (`loadSnapshotHistory`) is the read-only, per-slice
  fail-safe loader that reads the snapshot HISTORY slices back from the persisted
  source-of-truth rows (all firing setups across dates, all realized outcomes,
  all evaluation reports, plus a bounded recent window — `HISTORY_WINDOW_DAYS`=400
  — of matured analogue outcomes and candles, and the derived Decision_Date list)
  so the SPA tabs render real history instead of empty state; `main.ts`
  `persistView` now calls it and hands the result to `buildDashboardSnapshot`
  (which merges today's produced view on top). A slice that fails to load
  degrades to `[]` with a secret-free warning and never breaks the run, matching
  the fail-safe snapshot write. `snapshot.ts` also carries the schema-v2
  `pairEvaluations` slice (every pair evaluated this run, fired or not, with its
  deterministic direction + earned confidence + choppiness + `fired` flag) via
  the exported `pairEvaluationRows()` mapper; `main.ts` `persistView` maps the
  full captured `PairEvaluation[]` (`cachingLoader.get()`) into it. It is
  display-only (never re-enters firing/scoring) and feeds the web Setups tab's
  silent-day run-completion readout (`web/src/pure/shapeRunSummary.ts` +
  `web/src/tabs/Setups/RunSummary.tsx`), so a no-fire day shows a credible
  "run completed" summary rather than a bare "no data" notice. `snapshot.ts`
  (schema v3) also carries the pair-INDEPENDENT `dailyCommentary` record
  `{ decision_date, note_text, generated }` — the daily AI note produced by
  `displayOnly.ts`'s `buildDailyNote` producer (which runs every trading day,
  fired or not, fail-safe) via `src/rationale/dailyCommentary.ts`; the web
  `shapeDailyNote.ts` + `DailyNote.tsx` render it in the Setups panel as the
  LLM-path liveness signal (`generated:false` → explicit "unavailable" marker).
- `csv-loader/`, `staged-runner/` — CSV backfill import + backfill/backtest/
  forward-look staged runner.
- `storage/` — Supabase config + REST client + adapters (candle, vector,
  analogue, evaluation-report, view-persister stores). The display-data WRITER
  (`displayDataPersister.ts`, which upserted `signal_rationale`/
  `external_reference_comparison`) was DELETED in `simplify-to-cloud-minimal`
  task 6.5 — that content now lives only in the `dashboard.json` snapshot; its
  surviving write-shape types moved to `displayOnlyTypes.ts`. (The gate-verdict
  and feature-registry stores were removed in earlier simplify phases.)
- `ops/` — Operational tooling: `safety/` (gcloud runner + safety guard),
  `secret-manager/`, `deploy-verify/`, `scheduler/`, `gate-run/`, `seed-run/`,
  `evaluation-run/` (the one-shot first-OOS-evaluation entrypoint added by
  `simplify-to-cloud-minimal` task 2.2 - composes + records an `EvaluationReport`
  over a fixed committed OOS split). `candle-backfill/` (added by
  `daily-candle-freshness-and-cleanup` task 12 — the one-off operator entry
  (`main.ts`) that closes the current candle gap for all five pairs by driving the
  shared `runCandleFreshnessStage` once (bounded Gap_Backfill via the provider
  chain through the existing `OhlcIngestion`); injectable + unit-tested with no
  network; executing it against hosted is the operator-gated ☁️ step (task 13)).
  `fx-writer-check/` (added by
  `simplify-to-cloud-minimal` task 5.2a.4 — a PURE verdict classifier +
  live runner that proves the `fx_writer` Scoped_Write_Credential can
  INSERT/UPDATE the retained tables via the real `SupabaseRestClient` while
  DELETE is refused). (`write-credential/` — the scoped-JWT
  `pipeline_writer` selector — was DELETED in task 6.3; it existed solely for the
  read-side security model. The single Write_Credential is the `supabase-key`
  Secret Manager secret, referenced by name in `src/storage/supabaseConfig.ts`.)
  `simplify-to-cloud-minimal` Phase 6 task 7.1 added two NON-code ops artifacts:
  `ops/required-resources.manifest.json` (the authoritative positive keep-list,
  the Required_GCP_Resource_Set) and `ops/enumerate-gcp.sh` (a STRICTLY read-only
  `gcloud list`/`describe`/`get-iam-policy` enumeration that diffs the live
  project against the manifest and labels each resource KEEP vs ORPHANED — no
  mutation; deletions are the separate operator-gated task 7.2).
- `version-policy/`, `architecture/`, `living-docs/` — version-policy audit;
  compute/storage/serving separation guard; the Living-Docs Writer.

Other roots: `web/` (the SPA, now reading the static `dashboard.json`
snapshot), `supabase/migrations/` (schema),
`ops/` + `ops.config.json` (operational config, including the
`Data_Source_Role` decision that CSV is backfill-only), `.github/workflows/`
(CI + deploy), `data/` (seed CSV candle files).

## 4. Spec completion status

| Spec | Status | Open items |
| --- | --- | --- |
| `fx-daily-pattern-assistant` | **Complete** (all tasks `[x]`) | — |
| `operational-wiring` | **Reconciled** (daily-candle R11.2) | Task 12's parent is now `[x]` (all four subtasks 12.1–12.4 were `[x]`). Task 13 (final checkpoint — cloud half) is explicitly **DEFERRED (superseded)**: the cloud half (SecretManager/DeployVerifier/Scheduler + the hosted `pipeline_writer` write path) was re-done by `simplify-to-cloud-minimal` — read-side roles dropped for a sole `fx_writer` write role, and the end-to-end cloud loop was proven live under that spec's task 8 (`scheduled-daily-run-2rrm6`, exit 0). Task 12.4's `pipeline_writer` posture is noted as superseded by `fx_writer` though left `[x]` (genuinely executed at the time). |
| `dashboard-ui` | **Reconciled** (daily-candle R11.3) | Task 17 (post-deploy Read_Proxy smoke) and Task 18 (final checkpoint) are explicitly **DEFERRED (superseded)**: the Read_Proxy (`services/read-proxy/`) and the Firebase `/api` rewrite those tasks verified were REMOVED in `simplify-to-cloud-minimal` Phase 5 (the SPA now reads a static public `dashboard.json` snapshot same-origin, no proxy). The write-rejection (`405`) / disallowed-query (`400`/`404`) smoke targets an HTTP component that no longer exists and is NOT falsely ticked; the equivalent live liveness (public `dashboard.json` anonymously fetchable, HTTP 200) was proven under `simplify-to-cloud-minimal` task 8. PLUS a new Requirement 8 criterion 8 (added this turn, format-valid): on 'All pairs', the AI / Third-party / Pattern-Outcomes tabs must render a cross-pair view over all five pairs instead of a 'pick a pair' prompt — reverses the original 8.2 dead-end that made the dashboard look empty of third-party/AI content on first load. Design addendum + task 19 (subtasks 19.1–19.7) for criterion 8 are now WRITTEN and format-valid (web/-only: compose existing pure shapers via a thin `shapeAllPairs` helper, one getSnapshot() read, per-pair no-data markers, labels preserved; design Property 16 added). Implementation of task 19 pending. (Tasks 17/18 trailing checkpoints still open.) |
| `dashboard-data-activation` | **Complete** (all tasks `[x]`) | — |
| `simplify-to-cloud-minimal` | **Complete** (all Phases 1-7 done; tasks 8, 8.1, 8.2 `[x]`). The first leak-free OOS evaluation was RECORDED (reportId `7ae77f6a-…`, +1.24pp vs baseline, below 3pp, no verdict), the Public_Read_Path snapshot uploader was IMPLEMENTED (GCS `SnapshotSink`) with its live bucket/IAM/CORS + repo vars PROVISIONED (operator-approved), and PR #25 was merged + deployed. The parent task 8 end-to-end cloud-loop proof is DONE: a live daily Cloud Run Job run (`scheduled-daily-run-2rrm6`, exit 0) wrote a `firing_setups` row for 2026-10-08 (EURUSD DOWN, conf ≈0.571, surfaced), maintained `realized_outcomes`, and published `dashboard.json` to the public bucket, verified anonymously fetchable (HTTP 200). | De-scope spec: kill-gate reframed to a human-read evaluation report (task 1), the `evaluation_reports` persistence + report write path + first-evaluation entrypoint landed (task 2.x), Phase 2/3 removed the auto-block + suppressors + research/software complexity, Phase 5 task 6 (6.1-6.5) landed the Public_Read_Path (fail-safe `dashboard.json` snapshot writer wired into the daily run, SPA repointed to a single `loadSnapshot()`, `services/read-proxy/` + read-side `src/ops/write-credential/` deleted, proxy/allowlist tests replaced with snapshot-path tests, the last `signal_rationale`/`external_reference_comparison` writer removed and its write-shape types relocated to `displayOnlyTypes.ts`), and task 5.2a cut over the `fx_writer` Write_Credential. Phase 4 is LIVE-APPLIED (task 5.3, operator-approved): migration `...006` was applied to hosted (project `bffzhjnpzxxuqvmnmylk`) after a fresh backup, reducing the schema to the 6-table Required_Object_Set; the three read-side roles (pipeline_writer, dashboard_reader, diagnostic_reader) were dropped, leaving `fx_writer` the sole write role; data preserved; idempotency confirmed; `make check` green. Phase 6 COMPLETE: task 7 simplified `deploy.yml`, task 7.1 authored the GCP manifest + read-only enumeration, and task 7.2 EXECUTED the ☁️ operator-approved GCP reconcile deletions live against project `trade-assistant-508806`. Phase 7: task 8.1 DONE (research-integrity layer confirmed intact — look-ahead guard, weekly-trend baseline, measurement math, shrinkage, realized-outcome journal, AI-never-scores guard all behaviour-unchanged — AND it surfaced + FIXED a look-ahead LEAK in `src/staged-runner/stagedRunner.ts` `buildFoldInputs` plus a follow-on performance fix, both merged to `main` via PRs #23/#24 and redeployed); task 8.2 DONE (this living-docs update). FIRST OOS EVALUATION NOW RECORDED: hosted `evaluation_reports` holds exactly one `shape-only` row (id `7ae77f6a-8d98-4d7c-a0e2-a2e5acf258b5`) and RESEARCH-LOG.md carries the matching `[EVALUATION] shape-only` entry — model accuracy 0.4996 vs baseline 0.4871, delta +1.24pp, 95% Wald CI [+0.66pp, +1.82pp], n=28470, deltaExceeds3pp=false, strength weak=16071/moderate=12351/strong=48. The shape-only pattern beats the weekly-trend baseline by a small, statistically-positive margin (CI excludes zero) but below the 3pp annotation threshold; recorded as a measured FINDING, no verdict. This is the first time the project's central premise is measured in the living log. Scope C, delete-not-quarantine. The Public_Read_Path snapshot uploader was then IMPLEMENTED (the GCS `SnapshotSink` in `src/scheduled-run/gcsSnapshotSink.ts`, wired via `resolveSnapshotSink()` on `DASHBOARD_SNAPSHOT_BUCKET`) and the live infra PROVISIONED (public-read bucket, runtime-SA object write, public read, CORS, repo vars) — all operator-approved. PR #25 was then merged + deployed, and the parent task 8 end-to-end cloud-loop proof was COMPLETED: a live daily Cloud Run Job run (`scheduled-daily-run-2rrm6`, exit 0) wrote a `firing_setups` row for 2026-10-08 (EURUSD DOWN, conf ≈0.571, surfaced), maintained `realized_outcomes`, and published `dashboard.json` to the public bucket — anonymously fetchable over HTTPS (HTTP 200). The only residue is follow-ups (the Vertex 403 for the display-only AI rationale; housekeeping), not spec work. |
| `daily-candle-freshness-and-cleanup` | **In implementation** — Phases 1-3 (tasks 1-11) DONE + merged (Candle_Freshness_Stage wired into the daily run, FCS→Twelve Data→Massive fallback chain, reusing `OhlcIngestion`); Phase 4 COMPLETE: task 12 (one-off backfill operator entry `src/ops/candle-backfill/main.ts`) + task 13 (☁️ operator-approved hosted run, 2026-10-08) DONE. The ☁️ run closed the ~3-week hole: all five pairs advanced 2026-09-15 → 2026-10-06 (Twelve Data served the range; 15 accepted/0 rejected per pair; verified live), with a benign one-day residual to 2026-10-07 the next Daily_Top_Up will take (R3.3). `make check` + web build green. Phase 5 task 14 (+ 14.1) DONE: Phase 5 COMPLETE (tasks 14 + 15). Task 14 added the READ-ONLY `verifyFreshness` helper + unit tests (`src/scheduled-run/freshnessVerification.ts`); task 15 added the read-only operator entry `src/ops/freshness-verify/main.ts` (+ tests, `make check` green 763 passed/6 skipped) and EXECUTED the ☁️ operator-approved LIVE read-only verify against hosted (`bffzhjnpzxxuqvmnmylk`, Decision_Date 2026-10-08): `dashboard.json` Decision_Date 2026-10-08 ⇒ snapshot reflects fresh history (R6.1 PASS); all five pairs latest 2026-10-06 vs target 2026-10-07 ⇒ the known benign one-day provider-availability residual (R6.2 FINDING, not a defect; next Daily_Top_Up closes it); no write performed. Remaining: Phase 6 cleanup R7-R11, Phase 7. Phase 6 task 16 (☁️ Vertex 403, R7) DONE `[x]`: diagnostics confirmed `roles/aiplatform.user` (includes `aiplatform.endpoints.predict`) was ALREADY bound to `job-runtime@` (IAM audit: ADDED 2026-10-08 17:58Z) and the logged 403 (2026-10-08 12:34Z) PREDATED that grant; `gemini-2.5-flash` reachable in `europe-west1` (countTokens HTTP 200). Manifest `rolesNote` records the verified least-privilege grant (R7.3). An operator-approved ☁️ manual Job run (`scheduled-daily-run-962h6`, exit 0) produced NO predict-403 and published a fresh `dashboard.json` (decisionDate 2026-10-09); zero pairs fired that day so the per-firing-pair rationale (R7.2) will self-confirm on the next firing day (operator accepted the 403 resolution as sufficient). Remaining in Phase 6: tasks 17-20 (R8-R11) + Phase 7. | New combined spec. Fixes a confirmed candle-data freshness DEFECT (hosted `candles` only to 2026-09-15; the daily Job never ingests fresh candles) via a Candle_Freshness_Stage that daily-tops-up + auto gap-backfills BEFORE the pipeline reads history, through the existing `OhlcIngestion` (Look_Ahead_Safe, idempotent, fail-safe), fed by a provider FALLBACK CHAIN FCS → Twelve Data → Massive (keys already in `.env`; first usable candles win, cascade on failure, normalize each response to one `RawCandle`), plus a one-off backfill for the current hole. Also bundles the leftover cleanup: Vertex AI 403 (R7), ~50MB git-history backup removal (R8), Dependabot triage/fix (R9), `.env` secret rotation+untrack (R10), trailing cross-spec checkpoint reconcile (R11), living docs/verification (R12). The design grounds the OHLC_Feed_Provider two-capability port (fetchLatest/fetchRange) + the FCS→Twelve Data→Massive fallback chain (FCS latest-only, so a multi-day range routes to Twelve Data/Massive), the Candle_Freshness_Stage reusing `OhlcIngestion` before the pipeline, a bounded 90-day backfill, a one-off operator backfill entry (`src/ops/candle-backfill/main.ts`), and cleanup R7–R11; tasks are 22 across 7 phases with the live-cloud items (one-off backfill, Vertex grant, secret rotation, hosted verify) operator-gated. Next: implement (start Phase 1). |

Cross-spec note (RECONCILED — daily-candle R11.1): `dashboard-data-activation`
Task 16 ran `dashboard-ui` Task 17's read-only smoke against the then-live
Read_Proxy and recorded it done. The Read_Proxy and the `/api` rewrite were
LATER removed by `simplify-to-cloud-minimal` Phase 5 (the SPA now reads a static
public `dashboard.json` snapshot). The two documents are now consistent:
`dashboard-data-activation` Task 16 stays `[x]` (genuinely executed at the time)
with a reconciliation note recording the supersession, and `dashboard-ui` Task 17
is explicitly DEFERRED (superseded) rather than ticked — the smoke it describes
targets an architecture that no longer exists, and the current public read path's
liveness was proven under `simplify-to-cloud-minimal` task 8.

## 5. Build / test / CI

- `make check` ≡ `npm run check` ≡ `eslint . && tsc --noEmit && vitest run`.
  (The isolated Python cross-check and the `make check-all`/`py-*` targets were
  removed in `simplify-to-cloud-minimal` Phase 3 task 4; the TypeScript property
  test in `src/confidence/` is the sole authority for the shrinkage formula.)
- **CI** (`.github/workflows/ci.yml`): on every push/PR — two jobs. The
  `quality` job runs the backend gate (Node from `.nvmrc`, `npm ci`, then
  Lint / Type-check / Tests / Version-policy as distinct stages, no
  `continue-on-error`). The `web` job verifies the SPA (`web/` working dir, own
  lockfile cache: `npm ci`, `npm run build` = `tsc --noEmit && vite build`,
  `npm run test`). The SPA now carries `@types/node` with `"node"` in its
  tsconfig `types`, so the build type-checks the Node-built-in imports in its
  test files under a clean CI install. (The Python cross-check is not wired into
  CI.)
- **Version-policy stage (hardened).** The Version-policy CI stage
  (`scripts/version-policy.mjs`) now (a) audits BOTH the root AND the `web/`
  package trees for exact, non-prerelease pins (previously it only audited root),
  and (b) enforces `SUPPORTED_MAJOR_CEILINGS` (`typescript<=6`,
  `@types/node<=22`, `react`/`react-dom`/`@types/react`/`@types/react-dom<=18`,
  `recharts<=2`) via the pure `auditCeilings` logic in the shared
  `src/version-policy/audit.js` (typed by `audit.d.ts`, surfaced through
  `versionPolicy.ts` as `VersionPolicyCheck.auditCeilings`), failing CI
  (non-zero exit) if any pin exceeds its supported major. The ceilings are kept
  consistent with the `.github/dependabot.yml` ignore rules and exist because
  TypeScript 7 is blocked upstream (typescript-eslint peer stops `<6.1.0` until
  the TS 7.1 API) and React 19 / recharts 3 are deferred breaking migrations.
  Covered by `src/version-policy/ceilings.test.ts` (7 unit + 2 fast-check
  property tests).
- **Deploy** (`.github/workflows/deploy.yml`): on push to `main`, a two-target
  path-filtered pipeline. A `changes` job (`dorny/paths-filter@v3`) emits
  `backend`/`frontend` flags. BACKEND (gated on `backend`): full quality gate →
  keyless WIF auth → Cloud Build SHA-tagged image → Artifact Registry →
  `gcloud run jobs deploy` to the Cloud Run Job as a least-privilege runtime SA.
  Non-secret config via `--set-env-vars`; every secret via `--set-secrets`
  (`<name>:latest`) — no secret value in the file. As of
  `simplify-to-cloud-minimal` Phase 6 task 7 the `--set-secrets` list was
  simplified to only the five secrets a retained runtime module reads
  (`external-signal-api-key`, `supabase-key` = the `fx_writer` Write_Credential,
  `supabase-publishable-key`, `supabase-url`, `supabase-pooler-url`); the six
  provider secrets for removed subsystems (alpha-vantage, twelve-data, finnhub,
  massive, news, news-calendar) were dropped. No read-proxy/RLS/scoped-read/
  read-view step ever existed in this workflow to remove; the WIF deploy identity
  and both deploy targets are unchanged. FRONTEND (gated on
  `frontend`): `web-quality-gate` (build + tests) → `deploy-frontend`
  (`firebase deploy --only hosting` from `web/`), reusing the same keyless WIF
  identity, authenticating to firebase-tools via `GOOGLE_APPLICATION_CREDENTIALS`
  (ADC); no stored `FIREBASE_TOKEN` or SA key (the deprecated `FIREBASE_TOKEN`
  env was removed). A skipped path-filter gate cascades to skip its dependent
  deploy. The deploy SA was granted `roles/firebasehosting.admin` (live grant
  applied), which the frontend job requires.

## 6. Strategic decisions

- **`fx_writer` write credential uses a BYO imported ES256 signing key (operator-approved, 2026-10-07).** Task 5.2a.3 assumed `fx_writer` could be minted offline with the project's own signing key "the same asymmetric-key model as the `pipeline_writer` JWT". Live reconciliation showed the active hosted signing key (`680889e6-…`, ES256/P-256, `in_use`) is Supabase-managed and non-exportable, so offline minting against it is impossible, and the BYO-key material once in `.env` is stale/revoked (`f85d3e2d-…`) or not a usable key. Decision: generate a fresh P-256 keypair locally, import its PRIVATE JWK into Supabase as a STANDBY key (so JWKS publishes the public half for PostgREST verification) and mint the `fx_writer` token locally with the matching private key (header `kid`=the standby key id). Service-role writing was rejected (bypasses RLS; reserved for operator one-offs). This preserves the PostgREST scoped-JWT model while adapting to Supabase's current managed-key reality. Private key lives only in gitignored `ops/fx-writer-key/` and is never committed or logged.

- **Dimensional minimalism / gate-first build order.** The kill-gate was built
  before feature discovery so the first thing the project learns is whether a
  shape-only daily pattern even beats the weekly trend. Features are added one at
  a time, each must pass both gates, failures are cut and logged.
- **AI division of labor.** Scoring and gate verdicts are AI-free by
  construction; a `ScoringInputGuard` + property test assert no LLM output
  reaches those paths.
- **Kill-gate reframe landed by addition, not rename (simplify task 1).** The
  human-read `EvaluationReport` + `composeEvaluationReport` were added beside
  the legacy `composeGateVerdict`/`GateVerdict` PASS/CUT path rather than
  renaming it, because the legacy verdict is still wired into
  `src/staged-runner/`, `src/ops/gate-run/`, and `web/`. This keeps the
  'measure-first, keep the loop green at every step' sequencing honest; the
  transitional legacy path is removed in tasks 2/2.1 (persistence + Living-Docs
  retargeted to `evaluation_reports` with no verdict column). The gate math
  (`evaluateGate1`/`evaluateGate2`, walk-forward pooling) is unchanged.
- **Supabase scoped-write credential.** The pipeline writes using an **ES256 JWT
  signed with an operator-held BYO asymmetric key**, role claim
  `pipeline_writer`, stored as the `supabase-key` Secret Manager secret.
  `SupabaseRestClient` splits `apikey` (publishable/anon — API-gateway
  admission) from `Authorization: Bearer` (the scoped JWT — the write path). The
  RLS-bypassing service-role key is reserved for operator one-offs and is never
  stored as `supabase-key` or referenced in `deploy.yml`.
- **RLS + least privilege.** RLS is enabled on the compute-written tables; the
  `pipeline_writer` role has SELECT/INSERT/UPDATE but **no DELETE**. Migrations
  `...002` (scoped write) and `...004` (gate tables grant) establish this; `...004`
  had to precede the live Gate_Run or its writes would be refused.
- **Live Cloud Execution Protocol.** `OperationalSafety` + `GcloudRunner`
  reconcile the active gcloud project/account and Supabase target before any
  live op, require operator approval showing the exact command, pass secrets
  only on stdin (never argv/logs/commits), and record only non-secret
  references.
- **Serving separation.** The SPA is strictly read-only; only the read-proxy
  touches Supabase, through a fixed allowlist with a SELECT/GET-only client. A
  `servingLayerGuard` test enforces the compute/storage/serving boundary.
- **Automated, keyless, path-filtered deploys for both targets.** The frontend
  SPA deploys to Firebase Hosting on merge to `main` (previously manual), via the
  same `deploy.yml` as the backend Cloud Run Job. A `dorny/paths-filter` job
  routes backend-only vs frontend-only commits so each target redeploys only
  when its own files change (a workflow-file change triggers both). Both deploys
  are keyless — the frontend reuses the backend's Workload Identity Federation
  identity and passes a short-lived OAuth access token to firebase-tools rather
  than storing a long-lived `FIREBASE_TOKEN` or SA key, keeping the frontend's
  security posture consistent with the backend's. The SPA also gained CI
  coverage (the `web` job), closing the prior gap where a broken frontend could
  merge undetected.
- **CSV is backfill, not a feed.** `ops.config.json` records
  `Data_Source_Role = { csv: { role: "backfill" } }` — run once to seed history,
  not a recurring source.
- **Display-only producers wired via `fetch`, not SDKs.** Both the Gemini
  rationale (Req 15) and the third-party reference (Req 23) are reached over the
  built-in `fetch` against REST endpoints rather than vendor SDKs. This keeps the
  core's zero-runtime-dependency property and lets the Gemini adapter live in the
  single sanctioned `src/llm` layer without tripping the import-boundary guard
  (which forbids SDK packages anywhere in `src/`). Both producers are optional
  and fail-safe: an unconfigured or failing provider degrades to "no rationale" /
  "reference unavailable" for the affected pair and never blocks the deterministic
  firing view from being persisted. Weekday gating is defence-in-depth: the
  scheduler cron is restricted to Mon–Fri (`0 17 * * 1-5`) and `main.ts`
  additionally early-exits on a weekend Decision_Date.
- **Living docs stay live via two agent hooks + the in-code writer.** The
  machine-managed STATE block is owned by `LivingDocs.updateState()`; the prose
  is kept current by two Kiro hooks in `.kiro/hooks/`:
  `keep-project-state-live.json` (trigger `Stop`) fires after any turn with a
  meaningful change/fix/decision, and `update-living-docs.kiro.hook` (trigger
  `postTaskExecution`) fires at spec-task boundaries. Both edit only the STATE
  block's three lines plus the affected prose, never write secrets, and leave
  RESEARCH-LOG.md (kill-gate verdicts) and LESSONS.md (constraints) alone. The
  literal BEGIN/END STATE marker strings appear exactly once in this file so the
  writer's first-match lookup targets the real block.
- **Operator deployment constraints (stated, binding).** The operator has
  confirmed two hard constraints that the simplicity audit must respect:
  (1) execution MUST be cloud — Cloud Run Job + Cloud Scheduler; local/laptop
  cron is not an option; and (2) the dashboard MUST be reachable from mobile,
  i.e. a hosted public URL, not localhost. This shifts the audit's de-scope
  target from "local-first" to "cloud-minimal single-user": Cloud Run Job,
  Cloud Scheduler, a hosted mobile-friendly dashboard, Secret Manager, and a
  minimal deploy path all become justified (move from DEFER toward KEEP). What
  these constraints do NOT justify (one trusted user, not hostile multi-tenant):
  the separate read-proxy service, RLS + scoped ES256 JWT `pipeline_writer` role
  + read views + diagnostic read path, and dual/keyless CI-CD ceremony — these
  stay REMOVE/SIMPLIFY. New concern introduced: a public URL needs ONE
  lightweight access gate (Firebase Auth single-user, a shared token, or Cloud
  Run IAP) in place of the removed security apparatus. The §13 kill-gate
  conclusion is unaffected (where it runs ≠ whether software auto-decides
  PASS/CUT). The audit document has NOT yet been edited to add this
  "revised under cloud + mobile constraints" section — pending the operator's
  auth preference. This turn was analysis only; no code, config, or document
  change was made.
- **Three further operator decisions (refine the above; originally captured as
  analysis only — since ACTIONED in code, see the closing bullet below).**
  (1) **Public data** — the operator confirms the data
  does not need protecting; it is fine for the public to see it. This REMOVES
  the entire read-side security layer (read-proxy service, RLS, scoped ES256 JWT
  `pipeline_writer` role, read views, diagnostic read path) and WITHDRAWS the
  public-URL auth-gate concern from the prior bullet — the dashboard can be a
  plain public URL. What still matters: API keys and the single DB write
  credential stay in Secret Manager, and the write path must not be publicly
  writable (public read OK, public write not). (2) **Choppiness guard →
  REMOVE as a suppressor** (and the currency-concentration guard likewise):
  these silently decide what the operator may see, the same objection as the
  §13 kill-gate. Keep the choppiness/efficiency metric only as a DISPLAYED field
  so the operator decides whether to stay out — do not suppress. (3) **Keep
  GitHub Actions deployment → KEEP** (convenient for the operator and consistent
  with mandatory cloud execution); treat keyless-WIF vs stored-key as "keep
  whatever already works, don't invest more ceremony" rather than a hard
  requirement. Net de-scope target is now simpler than "cloud-minimal
  single-user": Cloud Run Job + Cloud Scheduler + hosted public-read Postgres +
  public hosted mobile dashboard (no auth gate) + Secret Manager (keys + write
  cred) + GitHub Actions deploy; NO read-proxy, RLS, scoped JWT, read views,
  diagnostic path, auth gate, or choppiness/concentration suppressors. This
  target is now captured authoritatively in audit **§14**. (Originally captured
  document-only as a recommendation; see the closing "§14 recommendations now
  ACTIONED" bullet below — the removals have since been executed in code and
  reconciled on the live estate.)
- **Gate_Auto_Block and the suppressors are now REMOVED in code
  (`simplify-to-cloud-minimal` task 3, Phase 2).** The prior two bullets recorded
  these as recommendations; this turn actioned them. `fires()` is now purely
  `direction !== "FLAT" && earnedConfidence >= threshold` — no configuration is
  ever prevented from driving a displayed observation by an automatic gate, and
  no setup is silently suppressed. The gate-passing resolver (`gatePassingResolver.ts`
  + `makeGatePassingResolver` + its wiring in `scheduled-run/main.ts`), the
  Choppiness_Guard suppressor, and the Currency_Concentration_Guard are deleted;
  the choppiness/efficiency metric survives only as a DISPLAYED field. The
  `PairEvaluation` shape dropped `gatePassing`/`newsSuppressed` and gained
  `choppiness`; `suppression_reason` shrank to `below_floor`/`not_fired`. News
  gated firing via `newsSuppressed`, so dropping that field also removed the
  pipeline's news-resolver wiring (the `src/news-filter/` module itself is left
  for R7/Phase 3). Suppression/auto-block tests were deleted and replaced with
  no-suppression tests (every pair's observation is displayed, incl. an explicit
  "no trade"); `make check` stays green. The DORMANT legacy `gate_verdicts` PASS
  path and the SQL `suppression_reason`/`competing_pairs` schema objects are
  intentionally left for Phase 4 task 5 (schema reduction), and the `web/` SPA's
  snapshot wire-format cleanup for Phase 5.
- **Phase 3 complexity removal landed in code (`simplify-to-cloud-minimal` task 4,
  4.1-4.6).** The audit §14 'remove software not serving the core idea'
  recommendation is now actioned at code level (schema/table drops remain for
  Phase 4, SPA wire-format for Phase 5). Deleted outright (delete-not-quarantine):
  `src/research-assistant/`, `src/architecture/servingLayerGuard`, `src/yields/`,
  `src/features/` (candidate-feature set), `src/feature-registry/`, and the top-level
  `python/` cross-check with its Makefile/`.dockerignore`/`.gitignore`/`package.json`
  references. The Strategy_Source multi-strategy abstraction was removed from the
  domain model (`StrategyId` type and `strategyId` store keys gone; the retained
  Supabase write path keeps a single hardcoded `'system'` column default until the
  Phase 4 schema drop). `src/risk-boundaries/` is explicitly KEPT (R7.6) because it
  feeds the firing-card SL/TP; a new display-only guard test proves perturbing its
  config moves SL/TP but leaves every scoring field byte-for-byte identical. Two
  deliberate non-deletions: the `research_assistant` LLM role in `src/llm/` (a
  sanctioned LLM-interface role, distinct from the deleted module) and the dormant
  `gate_verdicts` verdict path (dropped in Phase 4). `make check` green at every
  subtask (633 tests). Changes are local, not committed/pushed.
- **Write_Credential cutover keeps the scoped-JWT REST model (Option A,
  `simplify-to-cloud-minimal` task 5.2a scoping).** The dashboard went public
  (read side de-secured), but the WRITE path still needs a credential, and the
  Cloud_Run_Job writes through PostgREST/REST, not direct Postgres. So the single
  Write_Credential `fx_writer` is modelled exactly like the outgoing
  `pipeline_writer`: a NOLOGIN Postgres role that `authenticator` is a member of,
  assumed via a signed JWT whose `role` claim is `fx_writer` and carried in the
  `Authorization: Bearer` header alongside the publishable `apikey`. A bare
  password/login role was explicitly rejected because `SupabaseRestClient` has no
  direct-Postgres path. Consequence: the cutover is a role provision + JWT re-mint
  + `supabase-key` secret rotation with NO change to `client.ts`/`supabaseConfig.ts`
  (they are role-name-agnostic by design). This is a pragmatic deviation from the
  stricter reading of "remove the scoped-JWT security" — under public data the JWT
  no longer protects reads (reads are open); it only names the write role, which is
  the minimum needed to keep the write path non-public (R4.5/R4.6). The scoping also
  found migration `...006` STEP 7 was missing `grant fx_writer to authenticator`
  (without it PostgREST rejects the role with `42501`); task 5.2a.1 fixes it. No
  code or cloud change was made this turn — this is the scoped plan only.
- **Phase 4 schema-reduction migration authored locally; hosted apply gated
  behind Phase 5 (`simplify-to-cloud-minimal` tasks 5.1 + 5.2).** The reconcile
  follows the design's "reconcile-to-known-good" shape: a single authoritative
  Required_Object_Set keep-list (the six retained tables + extensions + indexes;
  NO project-created roles/views/RLS policies under public data) is defined
  positively in migration `...006`, and a read-only `information_schema`/
  `pg_catalog` enumeration/diff query classifies every live object as kept vs
  orphaned (acting on real account contents, not assumed migration history). The
  destructive half is strictly ordered DATA-PRESERVE-THEN-DROP: the
  Realized_Outcome_Journal is back-filled into `realized_outcomes`
  (`on conflict do nothing`, `to_regclass`-guarded) BEFORE any drop, then 9
  views, all RLS policies, 11 orphaned tables, and 3 project-created roles are
  dropped, and public `SELECT` + `fx_writer`-restricted `INSERT`/`UPDATE` (no
  `DELETE`, no RLS row policies) are granted. Every statement is idempotent so
  re-running is a no-op (R10.5). Two deliberate scope boundaries: (a) the
  enumeration SELECT is left COMMENTED so applying the migration performs no
  account-wide read; (b) the HOSTED apply (task 5.3) is a separate
  operator-approved ☁️ step. **Operator decision this turn:** 5.3 is DEFERRED
  until after Phase 5, because the migration drops `signal_rationale` and
  `external_reference_comparison`, which still have a live writer
  (`displayDataPersister.ts` via `scheduled-run/main.ts`) that Phase 5
  (tasks 6-6.4) removes. Applying the hosted drop earlier would break the daily
  run with Postgres `42P01 (undefined_table)`. The constraint is documented
  inline in the migration (STEP 5 note). Changes are local, not committed/pushed,
  and NOT applied to any live target.
- **Hosted schema reconcile (`...006`) is APPLIED; the datastore is now at the
  public-data end state (`simplify-to-cloud-minimal` task 5.3, operator-approved).**
  Migration `...006` was applied to the hosted project `bffzhjnpzxxuqvmnmylk`
  after a fresh backup, reducing the schema to the 6-table Required_Object_Set
  with public read, `fx_writer`-only write (INSERT/UPDATE, no DELETE), no RLS
  policies, and no read-side roles or views. Three robustness fixes to the
  migration were needed SPECIFICALLY because hosted Supabase runs `postgres` as a
  NON-superuser and auto-enables RLS on new public tables — a durable fact worth
  recording for any future hosted migration: (1) STEP 6 must grant each
  about-to-be-dropped role to current_user WITH INHERIT TRUE before `drop owned
  by`; (2) STEP 4 must explicitly disable RLS on a freshly created public table
  (here `evaluation_reports`); (3) STEP 3 policy drops must be `to_regclass`-guarded
  (a DO loop) for re-apply idempotency. Also durable: hosted DDL from local must
  go through the IPv4 `SUPABASE_POOLER`, because the direct db host is IPv6-only.
- **Public_Read_Path = static JSON snapshot; read-proxy + read-side security
  removed in code (`simplify-to-cloud-minimal` Phase 5 task 6).** Design
  Decision 2 chose a static `dashboard.json` snapshot over direct PostgREST: the
  Cloud Run Job writes one file at the end of each daily run and the SPA fetches
  that same-origin static asset — no proxy, no PostgREST coupling, no auth gate,
  nothing public but a flat JSON file (matches "data is public"). This turn
  actioned it: ADDED a fail-safe snapshot writer (`src/scheduled-run/snapshot.ts`,
  wired AFTER the DB rows persist so a snapshot failure never corrupts the
  source-of-truth rows); DELETED `services/read-proxy/` in full and the SPA's
  ten-endpoint client + `endpoints.ts` allowlist + the Firebase `/api` rewrite,
  replacing them with a single typed `loadSnapshot()` + shared `snapshotCache`;
  DELETED `src/ops/write-credential/` (the scoped-JWT `pipeline_writer` selector,
  read-side-only) while RETAINING the single `supabase-key` Write_Credential by
  name; the Gate tab was reframed from PASS/CUT verdict cards to the human-read
  evaluation-report view (R1-aligned). `make check` + web build/tests green;
  grep confirms no dangling proxy/allowlist/write-credential/`/api` references.
  SEQUENCING (corrected, then resolved): task 6 did NOT by itself unblock the
  parked hosted reconcile (task 5.3). It added the snapshot writer BESIDE the
  existing display-table writer, so `signal_rationale`/`external_reference_comparison`
  were still written and dropping them on hosted would have broken the run with
  `42P01`. The actual unblocking step was a NEW task 6.5, which is NOW DONE:
  `makeDisplayDataPersister` + its DB-write call + the `displayDataPersister.ts`
  module (and its integration test) are DELETED; the three write-shape types the
  snapshot still needs were relocated to `src/storage/supabase/displayOnlyTypes.ts`;
  `displayOnly` is still built and still fed to `buildDashboardSnapshot`, so the
  display content lives only in `dashboard.json`. Verified (independently + `make
  check` green) that no retained code writes either table. Task 5.3 is now
  genuinely safe to apply. Two deliberate scope boundaries left for later: the `deploy.yml`
  pipeline simplification is Phase 6 task 7 (only a stale comment corrected), and
  the snapshot sink is a logged no-op until the Phase 6 uploader is wired. Changes
  are local, not committed/pushed; no live cloud resource touched.
- **Phase 6 deploy simplification + GCP reconcile is split code-first,
  deletions-last (`simplify-to-cloud-minimal` task 7 + 7.1 done; 7.2 pending).**
  The GCP cleanup follows design Decision 4's reconcile-to-known-good shape:
  `ops/required-resources.manifest.json` is the authoritative POSITIVE keep-list
  (Required_GCP_Resource_Set) and `ops/enumerate-gcp.sh` is a strictly read-only
  `gcloud` diff that classifies live resources KEEP vs ORPHANED. The non-destructive
  halves — simplifying `deploy.yml` (task 7) and authoring the manifest +
  enumeration (task 7.1) — landed this turn with `make check` green; the destructive
  half (task 7.2: deleting the `dashboard-read-proxy` service, the `dashboard-seed-run`/
  `dashboard-gate-run` jobs, obsolete secrets, stale images, dangling IAM/SAs) is a
  SEPARATE ☁️ operator-approved step and was deliberately NOT run — the orphan set is
  already enumerated and awaits approval of the exact delete commands. On `deploy.yml`,
  the only removal was secret-list trimming (six provider secrets for removed
  subsystems); the Job's `supabase-key`/`fx_writer` write path, the publishable
  apikey, the FCS key, both deploy targets, and the keyless WIF identity are all
  retained — confirming there was no read-side-security wiring in the workflow itself
  (it had lived in `services/read-proxy/` + the Firebase `/api` rewrite, both already
  removed in Phase 5).
- **OOS evaluation path: honest model prediction + in-memory retrieval (`simplify-to-cloud-minimal` task 8).** Two coupled corrections to `src/staged-runner/stagedRunner.ts` `buildFoldInputs` (the SHARED fold builder for both the evaluation-report and legacy verdict paths). (a) Correctness: the model's directional prediction for a decision date is now sourced from the Analogue_Neighborhood retrieved AS OF that date (`retrieve`→`selectHorizon`→`dominantDirection`/`earnedConfidence`/`excursionProfileAt`), NOT from the matured outcome it is scored against — closing a look-ahead leak that had produced a tautological `model=1`. `actual` is still the matured outcome; the baseline keeps its Weekly_Trend_Follow derivation; the gate math (gate1/gate2/verdict) is untouched. (b) Performance: because `retrieve` is now called per firing date, each pair's stored vectors + full matured-outcome set are bulk-loaded from the hosted stores ONCE and mirrored into `InMemoryPatternVectorStore`/`InMemoryAnalogueStore` (identical ports → byte-identical retrieval), so per-date retrieval is served in-memory and the hosted round-trip count collapses from ~2,500 to ~10. This is what makes the honest evaluation finish inside the Cloud Run Job timeout. Guard tests: `buildFoldInputsLeak.test.ts` (regression), `buildFoldInputsNoLeak.property.test.ts` (property), `buildFoldInputsPreload.test.ts` (byte-identical + bounded round-trips).
- **Run the first OOS evaluation INSIDE the Cloud Run Job, not locally (`simplify-to-cloud-minimal` task 8, operator-approved).** The honest evaluation does heavy per-date retrieval over the full OOS year; running it from a dev machine over the public internet proved too slow/fragile (a transient `fetch failed` aborted a ~30-min run with no resume). Decision: execute it as a one-off `gcloud run jobs execute scheduled-daily-run` with per-execution overrides (`--args dist/ops/evaluation-run/main.js`, `--update-env-vars EVALUATION_RUN_DOCS_DIR=/tmp`, raised `--task-timeout`) against the deployed image — co-located with the DB, robust. The in-container RESEARCH-LOG append is ephemeral (`/tmp`); the durable record is the hosted `evaluation_reports` row, synced back into the repo RESEARCH-LOG.md afterward.
- **Audit §14 cloud-minimal recommendations are now ACTIONED, not merely
  recommended (`simplify-to-cloud-minimal`, closed task 8.2).** The de-scope
  target captured in audit §14 and the three further operator decisions (public
  data, drop the suppressors, keep GitHub deploy) have been realised end-to-end,
  in code AND on the live estate — the cloud-minimal architecture now exists:
  (a) the removed subsystems are gone in code — the read-proxy service + its code
  and `/api` rewrite, the entire read-side security layer (RLS, scoped-read role,
  diagnostic read path, read views), the Python cross-check, yields + the feature
  registry, the research-assistant module, the serving-layer guard, and the
  auto-block + the choppiness/concentration suppressors (choppiness survives only
  as a displayed metric); (b) the hosted schema was reduced to the six-table
  Required_Object_Set and the live GCP estate reconciled against the positive
  keep-list (Phase 4 task 5.3 + Phase 6 task 7.2, both operator-approved); (c) the
  Public_Read_Path static `dashboard.json` snapshot ships in place of the proxy;
  (d) the kill-gate was reframed from an auto-blocking PASS/CUT verdict to a
  human-read evaluation report; and (e) the first evaluation is recorded (see §7).
  The historical bullets above are kept as the decision trail; this bullet marks
  the recommendation as DONE.
- **Public_Read_Path realised as a public GCS bucket (Option A, operator-approved).**
  The deferred snapshot uploader is now wired: the daily Cloud Run Job writes
  `dashboard.json` to a public-read GCS bucket (`trade-assistant-508806-dashboard`)
  via a zero-SDK `SnapshotSink` (`src/scheduled-run/gcsSnapshotSink.ts`) using the
  GCS JSON media-upload REST API over built-in `fetch`, authed by the existing
  `AccessTokenProvider` (runtime SA metadata token / local ADC) — no new auth, no
  SDK, fail-safe (a failed upload is logged+swallowed and never corrupts the
  persisted rows). The hosted SPA fetches that object cross-origin
  (`VITE_SNAPSHOT_URL`), with the CSP `connect-src` widened to
  `https://storage.googleapis.com` only. Firebase Hosting cannot rewrite to a raw
  bucket and reintroducing a serving service was rejected, so under the public-data
  decision a cross-origin fetch of a public bucket object is the minimal path. Live
  infra (bucket, runtime-SA object write, public read, CORS, repo vars) provisioned
  operator-approved.
- **Candle freshness via a provider fallback chain (new spec `daily-candle-freshness-and-cleanup`, requirements phase).** The live loop was found to run on stale candles (hosted history ended 2026-09-15 with no daily ingestion). The chosen fix adds a Candle_Freshness_Stage to the daily run that tops-up the prior day's candle and auto-backfills any gap BEFORE the deterministic pipeline reads history, reusing the existing `OhlcIngestion` validation + idempotent `(asset,date)` upsert (Look_Ahead_Safe, no re-implementation). Data comes from an ordered Provider_Fallback_Chain — FCS (primary, the connection already used for the display-only cross-reference) → Twelve Data → Massive — each resolved from its own `.env` API key by name (`EXTERNAL_SIGNAL_API_KEY` / `TWELVE_DATA_API_KEY` / `MASSIVE_API_KEY`), tried in order with first-usable-wins and skip-and-proceed-on-total-failure, each native response normalized to the single internal `RawCandle` shape over zero-SDK `fetch`. This keeps the daily loop producing current-day signals and self-heals a missed run, without a new credential or provider dependency. Requirements only so far; design/tasks/implementation pending.
- **Incremental CI/CD delivery cadence (operator).** Work ships milestone-by-milestone: implement a coherent task set locally (keeping `make check` + web build green), the operator merges `dev`→`main` to trigger the Deploy workflow, verify, then the next milestone. The agent builds + verifies locally and does NOT run GitHub/PR/merge/deploy actions — the operator handles all GitHub. ☁️ live steps (one-off backfill, Vertex grant, secret rotation) remain operator-gated with the exact command shown first.
- **Dashboard "All pairs" shows cross-pair detail, not a pick-a-pair prompt (dashboard-ui Req 8 criterion 8, this turn).** The operator's "nothing from the third-party API" report was diagnosed as a UX dead-end, not a data defect: the FCS external-comparison data is present in the live `dashboard.json` and the deployed SPA is current, but the AI, Third-party, and Pattern/Outcomes tabs each render a "pick a pair" prompt when the Pair_Selector is on the default "All pairs" (original dashboard-ui Req 8.2). Decision: those three per-pair tabs will render a cross-pair view over all five pairs on "All pairs" (verbatim snapshot values + explicit per-pair no-data markers), matching how the Setups tab already behaves, so the default landing view never hides present data. Requirements amended + format-valid; implementation pending.
- **Supported-major dependency ceilings enforced in CI; React 19 / recharts 3 / TS 7 deferred (operator-approved, this turn).** To stop recurring Dependabot ERESOLVE / unsupported-major CI failures, a durable supported-major ceiling is now enforced across BOTH package trees via `auditCeilings`/`SUPPORTED_MAJOR_CEILINGS` in `scripts/version-policy.mjs`, with matching `.github/dependabot.yml` ignore rules. React 18→19, recharts 2→3, and TypeScript 5→7 are held as explicit, CI-guarded DEFERRED migrations (recharts 3 breaks the Tooltip Formatter API; React 19 has recharts-2 peer constraints; TS 7 is blocked upstream by typescript-eslint until the TS 7.1 API) rather than being force-upgraded now. See §9 bucket (e).
- **Silent no-fire day shows a credible run-completion readout, not a bare "no data" (operator-requested, this turn).** The operator noted that the silent-by-default design made a successful-but-nothing-actionable run indistinguishable from a broken/absent run. Decision: on a no-fire day the Setups tab's silent state renders an affirmative "run completed, evaluated N pairs, M met the threshold" summary plus a per-pair readout of each pair's deterministic direction + earned confidence (vs the 0.55 threshold) + choppiness. This required carrying the non-firing pairs' evaluations outward: a new display-only `pairEvaluations` snapshot slice (schema v2) populated in `main.ts` from the already-captured full `PairEvaluation[]` (confidence for non-firing pairs was previously computed then dropped by `dailyRun`). The silent-by-default product behaviour is preserved — no fabricated actionable setups — only the "completed vs broken" ambiguity is removed. The readout is scoped to the silent state (firing days render cards as before). These values are display-only and never re-enter the firing/scoring path (AI/Deterministic boundary untouched). Code complete + locally verified; live after the operator deploys both halves and re-runs the Job.
- **Daily AI commentary note as an LLM-path liveness signal, reusing `signal_rationale` (operator-requested, this turn).** The operator noted the AI content stayed empty on no-fire days (the rationale producer only ran for firing cards), so a working AI layer was indistinguishable from a broken one. Decision: generate a short display-only whole-day note on EVERY trading day (fired or not) and render it in the Setups panel. To respect the AI/Deterministic boundary WITHOUT widening the hard-coded role allow-list, it REUSES the sanctioned `signal_rationale` role (its `SignalRationaleInput` is an open structural map, so a richer whole-day payload is valid) rather than adding a `daily_commentary` role; the prompt is built only from deterministic `PairEvaluation` numbers (direction, Earned_Confidence vs threshold, choppiness) and the output is `LlmTagged<string>`, so it is structurally excluded from scoring. It is carried in a NEW pair-INDEPENDENT `dailyCommentary` snapshot slice (schema v3) — not the per-pair `aiRationale` slice — because the AI tab is pair-gated and blank on "All pairs". `generated:false` + empty text when the LLM path is unavailable, surfaced as an explicit "AI commentary unavailable" marker (never fabricated); the note's PRESENCE is itself the liveness signal. Fully fail-safe (no LLM / provider error → no note, run unaffected). Code complete + locally verified (backend 790 tests, web 167 tests); DEPLOYED + LIVE-VERIFIED 2026-10-09 (schema v3 snapshot, `generated=true`, real note, no provenance leak). One cosmetic follow-up open: the live note reads truncated mid-sentence (see §7).

## 7. Obstacles / open risks

- **`operationalSafety.secretRedaction` property test flakiness — FIXED this turn, but WATCH (2026-10-09).** This fast-check property failed post-merge on `main` (passed on `dev` — a seed-dependent false positive, not a code regression; the operator saw it as a CI "lint fail"). It asserts a secret VALUE never appears as a substring on any output surface, but surfaces legitimately preserve secret NAMES + fixed `gcloud`/record tokens, and `redactSecrets` only scrubs whole literal VALUE occurrences — so a value that is a substring of a surviving name/token caused a benign false positive. FIX (test-only): `confusableWithStructural` filter on the value generators (`secretSetArb` + an `fc.pre()` on the stdin property). The redaction CODE was never at fault. NOTE: this file has flaked TWICE this session; if it recurs, pin the seed or audit the remaining arbitraries rather than loosening the assertion. Verified: the exact failing seed + 15 fresh runs now pass.

- **Daily AI note was truncated mid-sentence — DIAGNOSED + FIXED IN CODE (locally verified; pending deploy, 2026-10-09).** The live note read cut off ("…The GBPUSD UP setup, with an earned confidence"). ROOT CAUSE confirmed with a direct live Vertex call: `gemini-2.5-flash` is a thinking model and spent 491 of the 512 `maxOutputTokens` on hidden reasoning (`thoughtsTokenCount: 491`), leaving 17 for the visible answer (`finishReason: MAX_TOKENS`). FIX: `src/llm/geminiProvider.ts` gained an optional `thinkingBudget` (sent as `generationConfig.thinkingConfig.thinkingBudget` only when set), `DEFAULT_MAX_OUTPUT_TOKENS` raised 512→1024, and `main.ts` constructs the provider with `thinkingBudget: 0` + `maxOutputTokens: 1024`; a `MAX_TOKENS` finish now logs a secret-free `gemini.generation_truncated` warning. Verified live that `thinkingBudget: 0` → `finishReason: STOP` + a complete 3-sentence note; `npm run check` GREEN (795 tests, +5 provider tests). GOES LIVE after the operator deploys the backend + re-runs the Job; until then the live note is the prior truncated one. The liveness signal and the AI/Deterministic boundary are unaffected.

- **Dashboard-empty on the custom domain — RESOLVED END-TO-END, LIVE (2026-10-09).** Two independent causes, both now fixed and verified live. (A) CORS: the SPA is served from the custom domain `https://app.teamhandso.me` but the public-read snapshot bucket `trade-assistant-508806-dashboard` CORS `origin` list omitted it (only `.web.app` + `.firebaseapp.com`), so the browser blocked the cross-origin `dashboard.json` fetch. FIXED LIVE via `gsutil cors set` adding `https://app.teamhandso.me` to the `origin` list (kept the two existing origins); the applied config is saved reproducibly at `ops/dashboard-bucket-cors.json`. NOTE: `deploy.yml` does NOT manage bucket CORS — this is a one-time out-of-band step a future bucket rebuild must re-apply (the ops artifact documents it). (B) Empty tabs: the daily run published only today's firing view (`buildDashboardSnapshot(view, displayOnly, { decisionDates: [view.decisionDate] })`, no history), so `firingSetups/analogueOutcomes/realizedOutcomes/candles/evaluationReports` were always `[]`. FIXED IN CODE: new fail-safe read-only `src/scheduled-run/snapshotHistory.ts` (`loadSnapshotHistory`) loads the history slices from the persisted rows; `src/scheduled-run/snapshot.ts` gained a `firingSetups` history slice + a dedupe-merge (today's view wins on PK) + a `decisionDates` union; `main.ts` wires the loader into `persistView`. `npm run check` (lint+tsc+780 tests, 6 skipped) + `npm run build` GREEN. The operator committed+deployed the backend and manually ran the Cloud Run Job; the live `dashboard.json` regenerated (`generatedAt 2026-10-09T09:54:24Z`, ~970 KiB) and now carries firingSetups=4, decisionDates=4, analogueOutcomes=4020, candles=1430 (400-day bounded window), realizedOutcomes=2, evaluationReports=1, externalComparison=5 — VERIFIED live via cache-busted fetch; and a cache-busted GET + OPTIONS preflight from Origin `https://app.teamhandso.me` both return HTTP 200 with `access-control-allow-origin: https://app.teamhandso.me`. `aiRationale=0` is EXPECTED (no pair fired 2026-10-09; the display-only Gemini rationale is generated only for firing pairs and self-populates on the next firing day). (Distinct from the "All pairs" per-tab issue below, which only hides already-present data on first load.)

- **Dashboard per-pair tabs hide data on the default "All pairs" view (diagnosed; fix specced, not yet built).** AI, Third-party, and Pattern/Outcomes show a pick-a-pair prompt on "All pairs", so on first load the dashboard appears to carry no third-party/AI content even though the published `dashboard.json` has it (verified: `externalComparison` one row per pair; deployed SPA bundle current; date matches). Not a pipeline bug — selecting a specific pair reveals the data. Fix is dashboard-ui Req 8 criterion 8 (render those tabs cross-pair over all five pairs on "All pairs"); design/tasks/implementation pending. (The Vertex 403 that also emptied the AI tab is now RESOLVED — `daily-candle-freshness-and-cleanup` task 16; the AI tab will populate on the next firing-pair run.)

- **Candle-data freshness defect (CONFIRMED; top priority, now owned by a spec).** Hosted `candles` hold daily history for all 5 pairs only through 2026-09-15 (per-pair ≈4183-4184 rows; verified read-only), while the current Decision_Date is ~16 trading days later and the gap grows by one trading day per run. Root cause: nothing ingests fresh candles (CSV loader backfill-only; `OHLC_PROVIDER`/`OHLC_BASE_URL` empty). Impact: encoding, retrieval, the firing view, the realized-outcome journal, and any future evaluation all read stale history — the live daily loop executes but is not producing current-day signals. Owned by the new spec `daily-candle-freshness-and-cleanup` (Candle_Freshness_Stage + FCS→Twelve Data→Massive fallback chain + one-off backfill). Requirements phase only; not yet implemented.

- **`fx_writer` write-path cutover (5.2a) COMPLETE; the open ☁️ gate is now the 5.3 hosted reconcile itself.** The role exists on hosted and is granted to `authenticator`, `supabase-key` v3 carries a verifiable `role: fx_writer` ES256 JWT, and a live REST write-check is GREEN (INSERT/UPDATE succeed, DELETE refused 403). To get there, `...006` STEP 7 (grants) and STEP 3+4 (drop old RLS policies + disable RLS) were pulled forward out-of-band on the 5 existing retained tables; `pipeline_writer` still works so the daily run is unbroken. REMAINING RISK for task 5.3: it performs the DESTRUCTIVE drops (tables, views, the `pipeline_writer` role, diagnostic read path) and creates `evaluation_reports` — take a fresh hosted backup (schema+data+roles) and present the exact drop set before applying. Hosted SQL/REST from local MUST use the IPv4 `SUPABASE_POOLER` (direct `db.*:5432` is IPv6-only, unreachable here). Sensitive artifact: gitignored `ops/fx-writer-key/` holds the `fx_writer` private signing key.

- **The central premise is now MEASURED in the living log (RESOLVED).** For the
  first time, `RESEARCH-LOG.md` carries a recorded evaluation between its
  `BEGIN/END ENTRIES` markers: one `[EVALUATION] shape-only` entry matching the
  single hosted `evaluation_reports` row (id `7ae77f6a-8d98-4d7c-a0e2-a2e5acf258b5`).
  The empirical question — does shape-only pattern matching beat the weekly-trend
  baseline out-of-sample? — now has a measured answer: model accuracy 0.4996 vs
  baseline 0.4871, delta +1.24pp, 95% Wald CI [+0.66pp, +1.82pp], n=28470,
  deltaExceeds3pp=false, strength weak=16071/moderate=12351/strong=48. The pattern
  beats the baseline by a small, statistically-positive margin (the CI excludes
  zero) but below the 3pp annotation threshold; this is recorded as a finding, with
  no verdict. HOW IT GOT HERE (`simplify-to-cloud-minimal` task 8/8.1): the first
  live ☁️ hosted evaluation run exposed a look-ahead LEAK in the evaluation fold
  construction (`buildFoldInputs` sourced the model prediction from the matured
  outcome it was scored against → a false tautological `model=1`); it was FIXED
  (model prediction now sourced honestly from the retrieved analogue neighborhood
  as of each decision date), a follow-on performance fix made the honest evaluation
  runnable inside the Cloud Run Job, both fixes merged to `main` (PRs #23/#24) and
  the image redeployed, and the leak-free evaluation was executed and recorded. The
  earlier `dashboard-data-activation` Tasks 10/11 DB-vs-log discrepancy is now moot:
  the authoritative measured record is this evaluation report, present in BOTH the
  hosted table and the living research log.
- **Simplicity/complexity audit flags premature infrastructure (new this turn).**
  `docs/architecture/PROJECT-SIMPLICITY-AUDIT.md` reviews the whole project
  against the original local-first MVP and concludes the project has grown a
  production-grade platform (two deployable services, full GCP estate, RLS +
  scoped JWT + read-proxy + read views + diagnostic path, provider/strategy/
  storage abstractions, a Python cross-check for one formula, 13 tables, 4
  specs) while the central premise above has never been measured. It recommends
  protecting the research-integrity layer and deferring/removing/simplifying the
  surrounding software — re-introducing cloud, serving, and the scoped-credential
  security model only once a public serving layer actually requires them. The
  audit is advisory; no code, config, or cloud change was made, and deferred
  subsystems should be branch-quarantined rather than deleted. A follow-up
  focused review (audit §13) refines the kill-gate guidance: PROTECT the
  measurement engine (Gate 1/Gate 2 math) but reframe it as a human-read
  evaluation report; SIMPLIFY the `PASS`/`CUT` verdict (undocumented, inherited
  `+3pp`/`margin>=0` thresholds) into annotations at most; REMOVE the live-path
  auto-block (`gatePassingResolver`, Req 12.3) for v1. The software should
  measure and report; the operator decides whether the evidence supports the
  approach — it should not auto-decide the research is "alive" or "dead".
- **No usable local Supabase + live secrets in `.env` (new this turn).** The
  first-OOS-evaluation run (`simplify-to-cloud-minimal` task 2.2) could not be
  executed locally: `.env` has `SUPABASE_TARGET=hosted`, `SUPABASE_LOCAL_KEY` is
  empty, the Supabase CLI shim is broken (`supabase-go` binary missing), and no
  local Supabase stack is running (only an unrelated `wpdb` MySQL container). To
  run the evaluation locally the stack must be stood up, migration 006 applied,
  and candles/vectors seeded. Separately and more importantly, `.env` holds LIVE
  hosted Supabase secrets (the secret key, JWT secret, and DB password, referenced
  by name only here) — these should be rotated and the file untracked. This is
  outside the task scope but worth flagging as a security risk.
- **Write_Credential cutover gap BLOCKS task 5.3 (surfaced this turn via the live
  enumeration).** The schema-reduction migration `...006` STEP 6 drops the
  `pipeline_writer` role — the identity the Cloud Run Job currently uses to write
  (the scoped ES256 JWT in the `supabase-key` secret). STEP 7 is supposed to hand
  write (INSERT/UPDATE) to the single Write_Credential role `fx_writer`, but that
  grant is guarded `if exists (fx_writer)` and the live enumeration confirms
  `fx_writer` does NOT exist on hosted. So applying `...006` as-is would drop the
  Job's write path and NOT establish a replacement — leaving the DB public-read
  with no role able to write. This is the same shape of gap that 6.5 closed for
  the display writer: the migration is correct in isolation but a prerequisite was
  unowned. NOW OWNED + SCOPED: task 5.2a "Cut over the Write_Credential before the
  reconcile" (☁️, operator-approved) is broken into 5.2a.1-5.2a.4. The scoping
  settled the write-path model (Option A, operator-approved): `fx_writer` is a
  PostgREST SCOPED-JWT role mirroring `pipeline_writer` (NOLOGIN, `authenticator`
  is a member, reached via a `role: fx_writer` JWT) — NOT a bare login role, which
  the REST client cannot reach — so the cutover is a role re-mint + `supabase-key`
  secret rotation with NO client code change. SECOND BUG FOUND: migration `...006`
  STEP 7 grants `fx_writer` table privileges but OMITS `grant fx_writer to
  authenticator`, so even once the role exists PostgREST would reject it at runtime
  with `42501 permission denied to set role`. 5.2a.1 fixes the migration; 5.3 still
  depends on 5.2a being green. RELATED FINDING: `evaluation_reports` does not yet
  exist on hosted (migration `...006` has never been applied there) — the full file
  creates it before granting, so this is not itself a blocker.
- **A FULL hosted backup exists as of this turn (reversibility net for 5.3).**
  `~/supabase-backup-20261007T151618Z/` holds `schema.sql`, `data.sql` (~53 MB),
  and `roles.sql`, taken via `supabase db dump` over the IPv4 pooler and verified
  to contain all 11 to-be-dropped tables. NOTE: this backup is OUTSIDE the repo
  and is NOT committed (it contains production data); it is a local safety net for
  the 5.3 apply, not a durable artefact. Tooling note correcting an earlier claim:
  the Supabase CLI (v2.109) WORKS here and bundles a PG-17-compatible dumper; the
  local `pg_dump` is v15 and is version-gated out against the 17.6 server, and the
  IPv6 direct connection is unreachable — use the IPv4 pooler for hosted ops.
- **`.env` live-secret exposure is BROADER than previously noted (elevated this
  turn).** Reading `.env` for the 5.3 prep confirmed it holds, in plaintext: the
  hosted Supabase secret key, JWT secret, DB password (in two connection strings),
  and the Supabase access token, PLUS ~10 third-party provider API keys (Twelve
  Data, Massive, Alpha Vantage, Finnhub, News API, FMP, FCS) — all referenced by
  name only here, never by value. These are LIVE production credentials now
  directly in the path of cloud operations. Rotate ALL of them and untrack `.env`
  before further live work; prior notes mentioned only the three Supabase secrets.
  Now tracked as requirement R10 of the new spec
  `daily-candle-freshness-and-cleanup`.
- **Display-only features work locally but are undeployed and have prod-config
  prerequisites.** The Gemini + FCS wiring was verified only against live APIs
  from the dev machine. For the deployed Cloud Run Job to produce the data: the
  GitHub `GEMINI_MODEL` repo variable must be `gemini-2.5-flash` (the previously
  configured `gemini-3.5-flash` 404s), the Job's runtime service account needs
  `roles/aiplatform.user` for Vertex AI, and `.github/workflows/deploy.yml` must
  carry `EXTERNAL_SIGNAL_PROVIDER=FCS` (added this turn) so `externalSignalConfig
  FromEnv` resolves. Until a Job run completes post-deploy, the AI and
  Third-party tabs stay in their empty/unavailable states. Note the AI tab is
  per-firing-card, so on a silent (no-firing) day showing "no rationale" is
  correct, not a bug.
- **Display-only Gemini rationale 403 on Vertex AI — RESOLVED (`daily-candle-freshness-and-cleanup` task 16, R7).** The earlier HTTP 403 `aiplatform.endpoints.predict denied` for `job-runtime@` on `gemini-2.5-flash` is fixed: `roles/aiplatform.user` (which includes `aiplatform.endpoints.predict`) is bound to the SA (IAM audit: ADDED 2026-10-08 17:58Z) and the logged 403 (2026-10-08 12:34Z) predated that grant. An operator-approved ☁️ Job run (`scheduled-daily-run-962h6`, exit 0) produced NO predict-403; the model is reachable in `europe-west1` (countTokens HTTP 200). Zero pairs fired that run so the per-firing-pair rationale (R7.2) will self-confirm on the next firing day. The path stays display-only (never touches scoring). Manifest `rolesNote` records the verified least-privilege grant.
- **Read-proxy CODE removed; the live GCP resource still exists.** The
  `services/read-proxy/` code, its `/api` rewrite, and the SPA's ten-endpoint
  allowlist were DELETED in `simplify-to-cloud-minimal` Phase 5 task 6; the SPA
  now reads the static `dashboard.json` snapshot, so the former local-only
  `/candles` + `/analogue-outcomes` column fix is moot. REMAINING RISK: the
  deployed `dashboard-read-proxy` Cloud Run service + its images still exist in
  GCP and are now orphaned — their deletion is the Phase 6 R11 operator-approved
  sweep (task 7.2, PENDING operator approval). As of task 7.1 the orphan set is
  ENUMERATED: a live read-only `ops/enumerate-gcp.sh` run (diffed against
  `ops/required-resources.manifest.json`) classified `dashboard-read-proxy` plus
  jobs `dashboard-seed-run`/`dashboard-gate-run`, ~10 obsolete secrets, stale
  Artifact Registry images, and several review-SAs as ORPHANED deletion
  candidates — but NO deletion was executed. Until task 7.2 runs the stale service
  remains but nothing points at it.
- **Snapshot sink no-op / `dashboard.json` not published — RESOLVED.** The daily
  Job's `resolveSnapshotSink()` was a logged no-op, so no `dashboard.json` was ever
  published and the SPA fetched a static asset Firebase Hosting cannot write at
  runtime. The GCS `SnapshotSink` is now IMPLEMENTED
  (`src/scheduled-run/gcsSnapshotSink.ts`, wired on `DASHBOARD_SNAPSHOT_BUCKET`) and
  the live bucket/IAM/CORS + the `DASHBOARD_SNAPSHOT_BUCKET`/`VITE_SNAPSHOT_URL`
  repo vars are provisioned (operator-approved). PR #25 was merged + deployed and
  the loop is now PROVEN LIVE: the daily Cloud Run Job run
  `scheduled-daily-run-2rrm6` published `dashboard.json` (1779 bytes) to the
  public bucket, verified anonymously fetchable over HTTPS (HTTP 200). Fully
  resolved under parent task 8.
- **Frontend auto-deploy: IAM blocker cleared; green deploy not yet verified.**
  The first `deploy-frontend` run 403'd because the deploy SA
  (`gh-deploy@…`, the `DEPLOY_SERVICE_ACCOUNT`) lacked a Firebase Hosting role;
  `roles/firebasehosting.admin` has now been granted (live grant applied + binding
  verified in the SA's IAM policy) and the deprecated `FIREBASE_TOKEN` env was
  removed in favour of ADC. The workflow edit is not yet committed/pushed, and
  the deploy has not been re-run, so a successful hosting publish remains
  expected-but-unverified. Secondary note: the pipeline uses the third-party
  `dorny/paths-filter@v3` action — if the org restricts Actions to
  verified/first-party publishers, replace it with native per-file `paths:`
  filters (which would require splitting into two workflow files).
- **Live-cloud checkboxes can't be re-verified from the repo alone.** Hosted
  migrations applied, secrets provisioned, images deployed, scheduler created,
  and scoped-write verified live are all asserted via LIVE CLOUD task checkboxes.
  Treat them as claims pending re-verification against the live project, not as
  facts provable from source.
- **Non-transactional gate writes.** The aggregate-then-fold insert is not
  transactional across PostgREST requests; a fold-insert failure can leave a
  tolerable orphan aggregate row (append-only), surfaced with its `configId`.
- **Diagnostic read path.** Because the anon key is RLS-limited and the scoped
  read key 401s on raw PostgREST, a least-privilege read-only count path exists
  (`...005` migration + `supabase/DIAGNOSTIC_READ_PATH_POLICY.md`); service-role
  one-offs must be read-only, operator-approved, and never logged.
- **Git hygiene / branch confusion.** The remote is named `main` (not `origin`),
  which collides with the `main` branch and caused work to feel "lost" when it
  was only committed on another branch. Work had become fragmented across `dev`
  and `activate/dashboard-firing`; this was reconciled by merging the latter into
  `dev` (see STATE summary). The reconciling merge commit on `dev` is not yet
  pushed. Recommended follow-ups: rename the remote to `origin`, and push `dev`
  (directly or via PR per team preference).
- **Deploy reaches the live image only via a `dev`→`main` PR merge.** The Deploy
  workflow (`.github/workflows/deploy.yml`) triggers ONLY on push to `main`;
  pushes to `dev` run CI only. So any fix (e.g. the leak fix in PR #23, the perf +
  flaky-test fix in PR #24) is NOT in the deployed Cloud Run Job image until the
  operator merges the PR to `main`. PR #23 and PR #24 are merged + deployed;
  PR #25 (the GCS snapshot sink + the
  `DASHBOARD_SNAPSHOT_BUCKET`/`VITE_SNAPSHOT_URL` repo-var wiring) is the current
  one open and awaiting the operator's merge to `main`.
- **A flaky, seed-dependent property test exists in dormant `news-filter`.**
  `src/news-filter/property28-suppressionPure.test.ts` broke CI on `main` once
  (bad fast-check seed) because it scanned the pass-through `reason` for direction
  tokens. Fixed this session (test-only; `suppress()` was correct). The
  `src/news-filter/` module is dormant under the de-scope (pipeline wiring
  removed) but still exported from `src/index.ts` and still runs in CI; consider
  removing the module in a later cleanup.
- **~50 MB DB backup committed into git history + 20 Dependabot vulnerabilities.**
  `ops/backups/hosted-5.3-*.sql` (~50 MB) was committed in the Phase-2-7 de-scope
  commit and now lives in git history (GitHub flagged it over the 50 MB
  recommended size) — consider gitignoring/removing it and the `ops/backups/` dir.
  Separately, the repo's Dependabot reports 20 vulnerabilities (4 critical, 2
  high, 12 moderate, 2 low) — worth a dedicated pass. Now tracked as requirements
  of the new spec `daily-candle-freshness-and-cleanup`: the git-history backup
  removal is R8, the Dependabot triage/fix is **R9 — DONE (see §9 below)**, /web
  toolchain upgraded to vite 7 / vitest 3.2.4 to clear the Dependabot-PR CI failures.
  The recurring Dependabot ERESOLVE / unsupported-major CI failures are now
  STRUCTURALLY addressed by a CI-enforced supported-major-ceiling policy
  (`auditCeilings`/`SUPPORTED_MAJOR_CEILINGS` across both package trees) plus
  matching `.github/dependabot.yml` ignore rules, with React 19 / recharts 3 /
  TypeScript 7 held as documented DEFERRED migrations (TS 7 blocked upstream
  until typescript-eslint supports the TS 7.1 API). See §9 for detail.

## 8. Immediate next steps

1. TOP PRIORITY — CONTINUE `daily-candle-freshness-and-cleanup` Phase 6 cleanup
   (R7-R11), then Phase 7. Phases 1-5 are DONE: the Candle_Freshness_Stage
   (tasks 1-11) is merged to `main`; the ☁️ task 13 hosted backfill closed the
   candle gap (all five pairs to 2026-10-06, benign one-day residual); and the
   ☁️ task 15 read-only hosted freshness verify PASSED (snapshot reflects fresh
   history; the only finding is that known one-day provider-availability residual,
   which the next Daily_Top_Up takes). NEXT action is the Phase 6 follow-ups,
   tracked as requirements R7-R11 of this spec: the Vertex 403 predict grant
   (☁️, task 16), `.env` secret rotation + untrack (R10), the ~50MB git backup
   housekeeping, and Dependabot triage. Keep `make check` + the web build green;
   the ☁️ live-cloud items (Vertex predict grant, `.env` secret rotation) stay
   operator-gated under the operational-safety protocol.
2. HIGH PRIORITY — `dashboard-ui` Req 8 criterion 8 DESIGN + TASKS are DONE
   (design addendum + task 19, subtasks 19.1–19.7, both format-valid). NEXT
   ACTION: EXECUTE task 19 — implement the thin pure `shapeAllPairs` helper +
   its property test (Property 16), edit the AI, Third-party, and
   Pattern/Outcomes tabs to render a cross-pair all-five-pairs view on "All
   pairs" (composing the existing `shapeExternal`/`shapeAi`/Pattern-Outcomes
   shapers over one `getSnapshot()` read, per-pair no-data markers, labels
   preserved), and add the DOM tests. Keep `make check` + the web build green,
   then ship via a `dev`→`main` PR (operator-gated merge). web/-only; no
   snapshot schema / daily Job / `src/` core change.
3. DONE — PR #25 (`dev`→`main`) was merged + deployed (Job image `b4b27b2e…`,
   env `DASHBOARD_SNAPSHOT_BUCKET=trade-assistant-508806-dashboard`, SPA rebuilt
   with the bucket snapshot URL) and one daily Cloud Run Job run
   (`scheduled-daily-run-2rrm6`, exit 0) PROVED the loop: it wrote the
   `firing_setups` row for 2026-10-08, maintained `realized_outcomes`, and
   published `dashboard.json` to the public bucket (anonymously fetchable, HTTP
   200). Parent task 8 is marked `[x]` and `simplify-to-cloud-minimal` is
   COMPLETE.
4. DONE (`daily-candle-freshness-and-cleanup` task 16, R7). The runtime SA
   (`job-runtime@`) Vertex AI 403 is resolved: `roles/aiplatform.user` (includes
   `aiplatform.endpoints.predict`) is bound to the SA and an operator-approved ☁️
   Job run (`scheduled-daily-run-962h6`, exit 0) produced no predict-403; model
   reachable in `europe-west1`. Zero pairs fired that run, so the per-firing-pair
   rationale (R7.2) self-confirms on the next firing day. `GEMINI_MODEL` repo
   variable is `gemini-2.5-flash` (the previously configured `gemini-3.5-flash`
   404s). Display-only path; never blocked the loop.
5. Commit the uncommitted living-doc/task edits still outstanding from prior
   turns, now including the new spec files: the RESEARCH-LOG.md evaluation entry,
   this PROJECT-STATE.md update, the task-8 checkbox in `tasks.md`, the new
   `.kiro/specs/daily-candle-freshness-and-cleanup/` requirements.md (+ `.config`),
   and the amended `.kiro/specs/dashboard-ui/requirements.md` (new Req 8
   criterion 8).
6. (SUPERSEDED by `simplify-to-cloud-minimal` Phase 5 task 6 — the read-proxy
   code is deleted and the SPA now reads the `dashboard.json` snapshot.) What
   remains: DELETE the orphaned `dashboard-read-proxy` Cloud Run service + images
   from GCP in the Phase 6 R11 operator-approved sweep (task 7.2). (The real
   snapshot uploader is now IMPLEMENTED as the GCS `SnapshotSink` and its live
   infra provisioned; it shipped to the Job via the PR #25 merge in step 3.)
7. DONE — the first real evaluation of the core premise is recorded in
   `RESEARCH-LOG.md` as an evaluation REPORT (model-vs-baseline accuracy, delta,
   friction-adjusted MFE/MAE, sample size, Wald CI), no `PASS`/`CUT` verdict, per
   audit §13. Result: +1.24pp over baseline, CI [+0.66pp, +1.82pp], below the 3pp
   annotation threshold. The DB-vs-log discrepancy is resolved (the report lives in
   both the hosted table and the log).
8. DONE (daily-candle R11.2) — `operational-wiring` Task 12's parent is now `[x]`
   (all four subtasks `[x]`); Task 13 (final checkpoint — cloud half) is explicitly
   DEFERRED (superseded) because the cloud half was re-done by
   `simplify-to-cloud-minimal` and its end-to-end loop proven live under that spec's
   task 8.
9. DONE (daily-candle R11.1/R11.3) — `dashboard-ui` Tasks 17 (post-deploy Read_Proxy
   smoke) and 18 (final checkpoint) are explicitly DEFERRED (superseded): the
   Read_Proxy + `/api` rewrite they verified were removed in
   `simplify-to-cloud-minimal` Phase 5 (SPA now reads a static `dashboard.json`
   snapshot). Reconciled with `dashboard-data-activation` Task 16 (left `[x]` with a
   supersession note) so the specs tell a single consistent story.
10. Push the reconciling merge on `dev` to the remote (directly or via PR), and
   rename the remote `main` → `origin` to remove the branch/remote name clash.
11. Decide on the simplicity/complexity audit
   (`docs/architecture/PROJECT-SIMPLICITY-AUDIT.md`, incl. the §13 kill-gate
   review): its top recommendation is to run the existing measurement engine and
   record the first evaluation report (step 7) BEFORE any rearchitecting, then
   de-scope infrastructure (defer-on-branch, don't delete) and reframe the
   kill-gate as a report rather than an auto-blocking PASS/CUT verdict. Per the
   operator's binding constraints (cloud execution + mobile access; see
   Obstacles), the de-scope target is now "cloud-minimal single-user" rather
   than local-first, and — per three further operator decisions (public data,
   drop the choppiness/concentration suppressors, keep GitHub deploy) — removes
   the read-side security layer and the auth gate entirely. DONE: the audit now
   carries §14 (authoritative constraint-adjusted architecture) plus annotated
   §7/§8/§9/§12 (edited this turn, document only). OUTSTANDING (implementation,
   not yet started): action the §14 recommendations in the codebase — but only
   after step 7 (run the measurement engine, record the first evaluation report)
   per the audit's own ordering.
12. Execute the `simplify-to-cloud-minimal` spec. Phases 1-3 are DONE, Phase 4
   schema authoring (tasks 5.1 + 5.2) is authored locally, and THIS TURN Phase 5
   task 6 (6.1-6.4) landed: the fail-safe `dashboard.json` snapshot writer is
   wired into the daily run, the SPA reads it via `loadSnapshot()`, the
   read-proxy code + read-side `write-credential` tooling are deleted, and the
   proxy/allowlist tests are replaced with snapshot-path tests (`make check` +
   web build/tests green, local-only), AND task 6.5 (DONE this turn) removed the
   last live writer of `signal_rationale`/`external_reference_comparison` — the
   `makeDisplayDataPersister` call + module are deleted, the surviving write-shape
   types relocated to `displayOnlyTypes.ts`, `displayOnly` still feeds the
   snapshot, `make check` green. Phase 6 task 7 (simplify `deploy.yml`) and
   task 7.1 (author `ops/required-resources.manifest.json` + the read-only
   `ops/enumerate-gcp.sh` enumeration) are now DONE in code (`make check` green);
   tasks 5.2a and 5.3 are also DONE (the `fx_writer` cutover + the hosted schema
   reconcile). NEXT ☁️ OPERATOR STEP: task 7.2 — present the enumerated orphan
   delete set and, on approval, delete the `dashboard-read-proxy` service + images,
   the `dashboard-seed-run`/`dashboard-gate-run` jobs, the obsolete provider/scoped
   secrets, stale Artifact Registry images (retention), and dangling IAM/SAs; then
   wire the real snapshot uploader (currently a no-op) and run Phase 7 end-to-end
   verification. STILL PENDING: the ACTUAL first OOS evaluation run — the single
   highest-value measurement step. Its code is now fixed and leak-free; it is no
   longer blocked on code or on a local Supabase but specifically on the PR #24
   redeploy + the one-off evaluation Cloud Run Job re-run — now DONE and recorded
   (see step 7).

## 9. Dependency vulnerability triage (R9 — `daily-candle-freshness-and-cleanup` task 18)

Triaged against the live `npm audit` output in each `package.json` (root
`fx-daily-pattern-assistant` and the web SPA `web/dashboard-ui-web`) — this is
local dependency work, no live-cloud/network/auth-gated action. The 20 recorded
Dependabot findings (4 critical / 2 high / 12 moderate / 2 low) are the sum of
the individual GitHub advisories across both package trees; `npm audit` collapses
them onto the vulnerable packages below. Every finding is bucketed so nothing is
silently dropped.

**Buckets**

- **(a) Fixed by a compatible pinned bump — APPLIED.** `web/package.json`:
  `vite` 5.4.11 → **5.4.21** and `vitest` 2.1.8 → **2.1.9** (exact pins, no
  ranges — honoring the no-ranges policy; both patch-level within the installed
  5.x / 2.x majors). These absorbed the advisories that are fixed WITHIN the
  5.4.x / 2.1.x lines: the Vitest API-server RCE (GHSA-9crc-q9x8-hgqq, critical,
  fixed in 2.1.9) and the several `vite` `server.fs.deny` bypass / path-traversal
  CVEs fixed within 5.4.x (e.g. GHSA-x574-m823-4x7w, -356w-63v5-8wf4,
  -859w-5945-r5v3, -xcj6-pq6g-qj4x, -4r4m-qw57-chr8, -vg6x-rcgg-rjx6). `make
  check` + the web build + the web test suite stay green on the bumped versions.
  The `/web` toolchain was subsequently upgraded as one atomic set to clear the
  Dependabot-PR CI ERESOLVE failures: `vite` 5.4.21 → **7.3.7**, `vitest`
  2.1.9 → **3.2.4**, `@vitejs/plugin-react` 4.3.4 → **4.7.0** (exact pins, no
  ranges), regenerating `web/package-lock.json`; this clears the `vite`
  `server.fs.deny` CVEs (fixed ≤6.4.2) and the `esbuild` dev-server leak (vite 7
  ships esbuild 0.27+). Verified locally on Node 22: web `npm ci` resolves with
  no ERESOLVE, `npm run build` green, `npm test` 146/146 green.
- **(b) Requires a breaking (SemVer-major) change — PARTIALLY TAKEN.**
  The vite/vitest major has now been partially taken (to `vite` **7.3.7** /
  `vitest` **3.2.4** / `@vitejs/plugin-react` **4.7.0**, see bucket (a)), which
  cleared the `vite` `server.fs.deny` CVEs (`<=6.4.2`) and the `esbuild`
  dev-server leak. The ONLY still-deferred items are the ones that need `vitest`
  **5** (which forces `vite` **8** → `@vitejs/plugin-react` **6**, peer `vite ^8`
  only — a larger jump): the two `tinypool` prototype-pollution criticals
  (`<=2.1.1`), `@vitest/mocker` path traversal (`<4.1.11`), and the `vitest`
  UI-server file read (fixed 3.2.6+ → vitest 5.x). **Migration note:** vitest 2→5
  / vite 7→8 remain breaking (config API, plugin peer-deps, test runner
  behaviour) and are deferred to a dedicated tooling-upgrade pass rather than
  forced here. **Reachability:** all remaining items are dev/CI-only (vite/vitest
  never ship to production — the web app deploys as a static pre-built SPA to
  Firebase Hosting) and require a running vitest dev/API/UI server (not used in
  CI build or prod), so runtime exposure is nil.
- **(c) Not applicable (dev-only / unreachable at runtime) — RATIONALE RECORDED.**
  Root `fx-daily-pattern-assistant`: `source-map-js` 1.2.1 (high, event-loop DoS,
  `<1.2.2`, GHSA-68fv-2mgg-jv7q) — a dev-only transitive dep (via
  `vitest`→`vite`→`postcss` and `@vitest/coverage-v8`→`magicast`); not directly
  pinned by this repo, only reachable in test-tooling source-map parsing, never in
  the compiled production artifact. The root project already runs the current
  `vitest` 5.0.1 / `vite` 8.3.0; the residual sits in a transitive `postcss` /
  `magicast` and clears when those upstreams ship source-map-js ≥1.2.2. Not force-
  pinned via an override to avoid introducing a non-standard transitive pin for a
  dev-only, unreachable DoS.

**Triage table (every finding bucketed)**

| Pkg (tree) | Direct? | Severity | Advisory (short) | Bucket | Action / rationale |
| --- | --- | --- | --- | --- | --- |
| `vite` (web) | yes | high+mod×N | `server.fs.deny` bypasses, path traversal (fixed ≤6.4.2) | (a) | Pinned 5.4.11→5.4.21→**7.3.7**; `<=6.4.2` CVEs cleared by vite 7 |
| `vitest` (web) | yes | critical | API-server RCE GHSA-9crc (fixed 2.1.9) | (a) | Pinned 2.1.8→2.1.9→**3.2.4** |
| `vitest` (web) | yes | critical | UI-server file read GHSA-5xrq (`<3.2.6`) | (b) | Needs vitest **5** (→ vite 8 → plugin-react 6), deferred |
| `esbuild` (web) | no | moderate | dev-server request/response leak `<=0.24.2` | (a) | Cleared by vite 7 (ships esbuild 0.27+) |
| `tinypool` (web) | no | critical×2 | prototype-pollution → RCE `<=2.1.1` | (b) | Needs vitest **5** (→ vite 8 → plugin-react 6), deferred |
| `@vitest/mocker` (web) | no | moderate | path traversal `<4.1.11` | (b) | Needs vitest **5** (→ vite 8 → plugin-react 6), deferred |
| `vite-node` (web) | no | moderate | via vulnerable vite | (a) | Cleared by vite 7 upgrade |
| `source-map-js` (root) | no | high | event-loop DoS `<1.2.2` | (c) | Dev-only transitive (postcss/magicast); unreachable in prod artifact |

**Green verification after the applied bump:** root `npm run check` (lint +
typecheck + 763 vitest tests) green; `web` `npm run build` (tsc + vite build)
green; `web` `npm test` (146 tests) green. Lockfiles updated via `npm install`
in `web/`. After the subsequent `/web` toolchain upgrade (vite 7.3.7 / vitest
3.2.4 / @vitejs/plugin-react 4.7.0): web `npm ci` resolves clean with no
ERESOLVE, `npm run build` green, and `npm test` 146/146 green on Node 22.

**(d) Grouping to prevent recurrence — ADDED.** A new `.github/dependabot.yml`
was added that GROUPS the coupled `vite` / `vitest` / `@vitejs/*` / `@vitest/*`
/ `tinypool` / `esbuild` packages into a single atomic `vite-vitest-toolchain`
PR per `/web` run, so the peer set moves together and the ungrouped-partial-bump
ERESOLVE failure (one package bumped while its peers lagged) cannot recur.

**(e) Durable supported-major-ceiling policy — CI-ENFORCED (this turn).** To
stop the recurring Dependabot ERESOLVE / unsupported-major CI failures and keep
all future dependency work on supported majors, a durable supported-major
ceiling is now enforced in CI: `scripts/version-policy.mjs` audits BOTH package
trees (root `package.json` and `web/package.json`) for exact pins AND enforces
`SUPPORTED_MAJOR_CEILINGS` via the pure `auditCeilings` logic in the shared
`src/version-policy/audit.js` (surfaced through `versionPolicy.ts`), exiting
non-zero on any violation. Ceilings: `typescript<=6`, `@types/node<=22`,
`react`/`react-dom`/`@types/react`/`@types/react-dom<=18`, `recharts<=2`
(covered by `src/version-policy/ceilings.test.ts` — 7 unit + 2 fast-check
property tests). `.github/dependabot.yml` was extended to match: a new `react`
group under `/web` (react, react-dom, @types/react, @types/react-dom move
atomically) plus `ignore` rules holding the blocked/deferred majors consistent
with the ceilings constant (root + web `typescript >=7`; `@types/node >=23`;
web `react`/`react-dom`/`@types/react`/`@types/react-dom >=19`; web
`recharts >=3`). React 19, recharts 3, and TypeScript 7 are DEFERRED migrations
held behind these ceilings rather than silent CI failures: recharts 3 has a
breaking Tooltip Formatter API, React 19 is a major with recharts-2 peer
constraints, and TS 7 is blocked upstream by typescript-eslint (peer `<6.1.0`
until the TS 7.1 API) — TypeScript 7 can be revisited once typescript-eslint
supports that API. Separately, a latent fast-check-4 test-arbitrary bug in
`web/src/pure/selectDates.browse.property.test.ts` (its `fc.date()` arbitrary
could yield an Invalid Date → `RangeError`) was fixed with a safe YYYY-MM-DD
builder that works under fast-check 3 and 4; the production `selectDates.ts` was
correct and untouched. STRATEGIC DECISION (operator-approved): enforce the
supported-major ceilings in CI and defer the React 19 / recharts 3 / TS 7 majors
as explicit, CI-guarded decisions. All changes are locally verified green (root
`npm run check` 773 passed/6 skipped incl. the 10 new ceiling tests; `node
scripts/version-policy.mjs` exit 0 over 22 specs across both trees; web build +
146 tests green; dependabot.yml valid YAML) but are UNCOMMITTED on branch `dev`,
so Dependabot's live behavior is not yet confirmed against GitHub.

## Notes on maintenance

The STATE block above is rewritten in place by `LivingDocs.updateState()` and by
the `update-living-docs` hook. Prose outside the markers is preserved across
updates — keep sections 1–8 current whenever a change, fix, or decision lands.
Never write a secret value, key, token, or JWT into this file; reference
credentials by name only. Kill-gate verdicts belong in `RESEARCH-LOG.md` (via
`appendVerdict()` / `appendCut()`), never here. Hand-authored constraints belong
in `LESSONS.md`.
