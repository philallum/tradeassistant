# Requirements Document

## Introduction

The Dashboard_UI is a mobile-first, visually rich web dashboard that displays the FX
pattern assistant's persisted results — firing cards, suppressions, confidence trends,
outcome/excursion profiles, model-vs-baseline gate verdicts, walk-forward fold visuals,
price charts, prediction-versus-actual comparisons, and the display-only AI/LLM and
external-provider reference data — using charts, diagrams, and infographics. It shows the
latest Decision_Date as the default landing view and supports browsing historical
Decision_Dates. It is a strictly read-only consumer of persisted storage: a new serving
layer that reads only, never writes, and never recomputes any pipeline, scoring, gate, or
guard logic.

This spec is a deliberate pivot from the earlier "local plain-HTTP, latest-date-only"
dashboard. The direction below replaces that entirely.

### Locked decisions (constraints)

- **Separate deployable frontend app.** The Dashboard_UI is a React + Vite + TypeScript
  single-page app that lives in its OWN FULLY STANDALONE directory `web/`, with its own
  `package.json`, build, and test toolchain. It is NOT wired as a workspace in the root
  `package.json`, and it is NOT mixed into the deterministic core under `src/`.
- **No-new-dependency principle is scoped to the core.** The parent "no new runtime
  dependency" rule (parent Requirement 18) governs the deterministic core (`src/`) and
  does NOT constrain this separate frontend app. React, Vite, and Recharts are permitted
  inside the `web/` app only. This is stated explicitly so the frontend reconciles with
  parent Requirement 18 and with the Serving_Layer_Guard, which must continue to forbid
  serving/web dependencies inside the core tree.
- **Charting library.** Recharts is the charting library for v1 (declarative React
  charts, mobile-friendly).
- **Deployment target.** Firebase Hosting serving a static SPA, with an `/api` rewrite to
  the Read_Proxy Cloud Run service. Mobile-first responsive design is a first-class
  requirement, not an afterthought.
- **Firebase project.** The Firebase project is "Trade Assistant", project ID
  `trade-assistant-508806`, project number `794110228539` — the SAME GCP project the
  Cloud Run Job and the Read_Proxy Cloud Run service use. Firebase provides Hosting (and
  the `/api` rewrite) ONLY; there is no Firebase Auth.
- **Public, read-only access.** The dashboard data is NON-SENSITIVE and the app is a
  PUBLIC read-only site on the open internet with NO login. There is no authentication and
  no sign-in. The security posture optimizes for PLATFORM INTEGRITY (resisting abuse,
  injection, and use as an open data firehose), not data confidentiality. Public access is
  an accepted, deliberate decision.
- **Data access via a server-side read-only Cloud Run proxy (no browser DB credential).**
  The Dashboard_UI reads persisted data ONLY through the Read_Proxy: a Cloud Run service in
  the same GCP project (`trade-assistant-508806`) that holds the Supabase read credential
  server-side in Secret Manager and is the ONLY component that talks to Supabase. The
  browser (public, no auth) loads the static SPA from Firebase_Hosting (served with a
  strict CSP), and the SPA calls the Read_Proxy over HTTPS through the Firebase Hosting
  `/api` rewrite. NO database or Supabase credential of any kind is EVER shipped to the
  browser, embedded in the HTML, or returned in responses. The proxy reads only from
  curated read-only Postgres VIEWS (Read_Only_View) protected by default-deny RLS, issues
  only SELECT reads, and MUST NEVER use the Scoped_Write_Credential or the service-role
  key, and MUST NEVER issue any write. The views + grants + default-deny RLS are a REQUIRED
  companion migration applied to hosted Supabase.
- **Dark-only theme.** The Dashboard_UI presents a single dark theme. There is no
  light/dark toggle and no `prefers-color-scheme` defaulting; Recharts and all UI theme to
  the single dark theme.

### Real-schema grounding

Requirements below are grounded in the ACTUAL schema across the migrations
(`supabase/migrations/20260916000000_initial_schema.sql`,
`supabase/migrations/20260916000001_strategy_attribution_realized_outcomes.sql`, and
`supabase/migrations/20260916000002_rls_pipeline_writer_scoped_write.sql`). The dashboard
reads the HOSTED data in production. Key base tables projected to the dashboard:
`firing_setups`, `analogue_outcomes`, `realized_outcomes`, `gate_verdicts`,
`gate_fold_verdicts`, and `candles`. Supporting tables (`yields`, `calendar_events`,
`news_risk_flags`, `pattern_vectors`) are noted as possible future visuals, not required
for v1.

The follow-up migration (`20260916000001`) is the authoritative schema for `firing_setups`
and is reflected throughout:

- `firing_setups.strategy_id` exists (text, default `'system'`).
- The `firing_setups` primary key is the composite `(decision_date, pair, strategy_id)`.
- `firing_setups.suppression_reason` allows `('news','currency_concentration',
  'below_floor','not_fired','too_choppy')` — `too_choppy` IS a valid, persisted
  suppression reason.
