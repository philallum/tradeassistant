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
- **Phase:** v1 feature-complete across all four specs; display-only features wired + verified live; frontend CI/CD automated and its IAM blocker cleared (live grant applied, re-run pending); read-proxy allowlist bug fixed locally (proxy redeploy pending); closing out final live-cloud checkpoints and the first real kill-gate verdict.
- **Updated:** 2026-10-07
- **Summary:** Deterministic TypeScript core (fx-daily-pattern-assistant) is 100% complete and property-tested. Frontend-deploy 403 diagnosed AND fixed this turn: the first auto-deploy run failed at `firebase deploy --only hosting` with HTTP 403 "caller does not have permission" (WIF auth itself succeeded) because the deploy service account `gh-deploy@trade-assistant-508806.iam.gserviceaccount.com` held only backend roles and NO Firebase Hosting role. LIVE CLOUD ACTION (operator-approved, executed this turn): granted `roles/firebasehosting.admin` to that SA via `gcloud projects add-iam-policy-binding` and verified the binding now appears in the SA's live IAM policy; the Firebase Hosting API was already enabled. The deploy itself has not been re-run yet, so a green hosting deploy is expected-but-unverified. Also cleaned up the workflow: removed the deprecated `FIREBASE_TOKEN` env from the `deploy-frontend` step and left only `GOOGLE_APPLICATION_CREDENTIALS` (ADC, the non-deprecated keyless path the auth step already exports); YAML re-validated. The workflow edit is in the working tree, NOT yet committed/pushed. Read-proxy bug fixed this turn: the dashboard "Pattern & Outcomes" tab showed "data service is temporarily unavailable" because two of its four reads — `/candles` and `/analogue-outcomes` — returned 502. Root cause in `services/read-proxy/src/allowlist.ts`: both endpoints mapped the public `pair` param to a DB `column: "pair"`, but their views (`v_candles`, `v_analogue_outcomes`) project the pair column as `asset`, so PostgREST rejected `pair=eq.…` with 42703 "column does not exist" and the proxy wrapped it as 502. Fixed by changing those two params to `column: "asset"` (public param name stays `pair`; frontend row types already expect `asset`, so untouched). Verified against live Supabase: the old `pair=eq.EURUSD` filter 400s on both views while the new `asset=eq.EURUSD` returns 200 (400 candles, 300 analogue rows); read-proxy builds clean and its `src` tests pass (33 passed / 6 skipped). NOT yet deployed: the fix is local only — the `dashboard-read-proxy` Cloud Run service is deployed out-of-band and must be rebuilt/redeployed for it to take effect (it is NOT covered by the `deploy.yml` backend path filter, which targets the Cloud Run Job, not this service). CI red-on-dev fix this turn: the new `web` CI job surfaced a pre-existing latent bug — the SPA test files import Node built-ins (`node:fs`/`node:url`/`node:path`) but `web/` had no `@types/node` and `web/tsconfig.json` set `types: ["vite/client"]` (excluding Node types), so `tsc --noEmit` failed under CI's clean `npm ci` (it had passed locally only via a stale/hoisted `node_modules`, and the web build had never run in CI before). Fixed by adding `@types/node@22.20.2` (exact-pinned to match root + Node 22 line) to `web/` devDependencies (+ lockfile) and `"node"` to the tsconfig `types` array. Verified on a clean `web/` `npm ci`: build passes, 133 web tests pass; backend `npm run check` (682 tests) and version-policy green. These three files (`web/package.json`, `web/package-lock.json`, `web/tsconfig.json`) are edited locally but NOT yet committed/pushed. operational-wiring is done except Task 13 (final checkpoint); Task 12's subtasks are all complete though its parent checkbox is still unticked. dashboard-ui is complete except Task 17 (post-deploy read-only smoke) and Task 18 (final checkpoint). dashboard-data-activation is 100% complete. CI/CD this turn: the dashboard SPA (`web/`) now has CI coverage (new `web` job in `ci.yml`: build + Vitest) and is DEPLOYED AUTOMATICALLY to Firebase Hosting on merge to `main` via `deploy.yml` — a `dorny/paths-filter` `changes` job routes backend-only vs frontend-only commits, the backend `quality-gate`/`build-and-deploy` jobs are now gated on the `backend` filter, and new `web-quality-gate`→`deploy-frontend` jobs build/test then `firebase deploy --only hosting` KEYLESSLY, reusing the same WIF identity (OAuth access token minted via `token_format: access_token`; both `GOOGLE_APPLICATION_CREDENTIALS` and `FIREBASE_TOKEN` set belt-and-suspenders; no long-lived secret). One-time prerequisite before the first auto-deploy works: grant `roles/firebasehosting.admin` to the deploy service account (live-cloud action, NOT executed). PRIOR this turn-set: the two display-only producers that were previously stubbed off are now wired into the scheduled daily run — (1) a real Gemini `LlmProvider` (`src/llm/geminiProvider.ts`, Vertex AI generateContent over `fetch`, ADC/metadata token, no SDK so the import-boundary guard stays green) behind the single `LlmInterface`, and (2) a real FCS `ExternalSignalProvider` (`src/external-signal/fcsProvider.ts`, `/forex/latest` over `fetch`, all five pairs in ONE batched request to respect the free-plan 3-req/min limit, BUY/SELL/HOLD from daily change %). `src/scheduled-run/main.ts` replaced its `loadDisplayOnly = () => undefined` stub with a real `buildDisplayOnly` (`src/scheduled-run/displayOnly.ts`) that generates rationale/labels per firing card and the five-pair comparison, persisted via the existing `makeDisplayDataPersister`; added `src/scheduled-run/accessToken.ts` for the GCP token. Weekday gating added: scheduler cron now `0 17 * * 1-5` and an `isTradingDay` early-exit in `main.ts`. Config fixes: local `.env` `GEMINI_MODEL` corrected `gemini-3.5-flash`→`gemini-2.5-flash` (the former 404s in europe-west1); `eslint.config.js` now ignores `web/dist/**` (a pre-existing gap that failed lint on a clean tree); `.github/workflows/deploy.yml` `--set-env-vars` now also sets `GOOGLE_GENAI_USE_VERTEXAI=true` and `EXTERNAL_SIGNAL_PROVIDER=FCS` (without the latter the Job would skip FCS even with the key). Verified locally: lint + typecheck clean, 637 tests pass / 9 skipped; both adapters exercised live (Gemini returned a tagged rationale + labels; FCS returned direction/score/comparison for all five pairs). Stack: TypeScript (Node 22, ESM, zero runtime deps) + Vitest/fast-check; isolated Python cross-check (pytest/hypothesis); Supabase Postgres + pgvector; GCP Cloud Run Job + Cloud Scheduler + Secret Manager + Artifact Registry via keyless WIF; Firebase-hosted React/Vite SPA fronted by a read-only Cloud Run read-proxy. Open items: operational-wiring Task 13, dashboard-ui Tasks 17/18, RESEARCH-LOG.md still has zero logged kill-gate verdicts, and the backend changes this turn are NOT yet deployed — they require a push to `main` (plus setting the GitHub `GEMINI_MODEL` repo variable to `gemini-2.5-flash` and granting the Job runtime SA `roles/aiplatform.user`) and one Job execution before the dashboard shows the new data.
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
  authoritative. Python (`pytest` + `hypothesis`) only for an isolated
  statistical cross-check of the confidence-shrinkage formula; the TS core is
  the source of truth.
