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
- **Phase:** v1 feature-complete across the original four specs; the fifth spec `simplify-to-cloud-minimal` is UNDER EXECUTION. Phases 1-5 COMPLETE; Phase 6 NOW COMPLETE (task 7 `deploy.yml` simplification done; task 7.1 GCP manifest + read-only enumeration done; task 7.2 the ☁️ operator-approved GCP reconcile deletions now EXECUTED LIVE against project `trade-assistant-508806`). Phase 4 LIVE-APPLIED to hosted (migration `...006`: 6-table Required_Object_Set with public SELECT + `fx_writer` INSERT/UPDATE/no-DELETE; the three read-side roles dropped). Remaining: Phase 7 (end-to-end verify, tasks 8/8.1/8.2) and the ACTUAL first recorded OOS evaluation run (task 2.2 cloud step, unexecuted). Operator approved scope C, delete-not-quarantine, and the kill-gate reframe.
- **Updated:** 2026-10-08
- **Summary:** THIS TURN (☁️ single spec-task execution of Phase 6 task 7.2 — operator-approved GCP reconcile) EXECUTED LIVE destructive GCP deletions under the operational-safety protocol: active project reconciled to `trade-assistant-508806` (account allum.phil@gmail.com), keep-list read from `ops/required-resources.manifest.json`, read-only enumeration via `ops/enumerate-gcp.sh`, exact delete set presented to and approved by the operator, and `deploy.yml` --set-secrets confirmed to reference ONLY the 5 retained secrets before any secret deletion. DELETED (all exit 0): Cloud Run service `dashboard-read-proxy` (R11.6); Cloud Run jobs `dashboard-seed-run` + `dashboard-gate-run` (R11.7); 10 obsolete/unused secrets — alpha-vantage-api-key, finnhub-api-key, massive-api-key, news-api-key, news-calendar-api-key, twelve-data-api-key, supabase-direct-connection, supabase-read-key, supabase-secret-key, supabase-token (R11.8, by name only); Artifact Registry packages `dashboard-read-proxy`/`gate-run`/`seed-run` + the 5 oldest `scheduled-run` digests, keeping the 5 newest incl. the live image (R11.9); service accounts read-proxy-runtime@ + gate-run-runtime@ (held no project IAM bindings, so no dangling grants) (R11.10). The 3 'review' SAs (trade-assistant@, 794110228539-compute@, firebase-adminsdk-fbsvc@) were EXPLICITLY HELD BACK by operator decision — expected residue, not a failure. Post-reconcile the live enumeration equals the Required_GCP_Resource_Set for every in-scope category and the reconcile is a no-op on re-run (R11.11, R11.12). Parent task 7 (`deploy.yml` simplification) auto-completed. FOLLOW-UP flagged by the subagent: `src/ops/secret-manager/*.test.ts` fixtures still mention some deleted secret names as SAMPLE DATA (not runtime refs) — a leftover worth tidying, not blocking. Next ready task is Phase 7 task 8.1 (confirm research-integrity layer intact); this was a single-task run so execution stopped there. SECURITY (standing): `.env` holds live production secrets in plaintext — rotate and untrack; gitignored `ops/fx-writer-key/` holds the `fx_writer` private signing key. PRIOR open items still stand: first OOS evaluation run (task 2.2, unexecuted — RESEARCH-LOG.md has zero recorded evaluations), operational-wiring Task 13, dashboard-ui Tasks 17/18. Stack: TypeScript (Node 22, ESM, zero runtime deps) + Vitest/fast-check; Supabase Postgres (hosted PG 17.6) + pgvector; GCP Cloud Run Job + Scheduler + Secret Manager + Artifact Registry via keyless WIF; Firebase-hosted React/Vite SPA reading a static `dashboard.json` snapshot.
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
  now reads the Public_Read_Path: a single static `dashboard.json` snapshot the
  Cloud Run Job writes at the end of each daily run, fetched same-origin via
  `web/src/api/snapshot.ts` `loadSnapshot()` (one shared `snapshotCache` across
  all tabs). The former `services/read-proxy/` Node `http` service + its `/api`
  rewrite + ten-endpoint allowlist are DELETED in code; the live GCP read-proxy
  resource was also DELETED in the Phase 6 R11 reconcile (task 7.2).
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
  no SDK package, so the import-boundary smoke test stays green.
