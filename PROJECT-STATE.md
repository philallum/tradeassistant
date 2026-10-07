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
- **Phase:** v1 feature-complete across all four specs; closing out final live-cloud checkpoints and recording the first real kill-gate verdict.
- **Updated:** 2026-10-07
- **Summary:** Deterministic TypeScript core (fx-daily-pattern-assistant) is 100% complete and property-tested. operational-wiring is done except Task 13 (final checkpoint); Task 12's subtasks are all complete though its parent checkbox is still unticked. dashboard-ui is complete except Task 17 (post-deploy read-only smoke) and Task 18 (final checkpoint). dashboard-data-activation is 100% complete: Supabase persistence for gate verdicts + feature registry, a GatePassingResolver wired into the scheduled run, a live Gate_Run, and a re-run daily job that populates firing_setups. Stack: TypeScript (Node 22, ESM, zero runtime deps) + Vitest/fast-check; isolated Python cross-check (pytest/hypothesis); Supabase Postgres + pgvector; GCP Cloud Run Job + Cloud Scheduler + Secret Manager + Artifact Registry via keyless WIF; Firebase-hosted React/Vite SPA fronted by a read-only Cloud Run read-proxy. Open items: operational-wiring Task 13, dashboard-ui Tasks 17/18, and — most important — RESEARCH-LOG.md still has zero logged kill-gate verdicts, so the central premise (shape-only pattern model beats the weekly-trend baseline out-of-sample) is not yet recorded in the living research log even though a live Gate_Run is claimed complete. Living-docs automation now keeps this file current: an in-code Living-Docs Writer plus two agent hooks (a Stop-trigger hook for any meaningful change and the postTaskExecution hook at spec-task boundaries).
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
- `news-filter/` — Calendar ingestion, LLM risk flag, deterministic
  suppression with fail-safe.
- `rationale/` — Display-only signal rationale + pattern description.
- `research-assistant/` — Human-gated research proposals.
- `dashboard/` — Silent-by-default dashboard, per-pair `fires()` decision,
  concentration/choppiness guards, firing-setup persistence, realized-outcome
  journal.
- `risk-boundaries/` — Empirical analogue-derived risk boundaries.
- `external-signal/` — External cross-reference, display/research-only, never
  feeds scoring.
- `pipeline/` — End-to-end deterministic daily-run wiring; `makePipelineLoader`,
  `gatePassingResolver.ts`.
- `scheduled-run/` — GCP-scheduled unattended daily entry (`main.ts`), reuses
  the same daily-run path.
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
- **CI** (`.github/workflows/ci.yml`): on every push/PR — Node from `.nvmrc`,
  `npm ci`, then Lint / Type-check / Tests / Version-policy as distinct stages,
  no `continue-on-error`. (The Python cross-check is not wired into CI.)
- **Deploy** (`.github/workflows/deploy.yml`): on push to `main` — full quality
  gate, then (gated on green) keyless WIF auth → Cloud Build SHA-tagged image →
  Artifact Registry → `gcloud run jobs deploy` to the Cloud Run Job as a
  least-privilege runtime SA. Non-secret config via `--set-env-vars`; every
  secret via `--set-secrets` (`<name>:latest`) — no secret value in the file.

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
- **CSV is backfill, not a feed.** `ops.config.json` records
  `Data_Source_Role = { csv: { role: "backfill" } }` — run once to seed history,
  not a recurring source.
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

## 8. Immediate next steps

1. Record the first real kill-gate walk-forward verdict in `RESEARCH-LOG.md`
   (or reconcile the DB-vs-log discrepancy above) so the core premise is
   measured in the living log.
2. Close `operational-wiring` Task 13 (final checkpoint) and tick Task 12's
   parent checkbox.
3. Run `dashboard-ui` Task 17 (post-deploy read-only smoke against real firing
   data) and close Task 18; reconcile with `dashboard-data-activation` Task 16.

## Notes on maintenance

The STATE block above is rewritten in place by `LivingDocs.updateState()` and by
the `update-living-docs` hook. Prose outside the markers is preserved across
updates — keep sections 1–8 current whenever a change, fix, or decision lands.
Never write a secret value, key, token, or JWT into this file; reference
credentials by name only. Kill-gate verdicts belong in `RESEARCH-LOG.md` (via
`appendVerdict()` / `appendCut()`), never here. Hand-authored constraints belong
in `LESSONS.md`.
