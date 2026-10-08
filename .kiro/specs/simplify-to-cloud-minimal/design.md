# Design Document

## Overview

This design turns the eleven requirements of `simplify-to-cloud-minimal` into a
concrete plan to simplify the FX Daily Pattern Assistant to the audit's §14
**cloud-minimal, single-user, public-data** architecture, with the kill-gate
reframed as a **human-read evaluation report** (audit §13).

It is a de-scope of an existing, feature-complete system, not a greenfield
build. The analysis core (guard, encoder, retrieval, baseline, confidence,
measurement math, realized-outcome journal, AI-never-scores guard) is preserved
unchanged in behaviour; the surrounding infrastructure, abstraction, and
automatic decision-making are removed.

Two orderings are load-bearing and shape the whole design:

1. **Measure before you rip out.** The kill-gate reframe (R1) and the first
   recorded evaluation (R2) land before any destructive removal (R3–R8, R10,
   R11). So the premise is measured against the existing, intact machinery first.
2. **Keep the loop green at every step.** Each removal is paired, in the same
   change, with whatever wiring update keeps `make check` green and the
   end-to-end daily loop functional (R9.2, R9.6).

### Investigation findings that drive the design

These were confirmed by reading the code and resolve the two open flags from the
requirements:

- **The gate "auto-block" is a firing condition, not a standalone file.**
  `evaluatePair()` (`src/pipeline/dailyPipeline.ts`) computes a `gatePassing`
  boolean from an injected resolver; both `fires()` (`src/dashboard/dashboard.ts`)
  and `persistFiringSetups.ts` require `evaluation.gatePassing` to fire. The
  resolver (`makeGatePassingResolver`) reads the newest `PASS` from
  `gate_verdicts`. Removing the auto-block therefore means **changing the firing
  condition** and the `PairEvaluation` shape — not merely deleting
  `gatePassingResolver.ts`.
- **Risk-boundaries IS consumed by the display path.** `deriveRiskBoundaries()`
  produces the `stopLossPips` / `takeProfitPips` shown on the firing card
  (`renderFiringCard.ts`). Per R7.6 the resolution is **KEEP in minimal
  displayed form** — do not remove it.
- **The SPA reads through a read-proxy via a Firebase Hosting `/api` rewrite.**
  `web/src/api/endpoints.ts` declares ten `/api/*` endpoints mirroring the
  read-proxy allowlist, mapped to SQL read views. Removing the read-proxy
  requires replacing what `/api/*` resolves to — this is the central
  Public_Read_Path decision (§ below).
- **News also gates firing.** `fires()` requires `!newsSuppressed`. News is
  deferred, so the firing condition collapses to a direction-and-confidence test.

## Key Design Decisions

### Decision 1 — Firing condition after the removals

**Current:** a pair fires iff `gatePassing && !newsSuppressed && direction !== "FLAT" && earnedConfidence >= threshold`.

**New:** a pair fires iff `direction !== "FLAT" && earnedConfidence >= threshold`.

