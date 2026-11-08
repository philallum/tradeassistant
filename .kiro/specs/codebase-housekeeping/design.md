# Design: Codebase Housekeeping

## Approach

Small, independently verifiable batches. Tests that pin current behaviour come first; each
removal or consolidation follows its protecting test; documentation is written last so it
describes the final code.

## Decisions

- **R1 horizon:** `retrieve` keeps one record per analogue date (smallest horizon), so horizons
  2/3 have n=0. Documented as horizon-1 only; real selection is a future spec.
- **R2 FCS:** `FcsExternalSignalProvider` reads the live `/forex/latest` value. The scorecard
  recorder skips the `third_party` cell when `decisionDate` is not the current NY trading date.
- **Shared predicate:** exported from `src/dashboard/dashboard.ts`; imported by
  `persistFiringSetups`, `snapshot`, `displayOnly` and the walk-forward regenerator.
- **Matrix once:** built in `makePersistView`, passed to `buildConfluenceSlice` and
  `runSignalScorecardStep`, PAIRS-ordered.
- **Removal order:** re-point oracle tests; remove `ops/gate-run` and the `backtest` stage;
  remove verdict types/store/adapter/exports; delete orphaned tests; update CODE-MAP and
  `ops/required-resources.manifest.json`.
- **Docs layout:** README -> PROJECT-STATE -> {docs/state/DECISIONS (+ Decision Index),
  docs/DASHBOARD-SNAPSHOT-CONTRACT.md, docs/RUNBOOK.md, .env.example}.

## Silent-skip events (Req 9)

scorecard candle-load failure, `forecastExpectedRange`, `encodeStoredCandles`,
`snapshotHistory.safeSlice`, `loadOriginalsFromFiringSetups`, track-record deadline hit.
All use the structured `JSON.stringify({event, ...})` convention and carry names/dates/counts only.

## Testing

Characterization test (R1); `fires()` boundary tests; re-pointed oracle tests with a temporary
mutation check; R2 guard test; failed-pair regression test; FCS error-redaction test; timing
wrapper test; byte-identical snapshot comparison for a healthy run.
