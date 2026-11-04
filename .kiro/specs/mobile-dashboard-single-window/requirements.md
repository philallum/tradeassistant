# Requirements Document

## Introduction

This feature is a mobile-first Information Architecture and visual layout refactor of the
existing trading dashboard web application. It replaces the current five-tab, bottom-navigation
layout — which fragments a single currency pair's picture across separate scrolling views — with
a single, unified, progressive-disclosure "Air Traffic Control" card per currency pair.

This is **strictly a presentation refactor**. No data source, scoring computation, decision
threshold, confidence value, trade parameter, AI output, or third-party output changes. Every
value shown in the new layout is produced by the existing pure display shapers (the
`shapeDashboard`, `shapeConfluence`, `shapeSetupTrades`, `shapeEvidence`, `shapeDailyNote`, and
related selectors), and the refactor MUST NOT alter the values those shapers produce. The new
layout only changes which existing values are shown, where, and how densely.

Per the stakeholder decision, the unified card is the only layout at every viewport width: the
redesign applies on mobile and desktop alike, and the existing bottom tab bar is removed.

At the top of the single window, above the Master_Card, the redesign places an All_Pairs_Strip: a
compact cross-pair overview row that lists all five Pairs so the whole book stays scannable at a
glance and the viewer can drill into any one Pair without losing cross-pair comparison.

The redesign organizes the single window into four zones:
- **Zone 1 — Control Bar:** a sticky top bar with the Pair_Selector, the Decision_Date selector, and a Refresh control.
- **Zone 2 — Verdict Banner:** direction, earned confidence, validation status, and trade parameters (Entry, Stop_Loss, Take_Profit, Expectancy).
- **Zone 3 — Confluence Matrix:** a compact grid of the six Strategy votes with a net Confluence_Score, a status label, and tap-to-reveal per-cell rationale.
- **Zone 4 — Context Drawers:** default-collapsed accordions for the Daily AI Advisory Note and the Historical Analogue Evidence.

## Glossary

- **Dashboard_UI**: The React single-page web application that renders the trading dashboard.
- **Master_Card**: The single unified vertical card rendered for the selected Pair, composed of the Verdict_Banner, the Confluence_Matrix, and the Context_Drawers.
- **All_Pairs_Strip**: The compact cross-pair overview row at the top of the single window listing all five Pairs with each Pair's Direction and net Confluence_Score; display-only; activating an entry drills into that Pair's Master_Card.
- **Control_Bar**: The sticky top bar (Zone 1) holding the Pair_Selector, the Decision_Date selector, and the Refresh_Control.
- **Pair_Selector**: The control that selects the active Pair from the five supported Pairs.
- **Pair**: One of the five supported currency pairs: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD.
- **Decision_Date**: A date (`YYYY-MM-DD`) for which a persisted run exists; the browsed date, defaulting to the Latest_Decision_Date.
- **Latest_Decision_Date**: The most recent Decision_Date in the available set, used when no explicit date is chosen.
- **Refresh_Control**: The control that re-fetches the dashboard data with cache-busting.
- **Verdict_Banner**: Zone 2 — the high-contrast direction indicator, earned confidence, validation status badge, and trade parameters.
- **Direction**: The forecast direction for a Pair (up, down, or flat), produced by the existing shapers.
- **Direction_Class**: The enumerated forecast direction set (UP, DOWN, FLAT) produced by the existing shapers.
- **Earned_Confidence**: The confidence percentage for the Pair's forecast, produced by the existing shapers.
- **Validation_Status**: Whether the Pair's trade parameters are validated out-of-sample net of costs; when un-validated, Stop_Loss and Take_Profit render as the explicit un-validated marker.
- **Trade_Parameters**: Entry assumption, Stop_Loss, Take_Profit, and Net_Expectancy for the Pair.
- **Stop_Loss**: The stop-loss distance in pips for the Pair's trade plan, or the un-validated marker when not validated.
- **Take_Profit**: The take-profit distance in pips for the Pair's trade plan, or the un-validated marker when not validated.
- **Net_Expectancy**: The system's measured net expectancy in pips, or an explicit not-measured marker when absent.
- **Confluence_Matrix**: Zone 3 — the compact grid of the six Strategy votes with the Confluence_Score and status.
- **Confluence_Score**: The net confluence score over the interval `[-1, 1]` for the Pair, produced by `shapeConfluence`.
- **Confluence_Status**: The status label for the Pair's confluence (for example, aligned, conflict, or neutral), produced by `shapeConfluence`.
- **Strategy**: One of the six strategy voters: Trend, Breakout, Range, Reversal, Custom Pattern, Third Party.
- **Strategy_Cell**: One cell of the Confluence_Matrix carrying a Strategy's direction glyph, direction label, and numeric strength.
- **Third_Party_Strategy**: The Third Party strategy voter; display-only — it is shown but never editable or acted upon from the UI.
- **Rationale_Drawer**: The inline region that reveals a selected Strategy_Cell's numeric rationale.
- **Context_Drawers**: Zone 4 — the collapsible accordions for the Daily_AI_Note and the Historical_Evidence.
- **Accordion**: A collapsible disclosure region with a header control and a collapsible panel.
- **Daily_AI_Note**: The pair-independent daily AI advisory commentary, produced by `shapeDailyNote`; advisory only and non-scoring.
- **Historical_Evidence**: The historical analogue outcome context for the Pair, produced by `shapeEvidence`.
- **Backtest_Edge_Pill**: A single compact KPI badge summarizing the backtest edge versus baseline, replacing the year-long backtest tables on the default view.
- **Pure_Shaper**: A deterministic display shaper under `web/src/pure` that converts snapshot data into a view model without fetching, DOM access, clock reads, or core imports.
- **Snapshot**: The persisted dashboard data object the Dashboard_UI fetches and the Pure_Shapers consume.

