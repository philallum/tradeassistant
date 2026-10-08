# Implementation Plan: Dashboard_UI

## Overview

This plan converts the dashboard-ui design into incremental, test-driven coding tasks.
It is a strictly **read-only serving layer**: no task re-implements any pipeline, scoring,
gate, or guard logic, and the SPA recomputes nothing — every rendered value is drawn
verbatim from a persisted row (Req 9.10, 10.4, 20.1). The work is organized by the four
deliverables the design defines, built in dependency order:

- **`web/`** — a standalone React + Vite + TypeScript SPA deployed to Firebase Hosting.
  It holds no database credential and reads only through the Read_Proxy via the Firebase
  Hosting `/api` rewrite. Its correctness lives in **pure modules** under `web/src/pure/*`
  (date selection + row→view-model + chart-series shaping), separated from impure
  fetch/render code so it is property-testable without a browser or network (Req 19).
- **`services/read-proxy/`** — a standalone TypeScript/Node Cloud Run **service**. Its HTTP
  layer uses the **Node 22 built-in `http` module plus a thin hand-written router — NO web
  framework** (no Express/Fastify/Koa/etc.). It is the only serving-side component that
  touches Supabase, exposes a fixed endpoint allowlist, builds SELECT-only PostgREST
  queries, and enforces rate-limit / cache / CSP policy.
- **Companion migration `20260916000003_dashboard_read_views_rls.sql`** — adds the two
  display-only base tables, the nine `security_invoker` read-only views, the separate
  `dashboard_reader` role, `pipeline_writer` grants/RLS on the new tables, and the
  default-deny grant posture. Applied identically local + hosted (Req 4.3, 4.7, 21.5).
- **Core-side display-only persistence (`src/`)** — a new
  `src/storage/supabase/displayDataPersister.ts` writer wired at the existing
  `dailyRun`/`persistView` seam in `src/scheduled-run/main.ts`, writing `signal_rationale`
  and `external_reference_comparison` under the unchanged `pipeline_writer` write path.
  The `dailyRun` firing logic is untouched (Req 20.1–20.4).

Plus the **serving-layer guard reconciliation**: `src/architecture/servingLayerGuard.test.ts`
is extended (no `src/` import of `web/` or `services/read-proxy/`; core stays serving-free),
and the parent fx-daily-pattern-assistant design 17.3/17.4 reservation text is updated to
record that the reserved read-only serving layer is now realized as these two deployables
(Req 20.5, 20.6).

### Tooling

`web/` and `services/read-proxy/` each get their **own pinned `package.json`** (exact
versions) with their own `vitest` + `fast-check` toolchain and a dependency audit, scoped
to that app only. This is permitted because the parent no-new-dependency rule (parent
Req 18) is scoped to the deterministic core (`src/`) and does NOT constrain these separate
deployables (Req 1.1, 1.2, 5.10). React, Vite, and Recharts are confined to `web/`. The
core-side change (task 10) adds no new dependency and reuses the existing `SupabaseRestClient`.

### Two kinds of task, kept strictly separate

- **Testable coding tasks** — pure data-shaping / selection logic, pure proxy query-building
  / policy logic, structural/guard tests, unit + accessibility tests, and local-Supabase
  integration tests for the proxy. Each correctness property is implemented by a SINGLE
  `fast-check` property test at **minimum 100 iterations**, tagged in the repo convention
  `// Feature: dashboard-ui, Property N: <property text>`, with `**Validates: Requirements
  X.Y**` matching the design.
- **LIVE CLOUD EXECUTION tasks** — applying the companion migration to hosted Supabase,
  provisioning the read credential in Secret Manager, deploying the Read_Proxy Cloud Run
  service, `firebase deploy`, and the post-deploy read-only smoke verification. These are
  **not** property tests. They follow the design's **Live Cloud Execution Protocol**:
  reconcile active `gcloud` project + account against `trade-assistant-508806` → show the
  exact command for operator approval → source secret values from Secret Manager on stdin,
  never echoed/logged/committed → confirm each op's effect afterward recording only
  non-secret references. The operator has agreed these run live.

Test sub-tasks are marked optional with `*`. Core implementation tasks and live-cloud tasks
are never optional.

## Tasks