- **Tooling:** ESLint 9 + typescript-eslint. Dependencies are exact-pinned
  (no ranges) in every `package.json`. A custom `version-policy` audit
  (`scripts/version-policy.mjs`) guards version drift.
- **Storage:** Supabase Postgres + **pgvector** for pattern-vector ANN
  retrieval. Local and hosted targets selected via `SUPABASE_TARGET`. Schema
  managed by SQL migrations under `supabase/migrations/`.
- **Cloud (GCP, project `trade-assistant-508806`):** Cloud Run **Job** for the
  scheduled daily refresh; Cloud Run **service** for the dashboard read-proxy;
  Cloud Scheduler (daily `0 17 * * *` America/New_York); Secret Manager for all
  runtime secrets; Cloud Build + Artifact Registry (SHA-pinned images); keyless
  CI auth via Workload Identity Federation / OIDC (no stored SA key).
- **Serving / UI:** React + Vite + TypeScript SPA (`web/`) on Firebase Hosting,
  strictly read-only, fronted by `services/read-proxy/` — a Node 22 built-in
  `http` service (no Express/Fastify) that is the only serving-side component
  touching Supabase, with a fixed endpoint allowlist, SELECT/GET-only client,
  security headers, rate limiting, and caching.
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
- `yields/` — Sovereign 10Y yield-feed ingestion with missing-feed fail-safe.
- `encoder/` — Shape-only, per-scale-normalized pattern-vector encoder
  (10/20/40-day windows).