- `realized_outcomes` exists as the predicted-versus-actual journal keyed by
  `(strategy_id, pair, decision_date)` carrying `predicted_direction`,
  `earned_confidence`, `stop_loss_pips`, `take_profit_pips`, `realized_direction`,
  `realized_mfe_pips`, `realized_mae_pips`, and the `matured` flag.

The third migration (`20260916000002`) is the authoritative grounding for the
read/write-credential separation: it enables RLS on the five compute-written tables
(`candles`, `pattern_vectors`, `analogue_outcomes`, `firing_setups`, `realized_outcomes`)
and defines the least-privilege `pipeline_writer` role (SELECT/INSERT/UPDATE, no DELETE)
reached by the pipeline's Scoped_Write_Credential. The dashboard's Read_Proxy read role is
a SEPARATE, read-only (SELECT-only) role scoped to the dashboard views, defined by the new
companion migration described in Requirement 3.

### Display-only persistence introduced in v1 (AI/Deterministic boundary)

v1 adds DISPLAY-ONLY persistence on the pipeline/storage side so the dashboard can show
advisory, AI-generated and third-party reference material that is NOT currently stored in
any dashboard-readable table:

- The LlmTagged signal rationale and pattern-description labels produced by the
  `signal_rationale` / `pattern_description` roles (`src/rationale`), and optionally the
  research-assistant proposals (`src/research-assistant`).
- The external-provider ExternalReferenceSignal and ReferenceComparison produced by
  `src/external-signal` (`compareToOwn` / `logComparison`).

This persisted data is strictly display/advisory. It preserves its LlmTagged / display-
only provenance, is WRITTEN by the pipeline, and is READ-ONLY for the dashboard. It MUST
NEVER feed back into the directional probability, Earned_Confidence, Direction_Class,
retrieval, or the Kill_Gate verdict (parent Requirements 2.6, 15.4, 23.2/23.3). See
Requirement 16.

### Serving-layer reconciliation

Introducing a serving layer intentionally changes the posture recorded in the parent
design (fx-daily-pattern-assistant Requirement 17.3/17.4, "serving layer is out of v1")
and enforced by the Serving_Layer_Guard (`src/architecture/servingLayerGuard.test.ts`).
Because the Dashboard_UI (`web/`) and the Read_Proxy are SEPARATE deployables outside
`src/`, the guard's core invariants (no serving framework or HTTP listener inside the
compute/storage tree) can stay intact; the reconciliation is about recognizing the new
app and proxy as the reserved read-only serving layer rather than silently breaking the
guard. See Requirement 10 and Requirement 16.

## Glossary

Reused terms:

- **DashboardView**: The existing per-Decision_Date pipeline output
  (`src/dashboard/types.ts`) carrying `cards` (firing cards) and `suppressed`
  (suppressions). The Dashboard_UI reconstructs the equivalent view from persisted rows;
  it does not re-run `dailyRun`.
- **FiringCard**: An existing rendered firing setup (`src/dashboard/types.ts`): pair,
  Direction_Class, Horizon, Earned_Confidence, excursion profile, and the nullable
  empirical Stop_Loss / Take_Profit pips.
- **Decision_Date**: The trading date a run evaluates, stored as `decision_date` on each
  `firing_setups` row. The Latest_Decision_Date is the maximum `decision_date` present.
- **Strategy_Source**: The strategy that produced a `firing_setups` or `realized_outcomes`
  row, stored as `strategy_id` (default `'system'` for the v1 deterministic system). It
  is part of the `firing_setups` composite primary key.
- **Suppression_Reason**: The enumerated reason a non-surfaced pair stayed silent,
  matching `firing_setups.suppression_reason`: one of `news`, `currency_concentration`,
  `below_floor`, `not_fired`, or `too_choppy`.
- **Realized_Outcome**: A `realized_outcomes` row pairing what a Strategy_Source predicted
  for a fired setup (`predicted_direction`, `earned_confidence`, `stop_loss_pips`,
  `take_profit_pips`) with the actual forward outcome (`realized_direction`,
  `realized_mfe_pips`, `realized_mae_pips`), guarded by the `matured` flag.
- **Scoped_Write_Credential**: The signed JWT whose `role` claim selects the
  Pipeline_Writer_Role (`pipeline_writer`); the pipeline's hosted WRITE-ONLY credential
  (SELECT/INSERT/UPDATE, no DELETE) used only by the Cloud Run Job. It is separate from
  the dashboard read credential. Neither the Dashboard_UI nor the Read_Proxy MAY use it.
- **SUPABASE_TARGET**: The environment variable selecting `local` or `hosted`, resolved by
  `loadSupabaseConfig` (`src/storage/supabaseConfig.ts`). The dashboard reads HOSTED in
  production.