- [x] 1. Companion migration — display-only tables, views, read role, default-deny RLS (Req 4)
  - [x] 1.1 Create the two display-only base tables with RLS and pipeline_writer grants
    - Add `supabase/migrations/20260916000003_dashboard_read_views_rls.sql`; create
      `signal_rationale` (PK `(decision_date, pair, strategy_id)`, `rationale_text`,
      `analogue_labels text[]`, `proposals jsonb`, `provenance`, `is_display_only`,
      `recorded_at`) and `external_reference_comparison` (PK `(decision_date, pair)`,
      `own_direction`, `reference_direction`, `reference_score`, `provider`, `comparison`
      checked in `('agree','diverge','neutral','unavailable')`, `provenance`,
      `is_display_only`, `fetched_at`, `recorded_at`) if absent
    - `enable row level security` on both; grant `pipeline_writer` `select, insert, update`
      (no delete) and add a `pipeline_writer_rw` policy on each, mirroring `20260916000002`
    - Idempotent / re-runnable; identical local + hosted
    - _Requirements: 4.3, 20.3, 21.5_

  - [x] 1.2 Create the dashboard_reader role and the nine security_invoker views
    - Guarded `DO` block `create role dashboard_reader nologin`; `grant dashboard_reader to
      authenticator` so PostgREST can `SET ROLE` into it
    - `create or replace view` for all nine views with `security_invoker = true`,
      projecting ONLY the columns listed in the design (`v_decision_dates`,
      `v_firing_setups`, `v_analogue_outcomes`, `v_realized_outcomes`, `v_gate_verdicts`,
      `v_gate_fold_verdicts`, `v_candles`, `v_signal_rationale`,
      `v_external_reference_comparison`); pair/asset-scoped views filter to the five `PAIRS`
    - _Requirements: 4.1, 4.2_

  - [x] 1.3 Apply default-deny grants and reader RLS policies
    - `grant usage on schema public to dashboard_reader`; `grant select` to
      `dashboard_reader` on the nine views ONLY and on no base table; add a
      `dashboard_reader_select` RLS policy on each new display-only table permitting SELECT
      for the reader through the security-invoker view while base-table direct SELECT stays
      ungranted
    - Confirm the migration is separate from `20260916000002` and leaves the
      `pipeline_writer` RLS unchanged (Req 4.6)
    - _Requirements: 4.4, 4.5, 4.6_

  - [x] 1.4 Write migration structural/unit test
    - Assert the migration file exists, is idempotent in shape (`create ... if not exists`,
      `create or replace view`, guarded role creation), grants `dashboard_reader` SELECT on
      exactly the nine views and no base table, and leaves `20260916000002` untouched
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.7_

- [x] 2. Core-side display-only persistence writer (Req 20)
  - [x] 2.1 Implement `makeDisplayDataPersister` writing the two display-only tables
    - Create `src/storage/supabase/displayDataPersister.ts` exposing
      `makeDisplayDataPersister(supabase, fetchImpl?)` returning
      `(data: DisplayOnlyWrite) => Promise<void>`; define `DisplayOnlyWrite`,
      `SignalRationaleWrite` (from `src/rationale`), and `ReferenceComparisonWrite` (from
      `src/external-signal`)
    - Upsert `signal_rationale` and `external_reference_comparison` via the existing
      `SupabaseRestClient` under the `pipeline_writer` write path; unwrap LlmTagged /
      external-signal provenance at the write boundary exactly as the FiringCard render
      boundary does — never re-entering scoring; never log the key
    - _Requirements: 20.3, 20.4_

  - [x] 2.2 Wire the writer at the dailyRun/persistView seam
    - In `src/scheduled-run/main.ts`, add one optional composition step beside
      `makeSupabaseViewPersister` that invokes `makeDisplayDataPersister` with the
      already-produced rationale / comparison values for the Decision_Date; leave the
      `dailyRun` firing logic and the pipeline untouched (compute/storage separation,
      Req 20.1–20.2)
    - _Requirements: 20.1, 20.2, 20.3_

  - [x] 2.3 Write integration tests against local Supabase (`SUPABASE_TARGET=local`)
    - Write a `DisplayOnlyWrite` through `makeDisplayDataPersister` and read
      `signal_rationale` / `external_reference_comparison` back (round-trip, 1–3 fixtures);
      assert `is_display_only=true` and `provenance` are persisted; assert the writer uses
      only INSERT/UPDATE (no base-table read exposure to the reader role)
    - _Requirements: 20.3, 20.4_

- [x] 3. Read_Proxy — allowlist + pure query building (Req 5, 3)
  - [x] 3.1 Scaffold `services/read-proxy/` toolchain and the endpoint allowlist (pure)
    - Create `services/read-proxy/` with its own pinned `package.json` (exact versions),
      `tsconfig.json`, `vitest` + `fast-check`, dependency audit, and `Dockerfile`
    - Implement `src/allowlist.ts`: `EndpointSpec` (`path`, `view`, `params` schema,
      `maxRows`, `cacheTtlMs`) and the fixed `ENDPOINTS` list exactly as the design's
      allowlist table (ten endpoints → one view each, param schemas, row caps)
    - Implement `buildQuery(spec, raw)` (pure): validate every param (ISO date regex,
      `isPair`, uuid, bounded int) and return `{ ok:true, view, query }` with a `limit` ≤
      the endpoint cap, or `{ ok:false, status:400|404, message }` for unknown path /
      unknown param / missing required / out-of-range — no query built on rejection
    - _Requirements: 5.4, 5.5_

  - [x] 3.2 Write property test — Read_Proxy issues SELECT-only queries
    - **Property 11: Read proxy issues SELECT-only queries**
    - `// Feature: dashboard-ui, Property 11: ...`, min 100 iterations
    - **Validates: Requirements 3.4, 3.5**

  - [x] 3.3 Write property test — allowlist rejects invalid requests and bounds response size
    - **Property 12: Allowlist rejects invalid requests and bounds response size**
    - `// Feature: dashboard-ui, Property 12: ...`, min 100 iterations
    - **Validates: Requirements 5.4, 5.5**

  - [x] 3.4 Implement rate-limit and cache policy (pure policy + impure store)
    - Create `src/rateLimit.ts` (per-IP 5 req/s burst 10, global ceiling 50 req/s; pure
      admission decision over a sequence of timestamps + an impure counter store) and
      `src/cache.ts` (short-TTL policy: 120s default, 300s for `decision-dates`; cache key
      includes the full query string; honors `Cache-Control: no-cache` as explicit bypass)
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 3.5 Write property test — rate limiter never admits above the ceiling
    - **Property 13: Rate limiter never admits above the ceiling**
    - `// Feature: dashboard-ui, Property 13: ...`, min 100 iterations
    - **Validates: Requirements 5.1, 5.3**

