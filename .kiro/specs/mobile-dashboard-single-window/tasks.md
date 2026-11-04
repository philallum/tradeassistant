# Implementation Plan: Mobile Dashboard Single Window

## Overview

Presentation-only refactor of the `web/` React dashboard: replace the five-tab, `BottomTabBar`-driven layout with an `AllPairsStrip` plus one `MasterCard` per pair in a single always-mounted window. All work is in `web/src/`. There are no backend, data, schema, migration or cloud changes, and nothing is deployed by these tasks.

The language is TypeScript (the design uses TypeScript). Tests use Vitest and fast-check. DOM tests use `@testing-library/react` in `*.dom.test.tsx` files. Pure-module tests are `*.test.ts` or `*.property.test.ts`. Run verification from `web/` with `npm run test` and `npm run build`.

Deploy-safety ordering, so the app stays green after every task:
1. Build the pure helpers and presentational components UNWIRED. They add no behaviour while unmounted.
2. Build `SingleWindowShell`, still unmounted.
3. Wire it into `AppShell`.
4. Delete the old tab shell last.

The data-invariance guard (task 7.1) is scheduled in the first wave so it protects the whole refactor.

Constraints for every task:
- Do NOT modify `pure/shapeDashboard.ts`, `pure/shapeConfluence.ts`, `pure/shapeSetupTrades.ts`, `pure/shapeEvidence.ts`, `pure/shapeDailyNote.ts`, `pure/confluenceNav.ts`, `pure/format.ts` or `state/selection.ts`.
- New modules under `web/src/pure/` must stay pure: no fetch, DOM, clock, or imports from the backend `src/`. They are automatically covered by `pure/purity.structural.test.ts`.

## Tasks

- [x] 1. Pure helpers (unwired)
  - [x] 1.1 Create the single-source "no signal" copy constant
    - Create `web/src/pure/noSignalCopy.ts` exporting ONE constant for the generic explicit unavailable / no-signal marker text, plus a short "pair did not fire" label for the banner. Do not hard-code this wording anywhere else.
    - **OPEN ITEM: the exact wording is to be confirmed by the operator.** Use a neutral placeholder such as "No signal" / "No data" and keep it in this one constant so it is trivial to change. Add a code comment saying so.
    - Keep it visually and textually distinct from the existing `NOT_ACTIONABLE` ("—") marker and from the "(un-validated)" marker.
    - _Requirements: 3.5, 3.6, 4.8, 9.6_

  - [x] 1.2 Implement `shapeAllPairsStrip`
    - Create `web/src/pure/shapeAllPairsStrip.ts` with `StripEntryVM`, `AllPairsStripVM` and `shapeAllPairsStrip(confluence: ConfluenceViewModel)` as specified in design.md.
    - Walk the `PAIRS` constant in order and look up each pair's `RowVM`. Take `statusLabel`, `marker` and `scoreText` verbatim.
    - A pair with no row yields `hasData: false`, `marker: "none"`, and the no-signal marker from 1.1. Never fabricate a direction or score.
    - Confirm `purity.structural.test.ts` still passes.
    - _Requirements: 4.1, 4.2, 4.6, 4.8_

  - [x] 1.3 Write property test for strip projection fidelity
    - File: `web/src/pure/shapeAllPairsStrip.property.test.ts`. Use fast-check with at least 100 runs and generate `ConfluenceViewModel` values, including ones with missing pairs.
    - **Property 1: All_Pairs_Strip is a verbatim projection of the confluence rows**
    - **Validates: Requirements 4.6, 4.8**

  - [x] 1.4 Write property test for strip ordering and cardinality
    - Same file as 1.3. Include the empty `ConfluenceViewModel` among the generated inputs.
    - **Property 2: All_Pairs_Strip always lists exactly the five pairs, in canonical order**
    - **Validates: Requirements 4.1**

  - [x] 1.5 Implement `selectPairConfluenceRow`
    - Create `web/src/pure/selectPairConfluenceRow.ts`: `(viewModel, pair) => RowVM | null`. It is a plain lookup and does not reshape the row.
    - _Requirements: 5.8_

  - [x] 1.6 Write property test for single-pair row selection
    - File: `web/src/pure/selectPairConfluenceRow.property.test.ts`. The result is `null` exactly when there is no row for the pair, otherwise the unchanged source `RowVM`.
    - **Property 3: Single-pair confluence selection is a faithful sub-slice**
    - **Validates: Requirements 5.8**

  - [x] 1.7 Implement `shapeBacktestEdge`
    - Create `web/src/pure/shapeBacktestEdge.ts` with `BacktestEdgePillVM` and `shapeBacktestEdge(report: EvaluationReportRow | null)`.
    - Import `formatDeltaPp` from `../tabs/Gate/format` instead of duplicating it. `available` is false if and only if `report === null`. Otherwise `edgeText = formatDeltaPp(report.delta_vs_baseline)`.
    - Do not reimplement `selectLatestReport`. It stays in `tabs/Gate/selectReport.ts` and is called by the shell (task 4.4).
    - Read `pure/purity.structural.test.ts` first to confirm the cross-folder import of `tabs/Gate/format` passes the purity scan. That file only forbids imports from the backend `src/` and relative paths that escape `web/`. If the scan fails, report it rather than weakening the test.
    - _Requirements: 8.4, 8.5, 8.6_

  - [x] 1.8 Write property test for the backtest-edge pill
    - File: `web/src/pure/shapeBacktestEdge.property.test.ts`. Generate `EvaluationReportRow | null`.
    - **Property 4: Backtest edge pill never fabricates a value**
    - **Validates: Requirements 8.5, 8.6**

  - [x] 1.9 Implement `resolveWindowSelection`
    - Create `web/src/pure/resolveWindowSelection.ts`, a pure function of `(pair, date, availableDates, rawPairParam, rawDateParam)`.
    - Map the `ALL_PAIRS` sentinel or an unsupported pair to `EURUSD`. Map a date not in the available set to the Latest_Decision_Date, using `selectBrowseDate` semantics. Retain any valid field.
    - Return `{ pair, date, rejectedPair: boolean, rejectedDate: boolean }`. The `rejected*` flags are derived from the raw URL params the shell reads itself, so Req 10.4 is satisfied best-effort and `state/selection.ts` stays untouched.
    - Do NOT modify `state/selection.ts`.
    - _Requirements: 2.6, 10.3, 10.4_

  - [x] 1.10 Write property tests for `resolveWindowSelection`
    - File: `web/src/pure/resolveWindowSelection.property.test.ts`. A valid field is always retained, an invalid field always defaults, and the result is always a supported pair.
    - _Requirements: 2.6, 10.3_