## Requirements

### Requirement 1: Single-Window Unified Layout

**User Story:** As a mobile trader, I want one continuous card per pair instead of five separate tabs, so that I can assemble a pair's full picture without tab-switching.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL render the Control_Bar, the Master_Card, and no bottom tab bar as its complete top-level layout.
2. WHEN a Pair is selected, THE Dashboard_UI SHALL render one Master_Card for that Pair containing the Verdict_Banner, the Confluence_Matrix, and the Context_Drawers in that top-to-bottom vertical order.
3. THE Dashboard_UI SHALL render the Master_Card as a single vertical column such that the Verdict_Banner, the Confluence_Matrix, and the Context_Drawers require no horizontal scrolling at any viewport width of 320 px or greater.
4. THE Dashboard_UI SHALL apply the Master_Card layout at every viewport width of 320 px or greater.
5. THE Dashboard_UI SHALL NOT render the five-tab bottom navigation bar at any viewport width of 320 px or greater.
6. IF no Pair is selected, THEN THE Dashboard_UI SHALL render the Control_Bar with no Master_Card and no bottom tab bar.
7. WHEN the Master_Card content height exceeds the available viewport height, THE Dashboard_UI SHALL make the Master_Card reachable through vertical scrolling without horizontal scrolling.

### Requirement 2: Sticky Control Bar (Zone 1)

**User Story:** As a trader, I want pair, date, and refresh controls fixed at the top, so that I can change selection and refresh without scrolling back up.

#### Acceptance Criteria

1. THE Control_Bar SHALL render the Pair_Selector, the Decision_Date selector, and the Refresh_Control.
2. WHILE the Master_Card is scrolled vertically through its full content height, THE Control_Bar SHALL remain anchored at the top edge of the viewport with no vertical displacement.
3. WHEN the viewer selects a Pair in the Pair_Selector, THE Dashboard_UI SHALL render the Master_Card for the selected Pair within 1 second.
4. WHEN the viewer selects a Decision_Date, THE Dashboard_UI SHALL render the Master_Card using the selected Decision_Date within 1 second.
5. THE Pair_Selector SHALL offer exactly the five supported Pairs: EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD.
6. WHEN the Dashboard_UI first loads, THE Control_Bar SHALL preselect the first supported Pair (EURUSD) and the most recent available Decision_Date.
7. WHEN the viewer activates the Refresh_Control, THE Dashboard_UI SHALL re-fetch and re-render the Master_Card for the currently selected Pair and Decision_Date within 3 seconds.
8. IF rendering the Master_Card for a selected Pair or Decision_Date fails, THEN THE Dashboard_UI SHALL retain the previously rendered Master_Card and display an error indication identifying the failed selection.

### Requirement 3: Verdict and Parameters Banner (Zone 2)

**User Story:** As a trader, I want the direction, confidence, and trade parameters in one high-contrast banner, so that I can read the verdict at a glance.

#### Acceptance Criteria