- [x] 4. Read_Proxy — SELECT-only Supabase client, config, security headers, HTTP server (Req 3, 5)
  - [x] 4.1 Implement the SELECT-only `SupabaseReadClient` and read-credential config
    - Create `src/supabaseReadClient.ts` exposing exactly one method `select<T>(view,
      query)` (GET only; NO upsert/insert/update/delete method exists), following the
      `SupabaseRestClient` pattern (Node built-in `fetch`, read credential as
      `Authorization: Bearer`, publishable key as `apikey`); the credential never appears in
      a response or log. Create `src/config.ts` resolving the read credential from Secret
      Manager env (`SUPABASE_TARGET`, verbatim env reads; mirrors `src/storage/supabaseConfig.ts`),
      never the Scoped_Write_Credential or service-role key
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 5.9_

  - [x] 4.2 Write property test — credential values never appear in responses or logs
    - **Property 14: Credential values never appear in responses or logs**
    - `// Feature: dashboard-ui, Property 14: ...`, min 100 iterations
    - **Validates: Requirements 3.6, 3.7, 5.9, 14.2**

  - [x] 4.3 Implement security headers and the CSP policy
    - Create `src/security.ts` setting on every response `Content-Security-Policy:
      default-src 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
      `Strict-Transport-Security`, and per-endpoint `Cache-Control`
    - _Requirements: 5.6_

  - [x] 4.4 Write unit tests — CSP and security headers present on proxy responses
    - Assert each required header is present/valued on a representative response
    - _Requirements: 5.6_

  - [x] 4.5 Implement the HTTP server and hand-written router (Node 22 built-in `http`, NO framework)
    - Create `src/main.ts` (the only serving-side HTTP listener, using the Node 22 built-in
      `http` module) and `src/app.ts` (a thin hand-written router bound to `ENDPOINTS`).
      **Do NOT introduce Express/Fastify/Koa or any web framework.** Register only `GET`
      handlers; any other method returns `405`. On each GET: run rate-limit → cache lookup →
      `buildQuery` → `SupabaseReadClient.select` → apply `maxRows` cap → attach security
      headers; reject disallowed path/param with `400`/`404` before any DB round-trip; map
      Supabase failures to `502`/`503` with a credential-free message
    - _Requirements: 3.1, 3.4, 5.5, 5.6_

  - [x] 4.6 Write proxy structural/guard test — SELECT-only, GET-only, no framework
    - Assert `SupabaseReadClient` exposes no write method; the router registers only GET;
      `services/read-proxy/package.json` declares no web framework (Express/Fastify/Koa/…)
      and the server uses the built-in `http` module
    - _Requirements: 3.4, 3.5, 5.5_

  - [x] 4.7 Write local-Supabase integration tests (gated, 1–3 requests per endpoint)
    - Against a reachable LOCAL Supabase (mirroring `supabaseStores.integration.test.ts`
      gating): a valid read returns rows; a write attempt / disallowed query is rejected;
      RLS denies direct base-table access for `dashboard_reader`
    - _Requirements: 3.4, 4.1, 4.4, 5.5_

- [x] 5. Checkpoint — migration, core writer, proxy
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. `web/` SPA — scaffold, wire-format types, pure date selection (Req 1, 19, 6, 7)
  - [x] 6.1 Scaffold the standalone `web/` app and shared wire-format row types
    - Create `web/` with its own pinned `package.json` (React + Vite + TypeScript +
      Recharts + `vitest` + `fast-check` + dependency audit), NOT wired as a root workspace;
      `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`
      bootstrap. Declare read-only wire-format interfaces in `src/api/endpoints.ts`
      (`FiringSetupRow`, `AnalogueOutcomeRow`, `RealizedOutcomeRow`, `CandleRow`,
      `GateVerdictRow`, `GateFoldVerdictRow`, `SignalRationaleRow`,
      `ExternalReferenceComparisonRow`) matching the view columns — independent copies, no
      import from `src/`
    - _Requirements: 1.1, 1.2, 20.2_

  - [x] 6.2 Implement pure date-selection module
    - Create `web/src/pure/selectDates.ts`: `selectLatestDecisionDate(dates)` (max date, or
      null when empty, order/duplicate independent) and `selectBrowseDate(dates, requested)`
      (requested when present, else latest, else null — never a date absent from the set)
    - _Requirements: 6.1, 7.1, 19.3_

  - [x] 6.3 Write property test — latest Decision_Date is the maximum present
    - **Property 1: Latest Decision_Date is the maximum present**
    - `// Feature: dashboard-ui, Property 1: ...`, min 100 iterations
    - **Validates: Requirements 6.1, 19.3**

  - [x] 6.4 Write property test — historical browse selects a present date or a defined fallback
    - **Property 2: Historical browse selects a present date or a defined fallback**
    - `// Feature: dashboard-ui, Property 2: ...`, min 100 iterations
    - **Validates: Requirements 7.1**

