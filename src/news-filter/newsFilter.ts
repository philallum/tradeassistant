// News Filter — calendar ingestion, LLM risk flag, deterministic suppression,
// and the feed fail-safe (Requirement 14; Design Component 10 — News Filter).
//
// The pipeline has a strict AI / Deterministic boundary (Design "The AI /
// Deterministic Boundary"):
//
//   ingestCalendar(rawJson)  → validate feed JSON → CalendarEvent[]        (Req 14.1)
//   riskFlag(date, events)   → LLM_Interface.invoke("news_filter", …)      (Req 14.2)
//                              → structured RiskFlag { level, reason }
//   suppress(flag)           → PURE deterministic decision from the flag   (Req 14.3–14.5)
//                              → { suppressed, reason }  (NEVER a direction)
//   failSafeSuppressAll(...) → on feed failure: flag missing context, log   (Req 14.6)
//                              an ingestion error, suppress ALL five pairs
//
// The LLM produces only the RiskFlag DATA. `suppress()` consumes only the plain
// `{ level, reason }` — it is not on a scoring / verdict path and it can never
// emit a Direction_Class (the SuppressionDecision type has no direction field).

import type { TradingDate } from "../guard/types.js";
import type { LlmInterface } from "../llm/llmInterface.js";
import type { NewsFilterInput, RiskFlag } from "../llm/types.js";
import {
  ALL_PAIRS,
  isCalendarImpact,
  type CalendarEvent,
  type CalendarEventStore,
  type CalendarValidationError,
  type IngestionErrorRecorder,
  type NewsFeedError,
  type NewsFeedFailureMode,
  type NewsRiskFlagRow,
  type NewsRiskFlagStore,
  type RawCalendarEntry,
  type SuppressionDecision,
} from "./types.js";
import { err, ok, type Result } from "../guard/types.js";

/**
 * Clock PORT so timestamps on ingestion-error records are injectable and tests
 * stay deterministic. Defaults to the system clock in production. Named
 * `NewsFilterClock` to avoid a barrel collision with the LLM module's `Clock`.
 */
export interface NewsFilterClock {
  now(): string;
}

const systemClock: NewsFilterClock = { now: () => new Date().toISOString() };

// --- ingestCalendar --------------------------------------------------------

/**
 * Validate a single raw calendar entry into a {@link CalendarEvent}
 * (Requirement 14.1). Rejects malformed entries: `name`, `currency`, and
 * `timestamp` must be non-empty strings and `impact` must be one of the known
 * ratings. Maps the feed field names to storage (`name` → `eventName`,
 * `timestamp` → `eventTs`).
 */
function validateEntry(
  entry: RawCalendarEntry,
  decisionDate: TradingDate,
  source: string,
): Result<CalendarEvent, CalendarValidationError> {
  const fail = (message: string): Result<CalendarEvent, CalendarValidationError> =>
    err({ reason: "calendar_validation_error", entry, message });

  const { name, currency, impact, timestamp } = entry;

  if (typeof name !== "string" || name.trim() === "") {
    return fail("calendar entry `name` must be a non-empty string");
  }
  if (typeof currency !== "string" || currency.trim() === "") {
    return fail("calendar entry `currency` must be a non-empty string");
  }
  if (!isCalendarImpact(impact)) {
    return fail('calendar entry `impact` must be one of "low" | "medium" | "high"');
  }
  if (typeof timestamp !== "string" || timestamp.trim() === "") {
    return fail("calendar entry `timestamp` must be a non-empty ISO-8601 string");
  }

  return ok({
    decisionDate,
    currency,
    eventName: name,
    impact,
    eventTs: timestamp,
    source,
  });
}

/** Options for {@link ingestCalendar}. */
export interface IngestCalendarOptions {
  /** The Decision_Date the events are ingested for. */
  readonly decisionDate: TradingDate;
  /** The feed/source label recorded on each event (mirrors `calendar_events.source`). */
  readonly source: string;
}

/**
 * Parse and VALIDATE structured calendar JSON into {@link CalendarEvent} rows
 * and upsert them to the {@link CalendarEventStore} (Requirement 14.1).
 *
 * The input `rawJson` is a JSON string OR an already-parsed array of
 * `{ name, currency, impact, timestamp }` entries. Validation is STRICT: if the
 * JSON does not parse, is not an array, or ANY entry is malformed, ingestion
 * fails with a {@link NewsFeedError} of mode `"invalid"` — the caller's
 * fail-safe (see {@link failSafeSuppressAll}) then flags the missing context,
 * logs the ingestion error, and suppresses all five pairs (Requirement 14.6).
 *
 * On success, all validated events are upserted (idempotent by the composite
 * key) and returned.
 */
export async function ingestCalendar(
  rawJson: string | readonly unknown[],
  store: CalendarEventStore,
  options: IngestCalendarOptions,
): Promise<Result<readonly CalendarEvent[], NewsFeedError>> {
  const invalid = (message: string): Result<readonly CalendarEvent[], NewsFeedError> =>
    err({
      reason: "news_feed_error",
      mode: "invalid",
      decisionDate: options.decisionDate,
      message,
    });

  let parsed: unknown;
  if (typeof rawJson === "string") {
    try {
      parsed = JSON.parse(rawJson);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return invalid(`calendar JSON failed to parse: ${detail}`);
    }
  } else {
    parsed = rawJson;
  }

  if (!Array.isArray(parsed)) {
    return invalid("calendar JSON must be an array of calendar entries");
  }

  const events: CalendarEvent[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) {
      return invalid("calendar entry must be a JSON object");
    }
    const result = validateEntry(raw as RawCalendarEntry, options.decisionDate, options.source);
    if (!result.ok) {
      return invalid(result.error.message);
    }
    events.push(result.value);
  }

  await store.upsertEvents(events);
  return ok(events);
}