- **Silent_By_Default**: The existing behavior where a Decision_Date with no surfaced
  firing cards is a valid, expected outcome rather than an error or an unexplained blank
  screen.
- **Serving_Layer_Guard**: The structural test `servingLayerGuard.test.ts` enforcing the
  parent serving-layer invariants.
- **LlmTagged**: The provenance brand (`src/llm/types.ts`) carried by every LLM-derived
  value. It marks a value as display/advisory only and keeps it structurally off every
  scoring / verdict path (parent Requirement 2.6).
- **Signal_Rationale**: The outward-only, LlmTagged plain-language rationale and the
  qualitative analogue pattern-description labels produced by the `signal_rationale` /
  `pattern_description` roles (`src/rationale`). Display-only; never a scoring input
  (parent Requirements 15.2, 15.4).
- **Research_Proposal**: An advisory, LlmTagged research-assistant proposal
  (`src/research-assistant`) that changes nothing without a recorded human approval.
  Display-only for the dashboard.
- **External_Reference_Signal**: A third-party provider's display/research-only
  recommended direction and optional score for a pair (`src/external-signal`), fetched
  fail-safe and never fed into any scoring or decision path (parent Requirement 23).
- **Reference_Comparison**: The display-only agreement/divergence classification of the
  system's own direction versus the External_Reference_Signal (`compareToOwn`), one of
  `agree`, `diverge`, `neutral`, or `unavailable`.

New terms:

- **Dashboard_UI**: The mobile-first React + Vite + TypeScript SPA defined by this spec,
  deployed on Firebase_Hosting as a separate, fully standalone `web/` app. It holds NO
  database credential and reads data only through the Read_Proxy.
- **Firebase_Hosting**: The static SPA hosting target for the Dashboard_UI, deployed via
  `firebase deploy` to the "Trade Assistant" project (`trade-assistant-508806`). It also
  provides the `/api` rewrite that forwards dashboard read requests to the Read_Proxy.
  Hosting only — it provides no authentication.
- **Read_Proxy**: The read-only Cloud Run SERVICE in the GCP project
  `trade-assistant-508806` that holds the Supabase read credential server-side (Secret
  Manager), exposes a fixed allowlist of READ-ONLY endpoints, is the ONLY component that
  talks to Supabase, and issues only SELECT reads against the Read_Only_View set. It never
  writes and never uses the Scoped_Write_Credential or the service-role key.
- **Read_Only_View**: A curated read-only Postgres view that projects exactly the columns
  the dashboard needs from a base table. The Read_Proxy reads only from the Read_Only_View
  set, never from base tables directly.
- **Default_Deny_RLS**: The security posture in which Row-Level Security is enabled on all
  involved relations and the Read_Proxy's read role may SELECT only the designated
  Read_Only_View set (no INSERT/UPDATE/DELETE), so that any newly added table or column is
  invisible to the dashboard until deliberately exposed through a view and grant.
- **Historical_Browse**: The capability to select and navigate prior Decision_Dates and
  view that date's persisted data.
- **Pair_Selector**: The persistent control for choosing the active currency pair among
  the five supported FX pairs — EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD (the `PAIRS` set in
  `src/ingestion/types.ts`) — plus an "All pairs" option. It is a first-class, persistent
  filter dimension alongside Decision_Date. The exact control (dropdown, segmented
  control, placement, interaction with the bottom tab bar) is a design detail.
- **Dark_Theme**: The single dark presentation mode applied to all Dashboard_UI content
  and Recharts charts. There is no light mode and no theme toggle.
- **Category_Tab**: A top-level information-architecture category presented as a tab
  (a mobile-native bottom tab bar is acceptable) under which the Dashboard_UI groups
  related content.
- **Accordion_Section**: An expandable/collapsible section used WITHIN a Category_Tab to
  disclose secondary detail without forcing a single long scrolling page.

## Requirements

### Requirement 1: Mobile-first Firebase-hosted standalone SPA

**User Story:** As a viewer, I want a mobile-first dashboard served from Firebase Hosting,
so that I can review the assistant's results from my phone or desktop.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL be implemented as a React, Vite, and TypeScript single-page
   application in the standalone `web/` directory with its own `package.json`, distinct
   from the deterministic core under `src/`.
2. THE Dashboard_UI `package.json` SHALL NOT be wired as a workspace in the root
   `package.json`; the `web/` app SHALL be fully standalone with its own build and test
   toolchain.
3. THE Dashboard_UI SHALL use a mobile-first responsive layout that renders its content
   legibly on a narrow mobile viewport without horizontal scrolling of primary content.
4. THE Dashboard_UI SHALL document a local development flow using the Vite dev server and
   a production build-and-deploy flow using `firebase deploy` to Firebase_Hosting.
5. WHEN the Dashboard_UI is built for production, THE Dashboard_UI SHALL produce a static
   SPA bundle deployable to Firebase_Hosting.
