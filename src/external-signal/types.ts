// External Signal Cross-Reference Types — Design Component 17 (Requirement 23).
//
// A DISPLAY / RESEARCH-ONLY component that sits entirely OUTSIDE the
// deterministic core. It fetches a third-party technical-analysis opinion for a
// Pair (a recommended direction plus the provider's own score) so the dashboard
// can show it side-by-side with the system's own output for human comparison
// (Requirements 23.1, 23.7).
//
// The reference is NEVER an input to the directional probability,
// Earned_Confidence, Direction_Class classification, the Kill_Gate verdict,
// retrieval, or any other scoring / decision path (Requirements 23.2, 23.3).
// The types here are deliberately isolated from the deterministic-core
// vocabulary: nothing in this module is accepted by a scoring function, and the
// only value that ever leaves is an outward-only display projection. Including
// or omitting the reference leaves every computed probability and verdict
// byte-for-byte identical.

import type { TradingDate } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";

// The five pairs cross-referenced at daily-run time (Requirement 23.1). A thin
// re-export so this module has a single source of truth for "the five pairs".
export { PAIRS, type Pair } from "../ingestion/types.js";

/**
 * A third-party provider's recommended stance for a Pair. `HOLD` is the
 * provider's own "no strong view" recommendation and is distinct from the
 * system's `Direction_Class` (this union is intentionally NOT the deterministic
 * `DirectionClass`, so a reference value can never be mistaken for one).
 */
export type ReferenceDirection = "BUY" | "SELL" | "HOLD";

/** The set of valid reference directions, for validation. */
export const REFERENCE_DIRECTIONS = ["BUY", "SELL", "HOLD"] as const;

/** Type guard for a {@link ReferenceDirection}. */
export function isReferenceDirection(value: unknown): value is ReferenceDirection {
  return typeof value === "string" && (REFERENCE_DIRECTIONS as readonly string[]).includes(value);
}

/**
 * A fetched External_Reference_Signal for a Pair (Requirement 23.1). Carries the
 * provider's recommended direction, its optional own score, a provider
 * provenance tag, and the fetch timestamp.
 *
 * `fetchedAt` is a wall-clock ISO timestamp and is therefore NON-deterministic;
 * it exists purely as display/audit provenance and, like every field here,
 * never reaches a scoring or verdict computation (Requirements 23.2, 23.3).
 */
export interface ExternalReferenceSignal {
  readonly pair: Pair;
  /** The Decision_Date the reference is shown alongside (ISO YYYY-MM-DD). */
  readonly decisionDate: TradingDate;
  /** The provider's recommendation. */
  readonly direction: ReferenceDirection;
  /** The provider's own confidence/score on a provider-defined scale (optional). */
  readonly score?: number;
  /** Provider provenance tag, e.g. the configured `EXTERNAL_SIGNAL_PROVIDER`. */
  readonly provider: string;
  /** ISO-8601 fetch timestamp (non-deterministic; display-only). */
  readonly fetchedAt: string;
}

/**
 * The modelled failure modes for the external signal provider (Requirement
 * 23.5): the provider is `unavailable`, it `timeout`s, or it returns an
 * `invalid` response. On any of these the reference is marked unavailable for
 * the Pair and the system's own output is left unchanged.
 */
export const EXTERNAL_SIGNAL_FAILURE_MODES = ["unavailable", "timeout", "invalid"] as const;

/** A modelled external-signal failure mode (Requirement 23.5). */
export type ExternalSignalFailureMode = (typeof EXTERNAL_SIGNAL_FAILURE_MODES)[number];

/**
 * A typed external-signal failure for a Pair (Requirement 23.5). Surfaced as
 * the error side of the provider's `Result`; the orchestrator turns it into a
 * "reference unavailable" display marker and never a silent substitution.
 */
export interface ExternalSignalError {
  readonly reason: "external_signal_error";
  /** Which failure mode occurred (unavailable | timeout | invalid). */
  readonly mode: ExternalSignalFailureMode;
  /** The Pair the fetch failed for. */
  readonly pair: Pair;
  /** Human-readable explanation of the failure. */
  readonly message: string;
}