1. THE Verdict_Banner SHALL display the Direction value produced by the existing shapers for the selected Pair as one of the enumerated Direction_Class values (UP, DOWN, or FLAT).
2. THE Verdict_Banner SHALL display the Earned_Confidence value produced by the existing shapers for the selected Pair.
3. THE Verdict_Banner SHALL display the Entry assumption, the Stop_Loss, the Take_Profit, and the Net_Expectancy produced by the existing shapers for the selected Pair.
4. THE Verdict_Banner SHALL display a Validation_Status badge whose text corresponds to the Validation_Status value (validated or unvalidated) produced by the existing shapers for the selected Pair.
5. IF the selected Pair's Trade_Parameters carry the unvalidated Validation_Status, THEN THE Verdict_Banner SHALL display the Stop_Loss and the Take_Profit as the explicit un-validated marker that is visually distinct from the not-available marker.
6. IF a trade-parameter value produced by the shapers is absent for the selected Pair, THEN THE Verdict_Banner SHALL display the explicit not-available marker for that value only, leaving every present value displayed.
7. THE Verdict_Banner SHALL convey Direction using a text label together with a non-colour cue, such that each enumerated Direction_Class value (UP, DOWN, FLAT) is distinguishable from the others without reliance on colour.
8. THE Verdict_Banner SHALL display each value from Criteria 1 through 4 exactly as produced by the existing shapers for the selected Pair, applying no transformation, rounding, or re-computation to the shaper output.
9. WHILE the selected Pair's Trade_Parameters carry the unvalidated Validation_Status, THE Verdict_Banner SHALL render the Validation_Status badge with visual prominence at least equal to the Stop_Loss and Take_Profit values, so the un-validated state is not visually subordinate to the trade-parameter numbers.
10. THE Verdict_Banner SHALL render the Entry, the Stop_Loss, the Take_Profit, and the Net_Expectancy without any affordance implying they are live, executable order levels.

### Requirement 4: All-Pairs Comparison Strip

**User Story:** As a trader, I want a compact overview of all five pairs at the top of the window, so that I can scan the whole book at a glance and drill into one pair without losing cross-pair comparison.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL render an All_Pairs_Strip above the Master_Card that lists all five supported Pairs.
2. THE All_Pairs_Strip SHALL display, for each Pair, the Direction as a text label with a non-colour cue and the net Confluence_Score produced by the existing shapers for that Pair.
3. WHEN the viewer activates a Pair entry in the All_Pairs_Strip, THE Dashboard_UI SHALL select that Pair and render its Master_Card.
4. THE All_Pairs_Strip SHALL indicate which Pair is currently selected.
5. THE All_Pairs_Strip SHALL render the five Pair entries without horizontal scrolling of primary content at any viewport width of 320 px or greater.
6. THE All_Pairs_Strip SHALL source every displayed value verbatim from the existing Pure_Shapers, recomputing nothing. *(Correctness property — the strip is display-only: every displayed value equals the corresponding Pure_Shaper output.)*
7. THE All_Pairs_Strip SHALL expose each Pair entry as a keyboard-focusable, keyboard-activatable control with a visible focus indicator.
8. WHERE a Pair has no data for the selected Decision_Date, THE All_Pairs_Strip SHALL render that Pair entry with an explicit no-data marker rather than a fabricated Direction or Confluence_Score.

### Requirement 5: Compact Confluence Matrix (Zone 3)

**User Story:** As a trader, I want a compact six-cell confluence grid with the net score, so that I can see every strategy's vote without a wide scrolling table.

#### Acceptance Criteria