6. THE Dashboard_UI SHALL serve a client-side routed SPA such that a direct load of a
   dashboard route resolves to the application rather than a hosting 404.

### Requirement 2: Public read-only access

**User Story:** As a viewer, I want to open the dashboard without logging in, so that I
can see the assistant's non-sensitive results immediately on any device.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL be publicly accessible without any authentication and SHALL NOT
   present a login screen, sign-in control, or sign-out control.
2. WHEN a viewer opens the dashboard, THE Dashboard_UI SHALL load and display the
   persisted dashboard data without requiring any credential or session.
3. WHILE dashboard data is being fetched through the Read_Proxy, THE Dashboard_UI SHALL
   display a loading state rather than a blank screen.

### Requirement 3: Read-only Cloud Run proxy and credential boundary

**User Story:** As a system owner, I want all database reads to go through a server-side
read-only proxy that holds the only read credential, so that the public browser never
holds a database credential and viewing results can never mutate data.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL read persisted data only by calling the Read_Proxy over HTTPS
   through the Firebase_Hosting `/api` rewrite, and SHALL NOT connect to Supabase or any
   database directly.
2. THE Dashboard_UI SHALL hold no database or Supabase credential of any kind, and no such
   credential SHALL appear in the client bundle, served HTML, or client-side logs.
3. THE Read_Proxy SHALL be a Cloud Run service in the GCP project `trade-assistant-508806`
   that holds the Supabase read credential server-side in Secret Manager and SHALL be the
   only component that connects to Supabase.
4. THE Read_Proxy SHALL issue only SELECT reads and SHALL NOT issue any insert, update, or
   delete request to any Supabase relation.
5. THE Read_Proxy SHALL NOT use the Scoped_Write_Credential or the service-role key.
6. IF a Read_Proxy response or log would otherwise contain a Supabase or database
   credential value, THEN THE Read_Proxy SHALL exclude that credential value from the
   response and the log.
7. IF a read request to the Read_Proxy fails, THEN THE Dashboard_UI SHALL surface a
   message that excludes every credential value.

### Requirement 4: Read-only projection views and default-deny RLS

**User Story:** As a system owner, I want the proxy to read only curated views under
default-deny RLS, so that the dashboard sees exactly the columns it needs and new tables
or columns stay invisible until deliberately exposed.

#### Acceptance Criteria

1. THE Read_Proxy SHALL read persisted data only from the Read_Only_View set and SHALL
   NOT read from base tables directly.
2. THE Read_Only_View set SHALL project exactly the columns the dashboard needs from its
   source base tables and SHALL NOT expose columns the dashboard does not render.
3. THE companion migration SHALL enable Row-Level Security on every relation involved in
   the dashboard read path (Default_Deny_RLS).
4. THE Read_Proxy's read role SHALL be granted SELECT only on the designated
   Read_Only_View set and SHALL be granted no INSERT, UPDATE, or DELETE on any relation.
5. WHERE a new base table or column is added without a corresponding view exposure and
   grant, THE Dashboard_UI SHALL be unable to read that table or column.
6. THE Read_Proxy's read role and read credential SHALL be separate from the pipeline's
   Scoped_Write_Credential and the `pipeline_writer` write-only role, which remain
   write-scoped and unchanged.
7. THE Read_Only_View set, grants, and Default_Deny_RLS policies SHALL be delivered as a
   companion migration applied to the hosted Supabase project.

### Requirement 5: Public-API hardening for the Read_Proxy and SPA

**User Story:** As a system owner, I want the public read API hardened against abuse and
injection, so that the open endpoint cannot be used as an unbounded data firehose or an
XSS vector.

#### Acceptance Criteria

1. THE Read_Proxy SHALL enforce aggressive rate limiting on incoming read requests,
   because the app has a single known user and the underlying data changes at most once
   per daily run (exact thresholds are a design detail).
2. THE Read_Proxy SHALL cache read responses with a short time-to-live, on the order of
   minutes, so that repeat loads are absorbed by the cache rather than re-querying
   Supabase (exact TTL is a design detail).
3. THE Read_Proxy SHALL enforce a global request ceiling that acts as a backstop against
   abuse (exact threshold is a design detail).
4. THE Read_Proxy SHALL cap pagination and response size for every endpoint to a bounded
   maximum.
5. THE Read_Proxy SHALL accept only a fixed allowlist of read query shapes and endpoints
   and SHALL reject any arbitrary or ad-hoc query.
6. THE Read_Proxy SHALL set a strict Content-Security-Policy and the standard security
   response headers on its responses.
7. THE Dashboard_UI SHALL be served from Firebase_Hosting with a strict
   Content-Security-Policy.
8. WHEN the Dashboard_UI renders LlmTagged AI text or third-party External_Reference_Signal
   text, THE Dashboard_UI SHALL output-encode or sanitize that text so it is rendered as
   inert content rather than executable markup.
