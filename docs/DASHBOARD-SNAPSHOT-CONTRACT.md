# `dashboard.json` - the snapshot contract

The daily Job publishes **one static JSON file**, `dashboard.json`, to a public-read GCS bucket.
The React app fetches it and renders it. There is no API server and no live database access from
the browser, so this file *is* the interface between the backend and the UI.

**Current schema version: 8.**

## Who owns what

| Side | File | Role |
| --- | --- | --- |
| Backend (writer) | `src/scheduled-run/snapshot.ts` | The authoritative types (`DashboardSnapshot` and every `Snapshot*` slice type), `SNAPSHOT_SCHEMA_VERSION`, `buildDashboardSnapshot`, `serializeSnapshot`, `writeDashboardSnapshot`. |
| Backend (writer) | `src/scheduled-run/gcsSnapshotSink.ts` | Uploads the bytes. Object name `dashboard.json`; `Content-Type: application/json`; `Cache-Control: no-cache, max-age=0`. With no bucket configured the write is a logged no-op. |
| Frontend (reader) | `web/src/api/types.ts` | A **hand-kept mirror** of the backend types. There is no code generation; the two are kept in lockstep by hand. |
| Frontend (reader) | `web/src/api/snapshot.ts` | `loadSnapshot()` (the only `fetch` in the SPA), `parseSnapshot()`, the lenient/strict parsers, `EMPTY_*` defaults, and its own `SNAPSHOT_SCHEMA_VERSION`. |

The TypeScript types are the field-level authority. This document describes the *rules* around
them; it deliberately does not duplicate every field.

## The envelope (top-level keys, in write order)

Key order is part of the contract: **a new slice is always appended last**, so every earlier key
keeps its byte position (the tests compare serialised output).

| Key | Added | Produced by | Parse mode (web) | Default when absent |
| --- | --- | --- | --- | --- |
| `schemaVersion`, `decisionDate`, `generatedAt` | v1 | `buildDashboardSnapshot` (`generatedAt` is stamped at build time) | scalars; wrong type -> `""` / current version | - |
| `decisionDates` | v1 | `loadSnapshotHistory` (every date with persisted data, ascending, today always included) | array | `[]` |
| `firingSetups` | v1 | today's firing view merged over history from `firing_setups` | array | `[]` |
| `pairEvaluations` | v2 | `pairEvaluationRows` - **all five pairs** each run, fired or not (`fired` comes from the single `fires()` predicate). v6 adds the optional `expected_range`. | array | `[]` |
| `analogueOutcomes`, `realizedOutcomes`, `candles` | v1 | `loadSnapshotHistory` (bounded 400-day window) | array | `[]` |
| `aiRationale` | v1 | Gemini, display-only (`LlmTagged`) | array | `[]` |
| `dailyCommentary` | v3 | Gemini whole-day note, display-only, every trading day | object | explicit not-generated record |
| `externalComparison` | v1 | third-party (FCS) reference vs the system's own direction | array | `[]` |
| `evaluationReports` | v1 | persisted `evaluation_reports` (no verdict column) | array | `[]` |
| `tradeLedgerSummary`, `calibration`, `exposure`, `provenance`, `validationStatus` | v4 | `buildEdgeSlices`. **Empty until an operator runs the offline `edge-eval`** - the daily Job never writes the ledger. | object / array | explicit empty values |
| `confluence` | v5 | `buildRunMatrix` -> `sliceFromRunMatrix` (six signals per pair + score/status, the weights and thresholds used, `validationLabel: "unvalidated"`) | **strict when the declared version is >= 5** (a malformed slice throws `SnapshotError`) | `EMPTY_CONFLUENCE` for v<5 |
| `trackRecord` | v6 | `buildTrackRecordSlice` - look-ahead-safe *replay* of the four classical strategies, the pattern journal, and the expected-candle-size replay (120 s deadline) | lenient; a bad row is dropped | `EMPTY_TRACK_RECORD` |
| `signalScorecard` | v7 | `buildSignalScorecardSlice` - the *recorded* per-signal ledger from `signal_predictions` (all six signals) | lenient; a bad row is dropped | `EMPTY_SIGNAL_SCORECARD` |
| `intradayValidation` | v8 | the intraday Job (`intradayMain.ts`) - the 4H enrichment | lenient; a bad row is dropped | `EMPTY_INTRADAY_VALIDATION` |

