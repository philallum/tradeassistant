// OHLC_Feed_Provider module public API — Design Components 1–2 (Requirement 1).
//
// The runtime adapter layer that fetches daily OHLC candles from a third-party
// provider over the built-in `fetch` (no SDK) for the Candle_Freshness_Stage.
// A thin, swappable `OhlcFeedProvider` port with a capability model
// (`supportsLatest` / `supportsRange`), two concrete adapters (Twelve Data and
// Massive, both hourly-derived NY-close candles), a secret-free `OhlcFeedError`,
// an env-driven config reader (`ohlcFeedConfigFromEnv`, keys by name only), and a
// `Provider_Fallback_Chain` resolver (Twelve Data → Massive,
// first-usable-wins per pair). Every output goes through the existing
// `OhlcIngestion` path — this layer never bypasses validation or upsert.

export {
  OHLC_FEED_FAILURE_MODES,
  ohlcFeedConfigFromEnv,
  TWELVE_DATA_DEFAULT_BASE_URL,
  MASSIVE_DEFAULT_BASE_URL,
  type OhlcFeedFailureMode,
  type OhlcFeedError,
  type OhlcFeedProvider,
  type OhlcProviderConfig,
  type OhlcFeedConfig,
} from "./types.js";
export { TwelveDataOhlcFeedProvider, toTwelveDataSymbol } from "./twelveDataOhlcProvider.js";
export { MassiveOhlcFeedProvider, toMassiveTicker } from "./massiveOhlcProvider.js";
export {
  buildProviderChain,
  chainFromProviders,
  isResolved,
  type ProviderChain,
  type ResolveOutcome,
  type ResolvedCandles,
} from "./providerChain.js";