- [x] 7. `web/` SPA — pure row/view-model and chart-series shapers (Req 9, 10, 12, 13, 8)
  - [x] 7.1 Implement `shapeDashboardView` + `format.ts`
    - Create `web/src/pure/shapeDashboard.ts` producing `SetupsViewModel` (`cards` one per
      surfaced row, `suppressions` one per suppressed row incl. `competing_pairs`,
      `isSilent` iff rows present and none surfaced, `hasRows` iff input non-empty) and
      `web/src/pure/format.ts` (pip / confidence / direction formatting; explicit
      not-actionable marker for null SL/TP). Firing-card fields drawn verbatim from the row
    - _Requirements: 6.2, 7.2, 7.4, 8.5, 8.7, 9.1, 9.2, 9.3, 9.4, 9.10, 13.1, 13.3, 19.4, 20.1_

  - [x] 7.2 Write property test — dashboard view model completeness, silent, and empty
    - **Property 3: Dashboard view model completeness, silent, and empty**
    - `// Feature: dashboard-ui, Property 3: ...`, min 100 iterations
    - **Validates: Requirements 6.2, 7.2, 7.4, 8.7, 13.1, 13.3, 19.4**

  - [x] 7.3 Write property test — suppression shaping preserves pair, reason, and competing pairs
    - **Property 4: Suppression shaping preserves pair, reason, and competing pairs**
    - `// Feature: dashboard-ui, Property 4: ...`, min 100 iterations
    - **Validates: Requirements 9.3, 9.4, 8.5**

  - [x] 7.4 Write property test — firing-card projection is verbatim with explicit null markers
    - **Property 5: Firing-card projection is verbatim with explicit null markers**
    - `// Feature: dashboard-ui, Property 5: ...`, min 100 iterations
    - **Validates: Requirements 9.1, 9.2, 9.10, 20.1**

  - [x] 7.5 Implement chart-series shapers (each yields an a11y table)
    - Create `web/src/pure/shapeCharts.ts`: `shapeConfidenceTrend` (one point per
      Decision_Date = `earned_confidence` verbatim, ascending), `shapeExcursionProfile`
      (`mfe_pips`/`mae_pips` verbatim), `shapePriceSeries` (OHLC verbatim, by date). Each
      series also returns an a11y table model (Req 18.4)
    - _Requirements: 9.5, 9.6, 9.9, 9.10, 10.4, 18.4, 20.1_

  - [x] 7.6 Write property test — confidence-trend projection
    - **Property 6: Confidence-trend projection**
    - `// Feature: dashboard-ui, Property 6: ...`, min 100 iterations
    - **Validates: Requirements 9.5, 9.10, 20.1**

  - [x] 7.7 Write property test — excursion-profile projection
    - **Property 7: Excursion-profile projection**
    - `// Feature: dashboard-ui, Property 7: ...`, min 100 iterations
    - **Validates: Requirements 9.6, 10.4, 20.1**

  - [x] 7.8 Write property test — price-series projection
    - **Property 8: Price-series projection**
    - `// Feature: dashboard-ui, Property 8: ...`, min 100 iterations
    - **Validates: Requirements 9.9, 9.10, 20.1**

  - [x] 7.9 Implement prediction-vs-actual, AI, and external shapers
    - Create `web/src/pure/shapePredictionActual.ts` (select the matured row with max
      Decision_Date; predicted + realized fields verbatim; pending marker when
      `matured=false`, never a fabricated outcome), `web/src/pure/shapeAi.ts`
      (rationale/labels/proposals, omit section when absent), and
      `web/src/pure/shapeExternal.ts` (own vs provider direction + comparison verbatim;
      explicit "reference unavailable" marker for `unavailable`)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 11.1, 11.4, 12.1, 12.3, 20.1_

  - [x] 7.10 Write property test — prediction-versus-actual selection and projection
    - **Property 9: Prediction-versus-actual selection and projection**
    - `// Feature: dashboard-ui, Property 9: ...`, min 100 iterations
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 20.1**

  - [x] 7.11 Write property test — external-comparison projection
    - **Property 10: External-comparison projection**
    - `// Feature: dashboard-ui, Property 10: ...`, min 100 iterations
    - **Validates: Requirements 12.1, 12.3**

  - [x] 7.12 Write `web/` purity structural test
    - Assert `web/src/pure/**` imports no `fetch`, DOM, Recharts, or `Date.now()` (clock is
      injected) — the purity invariant that makes the shapers property-testable
    - _Requirements: 19.1, 19.2_

- [x] 8. `web/` SPA — API client, selection store, dark theme, refresh cache-bust (Req 2, 3, 8, 15, 17)
  - [x] 8.1 Implement the impure API client and typed endpoint map
    - Create `web/src/api/client.ts` (impure `fetch` wrapper to `/api/*`, same-origin via the
      Firebase `/api` rewrite; surfaces `lastUpdated`; non-secret error messages only) and
      `web/src/api/endpoints.ts` typed endpoint map mirroring the proxy allowlist. Implement
      the cache-bust transform (`{ bustCache: true }` → append `_r=<nonce>` + send
      `Cache-Control: no-cache`)
    - _Requirements: 2.2, 3.1, 3.2, 3.7, 14.2, 17.2_

  - [x] 8.2 Write property test — refresh produces a distinct, cache-bypassing request
    - **Property 15: Refresh produces a distinct, cache-bypassing request**
    - `// Feature: dashboard-ui, Property 15: ...`, min 100 iterations
    - **Validates: Requirements 17.1, 17.2**

  - [x] 8.3 Implement the selection store (Pair + Decision_Date) with URL sync
    - Create `web/src/state/selection.ts`: single React-context store holding
      `Pair_Selector` (five `PAIRS` + "All pairs", default "All pairs") and the
      Decision_Date selection, synced to the URL query for deep-linking; the single source
      of truth so both survive tab switches
    - _Requirements: 8.1, 8.4, 8.6, 1.6, 16.4_

  - [x] 8.4 Implement the single dark theme
    - Create `web/src/theme/darkTheme.ts`: single dark theme tokens applied to all content
      and Recharts chart colors; no light theme, no toggle, no `prefers-color-scheme`
      defaulting
    - _Requirements: 15.1, 15.2, 15.3_