9. THE Read_Proxy's read credential SHALL reside in Secret Manager, following the pattern
   the existing Cloud Run Job uses, and SHALL NOT be present in the frontend build; every
   frontend build-time environment value SHALL be treated as public.
10. THE `web/` app SHALL pin its dependencies and SHALL run a dependency audit in its
    toolchain, and the dashboard deploy pipeline SHALL remain separate from any pipeline
    holding a write credential.

### Requirement 6: Latest Decision_Date landing view

**User Story:** As a viewer, I want to land on the most recent decision date, so that I
always see the current day's results without choosing a date.

#### Acceptance Criteria

1. WHEN a viewer opens the dashboard without selecting a date, THE Dashboard_UI SHALL
   display the Latest_Decision_Date, which is the maximum `decision_date` present in
   `firing_setups`.
2. WHEN displaying the Latest_Decision_Date, THE Dashboard_UI SHALL render that date's
   firing cards and suppressions.
3. THE Dashboard_UI SHALL display the resolved Latest_Decision_Date value on the landing
   view.

### Requirement 7: Historical Decision_Date browsing

**User Story:** As a viewer, I want to browse prior decision dates, so that I can review
past results and trends.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL provide a Historical_Browse control for selecting a
   Decision_Date among the dates present in `firing_setups`.
2. WHEN a viewer selects a prior Decision_Date, THE Dashboard_UI SHALL render that date's
   firing cards and suppressions.
3. WHEN a viewer navigates between Decision_Dates, THE Dashboard_UI SHALL display the
   currently selected Decision_Date value.
4. IF a selected Decision_Date has no persisted rows, THEN THE Dashboard_UI SHALL display
   a non-secret message stating that no data exists for that date.

### Requirement 8: Currency-pair selection and scope

**User Story:** As a viewer, I want to choose which currency pair I am looking at, so that
I can focus on one pair's detail while still seeing the cross-pair daily picture.

Note: The exact Pair_Selector control and the precise set of which views are per-pair
versus cross-pair are refined in design (confirmable). The hybrid model — per-pair detail
views plus a cross-pair Setups overview — is required. The system has exactly five FX
pairs (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD per the `PAIRS` set in
`src/ingestion/types.ts`); no other pairs exist.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL provide a persistent Pair_Selector for choosing the active
   currency pair among the five supported pairs (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD),
   plus an "All pairs" option.
2. WHEN a specific pair is selected, THE Dashboard_UI SHALL scope the per-pair detail
   views to that pair: the price chart, the prediction-versus-actual comparison, that
   pair's firing card detail, that pair's Signal_Rationale, pattern-description, and
   Research_Proposal (AI) content, and that pair's External_Reference_Signal
   Reference_Comparison (Third-party) content.
3. WHEN the "All pairs" option is selected, THE Dashboard_UI SHALL present the cross-pair
   overview for the Setups category — the firing cards and suppressions across all five
   pairs for the selected Decision_Date — so the at-a-glance daily picture of which pairs
   fired and which were suppressed is not hidden.
4. WHERE no pair selection has been made for the daily summary, THE Dashboard_UI SHALL
   default the Pair_Selector to the "All pairs" cross-pair Setups overview.
5. THE Dashboard_UI SHALL render the currency-concentration suppression as cross-pair,
   displaying the competing same-currency pairs recorded in `competing_pairs`, regardless
   of a single-pair selection, so that competing-pair relationship remains visible.
6. WHEN a viewer changes the active pair, THE Dashboard_UI SHALL persist that Pair_Selector
   selection across Category_Tab navigation, in the same manner the Decision_Date selection
   persists, so the viewer remains on the same pair and Decision_Date while moving between
   tabs.
7. WHERE the selected pair has no data for the selected Decision_Date, THE Dashboard_UI
   SHALL display a non-secret "no data for this pair on this date" message rather than a
   blank view.

### Requirement 9: Visual rendering of firing cards, suppressions, and charts

**User Story:** As a viewer, I want firing cards and infographics, so that I can
understand confidence, outcomes, and gate verdicts at a glance.

#### Acceptance Criteria

1. WHEN rendering a surfaced `firing_setups` row, THE Dashboard_UI SHALL display the
   pair, Direction_Class, Horizon, Earned_Confidence, and the Stop_Loss and Take_Profit
   pip values from that row.
2. IF a surfaced row's `stop_loss_pips` or `take_profit_pips` is null, THEN THE
   Dashboard_UI SHALL render that boundary as an explicit not-actionable marker rather
   than a fabricated number.
3. WHEN rendering a suppression whose reason is `currency_concentration`, THE
   Dashboard_UI SHALL display the suppressed pair, the reason, and the competing
   same-currency pairs recorded in `competing_pairs`.
4. WHEN rendering a suppression whose reason is `news`, `below_floor`, `not_fired`, or
   `too_choppy`, THE Dashboard_UI SHALL display the suppressed pair and that reason.
