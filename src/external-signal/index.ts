// External Signal Cross-Reference module public API — Component 17
// (Requirement 23).
//
// A DISPLAY / RESEARCH-ONLY cross-reference that sits entirely OUTSIDE the
// deterministic core. A thin, swappable `ExternalSignalProvider` (23.4) fetches
// the CURRENT third-party recommendation per pair at daily-run time (23.1,
// 23.6); the orchestrator wraps each result as an `ExternalReferenceSignal` with
// a provider provenance tag and fetch timestamp, and is FAIL-SAFE: on
// unavailable/timeout/invalid it marks that pair's reference unavailable via a
// typed `ExternalSignalError` and leaves the system's own output unchanged
// (23.5). The reference is never an input to the directional probability,
// Earned_Confidence, Direction_Class, Kill_Gate verdict, retrieval, or any
// scoring/decision path (23.2, 23.3): the only value that leaves is an
// outward-only display projection rendered beside the pair's own output for
// human agreement/divergence comparison (23.7), with optional research-only
// comparison logging that never feeds scoring.

export * from "./types.js";
export {
  fetchReferenceForPair,
  fetchAllReferences,
  toReferenceDisplay,
  toReferenceDisplays,
  compareToOwn,
  logComparison,
  REFERENCE_UNAVAILABLE,
  type ExternalSignalClock,
  type ReferenceComparison,
  type ReferenceDisplay,
} from "./externalSignal.js";
export {
  InMemoryExternalSignalProvider,
  type SeededReference,
} from "./inMemoryProvider.js";
export {
  FcsExternalSignalProvider,
  directionFromChangePercent,
  FCS_DEFAULT_BASE_URL,
} from "./fcsProvider.js";
