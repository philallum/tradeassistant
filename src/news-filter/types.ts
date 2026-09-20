// News Filter Types — calendar events, risk flags, suppression, and the
// fail-safe vocabulary (Requirement 14; Design Component 10 — News Filter).
//
// The News Filter is a SUPPRESSOR ONLY (Requirement 14.5): it can silence an
// otherwise-firing setup, but it can NEVER produce a Direction_Class. That
// invariant is expressed structurally here — the suppression decision type is a
// small `{ suppressed, reason }` shape with no direction anywhere on it.
//
// The AI / Deterministic boundary applies (Design "The AI / Deterministic
// Boundary"): the `news_filter` LLM role produces the structured
// `RiskFlag {level, reason}` DATA only. The deterministic `suppress()` consumes
// that plain `{ level, reason }` — it is not on a scoring / verdict path and
// never influences a probability or a direction.
//
// This file defines the module's typed vocabulary plus the two storage PORTs
// (mirroring the `calendar_events` and `news_risk_flags` tables) and their
// in-memory reference implementations, following the storage-port + in-memory
// reference pattern used across the codebase (e.g. `FeatureRegistryStore`,
// `RoleRejectionRecorder`, `CandleStore`).

import type { TradingDate } from "../guard/types.js";
import { PAIRS, type Pair } from "../ingestion/types.js";
import type { RiskFlag } from "../llm/types.js";

// Re-export the shared RiskFlag so consumers of the News Filter can import the
// structured flag shape from this module (it is defined in the LLM vocabulary,
// Requirement 14.2).
export type { RiskFlag } from "../llm/types.js";

// The five pairs the fail-safe suppresses (Requirement 14.6). Re-exported from
// the ingestion vocabulary so the "all five pairs" set has a single source of
// truth (EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD).
export { PAIRS, type Pair } from "../ingestion/types.js";

/**
 * Impact ratings a calendar feed may assign to an event. Kept as a small,
 * explicit union; `ingestCalendar()` validation rejects anything outside it.
 */
export const CALENDAR_IMPACTS = ["low", "medium", "high"] as const;

/** A calendar event impact rating (Requirement 14.1). */
export type CalendarImpact = (typeof CALENDAR_IMPACTS)[number];

/** Type guard for {@link CalendarImpact}. */
export function isCalendarImpact(value: unknown): value is CalendarImpact {
  return typeof value === "string" && (CALENDAR_IMPACTS as readonly string[]).includes(value);
}

/**
 * The RAW structured calendar JSON entry as supplied by a feed
 * (ForexFactory / FMP): `{ name, currency, impact, timestamp }`
 * (Requirement 14.1). Field names mirror the FEED, not storage — `name` maps to
 * `event_name` and `timestamp` maps to `event_ts` during ingestion. Every field
 * is `unknown` because the payload is untrusted until validated.
 */
export interface RawCalendarEntry {
  readonly name?: unknown;
  readonly currency?: unknown;
  readonly impact?: unknown;
  readonly timestamp?: unknown;
}

/**
 * A validated calendar event, keyed to mirror the `calendar_events` table
 * primary key `(decision_date, currency, event_name, event_ts)`
 * (Requirement 14.1). Produced by `ingestCalendar()` after validation; the feed
 * field names are mapped here (`name` → `eventName`, `timestamp` → `eventTs`).
 */
export interface CalendarEvent {
  /** The Decision_Date this event is ingested for (ISO-8601 YYYY-MM-DD). */
  readonly decisionDate: TradingDate;
  /** ISO-4217-style currency code the event pertains to (e.g. "USD"). */
  readonly currency: string;
  /** The event name (feed `name` → storage `event_name`). */
  readonly eventName: string;
  /** The event impact rating (Requirement 14.1). */
  readonly impact: CalendarImpact;
  /** The event timestamp, ISO-8601 (feed `timestamp` → storage `event_ts`). */
  readonly eventTs: string;
  /** The feed/source that supplied the event (mirrors `calendar_events.source`). */
  readonly source: string;
}

/**
 * A structural validation error for a single malformed calendar entry
 * (Requirement 14.1). `ingestCalendar()` rejects the malformed entry and, at the
 * feed level, a validation failure triggers the fail-safe (Requirement 14.6).
 */
export interface CalendarValidationError {
  readonly reason: "calendar_validation_error";
  /** The offending raw entry, echoed back for diagnostics. */
  readonly entry: unknown;
  /** Human-readable explanation of what failed validation. */
  readonly message: string;
}