1. THE Confluence_Matrix SHALL render exactly six Strategy_Cells in the canonical left-to-right order: Trend, Breakout, Range, Reversal, Custom Pattern, and Third Party.
2. THE Confluence_Matrix SHALL render each Strategy_Cell with a direction glyph (▲ for up, ▼ for down, – for flat), a direction label ("Up", "Down", or "Flat"), and the numeric strength produced by `shapeConfluence` formatted to two decimal places within the interval -1.00 to 1.00.
3. IF a Strategy_Cell is unavailable in the `shapeConfluence` view model, THEN THE Confluence_Matrix SHALL render that cell with an "Unavailable" label and the unavailable reason detail, and SHALL NOT render a numeric strength value for that cell.
4. THE Confluence_Matrix SHALL display the Confluence_Score produced by `shapeConfluence` for the selected Pair formatted to two decimal places within the interval -1.00 to 1.00.
5. THE Confluence_Matrix SHALL display the Confluence_Status label produced by `shapeConfluence` for the selected Pair as one of the enumerated labels: "Aligned up", "Aligned down", "Neutral", "Insufficient data", or "Stay Flat".
6. THE Confluence_Matrix SHALL render the Strategy_Cells as a compact grid with no horizontal scrollbar on the primary matrix content.
7. THE Confluence_Matrix SHALL render the Third_Party_Strategy cell as display-only, marked with a display-only indicator and exposing no interactive control that changes scoring.
8. THE Confluence_Matrix SHALL render the six Strategy_Cells for the currently selected Pair only, as a single-pair slice of the data the existing shapers produce for all Pairs.
9. WHILE the confluence slice is unvalidated, THE Confluence_Matrix SHALL convey status using one neutral visual treatment that carries meaning through text labels and markers rather than colour; WHERE the slice is validated, THE Confluence_Matrix MAY reinforce the status with colour.

### Requirement 6: Tap-to-Reveal Cell Rationale

**User Story:** As a trader, I want to tap a strategy cell to see its numeric rationale, so that I can understand a vote on demand without permanent clutter.

#### Acceptance Criteria

1. THE Confluence_Matrix SHALL render each Strategy_Cell as a control that is activatable by both a pointer tap and keyboard activation and that exposes an accessible name.
2. WHEN the viewer activates a Strategy_Cell, THE Dashboard_UI SHALL reveal the Rationale_Drawer for that Strategy_Cell within 200 milliseconds of the activation.
3. WHERE the activated Strategy_Cell is available, THE Rationale_Drawer SHALL display, drawn verbatim from the `shapeConfluence` view model for that Strategy_Cell, the direction label and glyph, the strength value formatted to two decimal places within the bounded interval -1.00 to 1.00, and the rationale detail text.
4. WHERE the activated Strategy_Cell is unavailable, THE Rationale_Drawer SHALL display the unavailable label and the unavailable reason detail text drawn verbatim from the `shapeConfluence` view model, and SHALL display no numeric strength value.
5. WHEN the viewer dismisses the Rationale_Drawer by activating the dismiss control or activating the currently activated Strategy_Cell again, THE Dashboard_UI SHALL hide that Rationale_Drawer within 200 milliseconds.
6. WHEN the viewer activates a Strategy_Cell while another Rationale_Drawer is revealed, THE Dashboard_UI SHALL hide the previously revealed Rationale_Drawer and keep at most one Rationale_Drawer revealed.
7. WHILE no Strategy_Cell is activated, THE Dashboard_UI SHALL keep every Rationale_Drawer hidden.
8. WHEN the viewer presses an arrow key, the Home key, or the End key while a Strategy_Cell is focused, THE Confluence_Matrix SHALL move focus between Strategy_Cells without selecting a Strategy_Cell, leaving any pinned Rationale_Drawer unchanged.
9. THE Confluence_Matrix SHALL expose the Strategy_Cells as a single Tab stop using a roving tabindex, such that exactly one Strategy_Cell is in the Tab order at a time.
10. WHEN the viewer presses the Escape key while a Rationale_Drawer is revealed, THE Dashboard_UI SHALL dismiss the revealed Rationale_Drawer.

### Requirement 7: Progressive-Disclosure Context Drawers (Zone 4)

**User Story:** As a trader, I want the AI note and historical evidence collapsed by default, so that the default view stays scannable and I expand detail only when I want it.

#### Acceptance Criteria

1. THE Context_Drawers SHALL render exactly two Accordions: a Daily_AI_Note Accordion and a Historical_Evidence Accordion.
2. WHEN the Master_Card is first rendered, THE Context_Drawers SHALL render both Accordions in the collapsed state with no panel content visible.
3. WHEN the viewer activates a collapsed Accordion header, THE Dashboard_UI SHALL expand that Accordion's panel within 200 milliseconds while leaving the other Accordion's collapsed or expanded state unchanged.
4. WHEN the viewer activates an expanded Accordion header, THE Dashboard_UI SHALL collapse that Accordion's panel within 200 milliseconds.
5. WHILE the Daily_AI_Note Accordion is expanded, THE Dashboard_UI SHALL display the Daily_AI_Note text produced by `shapeDailyNote` for the selected Pair.
6. WHILE the Historical_Evidence Accordion is expanded, THE Dashboard_UI SHALL display the Historical_Evidence values produced by `shapeEvidence` for the selected Pair.
7. IF `shapeDailyNote` produces no Daily_AI_Note text for the selected Pair, THEN THE Dashboard_UI SHALL display a placeholder message indicating no note is available while keeping the Daily_AI_Note Accordion present and activatable.
8. IF `shapeEvidence` produces no Historical_Evidence values for the selected Pair, THEN THE Dashboard_UI SHALL display a placeholder message indicating no evidence is available while keeping the Historical_Evidence Accordion present and activatable.
9. WHILE the Daily_AI_Note Accordion is expanded, THE Dashboard_UI SHALL display a label identifying the Daily_AI_Note as advisory and non-scoring.