5. THE Dashboard_UI SHALL render an Earned_Confidence trend chart over Decision_Dates
   from persisted `firing_setups` rows.
6. THE Dashboard_UI SHALL render an outcome/excursion profile visualization of favorable
   (`mfe_pips`) and adverse (`mae_pips`) movement from `analogue_outcomes`.
7. THE Dashboard_UI SHALL render a model-versus-baseline gate verdict visualization from
   `gate_verdicts`, including the gate pass/cut `verdict`.
8. THE Dashboard_UI SHALL render a walk-forward fold visualization from
   `gate_fold_verdicts`, including each fold's per-fold `verdict` and skipped status.
9. THE Dashboard_UI SHALL render a price chart from `candles` OHLC rows for a selected
   pair.
10. THE Dashboard_UI SHALL render every charted value from persisted rows and SHALL NOT
    recompute it from any other field.

### Requirement 10: Prediction-versus-actual rendering

**User Story:** As a viewer, I want to see what the system predicted next to what actually
happened, so that I can judge how the pattern predictions held up.

#### Acceptance Criteria

1. WHEN rendering a pair with a persisted `realized_outcomes` row, THE Dashboard_UI SHALL
   display the predicted outcome (`predicted_direction`, `earned_confidence`, and the
   `stop_loss_pips` / `take_profit_pips` boundaries) alongside the actual realized outcome
   (`realized_direction`, `realized_mfe_pips`, `realized_mae_pips`).
2. WHILE a `realized_outcomes` row has `matured` false, THE Dashboard_UI SHALL render its
   actual outcome as a pending marker and SHALL NOT fabricate a realized direction or
   excursion value.
3. WHEN a pair has multiple matured `realized_outcomes` rows, THE Dashboard_UI SHALL
   display the most recent matured outcome for the prediction-versus-actual comparison.
4. THE Dashboard_UI SHALL draw prediction-versus-actual data from `realized_outcomes` and
   excursion profiles from `analogue_outcomes`, and SHALL NOT recompute either from any
   other field.

### Requirement 11: Display-only AI rationale and pattern-description rendering

**User Story:** As a viewer, I want to read the assistant's AI-generated rationale, so
that I understand the narrative behind a setup while knowing it is advisory.

#### Acceptance Criteria

1. WHEN persisted Signal_Rationale text exists for a surfaced pair and Decision_Date, THE
   Dashboard_UI SHALL display that rationale and the qualitative pattern-description
   labels for the pair.
2. WHEN rendering Signal_Rationale text or pattern-description labels, THE Dashboard_UI
   SHALL label them clearly as AI-generated, advisory, and non-scoring.
3. WHERE persisted Research_Proposal content is available, THE Dashboard_UI SHALL display
   each proposal clearly labeled as an advisory, AI-generated proposal.
4. IF no Signal_Rationale, pattern-description, or Research_Proposal content is persisted
   for a pair and Decision_Date, THEN THE Dashboard_UI SHALL omit the AI section for that
   pair rather than fabricate advisory text.

### Requirement 12: Display-only external-provider comparison rendering

**User Story:** As a viewer, I want to compare the system's direction with a third-party
provider, so that I can see agreement or divergence as research context.

#### Acceptance Criteria

1. WHEN persisted External_Reference_Signal data exists for a pair and Decision_Date, THE
   Dashboard_UI SHALL display, for that pair and date, the system's own Direction_Class
   next to the provider's reference direction and the Reference_Comparison
   (`agree`, `diverge`, or `neutral`).
2. THE Dashboard_UI SHALL label the external-provider comparison clearly as research-only
   and never an input to any decision.
3. IF the persisted comparison records the reference as unavailable, THEN THE
   Dashboard_UI SHALL display an explicit "reference unavailable" marker as a non-error
   display state rather than an error or a fabricated reference.

### Requirement 13: Silent-by-default rendering

**User Story:** As a viewer, I want a quiet day stated clearly, so that an empty screen is
never ambiguous about whether a run happened.

#### Acceptance Criteria

1. WHEN a selected Decision_Date has rows present but no surfaced firing cards, THE
   Dashboard_UI SHALL display an explicit "no setups fired" message for that date rather
   than an empty or blank card area.
2. WHEN a selected Decision_Date has suppressions, THE Dashboard_UI SHALL display those
   suppressions even when no firing cards surfaced.
3. THE Dashboard_UI SHALL NOT fabricate a firing card for a Decision_Date that has no
   surfaced rows.

### Requirement 14: Graceful empty and error states

**User Story:** As a viewer, I want clear feedback when there is nothing to show or
something fails, so that I can tell "no data yet" apart from "something broke".

#### Acceptance Criteria

1. IF no persisted rows exist yet for any date, THEN THE Dashboard_UI SHALL display a
   non-secret message stating that no runs have been persisted yet.