/**
 * The deterministic suppression decision — a pure function of a {@link RiskFlag}
 * ONLY (Requirements 14.3, 14.5). It carries a suppress/permit boolean and the
 * recorded reason and NOTHING ELSE: there is deliberately no Direction_Class
 * field anywhere on this type, so the News Filter structurally cannot emit
 * UP / DOWN / FLAT (Requirement 14.5).
 */
export interface SuppressionDecision {
  /** True when the setup must be suppressed; false when trading is permitted. */
  readonly suppressed: boolean;
  /** The recorded reason (the flag's reason on suppression; a permit note otherwise). */
  readonly reason: string;
}

/**
 * The explicit calendar-feed failure modes handled by the fail-safe
 * (Requirement 14.6): the feed is `unavailable`, it `timeout`s, or its payload
 * fails validation (`invalid`).
 */
export const NEWS_FEED_FAILURE_MODES = ["unavailable", "timeout", "invalid"] as const;

/** A modelled calendar-feed failure mode (Requirement 14.6). */
export type NewsFeedFailureMode = (typeof NEWS_FEED_FAILURE_MODES)[number];

/**
 * A news-feed failure for a Decision_Date (Requirement 14.6). Signals the
 * fail-safe path: flag the missing context, log an ingestion error, and
 * suppress ALL five pairs for that date.
 */
export interface NewsFeedError {
  readonly reason: "news_feed_error";
  /** Which failure mode occurred (unavailable | timeout | invalid). */
  readonly mode: NewsFeedFailureMode;
  /** The Decision_Date the feed failed for. */
  readonly decisionDate: TradingDate;
  /** Human-readable explanation of the failure. */
  readonly message: string;
}

/**
 * A persisted news risk flag row, mirroring the `news_risk_flags` table primary
 * key `(decision_date, pair)` and columns `level`, `reason`, `feed_ok`
 * (Requirement 14.2, 14.6). `feedOk` is `false` on the fail-safe rows written
 * for every pair when the feed fails.
 */
export interface NewsRiskFlagRow {
  readonly decisionDate: TradingDate;
  readonly pair: Pair;
  readonly level: RiskFlag["level"];
  readonly reason: string;
  /** False when this row was written by the fail-safe (feed failure). */
  readonly feedOk: boolean;
}

// --- Ingestion-error logger PORT ------------------------------------------

/**
 * A logged ingestion error (Requirement 14.6, 17.1). The fail-safe records one
 * of these whenever the calendar feed is unavailable / times out / fails
 * validation for a Decision_Date.
 */
export interface IngestionErrorLog {
  /** The Decision_Date the feed failed for. */
  readonly decisionDate: TradingDate;
  /** Which failure mode occurred. */
  readonly mode: NewsFeedFailureMode;
  /** Human-readable explanation of the failure. */
  readonly message: string;
  /** When the error was logged (ISO-8601); injectable for deterministic tests. */
  readonly at: string;
}

/**
 * Recorder PORT for ingestion errors (Requirement 14.6, 17.1). The News Filter
 * depends only on this port, never on a logging backend directly — mirroring
 * the recorder-port pattern used across the codebase (e.g.
 * `RoleRejectionRecorder`, `BlockedScoringInputRecorder`). A real adapter can
 * persist to an audit sink; the in-memory reference implementation keeps the
 * fail-safe testable offline.
 */
export interface IngestionErrorRecorder {
  /** Persist a single ingestion-error record. */
  record(error: IngestionErrorLog): void;
  /** Read back all recorded ingestion errors in insertion order. */
  all(): readonly IngestionErrorLog[];
}

/**
 * In-memory reference implementation of {@link IngestionErrorRecorder}.
 * Deterministic and dependency-free; the reference behaviour for any persistent
 * adapter and the recorder used to exercise the fail-safe offline.
 */
export class InMemoryIngestionErrorRecorder implements IngestionErrorRecorder {
  readonly #records: IngestionErrorLog[] = [];

  record(error: IngestionErrorLog): void {
    this.#records.push(error);
  }

