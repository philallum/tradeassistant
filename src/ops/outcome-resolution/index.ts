// Historical Outcome Resolution module public API (Feature: operational-wiring).
//
// Drives the EXISTING forward-outcome `resolve(...)` over all stored history so
// the `analogue_outcomes` table is populated during ingestion/backfill. This
// surface re-implements NO ingestion/encoding/resolver/ATR logic — it only
// WIRES the existing pieces behind the storage PORTs. No `Secret_Key` value is
// ever read into or emitted from any exported shape.

export * from "./types.js";
export {
  resolveHistoricalOutcomes,
  type OutcomeResolutionDeps,
} from "./outcomeResolution.js";