2. IF a Read_Proxy request returns an error, THEN THE Dashboard_UI SHALL display a
   non-secret error message rather than a stack trace, raw payload, or blank screen.
3. WHILE a data request is in flight, THE Dashboard_UI SHALL display a mobile-friendly
   loading state.

### Requirement 15: Dark theme

**User Story:** As a viewer, I want a single dark theme, so that the dashboard is
comfortable to read without managing a theme setting.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL present a single Dark_Theme for all content and SHALL NOT
   provide a light theme or a theme toggle.
2. THE Dashboard_UI SHALL NOT default its theme from the user's `prefers-color-scheme`
   system preference and SHALL always apply the Dark_Theme.
3. THE Dashboard_UI SHALL apply the Dark_Theme to Recharts chart colors so charted values
   remain legible against the dark background.

### Requirement 16: Tabbed category navigation and in-category accordions

**User Story:** As a viewer on a phone, I want top-level categories as tabs with
expandable sections for detail, so that I navigate the dashboard instead of scrolling one
long page.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL organize its content into top-level Category_Tabs rather than a
   single long scrolling page, and SHALL present those tabs mobile-first (a mobile-native
   bottom tab bar is acceptable).
2. THE Dashboard_UI SHALL provide, as its top-level categories (confirmable in design):
   Setups (firing cards and suppressions); Pattern & Outcomes (Earned_Confidence trend,
   MFE/MAE excursion profile, prediction-versus-actual, and the price chart); Gate
   (`gate_verdicts` and `gate_fold_verdicts`); AI (Signal_Rationale, pattern-description,
   and Research_Proposal content); and Third-party (External_Reference_Signal
   Reference_Comparison).
3. WHERE a category carries secondary detail, THE Dashboard_UI SHALL present that detail
   in expandable Accordion_Sections within the category rather than always-expanded.
4. WHEN a viewer navigates between Category_Tabs, THE Dashboard_UI SHALL persist BOTH the
   Historical_Browse Decision_Date selection (and the Latest_Decision_Date header) AND the
   Pair_Selector selection, so that both the selected Decision_Date context and the
   selected pair are retained across categories.
5. THE Dashboard_UI SHALL make Category_Tabs and Accordion_Sections operable by keyboard
   and assistive technology with correct roles and accessible labels.

### Requirement 17: Refresh control and data-freshness indicator

**User Story:** As a viewer, I want an explicit refresh and a last-updated timestamp, so
that I can force the newest data and know how fresh what I see is.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL provide an explicit refresh control that forces a fresh
   end-to-end fetch of the currently shown data.
2. WHEN the viewer activates the refresh control, THE Dashboard_UI SHALL bypass its own
   client cache and SHALL issue a cache-busting or non-cached request so the Read_Proxy's
   cached response is bypassed and fresh data is served.
3. THE Dashboard_UI SHALL display a visible data-freshness "last updated" timestamp for
   the currently shown data.
4. WHILE a refresh is in flight, THE Dashboard_UI SHALL display the loading state.
5. IF a refresh request fails, THEN THE Dashboard_UI SHALL display a non-secret error
   message rather than a stack trace, raw payload, or blank screen.

### Requirement 18: Accessibility and mobile UX basics

**User Story:** As a viewer using assistive technology or a small screen, I want
accessible, legible UI, so that the dashboard is usable without relying on color or
precise pointing.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL use semantic document structure with a single top-level
   heading and labeled sections for firing cards, suppressions, and charts.
2. THE Dashboard_UI SHALL provide accessible text labels for interactive controls,
   including the Historical_Browse date control, the Category_Tabs, the
   Accordion_Sections, and the refresh control.
3. THE Dashboard_UI SHALL convey Direction_Class (UP/DOWN/FLAT) and surfaced-versus-
   suppressed status through text or shape in addition to color, and SHALL NOT rely on
   color alone.
4. THE Dashboard_UI SHALL provide a text or table equivalent, or accessible labels, for
   each chart so that charted values are available without interpreting the visualization
   alone.
5. THE Dashboard_UI SHALL size interactive tap targets to be operable on a touch screen.

### Requirement 19: Testable pure data-shaping logic

**User Story:** As a developer, I want data-shaping, formatting, and date-selection logic
to be pure and testable, so that rendering correctness is verified without a network or a
browser.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL separate the pure functions that select the Latest_Decision_
   Date, select a Historical_Browse date, and shape persisted rows into view and chart
   models from the impure data-fetch and rendering code.
2. THE Dashboard_UI SHALL implement these pure functions in the `web/` app's own test
   toolchain so they are unit- and property-testable.
3. WHEN the date-selection function is given a set of Decision_Dates, THE function SHALL
   return the maximum `decision_date` as the Latest_Decision_Date.
4. WHEN a view-model shaping function is given persisted rows for a Decision_Date, THE
   function SHALL include every surfaced row's pair and every suppression's pair and
   reason in the produced view model.