- [x] 9. `web/` SPA — tabs, selectors, charts, states, accessibility (Req 2, 8, 9, 11, 12, 13, 14, 16, 17, 18)
  - [x] 9.1 Implement the app shell: header selectors, bottom tab bar, refresh + last-updated
    - Create `web/src/App.tsx` + `components/`: persistent `Pair_Selector` (segmented on
      wide, dropdown on narrow) and Decision_Date selector above the tab content; mobile-
      native bottom tab bar with the five `Category_Tab`s; refresh control (wired to the
      cache-bust transform) and a visible "last updated" timestamp; client-side routing with
      SPA fallback. Mobile-first, no horizontal scroll of primary content
    - _Requirements: 1.3, 1.6, 2.2, 8.1, 8.6, 16.1, 16.4, 17.1, 17.3_

  - [x] 9.2 Implement the Setups tab (firing cards + suppressions, cross-pair when All pairs)
    - `tabs/Setups`: FiringCard list + Suppression list from `shapeDashboardView`; cross-pair
      when "All pairs", pair-filtered otherwise with suppressions staying cross-pair;
      currency-concentration suppression renders `competing_pairs`; "no setups fired"
      (silent) and "no data" states
    - _Requirements: 8.3, 8.5, 9.1, 9.2, 9.3, 9.4, 13.1, 13.2, 13.3_

  - [x] 9.3 Implement the Pattern & Outcomes tab (Recharts, dark-themed, with a11y tables)
    - `tabs/PatternOutcomes` with Accordion_Sections: Earned_Confidence trend, MFE/MAE
      excursion profile, prediction-vs-actual (most-recent matured; pending when
      `!matured`), price chart (OHLC) — all per-pair, drawn from the pure shapers, rendered
      with Recharts themed to the dark theme, each with its text/table equivalent
    - _Requirements: 8.2, 9.5, 9.6, 9.9, 10.1, 10.2, 10.3, 15.3, 16.3, 18.4_

  - [x] 9.4 Implement the Gate tab
    - `tabs/Gate`: model-vs-baseline `gate_verdicts` PASS/CUT visual (incl. `verdict`) and
      `gate_fold_verdicts` walk-forward folds incl. per-fold verdict and skipped status
    - _Requirements: 9.7, 9.8_

  - [x] 9.5 Implement the AI and Third-party tabs (inert, labeled rendering)
    - `tabs/Ai`: Signal_Rationale + pattern labels + Research_Proposal, clearly labeled
      AI-generated/advisory/non-scoring, section omitted when absent. `tabs/ThirdParty`: own
      Direction_Class vs provider reference + Reference_Comparison, labeled research-only,
      explicit "reference unavailable" marker. Both render LlmTagged / third-party text as
      React text children (auto-escaped) — never `dangerouslySetInnerHTML`
    - _Requirements: 8.2, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 5.8_

  - [x] 9.6 Implement loading, empty, and error states
    - Mobile-friendly loading state during any in-flight fetch (incl. refresh); "no runs
      persisted yet" (empty dates); "no data for this date" / "no data for this pair on this
      date"; non-secret error message on proxy/refresh failure (no stack trace / raw payload
      / blank screen)
    - _Requirements: 2.3, 7.4, 8.7, 14.1, 14.2, 14.3, 17.4, 17.5_

  - [x] 9.7 Write unit/example tests — gate render, folds, AI present/absent, loading
    - PASS vs CUT `gate_verdicts` render (9.7); skipped vs non-skipped fold (9.8); AI
      section renders when present and is omitted when absent with the advisory/non-scoring
      label (11.1–11.4); loading state renders during an in-flight fetch (2.3, 14.3)
    - _Requirements: 2.3, 9.7, 9.8, 11.1, 11.2, 11.3, 11.4, 14.3_

  - [x] 9.8 Write accessibility tests
    - Roles/labels for tabs, accordions, selectors, refresh; single top-level heading +
      labeled sections; Direction_Class and surfaced-vs-suppressed conveyed by text/shape
      not color alone; each chart has a text/table equivalent asserted present; tap-target
      sizing (vitest + Testing Library + axe-style assertions)
    - _Requirements: 16.5, 18.1, 18.2, 18.3, 18.4, 18.5_