- `retrieval/` — pgvector analogue retrieval (weekly-trend pre-filter,
  self-exclusion, matured-only, similarity radius) + forward-outcome resolver.
- `baseline/` — Weekly-trend-follow baseline (the null hypothesis to beat).
- `features/` — Candidate features (%B, RSI, volume-proxy regime,
  distance-to-SMA, structural S/R, yield spread).
- `feature-registry/` — One-feature-at-a-time gated discovery; inclusion
  ceiling ≤ 12.
- `confidence/` — Earned confidence with sample-size shrinkage, ATR-scaled FLAT
  band, horizon (1/2/3-day) selection.
- `kill-gate/` — Two-stage kill-gate: Gate 1 (directional ≥ 3pp over baseline),
  Gate 2 (risk-adjusted MFE/MAE after friction); walk-forward verdict
  composition; `GateVerdictStore` port.
- `llm/` — Role-gated, provenance-tagged LLM interface + `ScoringInputGuard`.
  The v1 production backend `geminiProvider.ts` (Vertex AI `generateContent`
  over built-in `fetch`, ADC/metadata bearer token, no SDK) implements the
  `LlmProvider` port — `src/llm` is the sole SDK-aware layer and still imports
  no SDK package, so the import-boundary smoke test stays green.
- `news-filter/` — Calendar ingestion, LLM risk flag, deterministic
  suppression with fail-safe.
- `rationale/` — Display-only signal rationale + pattern description.
- `research-assistant/` — Human-gated research proposals.
- `dashboard/` — Silent-by-default dashboard, per-pair `fires()` decision,
  concentration/choppiness guards, firing-setup persistence, realized-outcome
  journal.
- `risk-boundaries/` — Empirical analogue-derived risk boundaries.
- `external-signal/` — External cross-reference, display/research-only, never
  feeds scoring. `fcsProvider.ts` is the real FCS adapter (`/forex/latest` over
  `fetch`); it batches all five pairs into one request (memoized per
  Decision_Date) to respect the FCS free-plan 3-req/min limit, deriving
  BUY/SELL/HOLD from the daily change %.
- `pipeline/` — End-to-end deterministic daily-run wiring; `makePipelineLoader`,
  `gatePassingResolver.ts`.
- `scheduled-run/` — GCP-scheduled unattended daily entry (`main.ts`), reuses
  the same daily-run path. `main.ts` now builds the optional Gemini + FCS
  collaborators from env, skips non-trading days (`isTradingDay`), and persists
  the display-only values beside the firing view. `displayOnly.ts` composes the
  rationale + comparison writes (fail-safe per pair); `accessToken.ts` resolves
  the GCP token (Cloud Run metadata server in prod, `gcloud` ADC locally).
- `csv-loader/`, `staged-runner/` — CSV backfill import + backfill/backtest/
  forward-look staged runner.