### Requirement 20: Compute/storage separation and AI/Deterministic boundary for persisted display data

**User Story:** As a system architect, I want the dashboard to read persisted data only
and the new display-only persistence kept off every scoring path, so that the
deterministic compute boundary stays intact as a serving layer is introduced.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL derive every rendered and charted value from persisted rows and
   SHALL NOT invoke pipeline, scoring, gate, or guard computation.
2. THE Dashboard_UI SHALL reside in the standalone `web/` directory outside `src/` and
   SHALL NOT be imported by any deterministic-core module under `src/`.
3. THE persisted Signal_Rationale, pattern-description, Research_Proposal, and External_
   Reference_Signal / Reference_Comparison data SHALL be written by the pipeline as new
   storage (a new column or table), SHALL preserve its LlmTagged / display-only
   provenance, and SHALL be read-only for the Dashboard_UI.
4. THE persisted display-only data in 19.3 SHALL NEVER be fed back into the directional
   probability, Earned_Confidence, Direction_Class, retrieval, or the Kill_Gate verdict
   (parent Requirements 2.6, 15.4, 23.2/23.3).
5. THE Serving_Layer_Guard SHALL continue to assert that the deterministic core under
   `src/` contains no serving framework dependency and no HTTP listener.
6. WHEN the Dashboard_UI and Read_Proxy are added to the repository, THE Serving_Layer_
   Guard and the parent "serving layer out of v1" posture (fx-daily-pattern-assistant
   Requirement 17.3/17.4) SHALL be reconciled to recognize the Dashboard_UI and Read_Proxy
   as the reserved read-only serving layer rather than being left in contradiction.

### Requirement 21: Operator-approved live deployment under the Live Cloud Execution Protocol

**User Story:** As the operator, I want deployment carried out as approved live steps under
the Live Cloud Execution Protocol, so that the Read_Proxy, Hosting, and the companion
migration go live with reconciled project/account context and no leaked secrets.

#### Acceptance Criteria

1. BEFORE any live deployment command runs, THE deployment procedure SHALL reconcile the
   active `gcloud` project and account against `trade-assistant-508806` and SHALL present
   each command for operator approval before execution.
2. WHILE performing deployment, THE deployment procedure SHALL provide any secret value on
   stdin via Secret Manager and SHALL NOT echo, log, or commit any secret value.
3. THE deployment procedure SHALL deploy the Read_Proxy as a Cloud Run service in
   `trade-assistant-508806` with its read credential sourced from Secret Manager.
4. THE deployment procedure SHALL run `firebase deploy` for Firebase_Hosting and SHALL
   configure the `/api` rewrite that forwards dashboard read requests to the Read_Proxy.
5. THE deployment procedure SHALL apply the Read_Only_View set, grants, and
   Default_Deny_RLS companion migration to the hosted Supabase project.
6. AFTER deployment, THE deployment procedure SHALL perform a read-only smoke verification
   confirming that the public URL serves the latest Decision_Date and that the Read_Proxy
   rejects writes and disallowed queries, recording only non-secret references.

## Open Questions (to confirm during review)

1. **Read-only view set (to be settled in design with recommended default).** The exact
   set of Read_Only_View projections and the columns each exposes is a DESIGN-TIME decision
   the designer will PROPOSE. Recommended default: derive each view's columns from exactly
   what each card/chart renders (no speculative columns). The intended source base tables
   are: `firing_setups`, `analogue_outcomes`, `realized_outcomes`, `gate_verdicts`,
   `gate_fold_verdicts`, `candles`, and the new display-only LLM/comparison storage. This
   is security-sensitive and must be settled before the views + grants + Default_Deny_RLS
   companion migration (Requirement 21.5) is written.
2. **Display-only persistence shape (to be settled in design with recommended default).**
   The exact storage shape for the display-only Signal_Rationale / pattern-description, the
   optional Research_Proposal content, and the External_Reference_Signal /
   Reference_Comparison data is a DESIGN-TIME decision the designer will PROPOSE.
   Recommended default: separate dedicated tables for the display-only data (rather than
   new columns on `firing_setups`) to keep the AI/Deterministic boundary clean.
3. **Rate limiting and caching thresholds.** The aggressive rate-limit thresholds, the
   global ceiling value, the pagination/response-size caps, and the short-TTL caching value
   are design details. The BEHAVIOR is now required (Requirement 5.1–5.4); only the exact
   numbers remain to be chosen in design.
4. **Operator live steps.** The live deployment steps — deploying the Read_Proxy Cloud Run
   service, running `firebase deploy` for Hosting plus the `/api` rewrite, and applying the
   Read_Only_View + grants + Default_Deny_RLS companion migration to hosted Supabase — are
   now captured as explicit, trackable acceptance criteria in Requirement 21 and performed
   as operator-approved live steps under the Live Cloud Execution Protocol.