- [x] 10. Firebase Hosting config (Req 1, 5, 21)
  - [x] 10.1 Author `web/firebase.json` and `.firebaserc`
    - `firebase.json`: `public: web/dist`; `rewrites` with `/api/**` → the
      `dashboard-read-proxy` Cloud Run service and a catch-all `**` → `/index.html` SPA
      fallback; strict CSP + security headers under `headers`
      (`default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'
      'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none';
      base-uri 'self'`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`);
      `.firebaserc` targets `trade-assistant-508806`. Document the Vite dev + `firebase
      deploy` flow
    - _Requirements: 1.4, 1.5, 1.6, 5.7, 21.4_

  - [x] 10.2 Write Firebase config unit test
    - Assert `firebase.json` sets the `/api/**` rewrite to the proxy service, the SPA
      catch-all fallback, and the strict CSP + security headers
    - _Requirements: 1.6, 5.7_

- [x] 11. Serving-layer guard reconciliation + parent-spec text update (Req 20.5, 20.6)
  - [x] 11.1 Extend `servingLayerGuard.test.ts`
    - Keep the core invariants (no serving framework/HTTP listener/`web` dir inside `src/`);
      add an assertion that no file under `src/` imports from `web/` or
      `services/read-proxy/` (serving layer is a downstream consumer, never a core
      dependency); repoint/augment the documentation reservation check to recognize `web/` +
      the proxy as the now-realized reserved read-only serving layer
    - _Requirements: 20.2, 20.5, 20.6_

  - [x] 11.2 Update the parent design 17.3/17.4 reservation text
    - In `.kiro/specs/fx-daily-pattern-assistant/design.md`, update the 17.3/17.4 reservation
      text (and the `RESERVED` node) to record that the reserved read-only serving layer is
      now realized as the two read-only deployables (`web/` + Read_Proxy), so the guard and
      the parent posture are no longer in contradiction
    - _Requirements: 20.6_

  - [x] 11.3 Verify the reconciled guard passes
    - Run `servingLayerGuard.test.ts` and confirm the extended assertions and the updated
      parent-text checks pass
    - _Requirements: 20.5, 20.6_

- [x] 12. Checkpoint — all local coding tasks
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. LIVE CLOUD: apply the companion migration to hosted Supabase (Req 21.5)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live
    Cloud Execution Protocol.
  - Reconcile the resolved target against `SUPABASE_TARGET=hosted` and the active `gcloud`
    project + account against `trade-assistant-508806` first; abort on mismatch (Req 21.1)
  - Show the exact apply command for approval; apply migration `20260916000003` (two
    display-only tables + `pipeline_writer` grants/RLS + `dashboard_reader` role + nine
    `security_invoker` views + default-deny grants) to hosted; idempotent on re-run
  - Confirm the nine views and the `dashboard_reader` grants exist afterward; record only
    non-secret references
  - _Requirements: 4.3, 4.7, 21.1, 21.5_

- [x] 14. LIVE CLOUD: provision the read credential in Secret Manager (Req 21.2, 5.9)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live
    Cloud Execution Protocol.
  - Reconcile project + account first; mint the `dashboard_reader` read credential (signed
    JWT, role claim = `dashboard_reader`) without echoing it or the JWT secret
  - Show the exact `gcloud secrets create` / `gcloud secrets versions add --data-file=-`
    command for approval; create the `supabase-read-key` secret (and reference the existing
    `SUPABASE_HOSTED_URL` / `SUPABASE_PUBLISHABLE_KEY`), piping the value on stdin — never
    echoed/logged/committed/argv; add a version if the secret already exists
  - Grant the Read_Proxy runtime service account `roles/secretmanager.secretAccessor` and
    read the IAM policy back to verify; record only non-secret references
  - _Requirements: 5.9, 21.1, 21.2_

- [x] 15. LIVE CLOUD: deploy the Read_Proxy as a Cloud Run service (Req 21.3)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live
    Cloud Execution Protocol, using the existing `deploy.yml` Cloud Run Job deploy as the
    template (keyless WIF, SHA-pinned image via Cloud Build → Artifact Registry, dedicated
    least-privilege runtime service account), but `gcloud run deploy` (service) not `jobs`.
  - Reconcile project + account first; confirm the task 14 secret + accessor grant exist
  - Show the exact `gcloud run deploy dashboard-read-proxy` command for approval:
    `--set-env-vars` for non-secret config (`SUPABASE_TARGET=hosted`, project/region);
    `--set-secrets` for `SUPABASE_HOSTED_URL`, `supabase-read-key` → read credential,
    `SUPABASE_PUBLISHABLE_KEY`; dashboard deploy pipeline kept separate from the
    write-credential pipeline (Req 5.10)
  - Record the service URL + outcome with no secret value
  - _Requirements: 5.10, 21.1, 21.3_

- [x] 16. LIVE CLOUD: firebase deploy (Hosting + /api rewrite + CSP) (Req 21.4)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live
    Cloud Execution Protocol.
  - Reconcile project + account against `trade-assistant-508806` first; confirm the task 15
    proxy service is deployed so the `/api` rewrite target resolves
  - Build `web/dist` (`npm run build`); show the exact `firebase deploy` command for
    approval; publish the static SPA with the `/api/**` rewrite to the proxy service, the
    SPA catch-all fallback, and the strict CSP + security headers
  - Record the public Hosting URL with no secret value
  - _Requirements: 1.5, 21.1, 21.4_

- [ ] 17. LIVE CLOUD: post-deploy read-only smoke verification (Req 21.6)
  - **This is a LIVE operator-approved operation — NOT a property test.** Follow the Live
    Cloud Execution Protocol.
  - Reconcile project + account first; perform a read-only smoke check that the public URL
    serves the latest Decision_Date; that the Read_Proxy rejects a write attempt (`405`) and
    a disallowed query (`400`/`404`); recording only non-secret references
  - _Requirements: 21.1, 21.6_

- [ ] 18. Final checkpoint — live deployment complete
  - Ensure all tests pass and the smoke verification succeeded; ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster path;
  core implementation and live-cloud tasks are never optional.
- **LIVE CLOUD EXECUTION tasks (13, 14, 15, 16, 17) are not property tests.** They perform
  real operations in `trade-assistant-508806` / hosted Supabase under the Live Cloud
  Execution Protocol: reconcile project/account → show the exact command for operator
  approval → source secret values from Secret Manager on stdin, never echoed/logged/
  committed/argv → confirm each op's effect afterward recording only non-secret references.
- **The Read_Proxy HTTP layer uses the Node 22 built-in `http` module + a hand-written
  router — no Express/Fastify/Koa or any web framework** (tasks 3, 4; enforced by the
  structural test 4.6).
- **The core-side display-only persistence is in scope** (tasks 1, 2): the two new tables
  in the companion migration, the `src/storage/supabase/displayDataPersister.ts` writer, and
  the `dailyRun`/`persistView` wiring — written by `pipeline_writer`, read-only for the
  dashboard, never a scoring input.
- `web/` and `services/read-proxy/` each carry their own pinned `package.json` + `vitest` +
  `fast-check`; the no-new-dependency rule is scoped to the core `src/`.
- Property coverage: all 15 design properties map to a tagged `fast-check` property test —
  proxy pure logic Properties 11 (3.2), 12 (3.3), 13 (3.5), 14 (4.2); client Property 15
  (8.2); `web/` pure shapers Properties 1 (6.3), 2 (6.4), 3 (7.2), 4 (7.3), 5 (7.4), 6
  (7.6), 7 (7.7), 8 (7.8), 9 (7.10), 10 (7.11).
- Requirement coverage spans all 21 requirements: migration/RLS (Req 4) task 1; display-only
  persistence (Req 20) tasks 2, 11; proxy (Req 3, 5) tasks 3–4; SPA (Req 1, 2, 6–18, 19)
  tasks 6–9; Hosting (Req 1, 5) task 10; guard reconciliation (Req 20.5/20.6) task 11; live
  deployment (Req 21) tasks 13–17.
- Dependency order: the companion migration (task 1) and the proxy allowlist/pure logic
  (task 3) have no cross-dependencies and can start first; the proxy server (task 4) builds
  on task 3; the `web/` pure shapers (tasks 6–7) are independent of the proxy; the SPA UI
  (tasks 8–9) consumes the pure shapers and the client; Hosting (task 10) and guard
  reconciliation (task 11) follow; all live tasks (13–17) run last, in strict order
  (migration → secret → proxy deploy → firebase deploy → smoke).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "6.1"] },
    { "id": 1, "tasks": ["1.2", "3.2", "3.3", "3.4", "6.2", "6.3", "6.4"] },
    { "id": 2, "tasks": ["1.3", "1.4", "3.5", "4.1", "4.3", "7.1", "7.5", "7.9"] },
    { "id": 3, "tasks": ["2.1", "4.2", "4.4", "4.5", "7.2", "7.3", "7.4", "7.6", "7.7", "7.8", "7.10", "7.11", "7.12"] },
    { "id": 4, "tasks": ["2.2", "4.6", "4.7", "8.1", "8.3", "8.4"] },
    { "id": 5, "tasks": ["2.3", "8.2", "9.1"] },
    { "id": 6, "tasks": ["9.2", "9.3", "9.4", "9.5", "9.6"] },
    { "id": 7, "tasks": ["9.7", "9.8", "10.1"] },
    { "id": 8, "tasks": ["10.2", "11.1", "11.2"] },
    { "id": 9, "tasks": ["11.3"] },
    { "id": 10, "tasks": ["13"] },
    { "id": 11, "tasks": ["14"] },
    { "id": 12, "tasks": ["15"] },
    { "id": 13, "tasks": ["16"] },
    { "id": 14, "tasks": ["17"] }
  ]
}
```

## Addendum tasks — Cross-pair "All pairs" rendering for the per-pair tabs (Req 8 criterion 8)

- [ ] 19. Cross-pair "All pairs" rendering for the per-pair tabs (Req 8 criterion 8 / design addendum)
  - **`web/`-only, read-only, recompute-nothing.** On `ALL_PAIRS` the AI, Third-party, and
    Pattern/Outcomes tabs render a labeled per-pair section for all five pairs (canonical
    `PAIRS` order: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD) **instead of** `PickPairPrompt`;
    specific-pair selection is unchanged (Req 8.2); Setups and Gate are untouched. Every
    section is drawn VERBATIM from the single `getSnapshot()` read (one read, filtered by
    `decision_date` only), with per-pair no-data markers and the advisory / research-only /
    inert labels preserved per section. No change to the `dashboard.json` schema, the daily
    Job, or any `src/` core module. All subtasks are test-driven with injected loaders (NO
    live network) and leave `make check` + the `web` build/tests green.

  - [ ] 19.1 Implement the pure cross-pair grouping helper `web/src/pure/shapeAllPairs.ts`
    - Per design D1: `shapeAllPairs(rows, decisionDate, shaper, pairOf, dateOf, pairs = PAIRS)`
      groups already-fetched rows by pair in canonical `PAIRS` order and delegates each pair's
      `decision_date`- and pair-filtered slice to the caller's EXISTING per-pair shaper
      (`shapeAi` / `shapeExternal` / the Pattern/Outcomes shapers), returning one
      `PairSection<VM>` per pair
    - Copies/filters only — recomputes nothing, invents no new projection math; pure (no
      `fetch`, no DOM, no clock; imports nothing from `src/`), so it stays within the
      `web/src/pure/**` purity invariant
    - _Requirements: 8.8, 20.1_

  - [ ]* 19.2 Write property test `web/src/pure/shapeAllPairs.property.test.ts`
    - **Property 16: Cross-pair "All pairs" view is the per-pair shapers, grouped in canonical order, verbatim**
    - `// Feature: dashboard-ui, Property 16: Cross-pair "All pairs" view is the per-pair shapers, grouped in canonical order, verbatim`, `fast-check`, min 100 iterations
    - Generate arbitrary snapshot slices (pairs present/absent, duplicate dates, empty sets, a
      pair with no row for the date) and assert: exactly one section per pair in `PAIRS` order;
      each section equals the existing per-pair shaper applied over the pair-and-date-filtered
      rows (verbatim, no recomputation); a pair with no row yields the shaper's absent/empty
      result
    - **Validates: Requirements 8.8, 20.1**

  - [ ] 19.3 Third-party tab cross-pair render (`web/src/tabs/ThirdParty/ThirdPartyTab.tsx`)
    - Replace the `pair === ALL_PAIRS` `PickPairPrompt` branch with the cross-pair render: an
      all-pairs loader path (per design D2 — filter `externalComparison` by `decision_date`
      only, one `getSnapshot()` read, no per-pair fetch), map `PAIRS` → existing `shapeExternal`
      per pair (via `shapeAllPairs`) → a labeled per-pair section (per-pair `aria-label`, theme
      tokens, mobile-first vertical stack)
    - Reuse the existing per-pair "no comparison" / "reference unavailable" markers (D3) and
      render the research-only / never-a-decision-input banner for each section (D4). The
      `loading`, `error`, and specific-pair branches are preserved verbatim (Req 8.2 unchanged)
    - _Requirements: 8.8, 12.2, 12.3, 5.8, 20.1_

  - [ ] 19.4 AI tab cross-pair render (`web/src/tabs/Ai/AiTab.tsx`)
    - Same change as 19.3 using `shapeAi` (via `shapeAllPairs`): all-pairs loader filters
      `aiRationale` by `decision_date` only (one `getSnapshot()` read), map `PAIRS` → per-pair
      labeled sections (per-pair `aria-label`, theme tokens, mobile-first vertical stack)
    - Reuse the existing omit-when-absent "No AI rationale was persisted for {pair} on this
      date." per-pair marker (D3), and render the advisory / non-scoring banner plus per-proposal
      advisory labels for each section (D4). `loading` / `error` / specific-pair branches
      unchanged (Req 8.2)
    - _Requirements: 8.8, 11.2, 11.3, 11.4, 5.8, 20.1_

  - [ ] 19.5 Pattern/Outcomes tab cross-pair render (`web/src/tabs/PatternOutcomes/PatternOutcomesTab.tsx`)
    - Same change as 19.3 using the tab's existing shapers (`shapePredictionActual`,
      `shapeConfidenceTrend`, `shapeExcursionProfile`, `shapePriceSeries`): all-pairs loader
      filters the Pattern/Outcomes inputs (`analogueOutcomes`, `realizedOutcomes`, `candles`,
      `firingSetups`) by the date clause only (one `getSnapshot()` read), map `PAIRS` → per-pair
      labeled sections (per-pair `aria-label`, theme tokens, mobile-first vertical stack), each
      drawn verbatim
    - Reuse the existing per-pair "No data for {pair}…" marker (D3) for a pair whose shapers all
      yield empty. All five pairs MUST be represented with their data verbatim; note the
      chart-density / render-cost consideration of five pairs' charts — a compact per-pair
      summary is acceptable if full charts per pair are too heavy (exact compactness left to
      implementation). `loading` / `error` / specific-pair branches unchanged (Req 8.2)
    - _Requirements: 8.8, 20.1_

  - [ ]* 19.6 Write DOM example tests for the three tabs (injected loader, NO network)
    - For AI, Third-party, and Pattern/Outcomes, reusing each tab's existing injected-loader
      test pattern: on `ALL_PAIRS`, assert all five pairs' labeled sections render — including an
      explicit per-pair no-data / unavailable marker for a pair with no row — INSTEAD of the
      pick-a-pair prompt
    - Assert selecting a specific pair still narrows the tab to that one pair (Req 8.2); assert
      the per-section advisory / research-only labels remain present in the cross-pair view
    - _Requirements: 8.8, 8.2, 11.2, 12.2_

  - [ ] 19.7 Verify and ship
    - Run `make check` + the `web` build/tests and confirm green
    - Ship via a dev→main PR (the Deploy workflow rebuilds and republishes the static SPA). The
      live-deploy portion is an **operator-gated** step — open/merge the PR under operator
      approval; this subtask performs no cloud commands directly
    - _Requirements: 8.8_