### Requirement 8: Density Reduction and Noise Elimination

**User Story:** As a mobile trader, I want year-long backtest tables and raw sample dumps replaced with compact summaries, so that I am not forced into heavy scrolling of desktop-style tables.

#### Acceptance Criteria

1. WHILE the Master_Card is in its default (non-expanded) view, THE Master_Card SHALL NOT render a year-long historical backtest table, a multi-pair wide table, or a raw sample-count dump.
2. THE Master_Card SHALL NOT render any multi-pair table containing more than 1 currency-pair column in any view.
3. THE Dashboard_UI SHALL NOT surface the separate evaluation/edge detail view, comprising the year-long backtest statistics and the raw sample counts, in the default single-window mobile path, and SHALL make that detail reachable only on explicit demand within a Context_Drawer or an explicitly opened detail view.
4. THE Master_Card SHALL display the backtest edge as exactly 1 Backtest_Edge_Pill that summarizes the edge versus baseline as a single numeric value.
5. THE Backtest_Edge_Pill SHALL display the edge value produced by the existing shapers, unmodified, formatted to a fixed number of decimal places.
6. IF the edge value produced by the existing shapers is unavailable or cannot be computed, THEN THE Backtest_Edge_Pill SHALL display a placeholder indicator signifying no edge value is available and SHALL NOT display a stale or default numeric value.
7. WHERE raw sample-count detail exists, THE Master_Card SHALL present it within a Context_Drawer that is collapsed by default and excluded from the default (non-expanded) view.

### Requirement 9: Data Invariance (Presentation-Only Refactor)

**User Story:** As a trading-system owner, I want a guarantee that the redesign changes only presentation, so that no scoring, threshold, confidence, or output value shifts because of the layout change.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL source every value displayed in the Master_Card from the output of exactly one of the existing Pure_Shapers (`shapeDashboard`, `shapeConfluence`, `shapeSetupTrades`, `shapeEvidence`, `shapeDailyNote`), such that each displayed value is traceable to a single shaper output.
2. WHEN the Master_Card renders a value, THE Dashboard_UI SHALL display that value as an exact character-for-character copy of the corresponding Pure_Shaper output, applying no rounding, formatting change, truncation, or other transformation. *(Correctness property — invariant: the rendered value string equals the shaper output string.)*
3. THE redesign SHALL produce byte-identical output from `shapeDashboard`, `shapeConfluence`, `shapeSetupTrades`, `shapeEvidence`, and `shapeDailyNote` for identical Snapshot input, so that each shaper output before the refactor equals the corresponding shaper output after the refactor. *(Correctness property — invariant: for identical Snapshot input, each shaper output is byte-identical before and after the refactor.)*
4. THE redesign SHALL produce, for identical Snapshot input, the same decision threshold values, scoring-computation results, and trade-parameter-computation results before and after the refactor, with no change to any such value. *(Correctness property — invariant: for identical Snapshot input, every threshold, score, and trade parameter is unchanged across the refactor.)*
5. THE Dashboard_UI SHALL NOT fetch, recompute, or otherwise derive any Master_Card value from a source other than the existing Pure_Shapers.
6. IF a value required by the Master_Card cannot be sourced from a Pure_Shaper output, THEN THE Dashboard_UI SHALL NOT display a computed or placeholder substitute and SHALL surface an indication that the value is unavailable, leaving all traceable shaper-sourced values unchanged.

### Requirement 10: Selection and Refresh Continuity

**User Story:** As a trader, I want pair/date selection and refresh to behave exactly as before, so that deep links and freshness still work after the refactor.

#### Acceptance Criteria

