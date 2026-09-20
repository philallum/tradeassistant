// External Signal Cross-Reference — fetch orchestration, fail-safe, and the
// outward-only display projection (Requirement 23; Design Component 17).
//
// This module lives entirely OUTSIDE the deterministic core. Its inputs are a
// swappable `ExternalSignalProvider` (Requirement 23.4) and the list of pairs;
// its output is a set of `ReferenceOutcome`s and a display projection the
// dashboard renders BESIDE each pair's own output (Requirements 23.1, 23.7).
//
// Nothing here produces or consumes a Direction_Class, an Earned_Confidence, a
// probability, or a Kill_Gate verdict. The reference is fetched at daily-run
// time as a CURRENT third-party opinion only (Requirement 23.6) — it is never
// used for a historical backtest or gate evaluation, which would be look-ahead
// contamination. Including or omitting this module leaves every computed
// probability and verdict identical (Requirements 23.2, 23.3).

import type { TradingDate } from "../guard/types.js";
import type { DirectionClass } from "../retrieval/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { LivingDocs } from "../living-docs/livingDocs.js";
import {
  isReferenceDirection,
  type ExternalReferenceSignal,
  type ExternalSignalConfig,
  type ExternalSignalError,
  type ExternalSignalProvider,
  type ReferenceDirection,
  type ReferenceOutcome,
} from "./types.js";
import { DEFAULT_EXTERNAL_SIGNAL_TIMEOUT_MS } from "./types.js";

/**
 * Clock PORT so `fetchedAt` provenance is injectable and tests stay
 * deterministic. Defaults to the system clock in production.
 */
export interface ExternalSignalClock {
  now(): string;
}

const systemClock: ExternalSignalClock = { now: () => new Date().toISOString() };

/** Build an {@link ExternalSignalError} for a pair. */
function fail(
  pair: Pair,
  mode: ExternalSignalError["mode"],
  message: string,
): ExternalSignalError {
  return { reason: "external_signal_error", mode, pair, message };
}

/**
 * Validate a value returned by a provider adapter into an
 * {@link ExternalReferenceSignal}, or produce an `invalid` failure
 * (Requirement 23.5). Untrusted provider payloads are checked structurally:
 * `direction` must be a valid {@link ReferenceDirection} and `score`, when
 * present, must be a finite number. `pair`, `decisionDate`, `provider`, and
 * `fetchedAt` are stamped by the orchestrator so a misbehaving adapter cannot
 * spoof them.
 */
function normalizeSignal(
  raw: ExternalReferenceSignal,
  pair: Pair,
  decisionDate: TradingDate,
  provider: string,
  fetchedAt: string,
): { readonly ok: true; readonly signal: ExternalReferenceSignal } | {
  readonly ok: false;
  readonly error: ExternalSignalError;
} {
  if (!isReferenceDirection(raw.direction)) {
    return {
      ok: false,
      error: fail(pair, "invalid", `provider returned an invalid direction: ${String(raw.direction)}`),
    };
  }
  if (raw.score !== undefined && !Number.isFinite(raw.score)) {
    return {
      ok: false,
      error: fail(pair, "invalid", `provider returned a non-finite score: ${String(raw.score)}`),
    };
  }
  const signal: ExternalReferenceSignal = {
    pair,
    decisionDate,
    direction: raw.direction,
    ...(raw.score !== undefined ? { score: raw.score } : {}),
    provider,
    fetchedAt,
  };
  return { ok: true, signal };
}

/**
 * Race a provider fetch against a timeout (Requirement 23.5). A fetch that does
 * not settle within `timeoutMs` resolves to a typed `timeout` failure rather
 * than hanging the daily run.
 */