// --- riskFlag --------------------------------------------------------------

/**
 * Ask the `news_filter` LLM role for a structured {@link RiskFlag} for a
 * Decision_Date and persist it per pair (Requirement 14.2).
 *
 * The call routes through the {@link LlmInterface} (Requirements 2.3/2.4), which
 * returns the flag wrapped in an `LlmTagged<RiskFlag>`. We UNWRAP the tagged
 * value here and return the plain `{ level, reason }` DATA: only that data
 * crosses into the deterministic {@link suppress}, and it never influences a
 * Direction_Class. The unwrapped flag is persisted to the
 * {@link NewsRiskFlagStore} for every pair (a per-pair risk flag with
 * `feedOk = true`), matching the `news_risk_flags` table.
 */
export async function riskFlag(
  decisionDate: TradingDate,
  events: NewsFilterInput["events"],
  llm: LlmInterface,
  store: NewsRiskFlagStore,
): Promise<RiskFlag> {
  const tagged = await llm.invoke("news_filter", { decisionDate, events });
  // Unwrap the LLM-tagged value: only the { level, reason } DATA proceeds. The
  // provenance brand stays behind, so nothing tagged can leak downstream.
  const flag: RiskFlag = { level: tagged.value.level, reason: tagged.value.reason };

  for (const pair of ALL_PAIRS) {
    const row: NewsRiskFlagRow = {
      decisionDate,
      pair,
      level: flag.level,
      reason: flag.reason,
      feedOk: true,
    };
    await store.upsertFlag(row);
  }

  return flag;
}

// --- suppress (PURE, deterministic) ---------------------------------------

/**
 * The deterministic suppression policy — a PURE function of the
 * {@link RiskFlag} ONLY (Requirements 14.3, 14.5).
 *
 * Policy: an `"elevated"` or `"high"` risk level SUPPRESSES; `"none"` PERMITS.
 * On suppression the flag's stated `reason` is recorded on the decision
 * (Requirement 14.4). The return type is a small `{ suppressed, reason }` — it
 * has NO Direction_Class field, so the News Filter structurally cannot emit
 * UP / DOWN / FLAT (Requirement 14.5). This function performs no I/O and has no
 * dependency on a pair, a date, or any deterministic scoring input: identical
 * flags always yield identical decisions.
 */
export function suppress(flag: RiskFlag): SuppressionDecision {
  const suppressed = flag.level === "elevated" || flag.level === "high";
  return suppressed
    ? { suppressed: true, reason: flag.reason }
    : { suppressed: false, reason: "news filter permits trading (risk level none)" };
}

// --- Fail-safe (Requirement 14.6) -----------------------------------------

/** Dependencies for the fail-safe path. */
export interface FailSafeDeps {
  /** Persists the suppressed, feed-not-ok flag for every pair. */
  readonly flagStore: NewsRiskFlagStore;
  /** Logs the ingestion error (Requirement 14.6). */
  readonly errorRecorder: IngestionErrorRecorder;
  /** Injectable clock; defaults to the system clock. */
  readonly clock?: NewsFilterClock;
}

/** The recorded outcome of a fail-safe suppression. */
export interface FailSafeResult {
  /** The Decision_Date suppressed. */
  readonly decisionDate: TradingDate;
  /** Which feed failure mode triggered the fail-safe. */
  readonly mode: NewsFeedFailureMode;
  /** The suppressed flag rows written for all five pairs (feedOk = false). */
  readonly suppressedFlags: readonly NewsRiskFlagRow[];
}

/**
 * The FAIL-SAFE (Requirement 14.6): when the calendar feed is unavailable,
 * times out, or fails validation for a Decision_Date, (a) FLAG the missing news
 * context, (b) LOG an ingestion error via the injected recorder, and
 * (c) SUPPRESS ALL FIVE pairs for that Decision_Date by persisting a suppressed
 * `news_risk_flags` row with `feed_ok = false` (`level = "high"`) for each pair.
 *
 * The suppression is total and explicit: {@link ALL_PAIRS} is the single source
 * of truth for the five pairs, so every one of EURUSD, GBPUSD, USDJPY, USDCHF,
 * USDCAD is silenced for the date. Returns the recorded rows for inspection.
 */
export async function failSafeSuppressAll(
  feedError: NewsFeedError,
  deps: FailSafeDeps,
): Promise<FailSafeResult> {
  const clock = deps.clock ?? systemClock;
  const { decisionDate, mode } = feedError;

  // (b) Log the ingestion error and flag the missing context.
  const reason = `news feed ${mode} for ${decisionDate}: ${feedError.message}; missing news context — all pairs suppressed (fail-safe)`;
  deps.errorRecorder.record({
    decisionDate,
    mode,
    message: feedError.message,
    at: clock.now(),
  });

  // (c) Suppress ALL five pairs with feed_ok = false.
  const suppressedFlags: NewsRiskFlagRow[] = [];
  for (const pair of ALL_PAIRS) {
    const row: NewsRiskFlagRow = {
      decisionDate,
      pair,
      level: "high",
      reason,
      feedOk: false,
    };
    await deps.flagStore.upsertFlag(row);
    suppressedFlags.push(row);
  }

  return { decisionDate, mode, suppressedFlags };
}