1. WHEN the viewer changes the Pair or the Decision_Date, THE Dashboard_UI SHALL preserve the other selection unchanged and SHALL complete the selection update within 500 milliseconds.
2. WHEN the Dashboard_UI loads with a deep-link selection in the URL containing both a Pair value and a Decision_Date value, THE Dashboard_UI SHALL restore the Pair and the Decision_Date from the URL.
3. IF the Dashboard_UI loads with a URL whose Pair value is not one of the five supported Pairs or whose Decision_Date value is not a valid date in the available set, THEN THE Dashboard_UI SHALL apply the default selection for the invalid field (EURUSD for the Pair, the Latest_Decision_Date for the Decision_Date) while retaining any valid field from the URL.
4. WHERE the Dashboard_UI is able to determine that a URL selection value was rejected, THE Dashboard_UI SHALL display a message indicating that the requested selection was unavailable. (Best-effort: absence of this message SHALL NOT be treated as a defect, and this criterion SHALL NOT require any change to the selection store's contract.)
5. WHEN the viewer changes the Pair or the Decision_Date, THE Dashboard_UI SHALL mirror the updated Pair and Decision_Date into the URL within 500 milliseconds of the change.
6. WHEN the viewer activates the Refresh_Control, THE Dashboard_UI SHALL re-fetch the Snapshot using a request that bypasses cached responses and SHALL render the refreshed Master_Card upon successful retrieval.
7. IF a refresh-triggered Snapshot re-fetch fails or does not complete within 10 seconds, THEN THE Dashboard_UI SHALL keep the last successfully rendered Master_Card visible and SHALL display a message indicating that the refresh did not complete.
8. WHILE a refresh is in flight, THE Dashboard_UI SHALL keep the current Master_Card visible rather than blanking the view.

### Requirement 11: Loading, Empty, and Error States

**User Story:** As a trader, I want clear loading, empty, and error states inside the unified card, so that I never see a blank screen, a stack trace, or a raw payload.

#### Acceptance Criteria

1. WHILE the Snapshot fetch is in flight on first load, THE Dashboard_UI SHALL render a loading state within 100 milliseconds rather than a blank screen.
2. IF no run has been persisted, THEN THE Dashboard_UI SHALL render an explicit empty state message.
3. IF no data exists for the selected Decision_Date, THEN THE Dashboard_UI SHALL render an explicit no-data-for-date message.
4. IF the Snapshot fetch fails, THEN THE Dashboard_UI SHALL render an error message with a retry control, and SHALL NOT render a stack trace, raw payload content, or an internal error identifier.
5. IF the Snapshot fetch does not complete within 10 seconds, THEN THE Dashboard_UI SHALL treat the fetch as failed and render the error state.
6. WHEN the viewer activates the retry control after a fetch error, THE Dashboard_UI SHALL re-attempt the Snapshot fetch for the currently selected Pair and Decision_Date and render the loading state.
7. WHILE a retry is in flight, THE Dashboard_UI SHALL disable the retry control to prevent a duplicate concurrent fetch.

### Requirement 12: Accessibility

**User Story:** As a trader using a keyboard or screen reader, I want the card, matrix, drawers, and accordions to be operable and announced, so that the redesign is usable with assistive technology.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL render exactly one top-level `h1` heading for the document.
2. THE Confluence_Matrix SHALL expose each Strategy_Cell as a keyboard-focusable, keyboard-activatable control that is reachable via Tab navigation and activatable via the Enter key and the Space key.
3. WHEN the viewer activates a Strategy_Cell by Enter key or Space key, THE Dashboard_UI SHALL reveal that Strategy_Cell's Rationale_Drawer and expose the revealed state to assistive technology.
4. THE Context_Drawers SHALL expose each Accordion header as a keyboard-focusable control, reachable via Tab navigation, with its expanded or collapsed state exposed to assistive technology.
5. WHEN an Accordion header is toggled by Enter key or Space key, THE Dashboard_UI SHALL expand or collapse that Accordion's panel and update its exposed expanded or collapsed state.
6. THE Dashboard_UI SHALL render a visible focus indicator, distinguishable from the unfocused state by a change in visible outline or border, on every focusable control in the Master_Card and the Control_Bar.
7. THE Confluence_Matrix SHALL convey each Strategy_Cell's direction using a text label or glyph together with a non-colour cue, such that direction remains distinguishable when colour is removed.
8. IF a Strategy_Cell has no Rationale_Drawer content to reveal, THEN THE Dashboard_UI SHALL leave the Strategy_Cell focusable while exposing its unavailable or empty state to assistive technology.