- [x] 2. Presentational components (unwired)
  - [x] 2.1 Implement `Accordion`
    - Create `web/src/components/Accordion.tsx`, a generic disclosure primitive: a header `<button>` with `aria-expanded` and `aria-controls` over a collapsible panel that is `hidden` when collapsed. It defaults to collapsed.
    - Reuse the existing `confluence-focusable` focus-outline pattern from `tabs/Setups/ConfluencePanel.tsx` so there is a visible `:focus-visible` indicator.
    - The tap target must be at least the minimum used elsewhere in the repo.
    - _Requirements: 7.2, 7.3, 7.4, 12.4, 12.5, 12.6_

  - [x] 2.2 Implement `ContextDrawers`
    - Create `web/src/components/ContextDrawers.tsx` with exactly two `Accordion`s, both collapsed on mount and toggling independently.
    - Daily_AI_Note drawer: `DailyNoteViewModel.text` when `status === "generated"`, a placeholder when unavailable or absent, and the "advisory and non-scoring" label. Reuse the wording from `tabs/Setups/DailyNote.tsx`.
    - Historical_Evidence drawer: render one `EvidenceVM` with the same fields as `tabs/Setups/EvidencePanel.tsx`. When there is no evidence, render an explicit placeholder and keep the header present and activatable.
    - Where raw sample-count detail exists, it lives inside a collapsed-by-default drawer, never in the default view.
    - Read `EvidencePanel.tsx` and `DailyNote.tsx` first.
    - _Requirements: 7.1, 7.5, 7.6, 7.7, 7.8, 7.9, 8.7_

  - [x] 2.3 Write DOM tests for `Accordion` and `ContextDrawers`
    - File: `web/src/components/ContextDrawers.dom.test.tsx`.
    - Cover collapsed by default, independent toggle, `aria-expanded` state, Enter/Space toggling, the placeholders, and the advisory label.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.7, 7.8, 7.9, 12.4, 12.5_

  - [x] 2.4 Implement `BacktestEdgePill`
    - Create `web/src/components/BacktestEdgePill.tsx`. It shows `edgeText` when available, otherwise the no-signal / unavailable marker from 1.1, and never a stale or default number.
    - _Requirements: 8.4, 8.5, 8.6_

  - [x] 2.5 Implement `VerdictBanner`
    - Create `web/src/components/VerdictBanner.tsx` taking one `SetupTradeVM`.
    - Show direction as a text label plus the shape glyph, reusing the `directionGlyph` convention from `tabs/Setups/FiringCard.tsx`. Show confidence via `formatConfidence`. Show Entry, Stop_Loss, Take_Profit and Net_Expectancy via `formatPips`.
    - Render one Validation_Status badge driven by `vm.anyUnvalidated`, using the `Marker` pattern from `SetupTradeCard.tsx`. The badge uses the same font size as the numeric values (15px) so it is at least as prominent as them.
    - Add no order-placement affordance.
    - Do not transform any shaper output.
    - Read `SetupTradeCard.tsx` and `FiringCard.tsx` first. Null (did-not-fire) handling is added in task 5.1.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

  - [x] 2.6 Write DOM tests for `BacktestEdgePill` and `VerdictBanner`
    - Files: `BacktestEdgePill.dom.test.tsx` and `VerdictBanner.dom.test.tsx` in `web/src/components/`.
    - Pill: the available and unavailable states.
    - Banner: one example per field; UP/DOWN/FLAT each distinguishable by text and glyph (non-colour cue); the un-validated badge font size equals the numeric value font size; the un-validated marker and the not-available marker are visually distinct; no button elements.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 8.5, 8.6, 12.7_

  - [x] 2.7 Implement `PairConfluenceMatrix`
    - Create `web/src/components/PairConfluenceMatrix.tsx` with props `row: RowVM | null` and `columns: readonly ColumnVM[]`. Render six cells in canonical order with glyph, label and two-decimal strength.
    - Show an "Unavailable" label plus the reason and no strength for unavailable cells. Show the Confluence_Score and status label. Mark the Third_Party cell display-only (the existing `(display-only)` header suffix) with no scoring control.
    - Reuse `nextCell` from `pure/confluenceNav.ts` with `rowCount = 1` and `colCount = row.cells.length`. Navigation moves focus only and leaves any pinned drawer unchanged. Escape dismisses the pinned rationale.
    - Use a roving tabindex so exactly one cell is a Tab stop. Use `aria-pressed` and a single pinned Rationale_Drawer (`role="region"`, `aria-live="polite"`), relocated under the cell row. Re-activating the pinned cell, or activating the dismiss control, hides it.
    - Colour reinforcement only when `viewModel.validated`; otherwise use the neutral treatment (reuse `NEUTRAL_MARKER_COLOR`).
    - There must be no horizontal scrollbar on the primary content.
    - Read `tabs/Setups/ConfluencePanel.tsx` and `pure/confluenceNav.ts` first.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 12.2, 12.3, 12.6, 12.7, 12.8_

  - [x] 2.8 Write DOM tests for `PairConfluenceMatrix`
    - File: `web/src/components/PairConfluenceMatrix.dom.test.tsx`.
    - Cover: six cells in order; unavailable cell has no strength; roving tabindex gives exactly one Tab stop on a 1x6 grid; arrow/Home/End move focus without changing the pinned drawer; Enter/Space reveal the drawer with `aria-pressed`; Escape dismisses; at most one drawer open; the neutral treatment when unvalidated; a non-colour direction cue; an unavailable cell stays focusable.
    - _Requirements: 5.1, 5.3, 5.7, 5.9, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 12.2, 12.3, 12.7, 12.8_

  - [x] 2.9 Implement `AllPairsStrip`
    - Create `web/src/components/AllPairsStrip.tsx` rendering `shapeAllPairsStrip` output as five keyboard-focusable, keyboard-activatable controls with a visible focus indicator.
    - Each shows pair, `statusLabel` and `scoreText` (text label plus the marker's non-colour cue). The selected pair is indicated by `aria-current` or `aria-pressed` and a non-colour cue. Activating an entry calls an `onSelectPair(pair)` prop.
    - A `hasData: false` entry shows the no-signal marker from 1.1. The five entries fit at 320px without horizontal scroll of primary content (wrap or grid).
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 12.6_

  - [x] 2.10 Write DOM tests for `AllPairsStrip`
    - File: `web/src/components/AllPairsStrip.dom.test.tsx`. Cover activation by click, Enter and Space calling `onSelectPair`; the selected-pair indication; the no-data marker; five entries; focusable controls.
    - _Requirements: 4.1, 4.3, 4.4, 4.7, 4.8_

  - [x] 2.11 Implement `ControlBar`
    - Create `web/src/components/ControlBar.tsx`. It composes the existing `PairSelector`, `DateSelector` and `RefreshControl` unchanged. It is sticky (`position: sticky; top: 0`) and owns the document's single `<h1>`.
    - Read `AppShell.tsx` first to carry over the header layout and the h1 text.
    - _Requirements: 2.1, 2.2, 2.5, 12.1, 12.6_

  - [x] 2.12 Write DOM tests for `ControlBar`
    - File: `web/src/components/ControlBar.dom.test.tsx`.
    - Cover: exactly one `h1`; the three controls have accessible names; the sticky positioning style; the pair selector offers exactly the five pairs.
    - _Requirements: 2.1, 2.2, 2.5, 12.1_

  - [x] 2.13 Implement `MasterCard`
    - Create `web/src/components/MasterCard.tsx` composing `VerdictBanner`, `BacktestEdgePill` (directly under the banner), `PairConfluenceMatrix` and `ContextDrawers` in that top-to-bottom single-column order.
    - Contains no multi-pair table, no year-long backtest table and no raw sample-count dump in the default view. Exactly one pill.
    - No `<h1>`; use `<h2>` or lower.
    - _Requirements: 1.2, 1.3, 1.7, 8.1, 8.2, 8.4, 12.1_

  - [x] 2.14 Write DOM tests for `MasterCard`
    - File: `web/src/components/MasterCard.dom.test.tsx`.
    - Cover: DOM order banner, pill, matrix, drawers; exactly one pill; no `table` with more than one pair column; no `h1`; both drawers collapsed by default.
    - _Requirements: 1.2, 1.3, 8.1, 8.2, 8.4, 7.2, 12.1_

- [x] 3. Checkpoint - Components and helpers green
  - Run `npm run test` and `npm run build` from `web/`. Ensure all tests pass, ask the user if questions arise.

- [x] 4. SingleWindowShell (unwired)
  - [x] 4.1 Implement a timeout-race helper
    - Create `web/src/api/withTimeout.ts` exporting `withTimeout(promise, ms)`, which rejects with a non-secret `Error("The dashboard data could not be loaded in time.")` after `ms` (default 10_000) and clears its timer on settle.
    - **Verify before relying on abort:** `api/snapshotCache.ts#getSnapshot` memoises ONE shared in-flight promise per generation, and the first caller's `signal` is the one passed to `loadSnapshot`. `AppShell` also calls `getSnapshot` on the same generation. Aborting a per-window timeout signal could therefore cancel the shared fetch for `AppShell` and every other consumer, and a failed load clears the cache.
    - Therefore race the promise against a timer and do NOT pass a timeout-owned `AbortSignal` into `getSnapshot`. Document this in a code comment.
    - Read `api/snapshotCache.ts` and `api/snapshot.ts` first (the `signal` option is forwarded at `snapshot.ts` around line 465).
    - _Requirements: 10.7, 11.5_

  - [x] 4.2 Write unit tests for `withTimeout`
    - File: `web/src/api/withTimeout.test.ts`, using Vitest fake timers. Cover: resolves before the deadline; rejects at the deadline; the timer is cleared on settle; the error message is non-secret.
    - _Requirements: 11.5_

  - [x] 4.3 Implement the `SingleWindowShell` load state machine
    - Create `web/src/components/SingleWindowShell.tsx` with `SingleWindowShellProps` as in design.md: `refreshNonce`, `decisionDate`, and the injected loaders `loadFiringSetups`, `loadConfluence`, `loadEvidence`, `loadDailyCommentary` and `loadEvaluationReports`.
    - Default loaders read `getSnapshot(refreshNonce, ...)` as in `SetupsTab.tsx`. Mirror `SetupsTab`'s `LoadState` union (`loading | error | ready`), its `AbortController` plus `mounted` ref guard, and its non-secret error-message convention.
    - Wrap the load in `withTimeout(..., 10_000)` so a stall is treated as a failure (Req 11.5). Per 4.1, do not pass a timeout-owned signal to `getSnapshot`.
    - Render `LoadingState` while loading (within 100ms of first load). Render `ErrorState` with a retry that re-runs the load for the current selection and is disabled while a retry is in flight. Render an explicit message when no run is persisted and a "no data for this date" message.
    - Use `resolveWindowSelection` (1.9) with `useSelection()` to map `ALL_PAIRS` or invalid values to defaults without modifying `state/selection.ts`. The raw URL params for the best-effort Req 10.4 message are read from `window.location.search` inside the component.
    - Read `tabs/Setups/SetupsTab.tsx`, `tabs/Gate/GateTab.tsx` (its loader pattern), `components/ErrorState.tsx`, `components/LoadingState.tsx` and `state/selection.ts` first.
    - _Requirements: 2.6, 10.1, 10.2, 10.3, 10.4, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 4.4 Compose the ready state from the existing shapers
    - In `SingleWindowShell.tsx`, on `ready`: call `shapeDashboardView`, `shapeSetupTrades` (pick the one `SetupTradeVM` for the selected pair), `shapeConfluence` (once), `shapeAllPairsStrip`, `selectPairConfluenceRow`, `shapeEvidence` (pick the selected pair's `EvidenceVM`), `shapeDailyNote`, and `selectLatestReport` then `shapeBacktestEdge`.
    - Pass the results to `AllPairsStrip` and `MasterCard`. Strip activation calls the selection store's setter for the pair.
    - No step recomputes any shaper output, and no value is derived from any other source.
    - _Requirements: 4.3, 4.4, 9.1, 9.2, 9.5, 9.6_

  - [x] 4.5 Keep the last good card during refresh and failed refresh
    - In `SingleWindowShell.tsx`, once `ready`, a refresh or selection change that re-fetches keeps the last successful `MasterCard` mounted. It never blanks the view and never drops back to `loading`.
    - On failure or a 10s timeout, keep the card visible and show a non-blocking inline message identifying the failed selection or refresh ("refresh did not complete").
    - On success, replace the card. Show the Req 10.4 "requested selection was unavailable" message only when `resolveWindowSelection` flags a rejection. Its absence is not a defect.
    - _Requirements: 2.7, 2.8, 10.4, 10.6, 10.7, 10.8_

  - [x] 4.6 Write DOM tests for the shell load state machine
    - File: `web/src/components/SingleWindowShell.load.dom.test.tsx`, with injected fake loaders and fake timers.
    - Cover: loading, then ready; error with retry; retry button disabled while in flight; a 10s stall renders the error state; empty set message; no-data-for-date message; no stack trace or raw payload text.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x] 4.7 Write DOM tests for selection defaulting and last-good-card retention
    - File: `web/src/components/SingleWindowShell.selection.dom.test.tsx`.
    - Cover: `ALL` maps to EURUSD; an invalid pair or date defaults while the valid field is retained; a deep link with both values is restored; the pair and date mirror into the URL; a failed refresh keeps the previous card plus an inline message; a refresh in flight keeps the card visible.
    - _Requirements: 2.6, 2.8, 10.1, 10.2, 10.3, 10.5, 10.7, 10.8_

- [x] 5. Pair-did-not-fire state
  - [x] 5.1 Render the explicit no-signal state in the banner and strip
    - When a pair has no `SetupTradeVM` (it did not fire), `VerdictBanner` accepts `null` and renders only the generic explicit no-signal marker from `pure/noSignalCopy.ts`. It renders no direction, confidence or trade parameters, and no fabricated number.
    - The `MasterCard` still renders the matrix, pill and drawers. `SingleWindowShell` passes `null` when no `SetupTradeVM` exists for the selected pair.
    - `AllPairsStrip` already renders the same constant for `hasData: false` (1.2). Confirm both use the single constant and that there is no second copy of the string.
    - **OPEN ITEM: the exact wording is to be confirmed by the operator.** Keep all copy in `noSignalCopy.ts`.
    - _Requirements: 3.6, 4.8, 9.6_

  - [x] 5.2 Write DOM tests for the no-signal state
    - File: `web/src/components/noSignal.dom.test.tsx`.
    - Cover: the banner with `null` shows the constant and no direction, confidence or pips; the strip entry for a no-data pair shows the same constant; changing the constant's value changes both (import it in the test instead of hard-coding the text).
    - _Requirements: 3.6, 4.8, 9.6_

- [x] 6. Wire in and retire the old tab shell
  - [x] 6.1 Add the evaluation-detail route
    - Create `web/src/routing/evaluationDetail.ts` (a pure `isEvaluationDetailHash(hash)` plus `EVALUATION_DETAIL_HASH = "#/evaluation"`) and `web/src/components/useEvaluationDetail.ts` (a hook that subscribes to `hashchange`).
    - Leave `routing/routes.ts` unmodified.
    - Add an unobtrusive explicit-demand "Evaluation detail" link and a "Back" link affordance. Placement is decided in 6.3.
    - Read `routing/routes.ts` and `components/useRoute.ts` first for conventions.
    - _Requirements: 8.3_

  - [x] 6.2 Write tests for the evaluation-detail route helper
    - File: `web/src/routing/evaluationDetail.test.ts`. Cover recognising `#/evaluation`, rejecting other hashes, and the empty hash.
    - _Requirements: 8.3_

  - [x] 6.3 Wire `SingleWindowShell` into `AppShell` and remove the tab bar from the render tree
    - **Read first:** `components/AppShell.tsx` and `components/TabRouter.tsx`.
    - In `AppShell.tsx`: replace the inline `<header>` with `ControlBar`, replace `<TabRouter>` with `<SingleWindowShell refreshNonce decisionDate loaders...>`, and remove `<BottomTabBar>`, `useRoute()` and the unused imports.
    - Keep the `/decision-dates` fetch and its loading, error and empty gating, `refreshNonce`, and `data-refresh-nonce` unchanged.
    - When the hash is `#/evaluation`, render the existing `GateTab` (keyed on `refreshNonce`) with a back link to the main window. Otherwise render the single window.
    - Check `tabs/Gate/GateTab.tsx` for the dangling `aria-labelledby="tab-gate"` reference now that the tab bar is gone. If it points at a missing id, make the minimal fix that gives the panel a valid accessible name.
    - _Requirements: 1.1, 1.5, 1.6, 8.3, 12.1_

  - [x] 6.4 Update and retire tests that assert the old tab bar
    - **Read first:** `web/src/components/accessibility.appShell.dom.test.tsx` and `web/src/tabs/accessibility.content.dom.test.tsx`.
    - `accessibility.appShell.dom.test.tsx`: remove or rewrite the "bottom tab bar roles/labels" block (tablist, `aria-selected`, `aria-controls`), the tab-button tap-target test, the "active tab's h2 beneath h1" test, and the "labeled navigation landmark" assertion.
    - Keep and adapt: selector and refresh accessible names, the single `h1`, the banner landmark, selector and retry tap targets.
    - Add a regression test: the rendered tree contains no `role="tablist"` / `role="tab"` and no bottom-navigation landmark at 320px or wider.
    - `tabs/accessibility.content.dom.test.tsx`: it targets `FiringCard`, `SuppressionList` and `PatternOutcomesTab` components, not the shell. Keep the tests for components that still exist and are still imported. Retire only the assertions that depend on tab-bar mounting or on tabs that are no longer reachable.
    - Grep the whole of `web/src` for other references to `BottomTabBar`, `TabRouter`, `tab-setups`, `tabpanel-` and `role="tab"`, and fix or retire each. Do not leave any test failing.
    - _Requirements: 1.1, 1.5, 12.1, 12.4, 12.6_

  - [x] 6.5 Delete `BottomTabBar.tsx` and the `TabRouter` five-way switch
    - Delete `web/src/components/BottomTabBar.tsx`.
    - Delete `web/src/components/TabRouter.tsx`, or reduce it to nothing the shell uses. Prefer deleting it if grep shows no remaining references.
    - Leave `routing/routes.ts`, `components/useRoute.ts` and the retired tab folders in place. They are unmounted library code that other tests may cover.
    - Run `npm run build` from `web/` to confirm there are no dangling imports.
    - _Requirements: 1.1, 1.5_

- [x] 7. Data-invariance guards
  - [x] 7.1 Write the data-invariance guard test
    - Create `web/src/guards/dataInvariance.structural.test.ts` plus a committed fixture `web/src/guards/dataInvariance.hashes.json`.
    - The fixture holds the sha256 of each protected file at the base commit: `pure/shapeDashboard.ts`, `pure/shapeConfluence.ts`, `pure/shapeSetupTrades.ts`, `pure/shapeEvidence.ts`, `pure/shapeDailyNote.ts`, `pure/confluenceNav.ts`, `pure/format.ts` and `state/selection.ts`.
    - Compute the hashes from the current, still-unmodified files (they are unchanged at spec start). The test reads each file with `node:fs`, hashes it with `node:crypto`, and fails loudly naming any file that differs. Add a comment explaining that a deliberate future change must update the fixture in the same commit.
    - This is how Property 5 is enforced. It is deliberately NOT a generated-input fast-check test. The existing suites for these modules must keep passing unmodified.
    - **Property 5: Shaper outputs are unchanged by the refactor (data invariance)**
    - **Validates: Requirements 9.3, 9.4**

  - [x] 7.2 Write the render-fidelity property test
    - File: `web/src/components/masterCardRendering.property.test.tsx`, using fast-check (at least 100 runs) with `@testing-library/react`.
    - Generate arbitrary `SetupTradeVM`, `RowVM`, `EvidenceVM` and `DailyNoteViewModel` values, render `VerdictBanner`, `PairConfluenceMatrix` and `ContextDrawers`, and assert each labelled field's DOM text equals the string produced by the existing `format.ts` formatter, with no extra rounding or substitution.
    - Build the arbitraries the way `confidence/` and `csv-loader/` property suites build `fc.record` generators.
    - **Property 6: Rendered Master_Card values are an exact copy of shaper-output strings**
    - **Validates: Requirements 9.2**

- [x] 8. Final checkpoint - Full verification
  - From `web/`: run `npm run test` and `npm run build`.
  - From the repo root: run `npm run check` (lint, tsc, vitest and the web half).
  - Confirm no backend file changed: run `git status --porcelain` and `git diff --stat` and verify every changed path is under `web/` or `.kiro/specs/`, with nothing under the root `src/`, `data/`, `ops/` or `.github/`.
  - Confirm `web/src/guards/dataInvariance.structural.test.ts` passes, so the eight protected files are unmodified.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional extra coverage and can be skipped for a faster MVP. The property tests for design Properties 1 to 5 (tasks 1.3, 1.4, 1.6, 1.8 and 7.1) and the final checkpoint are required.
- The no-signal wording (tasks 1.1 and 5.1) is an OPEN item for operator confirmation. It lives in one constant, `pure/noSignalCopy.ts`.
- The 10-second timeout uses a promise race instead of an `AbortSignal` because `snapshotCache` shares one in-flight promise across callers (task 4.1).
- Req 10.4 (the "selection unavailable" message) is best-effort and requires no change to `state/selection.ts`.
- Nothing is deployed by these tasks. The operator merges dev to main.
- Each task references granular requirement clauses from requirements.md (12 requirements).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.5", "1.7", "1.9", "2.1", "2.5", "2.11", "4.1", "6.1", "7.1"] },
    { "id": 1, "tasks": ["1.2", "1.6", "1.8", "1.10", "2.2", "2.4", "2.7", "2.12", "4.2", "6.2"] },
    { "id": 2, "tasks": ["1.3", "2.3", "2.6", "2.8", "2.9", "2.13"] },
    { "id": 3, "tasks": ["1.4", "2.10", "2.14", "4.3"] },
    { "id": 4, "tasks": ["4.4"] },
    { "id": 5, "tasks": ["4.5"] },
    { "id": 6, "tasks": ["4.6", "4.7", "5.1"] },
    { "id": 7, "tasks": ["5.2", "6.3", "7.2"] },
    { "id": 8, "tasks": ["6.4"] },
    { "id": 9, "tasks": ["6.5"] }
  ]
}
```