- `storage/` — Supabase config + REST client + adapters (candle, vector,
  analogue, gate-verdict, feature-registry, display-data stores).
- `ops/` — Operational tooling: `safety/` (gcloud runner + safety guard),
  `secret-manager/`, `deploy-verify/`, `scheduler/`, `gate-run/`, `seed-run/`,
  `write-credential/`.
- `version-policy/`, `architecture/`, `living-docs/` — version-policy audit;
  compute/storage/serving separation guard; the Living-Docs Writer.

Other roots: `services/read-proxy/` (serving-side Cloud Run service), `web/`
(the SPA), `python/` (isolated cross-check), `supabase/migrations/` (schema),
`ops/` + `ops.config.json` (operational config, including the
`Data_Source_Role` decision that CSV is backfill-only), `.github/workflows/`
(CI + deploy), `data/` (seed CSV candle files).

## 4. Spec completion status

| Spec | Status | Open items |
| --- | --- | --- |
| `fx-daily-pattern-assistant` | **Complete** (all tasks `[x]`) | — |
| `operational-wiring` | Near-complete | Task 13 (final checkpoint). Task 12's subtasks 12.1–12.4 are all `[x]` but the parent checkbox is unticked. |
| `dashboard-ui` | Near-complete | Task 17 (post-deploy read-only smoke), Task 18 (final checkpoint). |
| `dashboard-data-activation` | **Complete** (all tasks `[x]`) | — |

Cross-spec note: `dashboard-data-activation` Task 16 marks the dashboard-ui
Task 17 smoke as done, while `dashboard-ui` Task 17 itself is still `[ ]`. These
two documents are out of sync and should be reconciled.

## 5. Build / test / CI

- `make check` ≡ `npm run check` ≡ `eslint . && tsc --noEmit && vitest run`.
  `make check-all` adds the Python cross-check (`pytest python/tests`).
- **CI** (`.github/workflows/ci.yml`): on every push/PR — two jobs. The
  `quality` job runs the backend gate (Node from `.nvmrc`, `npm ci`, then
  Lint / Type-check / Tests / Version-policy as distinct stages, no
  `continue-on-error`). The `web` job verifies the SPA (`web/` working dir, own
  lockfile cache: `npm ci`, `npm run build` = `tsc --noEmit && vite build`,
  `npm run test`). The SPA now carries `@types/node` with `"node"` in its
  tsconfig `types`, so the build type-checks the Node-built-in imports in its
  test files under a clean CI install. (The Python cross-check is not wired into
  CI.)
- **Deploy** (`.github/workflows/deploy.yml`): on push to `main`, a two-target
  path-filtered pipeline. A `changes` job (`dorny/paths-filter@v3`) emits
  `backend`/`frontend` flags. BACKEND (gated on `backend`): full quality gate →
  keyless WIF auth → Cloud Build SHA-tagged image → Artifact Registry →
  `gcloud run jobs deploy` to the Cloud Run Job as a least-privilege runtime SA.
  Non-secret config via `--set-env-vars`; every secret via `--set-secrets`
  (`<name>:latest`) — no secret value in the file. FRONTEND (gated on
  `frontend`): `web-quality-gate` (build + tests) → `deploy-frontend`
  (`firebase deploy --only hosting` from `web/`), reusing the same keyless WIF
  identity, authenticating to firebase-tools via `GOOGLE_APPLICATION_CREDENTIALS`
  (ADC); no stored `FIREBASE_TOKEN` or SA key (the deprecated `FIREBASE_TOKEN`
  env was removed). A skipped path-filter gate cascades to skip its dependent
  deploy. The deploy SA was granted `roles/firebasehosting.admin` (live grant
  applied), which the frontend job requires.

## 6. Strategic decisions

- **Dimensional minimalism / gate-first build order.** The kill-gate was built
  before feature discovery so the first thing the project learns is whether a
  shape-only daily pattern even beats the weekly trend. Features are added one at
  a time, each must pass both gates, failures are cut and logged.