/**
 * The thin, swappable provider PORT — Design Component 17 (Requirement 23.4).
 *
 * A concrete provider (an FX signals API adapter) implements only this method,
 * so the vendor behind the `EXTERNAL_SIGNAL_PROVIDER` / `EXTERNAL_SIGNAL_API_KEY`
 * / `EXTERNAL_SIGNAL_BASE_URL` env contract can be swapped without touching any
 * other component. `fetchReference` fetches the CURRENT reference for a pair; it
 * is display/research-only and is never called for a historical backtest or a
 * Kill_Gate evaluation (Requirement 23.6).
 *
 * Note the return type: a `Result<ExternalReferenceSignal, ExternalSignalError>`
 * from the `guard` vocabulary, NOT anything from a scoring path. The provider
 * cannot, by its type, hand a value to a scoring function.
 */
export interface ExternalSignalProvider {
  fetchReference(
    pair: Pair,
    decisionDate: TradingDate,
  ): Promise<import("../guard/types.js").Result<ExternalReferenceSignal, ExternalSignalError>>;
}

/**
 * The env-var contract for the external signal provider (design "External Data
 * Providers & Configuration"). The slot is OPTIONAL and display/research-only:
 * when `provider` is absent the cross-reference is simply not fetched and the
 * dashboard renders every pair with a "reference unavailable" marker, leaving
 * the system's own output unchanged.
 */
export interface ExternalSignalConfig {
  /** `EXTERNAL_SIGNAL_PROVIDER` — the provider provenance tag / vendor slug. */
  readonly provider: string;
  /** `EXTERNAL_SIGNAL_API_KEY` — provider credential (optional). */
  readonly apiKey?: string;
  /** `EXTERNAL_SIGNAL_BASE_URL` — provider base URL (optional). */
  readonly baseUrl?: string;
  /**
   * Per-pair fetch timeout in milliseconds; a fetch exceeding it is treated as
   * a `timeout` failure (Requirement 23.5). Defaults to
   * {@link DEFAULT_EXTERNAL_SIGNAL_TIMEOUT_MS}.
   */
  readonly timeoutMs?: number;
}

/** The default per-pair fetch timeout for the external signal provider. */
export const DEFAULT_EXTERNAL_SIGNAL_TIMEOUT_MS = 5_000 as const;

/**
 * Read the external-signal env-var contract into an {@link ExternalSignalConfig}
 * (design "External Data Providers & Configuration"). Returns `null` when
 * `EXTERNAL_SIGNAL_PROVIDER` is unset — the slot is OPTIONAL, so an absent
 * provider means the cross-reference is simply not fetched.
 *
 * Pure with respect to the injected `env` map (defaults to `process.env`), so it
 * is testable offline without touching the real environment.
 */
export function externalSignalConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExternalSignalConfig | null {
  const provider = env.EXTERNAL_SIGNAL_PROVIDER?.trim();
  if (provider === undefined || provider === "") {
    return null;
  }
  const apiKey = env.EXTERNAL_SIGNAL_API_KEY?.trim();
  const baseUrl = env.EXTERNAL_SIGNAL_BASE_URL?.trim();
  const timeoutRaw = env.EXTERNAL_SIGNAL_TIMEOUT_MS?.trim();
  const parsedTimeout = timeoutRaw === undefined || timeoutRaw === "" ? NaN : Number(timeoutRaw);
  const timeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0
      ? parsedTimeout
      : DEFAULT_EXTERNAL_SIGNAL_TIMEOUT_MS;

  return {
    provider,
    ...(apiKey !== undefined && apiKey !== "" ? { apiKey } : {}),
    ...(baseUrl !== undefined && baseUrl !== "" ? { baseUrl } : {}),
    timeoutMs,
  };
}

/**
 * The per-pair cross-reference outcome the dashboard renders BESIDE the pair's
 * own output (Requirements 23.1, 23.7). It is a small tagged union: either the
 * fetched {@link ExternalReferenceSignal} is `available`, or the reference is
 * `unavailable` with the typed {@link ExternalSignalError} that explains why
 * (Requirement 23.5). This is the ONLY value that leaves the module toward the
 * view; it carries no deterministic-core type and reaches no scoring path.
 */
export type ReferenceOutcome =
  | { readonly pair: Pair; readonly available: true; readonly signal: ExternalReferenceSignal }
  | { readonly pair: Pair; readonly available: false; readonly error: ExternalSignalError };