async function withTimeout(
  work: Promise<
    import("../guard/types.js").Result<ExternalReferenceSignal, ExternalSignalError>
  >,
  timeoutMs: number,
  pair: Pair,
): Promise<import("../guard/types.js").Result<ExternalReferenceSignal, ExternalSignalError>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<
    import("../guard/types.js").Result<ExternalReferenceSignal, ExternalSignalError>
  >((resolve) => {
    timer = setTimeout(() => {
      resolve({ ok: false, error: fail(pair, "timeout", `provider fetch exceeded ${timeoutMs}ms`) });
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Fetch the CURRENT External_Reference_Signal for a single pair through the
 * swappable provider, applying the timeout and validating the response
 * (Requirements 23.4, 23.5, 23.6). Any provider rejection, timeout, or invalid
 * payload becomes a typed {@link ExternalSignalError}; the reference is marked
 * unavailable and the system's own output is untouched. This function never
 * throws.
 */
export async function fetchReferenceForPair(
  provider: ExternalSignalProvider,
  pair: Pair,
  decisionDate: TradingDate,
  config: ExternalSignalConfig,
  clock: ExternalSignalClock = systemClock,
): Promise<ReferenceOutcome> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_EXTERNAL_SIGNAL_TIMEOUT_MS;

  let result: import("../guard/types.js").Result<ExternalReferenceSignal, ExternalSignalError>;
  try {
    const work = Promise.resolve(provider.fetchReference(pair, decisionDate));
    result = await withTimeout(work, timeoutMs, pair);
  } catch (cause) {
    // A provider that throws/rejects is treated as unavailable (fail-safe).
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { pair, available: false, error: fail(pair, "unavailable", `provider threw: ${detail}`) };
  }

  if (!result.ok) {
    return { pair, available: false, error: result.error };
  }

  const normalized = normalizeSignal(
    result.value,
    pair,
    decisionDate,
    config.provider,
    clock.now(),
  );
  if (!normalized.ok) {
    return { pair, available: false, error: normalized.error };
  }
  return { pair, available: true, signal: normalized.signal };
}

/**
 * Fetch the External_Reference_Signal for every one of the five pairs at
 * daily-run time (Requirement 23.1). Returns one {@link ReferenceOutcome} per
 * pair in the canonical {@link PAIRS} order. Each pair's fetch is independent
 * and fail-safe: a failure for one pair marks only that pair's reference
 * unavailable and never affects another pair or the system's own output
 * (Requirement 23.5). Never throws.
 */
export async function fetchAllReferences(
  provider: ExternalSignalProvider,
  decisionDate: TradingDate,
  config: ExternalSignalConfig,
  clock: ExternalSignalClock = systemClock,
): Promise<readonly ReferenceOutcome[]> {
  const outcomes = await Promise.all(
    PAIRS.map((pair) => fetchReferenceForPair(provider, pair, decisionDate, config, clock)),
  );
  return outcomes;
}

// --- Display projection (outward-only, beside the pair's own output) -------

/** The display marker shown when the reference is unavailable (Requirement 23.5). */
export const REFERENCE_UNAVAILABLE = "reference unavailable" as const;

/**
 * How the system's own directional output compares to the provider's reference
 * recommendation for a pair (Requirement 23.7). This is a HUMAN-COMPARISON
 * projection only: it is computed for display and is never fed back into any
 * scoring or decision path.
 *
 *   - `agree`     — both point the same way (own UP ↔ ref BUY, own DOWN ↔ ref SELL)
 *   - `diverge`   — they point opposite ways (own UP ↔ ref SELL, own DOWN ↔ ref BUY)
 *   - `neutral`   — at least one expresses no directional view (own FLAT, or ref HOLD)
 *   - `unavailable` — no reference was fetched for the pair
 */
export type ReferenceComparison = "agree" | "diverge" | "neutral" | "unavailable";

/**
 * The outward-only display row shown BESIDE a pair's own output on the dashboard
 * (Requirements 23.1, 23.7). Carries the fetched reference fields (or the
 * unavailable marker) plus the agreement/divergence tag for at-a-glance human
 * comparison. Nothing on this row re-enters a scoring path.
 */
export interface ReferenceDisplay {
  readonly pair: Pair;
  /** True when a reference was fetched for the pair. */
  readonly available: boolean;
  /** The provider's recommendation, or `null` when unavailable. */
  readonly direction: ReferenceDirection | null;
  /** The provider's own score, or `null` when unavailable/absent. */
  readonly score: number | null;
  /** Provider provenance tag, or `null` when unavailable. */
  readonly provider: string | null;
  /** ISO fetch timestamp, or `null` when unavailable. */
  readonly fetchedAt: string | null;
  /** The system's own Direction_Class for the pair, when supplied for comparison. */
  readonly ownDirection: DirectionClass | null;
  /** Agreement/divergence versus the system's own output (Requirement 23.7). */
  readonly comparison: ReferenceComparison;
  /** A single deterministic display line, e.g. "EURUSD ref: BUY (score 0.7) — diverge". */
  readonly display: string;
}

/** Map a system Direction_Class to the reference direction it agrees with. */
function agreeingReference(own: DirectionClass): ReferenceDirection | null {
  if (own === "UP") return "BUY";
  if (own === "DOWN") return "SELL";
  return null; // FLAT expresses no directional view
}

/**
 * Classify agreement/divergence between the system's own Direction_Class and the
 * provider's reference direction, for human comparison only (Requirement 23.7).
 */
export function compareToOwn(
  ownDirection: DirectionClass | undefined,
  reference: ReferenceDirection | null,
): ReferenceComparison {
  if (reference === null) return "unavailable";
  if (ownDirection === undefined || ownDirection === "FLAT" || reference === "HOLD") {
    return "neutral";
  }
  return agreeingReference(ownDirection) === reference ? "agree" : "diverge";
}

/** Format the reference score for display, or omit when absent. */
function formatScore(score: number | null): string {
  return score === null ? "" : ` (score ${score})`;
}

/**
 * Project a per-pair {@link ReferenceOutcome} into an outward-only
 * {@link ReferenceDisplay} to render beside the pair's own output
 * (Requirements 23.1, 23.7). `ownDirection`, when provided, is the system's own
 * Direction_Class for the pair; it is used ONLY to compute the human-facing
 * agreement/divergence tag and is never altered by the reference.
 *
 * Pure and deterministic given its inputs (the only non-deterministic value,
 * `fetchedAt`, is carried straight through from the already-fetched outcome).
 */
export function toReferenceDisplay(
  outcome: ReferenceOutcome,
  ownDirection?: DirectionClass,
): ReferenceDisplay {
  const own = ownDirection ?? null;

  if (!outcome.available) {
    return {
      pair: outcome.pair,
      available: false,
      direction: null,
      score: null,
      provider: null,
      fetchedAt: null,
      ownDirection: own,
      comparison: "unavailable",
      display: `${outcome.pair} ref: ${REFERENCE_UNAVAILABLE} (${outcome.error.mode})`,
    };
  }

  const { signal } = outcome;
  const score = signal.score ?? null;
  const comparison = compareToOwn(ownDirection, signal.direction);
  const display = `${signal.pair} ref: ${signal.direction}${formatScore(score)} [${signal.provider}] — ${comparison}`;

  return {
    pair: signal.pair,
    available: true,
    direction: signal.direction,
    score,
    provider: signal.provider,
    fetchedAt: signal.fetchedAt,
    ownDirection: own,
    comparison,
    display,
  };
}

/**
 * Project every per-pair {@link ReferenceOutcome} into its display row
 * (Requirements 23.1, 23.7). `ownDirections` optionally supplies the system's
 * own Direction_Class per pair for the agreement/divergence tag; a pair absent
 * from the map is compared as `neutral`/`unavailable`. Preserves input order.
 */
export function toReferenceDisplays(
  outcomes: readonly ReferenceOutcome[],
  ownDirections?: ReadonlyMap<Pair, DirectionClass>,
): readonly ReferenceDisplay[] {
  return outcomes.map((outcome) => {
    const own = ownDirections?.get(outcome.pair);
    return own === undefined
      ? toReferenceDisplay(outcome)
      : toReferenceDisplay(outcome, own);
  });
}

// --- Optional research-log comparison logging (display/research-only) ------

/**
 * OPTIONALLY log the agreement/divergence comparison to the Research_Log for
 * later human divergence analysis (Requirement 23; design Component 17). This is
 * DISPLAY/RESEARCH-ONLY: it appends a human-readable note and never feeds
 * scoring, retrieval, or the Kill_Gate. The note is written to PROJECT-STATE via
 * the {@link LivingDocs} state block so it does not masquerade as a Kill_Gate
 * verdict entry (which has its own strict template).
 *
 * Callers that do not want any logging simply omit this call — logging is
 * entirely optional and has no effect on the computed outputs.
 */
export async function logComparison(
  livingDocs: LivingDocs,
  decisionDate: TradingDate,
  displays: readonly ReferenceDisplay[],
  clock: ExternalSignalClock = systemClock,
): Promise<void> {
  const summary = displays.map((d) => `${d.pair}=${d.comparison}`).join(", ");
  await livingDocs.updateState({
    phase: "External reference cross-check",
    summary: `External reference comparison for ${decisionDate} (research-only, never feeds scoring): ${summary}`,
    updatedAt: clock.now(),
  });
}