## Rules

1. **Append last, bump both sides.** Adding a slice means: add the type and an `EMPTY_*` default
   in `snapshot.ts`; append the key at the end of `buildDashboardSnapshot`; bump
   `SNAPSHOT_SCHEMA_VERSION` **in both** `src/scheduled-run/snapshot.ts` and
   `web/src/api/snapshot.ts`; add the mirror type and a parser in the web app; add a pure shaper
   and component. Never reorder or rename an existing key.
2. **Lenient by default, strict only where a wrong value would mislead.** The web parser fills
   an absent or malformed slice with its empty default and *drops* a defective row rather than
   fabricating one. The single strict slice is `confluence` (when the document declares v5+),
   because rendering a half-formed consensus is worse than an explicit error.
3. **Version mismatch is tolerated.** The web app never rejects a newer or older version; it
   only gates `confluence` strictness. Each bump is therefore backward- and forward-compatible.
4. **Display-only data stays display-only.** Nothing in the snapshot is read back by the firing
   or scoring path. `aiRationale` and `dailyCommentary` are LLM text; `confluence`,
   `trackRecord`, `signalScorecard` and `intradayValidation` are labelled/treated as
   unvalidated.
5. **The browser derives, never recomputes.** All display values come from the pure shapers in
   `web/src/pure/` (enforced by `web/src/pure/purity.structural.test.ts` and the data-invariance
   guards in `web/src/guards/`). One deliberate exception to be aware of: the conviction tiers
   *Lean* and the exact-tie *Split* are computed in the browser
   (`web/src/pure/shapeConviction.ts`) from the engine's `status` and the published `weights`;
   the backend produces no such tiers.
6. **A failed publish never harms the rows.** `writeDashboardSnapshot` logs and swallows any sink
   error; the persisted tables are the source of truth and the next run overwrites the file.

## The intraday republish (a known hazard)

The intraday Job does not build a snapshot; it **reads the published `dashboard.json`, replaces
only the `intradayValidation` key, and uploads it again**. Consequences:

- It must run on an image whose republish is a *key-replace*. The first version rebuilt the
  snapshot from empty daily slices and clobbered the file; this was fixed and live-verified on
  2026-11-06.
- If no matching published snapshot exists (wrong decision date, unreadable file) it skips the
  republish rather than writing a partial file.
- `deploy.yml` redeploys the intraday Job on every backend deploy so it cannot run a stale image.
- Between the daily run and the 08:00 London republish the file's `schemaVersion` is the same;
  only `intradayValidation` changes.

## Reading the file

```bash
# The deployed location is the bucket named by DASHBOARD_SNAPSHOT_BUCKET:
curl -s "https://storage.googleapis.com/$DASHBOARD_SNAPSHOT_BUCKET/dashboard.json" | jq '{schemaVersion, decisionDate, generatedAt}'
```

For local SPA work, place a copy at the served root as `dashboard.json` (the SPA falls back to the
same-origin `/dashboard.json` when `VITE_SNAPSHOT_URL` is not set at build time; the deployed
bundle bakes the bucket URL in).

## What protects this contract

- `src/scheduled-run/snapshot.test.ts` - envelope shape, key order, `pairEvaluationRows`.
- `src/scheduled-run/main.test.ts` - each slice is fail-safe and leaves the firing view and
  persisted rows identical; the snapshot still publishes with the empty default.
- `src/scheduled-run/intradayMain.test.ts`, `publishedSnapshot.test.ts` - the key-replace republish.
- `web/src/api/snapshot*.test.ts` - lenient/strict parsing and defaults.
- `web/src/guards/` - the UI shows backend values verbatim.

There is **no automated test that the two hand-kept type mirrors agree.** If you change a wire
type, change `web/src/api/types.ts` in the same commit and run both gates.