Rationale: R3 removes the Gate_Auto_Block; news is deferred (R7); the
choppiness and concentration suppressors are removed (R3). The displayed strength
(the shrunk confidence) and the direction are the only firing inputs. The
choppiness metric is still **computed and displayed** (R3.2) but never suppresses.
This keeps the honest "silent-by-default" behaviour (FLAT or thin neighbourhoods
simply don't fire) without any software deciding what you may *see*.

`PairEvaluation` drops `gatePassing` and `newsSuppressed`; it gains a displayed
`choppiness` field. The `firing_setups.suppression_reason` enum shrinks to the
set that remains meaningful (`below_floor`, `not_fired`); `news`,
`currency_concentration`, and `too_choppy` are removed with their mechanisms.

### Decision 2 — Public_Read_Path: JSON snapshot (chosen) over direct PostgREST

Two options were considered (requirements R5.1):

- **(A) Static JSON snapshot** — the Cloud Run Job writes a single
  `dashboard.json` (today's observations + history + external signal + Gemini
  opinion + evaluation summary) to the Firebase Hosting site (or a public bucket)
  at the end of each daily run. The SPA fetches that one file.
- **(B) Direct PostgREST** — the SPA calls Supabase PostgREST directly with the
  anon key against public-readable tables.

**Chosen: (A) JSON snapshot.** Reasons:

- It is the strongest simplification: it removes the read-proxy, the ten-endpoint
  allowlist, the read views, *and* the SPA's PostgREST coupling in one move. The
  SPA goes from "ten typed endpoints + a proxy" to "fetch one static file."
- It needs no datastore credential in the browser and no PostgREST exposure at
  all — the only thing public is a flat JSON file, which matches "data is public."
- It is cheaper and faster (a CDN-served static asset, no per-view queries).
- It keeps the SPA strictly read-only (R5.3) by construction — there is nothing
  to write to.

Trade-off accepted: the dashboard is as fresh as the last daily Job run (plus any
manual Job execution), not real-time. For a once-daily tool that is correct, and
it is simpler than a live query path. Option (B) remains a documented fallback if
a future need for ad-hoc querying appears.

The Firebase Hosting `/api` rewrite to the read-proxy is deleted; the SPA fetches
`/<snapshot>.json` as a same-origin static asset. `web/src/api/` collapses from
the ten-endpoint typed client to a single typed snapshot loader.

### Decision 3 — Evaluation report, not a PASS/CUT verdict (R1, audit §13)

The measurement math in `src/kill-gate/gate1.ts` and `gate2.ts` is retained as
pure functions. What changes is the *output type and its consumers*:

- `composeGateVerdict()` → `composeEvaluationReport()`: returns an
  `EvaluationReport` with the measured metrics and **no `verdict` field**.
- The `GATE1_MIN_DELTA` (+3pp) and Gate-2 `margin >= 0` constants are retained
  only as **non-binding annotation flags** on the report (e.g.
  `delta_exceeds_3pp: boolean`), never as a gate (R1.5).
- `src/pipeline/gatePassingResolver.ts` and the `gatePassing` wiring in
  `scheduled-run/main.ts` are deleted (R3.4). Nothing in the daily path consults
  a verdict.
- Persistence: `gate_verdicts` / `gate_fold_verdicts` → a single
  `evaluation_reports` table (R8.2) with no verdict column.
- `RESEARCH-LOG.md` gets a new **evaluation-report entry** format (R2.2) via the
  Living-Docs writer, replacing the PASS/CUT `appendVerdict`/`appendCut` path.

The AI-never-scores guard (`ScoringInputGuard`) is unchanged and continues to
assert no LLM output reaches the measurement path (R1.7).

### Decision 4 — Reconcile-to-known-good for both Supabase (R10) and GCP (R11)

Both cleanups follow the same shape, adapted to their medium:

- **Supabase (declarative):** a new forward migration drops every object not in
  the `Required_Object_Set`. An introspection query over
  `information_schema` / `pg_catalog` enumerates the live account; the migration
  is written to leave exactly the required set; idempotent and applied to local
  and hosted (R10.4, R10.8).
- **GCP (imperative):** a committed `ops/required-resources.manifest.json`
  defines the `Required_GCP_Resource_Set`; a read-only enumeration
  (`gcloud … list`) is diffed against it; each deletion is an operator-approved
  Live_Cloud_Command under the existing operational-safety protocol (R11.4–R11.5).
  There is no "migration" — it is a manifest + reconcile procedure.

### Decision 5 — Delete, don't quarantine (operator decision)

Removed components are deleted outright — source, tests, schema objects, deploy
references, and GCP resources — with the suite kept green and the absence proven
by tests (R9.2–R9.3). No `legacy/` or disabled-flag retention.

## Architecture

### Target system (§14)

```
 Cloud Scheduler (daily, Session_Close, Mon–Fri)
        │
        ▼
 Cloud Run Job  "scheduled-daily-run"
   ingest candles → encode → retrieve analogues → resolve matured outcomes
     → baseline + confidence + ATR FLAT band → per-pair observation
     → derive risk boundaries (displayed) + choppiness metric (displayed)
     → write predictions + realized outcomes (matured) to Postgres
     → attach FCS signal + Gemini opinion (fail-safe, display only)
     → write dashboard.json snapshot to Hosting/public bucket
        │
        ├──────────────▶ Supabase Postgres (public read, non-public write)
        │
        ▼
 Firebase Hosting  (public URL, mobile)
   SPA fetches dashboard.json (read-only, no proxy, no auth gate)

 (periodic, offline, operator-run)
   measurement engine over the fixed OOS split
     → EvaluationReport → evaluation_reports table + RESEARCH-LOG entry
       (human reads it; no automated alive/dead verdict)

 GitHub Actions  → build image → Artifact Registry → deploy Job + Hosting
```

### Retained vs removed (maps the audit §9/§14 buckets to concrete modules)

**Retained (analysis + spine):** `guard/`, `ingestion/`, `encoder/`,
`retrieval/`, `baseline/`, `confidence/`, `risk-boundaries/` (display only),
`kill-gate/` measurement math (reframed), `llm/` (one Gemini call + the
AI-never-scores guard), `external-signal/` (one FCS adapter), `rationale/`
(display), `dashboard/` (minus suppressors), `pipeline/` (minus gate wiring),
`scheduled-run/`, `csv-loader/`, `storage/` (slimmed), `living-docs/`,
`version-policy/`; Cloud Run Job + Scheduler + Secret Manager + Artifact Registry
+ Firebase Hosting + GitHub Actions deploy.

**Removed:** `services/read-proxy/` (R4); `src/architecture/servingLayerGuard`
(R7.3); `src/research-assistant/` (R7.2); `src/yields/` (R7.5); `python/` (R7.1);
`src/pipeline/gatePassingResolver.ts` (R3.4); the choppiness + currency-
concentration suppressors (R3.1, R3.3); the feature-registry + candidate-feature
set (R7.5); the Strategy_Source multi-strategy abstraction (R7.4); RLS + scoped
JWT + read views + diagnostic path (R4.2); the `src/ops` tooling that existed
only for Read_Side_Security (R4.3); and the corresponding GCP resources (R11).

## Components and Interfaces

### C1 — Measurement engine → evaluation report (R1, R2)

- **Keep:** `evaluateGate1`, `evaluateGate2`, the walk-forward pooling math.
- **Change:** introduce `EvaluationReport`:
  ```
  interface EvaluationReport {
    configId: string;
    split: { trainEnd; testStart; testEnd };
    sampleSize: number;              // matched firing subset
    predictionsCount: number;
    modelAccuracy: number;
    baselineAccuracy: number;
    deltaVsBaseline: number;         // model - baseline (pp as fraction)
    frictionAdjustedModel: number;
    frictionAdjustedBaseline: number;
    mfeMaeSummary: { modelMfe; modelMae; baselineMfe; baselineMae };
    strengthBreakdown: { weak; moderate; strong };   // counts by confidence band
    uncertainty: { accuracyDeltaCI: [lo, hi]; note: string }; // sample-size aware
    annotations: { deltaExceeds3pp: boolean; riskAdjNonNegative: boolean }; // non-binding
    // NO `verdict` field.
  }
  ```
- **Delete:** the `verdict: "PASS"|"CUT"` field and the composition that produced
  it; rename `composeGateVerdict` → `composeEvaluationReport`.
- **Uncertainty:** a Wald (normal-approximation) confidence interval on the
  accuracy delta from the matched sample size, with an explicit low-n note when
  the matched subset is small (R2.5). This is deterministic and pure.

### C2 — Firing path (R3)

- `PairEvaluation`: remove `gatePassing`, `newsSuppressed`; add `choppiness`
  (displayed number).
- `fires()`: `direction !== "FLAT" && earnedConfidence >= threshold`.
- `persistFiringSetups.ts`: drop the gate/news/choppiness suppression branches;
  retain `below_floor` and `not_fired`.
- Delete `makeGatePassingResolver` and its wiring; delete the choppiness guard
  and concentration guard suppressor code and tests; replace their tests with
  tests asserting **no suppression** and that choppiness is surfaced as a field.

### C3 — Public read path (R5)

- Add a snapshot writer to the daily run: serialise the dashboard view +
  history + evaluation summary to `dashboard.json`, written to Hosting / a public
  bucket at the end of `runScheduledDaily` (fail-safe: a failed snapshot write is
  logged and does not corrupt the persisted DB rows).
- `web/src/api/`: replace the ten-endpoint typed client + `endpoints.ts`
  allowlist with a single typed `loadSnapshot()` that fetches `dashboard.json`.
  Keep the SPA's wire-format row *types* (they describe the snapshot shape) but
  drop the endpoint map and the proxy-coupled client.
- Delete the Firebase Hosting `/api` rewrite to the read-proxy; the SPA requests
  a static same-origin asset. No auth gate (R4.4).

### C4 — Datastore reduction + reconcile (R8, R10)

- `Required_Object_Set` (authoritative, R10.1): `candles`, `pattern_vectors`,
  `analogue_outcomes`, `firing_setups` (the daily observation / prediction
  record), `realized_outcomes`, `evaluation_reports`.
- New migration `...006_simplify_schema` (local + hosted): create
  `evaluation_reports`; drop `gate_verdicts`, `gate_fold_verdicts`, `yields`,
  `data_splits`, `walk_forward_folds`, `feature_registry`, `calendar_events`,
  `news_risk_flags`, `version_ledger`, `signal_rationale`,
  `external_reference_comparison` (their display content moves into the snapshot /
  `firing_setups`), the read views, RLS policies, the `pipeline_writer` role, and
  the diagnostic read-path objects.
- Strategy_Source: `realized_outcomes.strategy_id` collapses to a plain default
  (or is dropped if no retained reader needs it); the multi-strategy abstraction
  is removed (R7.4).
- Data preservation: before dropping, migrate any realized-outcome rows into the
  retained `realized_outcomes` shape (R8.6, R10.6).
- Write path under public data: public `SELECT` granted on the retained tables;
  `INSERT`/`UPDATE` restricted to the single `Write_Credential` the Job holds
  (R4.5, R4.6) — not public, no RLS row policies.

### C5 — Cloud spine + deploy simplification (R6, R11)

- Keep: Cloud Run Job, one Scheduler trigger, Secret Manager (API keys + the one
  Write_Credential), Artifact Registry, Firebase Hosting, GitHub Actions deploy.
- `deploy.yml`: remove the read-proxy and any RLS/scoped-JWT/read-view steps,
  secrets, env vars, and path filters; keep the Job deploy and the Hosting
  publish. Simplify (not expand) the deploy identity.
- `ops/required-resources.manifest.json`: the positive GCP keep-list (R11.1).
- Reconcile procedure: read-only enumeration diffed against the manifest; the
  operator-approved deletions remove the `dashboard-read-proxy` service + images,
  the one-shot `dashboard-seed-run` job (once seeding is done), the obsolete
  `supabase-key` scoped-JWT secret and now-unused provider secrets, stale images
  (retention policy), and dangling IAM/service accounts (R11.6–R11.10).

## Data Models

### evaluation_reports (replaces gate_verdicts + gate_fold_verdicts)

```
create table evaluation_reports (
  id                 uuid primary key default gen_random_uuid(),
  config_id          text not null,
  split_train_end    date not null,
  split_test_start   date not null,
  split_test_end     date not null,
  sample_size        integer not null,
  predictions_count  integer not null,
  model_accuracy     double precision not null,
  baseline_accuracy  double precision not null,
  delta_vs_baseline  double precision not null,
  friction_adj_model double precision,
  friction_adj_base  double precision,
  metrics            jsonb not null default '{}'::jsonb,  -- MFE/MAE, strength, CI, annotations
  created_at         timestamptz not null default now()
  -- NO verdict column (R8.2)
);
```

### firing_setups (retained; suppression_reason shrunk)

`suppression_reason` enum reduced to `('below_floor','not_fired')`; the `news`,
`currency_concentration`, and `too_choppy` values and their columns
(`competing_pairs`) are dropped. A displayed `choppiness` value is added.

### Removed tables

`gate_verdicts`, `gate_fold_verdicts`, `yields`, `data_splits`,
`walk_forward_folds`, `feature_registry`, `calendar_events`, `news_risk_flags`,
`version_ledger`, `signal_rationale`, `external_reference_comparison`, plus the
read views and the diagnostic read-path objects.

## Error Handling

- **Snapshot write failure** degrades gracefully: the DB rows are the source of
  truth; a failed `dashboard.json` write is logged and the next run overwrites it
  (R5.5 shows an explicit empty/unavailable state if the snapshot is missing).
- **Fail-safe display producers** (Gemini, FCS) are unchanged: an unconfigured or
  failing provider yields "no rationale" / "reference unavailable" for that pair
  and never blocks the deterministic observation (preserved behaviour).
- **Reconcile safety:** no object/resource is dropped until (DB) the forward
  migration is reviewed, or (GCP) the operator approves the exact command; data-
  bearing drops are preceded by data migration (R8.6, R10.6).

## Testing Strategy

- **Preserve:** every research-integrity test (look-ahead guard, baseline,
  measurement math, shrinkage, AI-never-scores) stays green and unchanged in
  intent (R9.1).
- **Replace, don't skip:** tests asserting PASS/CUT, auto-block, suppression, the
  read-proxy allowlist, RLS, and the removed modules are **deleted** and replaced
  with tests asserting the new behaviour — report has no verdict; firing ignores
  any gate; no suppression occurs; the SPA loads a snapshot; dropped objects are
  absent (R9.3).
- **Determinism:** `composeEvaluationReport` reproduces an identical report on
  identical inputs (R1.6).
- **End-to-end:** a post-de-scope check runs the daily path, writes
  predictions/realized outcomes + snapshot, and the SPA renders from the snapshot
  (R9.7).
- **Green gate at every commit:** `make check` (lint + typecheck + vitest) green
  after each removal step (R9.2).

## Sequencing (measurement-first, enforced by R9.5)

The tasks will implement in this order:

1. **R1 + R2** — reframe to `EvaluationReport`, add `evaluation_reports`, run the
   measurement on the fixed OOS split, record the first report in RESEARCH-LOG.
   *(Reconcile the DB-vs-log discrepancy noted in the requirements before/at this
   step: treat RESEARCH-LOG as source of truth; if a stale `gate_verdicts` PASS
   row exists it is superseded when `gate_verdicts` is dropped in step 4.)*
2. **R3** — remove the auto-block and the suppressors; simplify the firing
   condition; keep choppiness as a displayed field.
3. **R7** — remove research-assistant, serving-guard, Python cross-check, yields,
   feature-registry, Strategy_Source; retain risk-boundaries (display only).
4. **R8 + R10** — schema reduction + Supabase reconcile migration (drops the now-
   unreferenced tables, including the stale `gate_verdicts`).
5. **R4 + R5** — delete the read-proxy and the read-side security; introduce the
   snapshot Public_Read_Path; repoint the SPA.
6. **R6 + R11** — simplify the deploy pipeline; reconcile the GCP project
   (operator-approved deletions).
7. **R9.7** — end-to-end verification of the simplified cloud loop.

## Open Items Carried from Requirements

- **DB-vs-RESEARCH-LOG reconciliation** (R2): resolved by sequencing — the log is
  authoritative; any stale `gate_verdicts` PASS is removed when that table is
  dropped in step 4. Called out so no one treats the dropped row as a lost
  verdict.
- **risk-boundaries (R7.6):** resolved to **KEEP (display only)** — it feeds the
  firing card's SL/TP.
- **R11 vs R4/R6 ownership:** R4 owns the read-proxy *code/schema* removal and R6
  the *deploy pipeline* simplification; R11 is the live-GCP sweep that also
  deletes the deployed read-proxy *resource*. The three are coordinated in
  step 5–6 so the service, its deploy wiring, and its cloud resource go together.