- `news-filter/` — Calendar ingestion, LLM risk flag, deterministic
  suppression with fail-safe.
- `rationale/` — Display-only signal rationale + pattern description.
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
  the display-only values beside the firing view. `displayOnly.ts` composes the
  rationale + comparison writes (fail-safe per pair); `accessToken.ts` resolves
  the GCP token (Cloud Run metadata server in prod, `gcloud` ADC locally).
  `snapshot.ts` (added `simplify-to-cloud-minimal` task 6) builds + serialises
  the `dashboard.json` Public_Read_Path snapshot and writes it fail-safely
  through an injected `SnapshotSink` AFTER the DB rows persist (a failed write is
  logged and swallowed, never corrupting the source-of-truth rows); the concrete
  uploader is wired via `resolveSnapshotSink()` (a logged no-op until Phase 6).
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
  over a fixed committed OOS split). `fx-writer-check/` (added by
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
| `operational-wiring` | Near-complete | Task 13 (final checkpoint). Task 12's subtasks 12.1–12.4 are all `[x]` but the parent checkbox is unticked. |
| `dashboard-ui` | Near-complete | Task 17 (post-deploy read-only smoke), Task 18 (final checkpoint). |
| `dashboard-data-activation` | **Complete** (all tasks `[x]`) | — |
| `simplify-to-cloud-minimal` | **Under execution** — Phases 1-5 complete; Phase 6 COMPLETE (task 7 `deploy.yml` simplified; task 7.1 GCP manifest + read-only enumeration; task 7.2 the ☁️ operator-approved GCP reconcile deletions EXECUTED LIVE against project `trade-assistant-508806`); Phase 7 (end-to-end verify, tasks 8/8.1/8.2) pending; task 2.2 first-OOS-evaluation cloud run still unexecuted | De-scope spec: kill-gate reframed to a human-read evaluation report (task 1), the `evaluation_reports` persistence + report write path + first-evaluation entrypoint landed (task 2.x), Phase 2/3 removed the auto-block + suppressors + research/software complexity, Phase 5 task 6 (6.1-6.5) landed the Public_Read_Path (fail-safe `dashboard.json` snapshot writer wired into the daily run, SPA repointed to a single `loadSnapshot()`, `services/read-proxy/` + read-side `src/ops/write-credential/` deleted, proxy/allowlist tests replaced with snapshot-path tests, the last `signal_rationale`/`external_reference_comparison` writer removed and its write-shape types relocated to `displayOnlyTypes.ts`), and task 5.2a cut over the `fx_writer` Write_Credential. THIS TURN Phase 4 is now LIVE-APPLIED (task 5.3, operator-approved): migration `...006` was applied to hosted (project `bffzhjnpzxxuqvmnmylk`) after a fresh backup, reducing the schema to the 6-table Required_Object_Set; the three read-side roles (pipeline_writer, dashboard_reader, diagnostic_reader) were dropped, leaving `fx_writer` the sole write role; data preserved (realized_outcomes 0→2 before drops); idempotency confirmed; three robustness fixes committed to the migration + the guard test updated; `make check` green. CAVEAT: local-DB verification was validated via the structural guard test, not a live local enumeration, because the local Supabase CLI would not start. Still to do: simplify `deploy.yml` + reconcile GCP (Phase 6 / R11) and end-to-end verify (Phase 7). Scope C, delete-not-quarantine. NOTE: the ACTUAL first OOS evaluation run (task 2.2's ☁️ step) is deferred to the operator — the code entrypoint is ready but RESEARCH-LOG.md has no recorded evaluation yet. Next code-actionable: Phase 6 task 7 (simplify `deploy.yml`), followed by the GCP R11 reconcile and Phase 7 end-to-end verification. |

Cross-spec note: `dashboard-data-activation` Task 16 marks the dashboard-ui
Task 17 smoke as done, while `dashboard-ui` Task 17 itself is still `[ ]`. These
two documents are out of sync and should be reconciled.

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
- **Three further operator decisions (refine the above; analysis only, no
  code/doc change yet).** (1) **Public data** — the operator confirms the data
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
  target is now captured authoritatively in audit **§14**, added this turn
  (document only). It remains a recommendation — no code, migration, or cloud
  change has been made to action the removals.
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

## 7. Obstacles / open risks

- **`fx_writer` write-path cutover (5.2a) COMPLETE; the open ☁️ gate is now the 5.3 hosted reconcile itself.** The role exists on hosted and is granted to `authenticator`, `supabase-key` v3 carries a verifiable `role: fx_writer` ES256 JWT, and a live REST write-check is GREEN (INSERT/UPDATE succeed, DELETE refused 403). To get there, `...006` STEP 7 (grants) and STEP 3+4 (drop old RLS policies + disable RLS) were pulled forward out-of-band on the 5 existing retained tables; `pipeline_writer` still works so the daily run is unbroken. REMAINING RISK for task 5.3: it performs the DESTRUCTIVE drops (tables, views, the `pipeline_writer` role, diagnostic read path) and creates `evaluation_reports` — take a fresh hosted backup (schema+data+roles) and present the exact drop set before applying. Hosted SQL/REST from local MUST use the IPv4 `SUPABASE_POOLER` (direct `db.*:5432` is IPv6-only, unreachable here). Sensitive artifact: gitignored `ops/fx-writer-key/` holds the `fx_writer` private signing key.

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
  summary should not claim validation the research log does not show. UPDATE
  (`simplify-to-cloud-minimal` task 2.2): the runnable entrypoint
  `src/ops/evaluation-run/main.ts` now exists and will compose + append the
  first human-read `EvaluationReport` over the fixed OOS split, but executing it
  is an operator action and no usable local Supabase is available (see the
  env/secret-hygiene risk below), so RESEARCH-LOG.md is still empty — the premise
  remains unmeasured in the log, now blocked on an environment + an operator run,
  not on missing code.
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
  remains but nothing points at it. Also note the snapshot sink is a no-op until
  the Phase 6 uploader is wired, so no `dashboard.json` is actually published yet.
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
2. (SUPERSEDED by `simplify-to-cloud-minimal` Phase 5 task 6 — the read-proxy
   code is deleted and the SPA now reads the `dashboard.json` snapshot.) What
   remains: DELETE the orphaned `dashboard-read-proxy` Cloud Run service + images
   from GCP in the Phase 6 R11 operator-approved sweep (task 7.2), and wire the
   real snapshot uploader (currently a no-op) into the Job/deploy in Phase 6.
3. Record the first real offline evaluation of the core premise in
   `RESEARCH-LOG.md` (or reconcile the DB-vs-log discrepancy above) so the
   premise is measured in the living log. Per audit §13 this should be an
   evaluation REPORT (model-vs-baseline accuracy, delta, friction-adjusted
   MFE/MAE, sample size, statistical uncertainty) read by the operator, not an
   automated `PASS`/`CUT` verdict; the Gate 1/Gate 2 math still produces the
   numbers.
4. Close `operational-wiring` Task 13 (final checkpoint) and tick Task 12's
   parent checkbox.
5. Run `dashboard-ui` Task 17 (post-deploy read-only smoke against real firing
   data) and close Task 18; reconcile with `dashboard-data-activation` Task 16.
6. Push the reconciling merge on `dev` to the remote (directly or via PR), and
   rename the remote `main` → `origin` to remove the branch/remote name clash.
7. Decide on the simplicity/complexity audit
   (`docs/architecture/PROJECT-SIMPLICITY-AUDIT.md`, incl. the §13 kill-gate
   review): its top recommendation is to run the existing measurement engine and
   record the first evaluation report (step 3) BEFORE any rearchitecting, then
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
   after step 3 (run the measurement engine, record the first evaluation report)
   per the audit's own ordering.
8. Execute the `simplify-to-cloud-minimal` spec. Phases 1-3 are DONE, Phase 4
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
   verification. STILL PENDING from Phase 1: the ACTUAL first OOS evaluation run
   (task 2.2) remains unexecuted (no usable local Supabase) — the single
   highest-value measurement step, deferred to the operator.

## Notes on maintenance

The STATE block above is rewritten in place by `LivingDocs.updateState()` and by
the `update-living-docs` hook. Prose outside the markers is preserved across
updates — keep sections 1–8 current whenever a change, fix, or decision lands.
Never write a secret value, key, token, or JWT into this file; reference
credentials by name only. Kill-gate verdicts belong in `RESEARCH-LOG.md` (via
`appendVerdict()` / `appendCut()`), never here. Hand-authored constraints belong
in `LESSONS.md`.
