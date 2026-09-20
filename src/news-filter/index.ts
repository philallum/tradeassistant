// News Filter module public API — Component 10 (Requirement 14).
//
// Calendar ingestion + validation (14.1) → LLM structured risk flag via the
// LLM_Interface (14.2) → deterministic, pure suppression that consumes only the
// flag and NEVER emits a Direction_Class (14.3–14.5) → fail-safe that flags
// missing context, logs an ingestion error, and suppresses all five pairs on
// feed failure (14.6). Storage lives behind the CalendarEventStore /
// NewsRiskFlagStore PORTs (17.1); the deterministic suppression is off any
// scoring / verdict path (the AI / Deterministic boundary).

export * from "./types.js";
export {
  ingestCalendar,
  riskFlag,
  suppress,
  failSafeSuppressAll,
  type NewsFilterClock,
  type IngestCalendarOptions,
  type FailSafeDeps,
  type FailSafeResult,
} from "./newsFilter.js";