- **AI division of labor.** Scoring and gate verdicts are AI-free by
  construction; a `ScoringInputGuard` + property test assert no LLM output
  reaches those paths.
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

## 7. Obstacles / open risks

- **The central premise is not yet recorded as measured.** `RESEARCH-LOG.md`
  has **zero** entries between its `BEGIN/END ENTRIES` markers — no kill-gate
  PASS/CUT verdict has ever been appended. The harness, baseline, and feature
  discovery are all built and property-tested (including the mandated
  "deliberately-null feature must FAIL" and cross-regime inclusion tests), but
  the empirical question — does shape-only pattern matching beat the weekly-trend
  baseline out-of-sample? — is not answered in the living research log.
  `dashboard-data-activation` Tasks 10/11 claim a live Gate_Run recorded at least
  one PASS verdict in the hosted `gate_verdicts` table and populated
  `firing_setups`; if accurate a verdict exists in the database, but it is not
  reflected in `RESEARCH-LOG.md`. **Resolve this discrepancy** — the running
  summary should not claim validation the research log does not show.
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
- **Read-proxy fix is local-only and the proxy has no CI/CD.** The
  `/candles` + `/analogue-outcomes` column fix lives in
  `services/read-proxy/src/allowlist.ts` but the deployed `dashboard-read-proxy`
  Cloud Run service still runs the old revision, so the Pattern & Outcomes tab
  stays broken live until the service is rebuilt/redeployed out-of-band. Unlike
  the Cloud Run Job (backend) and the SPA (frontend), `services/read-proxy/**`
  is NOT wired into `deploy.yml` at all — no path filter, no deploy job — and
  has no CI coverage either. Candidate follow-up: add a `read-proxy` CI job and a
  path-filtered deploy job so this service ships like the other two targets.
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

## 8. Immediate next steps

1. Deploy the display-only features: set the GitHub `GEMINI_MODEL` repo variable
   to `gemini-2.5-flash` and grant the Job runtime SA `roles/aiplatform.user`.
   (The deploy SA `roles/firebasehosting.admin` grant for frontend auto-deploy is
   DONE.) Commit/push the workflow edits (incl. the `FIREBASE_TOKEN` removal) to
   `main` to redeploy the Cloud Run Job (now wired for Gemini + FCS and
   weekday-gated) and auto-deploy the SPA, then run one Job execution
   (`gcloud run jobs execute scheduled-daily-run`) so `signal_rationale` /
   `external_reference_comparison` get populated. Verify the SPA hosting deploy
   went green, and `/api/ai-rationale` + `/api/external-comparison`.
2. Redeploy the `dashboard-read-proxy` Cloud Run service so the `/candles` +
   `/analogue-outcomes` `asset`-column fix goes live (the Pattern & Outcomes tab
   is broken until then); optionally wire this service into CI/CD so it ships
   like the Job and the SPA.
3. Record the first real kill-gate walk-forward verdict in `RESEARCH-LOG.md`
   (or reconcile the DB-vs-log discrepancy above) so the core premise is
   measured in the living log.
4. Close `operational-wiring` Task 13 (final checkpoint) and tick Task 12's
   parent checkbox.
5. Run `dashboard-ui` Task 17 (post-deploy read-only smoke against real firing
   data) and close Task 18; reconcile with `dashboard-data-activation` Task 16.
6. Push the reconciling merge on `dev` to the remote (directly or via PR), and
   rename the remote `main` → `origin` to remove the branch/remote name clash.

## Notes on maintenance

The STATE block above is rewritten in place by `LivingDocs.updateState()` and by
the `update-living-docs` hook. Prose outside the markers is preserved across
updates — keep sections 1–8 current whenever a change, fix, or decision lands.
Never write a secret value, key, token, or JWT into this file; reference
credentials by name only. Kill-gate verdicts belong in `RESEARCH-LOG.md` (via
`appendVerdict()` / `appendCut()`), never here. Hand-authored constraints belong
in `LESSONS.md`.