  all(): readonly IngestionErrorLog[] {
    return [...this.#records];
  }

  /** Test/inspection helper: number of recorded ingestion errors. */
  get size(): number {
    return this.#records.length;
  }

  clear(): void {
    this.#records.length = 0;
  }
}

// --- calendar_events storage PORT -----------------------------------------

/**
 * Storage PORT for the `calendar_events` table (Requirement 14.1, 17.1). The
 * News Filter depends only on this port, never on Supabase directly, keeping
 * compute independent of storage. Implementations upsert by the table's primary
 * key `(decision_date, currency, event_name, event_ts)`.
 */
export interface CalendarEventStore {
  /** Upsert validated events idempotently by (decisionDate, currency, eventName, eventTs). */
  upsertEvents(events: readonly CalendarEvent[]): Promise<void>;
  /** Read all stored events for a Decision_Date (order unspecified). */
  getEvents(decisionDate: TradingDate): Promise<readonly CalendarEvent[]>;
}

/**
 * In-memory reference implementation of {@link CalendarEventStore}. Upserts by
 * the same composite key as the SQL primary key, so re-ingesting the same event
 * is idempotent. Deterministic and dependency-free.
 */
export class InMemoryCalendarEventStore implements CalendarEventStore {
  // Key: `${decisionDate}|${currency}|${eventName}|${eventTs}` (the PK columns).
  readonly #events = new Map<string, CalendarEvent>();

  upsertEvents(events: readonly CalendarEvent[]): Promise<void> {
    for (const event of events) {
      this.#events.set(calendarEventKey(event), event);
    }
    return Promise.resolve();
  }

  getEvents(decisionDate: TradingDate): Promise<readonly CalendarEvent[]> {
    const results: CalendarEvent[] = [];
    for (const event of this.#events.values()) {
      if (event.decisionDate === decisionDate) {
        results.push(event);
      }
    }
    return Promise.resolve(results);
  }

  /** Test/inspection helper: total number of stored events. */
  get size(): number {
    return this.#events.size;
  }

  clear(): void {
    this.#events.clear();
  }
}

/** The composite storage key for a {@link CalendarEvent} (mirrors the SQL PK). */
export function calendarEventKey(event: CalendarEvent): string {
  return `${event.decisionDate}|${event.currency}|${event.eventName}|${event.eventTs}`;
}

// --- news_risk_flags storage PORT -----------------------------------------

/**
 * Storage PORT for the `news_risk_flags` table (Requirement 14.2, 14.6, 17.1).
 * The News Filter depends only on this port, never on Supabase directly.
 * Implementations upsert by the table's primary key `(decision_date, pair)`.
 */
export interface NewsRiskFlagStore {
  /** Upsert a single risk-flag row idempotently by (decisionDate, pair). */
  upsertFlag(row: NewsRiskFlagRow): Promise<void>;
  /** Read a single flag row by (decisionDate, pair), or null when absent. */
  getFlag(decisionDate: TradingDate, pair: Pair): Promise<NewsRiskFlagRow | null>;
  /** Read all recorded flag rows (order unspecified). */
  all(): Promise<readonly NewsRiskFlagRow[]>;
}

/**
 * In-memory reference implementation of {@link NewsRiskFlagStore}. Upserts by
 * `(decisionDate, pair)` exactly as the SQL primary key does. Deterministic and
 * dependency-free.
 */
export class InMemoryNewsRiskFlagStore implements NewsRiskFlagStore {
  // Key: `${decisionDate}|${pair}` (the PK columns).
  readonly #flags = new Map<string, NewsRiskFlagRow>();

  upsertFlag(row: NewsRiskFlagRow): Promise<void> {
    this.#flags.set(newsRiskFlagKey(row.decisionDate, row.pair), row);
    return Promise.resolve();
  }

  getFlag(decisionDate: TradingDate, pair: Pair): Promise<NewsRiskFlagRow | null> {
    return Promise.resolve(this.#flags.get(newsRiskFlagKey(decisionDate, pair)) ?? null);
  }

  all(): Promise<readonly NewsRiskFlagRow[]> {
    return Promise.resolve([...this.#flags.values()]);
  }

  /** Test/inspection helper: total number of stored flag rows. */
  get size(): number {
    return this.#flags.size;
  }

  clear(): void {
    this.#flags.clear();
  }
}

/** The composite storage key for a news risk flag (mirrors the SQL PK). */
export function newsRiskFlagKey(decisionDate: TradingDate, pair: Pair): string {
  return `${decisionDate}|${pair}`;
}

/**
 * The full ordered set of five pairs the fail-safe suppresses
 * (Requirement 14.6). A thin re-name over {@link PAIRS} kept here so the
 * "all five" intent reads clearly at the fail-safe call site.
 */
export const ALL_PAIRS: readonly Pair[] = PAIRS;
