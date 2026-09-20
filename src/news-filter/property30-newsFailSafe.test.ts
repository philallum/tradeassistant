import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { failSafeSuppressAll, ingestCalendar } from "./newsFilter.js";
import {
  ALL_PAIRS,
  InMemoryCalendarEventStore,
  InMemoryIngestionErrorRecorder,
  InMemoryNewsRiskFlagStore,
  NEWS_FEED_FAILURE_MODES,
  PAIRS,
  type NewsFeedError,
  type NewsFeedFailureMode,
} from "./types.js";

// Feature: fx-daily-pattern-assistant, Property 30: For all feed-failure modes (unavailable, timeout, or failed validation) on a Decision_Date, the missing news context is flagged, an ingestion error is logged, and every one of the five Pairs is suppressed for that Decision_Date.
//
// Validates: Requirement 14.6.
//
// This is the MANDATED NAMED "news fail-safe" property test. It drives
// `failSafeSuppressAll` across arbitrary failure modes, Decision_Dates, and
// failure messages, asserting the three obligations of Requirement 14.6:
//   (1) exactly one ingestion error is logged (matching date + mode),
//   (2) the missing news context is flagged (reason references missing context
//       and the failure mode), and
//   (3) every one of the five Pairs is suppressed (feedOk === false, and
//       result.suppressedFlags covers all five pairs).
// A dedicated case also drives the "failed validation" mode through the REAL
// ingestion path (ingestCalendar → invalid NewsFeedError → failSafeSuppressAll).

/** A clock that returns a fixed timestamp so ingestion-error records are deterministic. */
const fixedClock = { now: () => "2026-03-16T12:00:00.000Z" };

/** Arbitrary Decision_Date string built from a bounded day-offset (always a valid YYYY-MM-DD). */
const decisionDateArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 9131 }) // 2000-01-01 through ~2025-01-01
  .map((days) =>
    new Date(Date.UTC(2000, 0, 1) + days * 86_400_000).toISOString().slice(0, 10),
  );

/** Arbitrary feed failure mode spanning unavailable | timeout | invalid. */
const modeArb: fc.Arbitrary<NewsFeedFailureMode> = fc.constantFrom(
  ...NEWS_FEED_FAILURE_MODES,
);

/** Arbitrary human-readable failure message (may be empty). */
const messageArb: fc.Arbitrary<string> = fc.string({ maxLength: 120 });

describe("Property 30: news feed fail-safe suppresses all five pairs", () => {
  it("flags missing context, logs exactly one ingestion error, and suppresses every pair for all failure modes", async () => {
    // Track which failure modes the generator actually exercises so we can
    // confirm coverage of unavailable | timeout | invalid across the run.
    const observedModes = new Set<NewsFeedFailureMode>();

    await fc.assert(
      fc.asyncProperty(
        modeArb,
        decisionDateArb,
        messageArb,
        async (mode, decisionDate, message) => {
          observedModes.add(mode);

          const flagStore = new InMemoryNewsRiskFlagStore();
          const errorRecorder = new InMemoryIngestionErrorRecorder();
          const feedError: NewsFeedError = {
            reason: "news_feed_error",
            mode,
            decisionDate,
            message,
          };

          const result = await failSafeSuppressAll(feedError, {
            flagStore,
            errorRecorder,
            clock: fixedClock,
          });

          // (1) Exactly one ingestion error, matching date + mode (Req 14.6 — log).
          expect(errorRecorder.size).toBe(1);
          const logged = errorRecorder.all()[0]!;
          expect(logged.decisionDate).toBe(decisionDate);
          expect(logged.mode).toBe(mode);
          expect(logged.message).toBe(message);
          expect(logged.at).toBe("2026-03-16T12:00:00.000Z");

          // (2) The missing news context is flagged: the reason conveys the
          //     missing-context intent and references the failure mode (Req 14.6).
          expect(result.decisionDate).toBe(decisionDate);
          expect(result.mode).toBe(mode);
          const suppressionReasons = result.suppressedFlags.map((row) => row.reason);
          for (const reason of suppressionReasons) {
            expect(reason).toContain("missing news context");
            expect(reason).toContain(mode);
            expect(reason).toContain(decisionDate);
          }

          // (3) Every one of the five pairs is suppressed with feedOk === false,
          //     and result.suppressedFlags covers all five pairs (Req 14.6 — suppress all).
          expect(result.suppressedFlags).toHaveLength(ALL_PAIRS.length);
          const flaggedPairs = new Set(result.suppressedFlags.map((row) => row.pair));
          for (const pair of ALL_PAIRS) {
            expect(flaggedPairs.has(pair)).toBe(true);

            const persisted = await flagStore.getFlag(decisionDate, pair);
            expect(persisted).not.toBeNull();
            expect(persisted?.feedOk).toBe(false);
            expect(persisted?.level).toBe("high");
            expect(persisted?.reason).toContain("missing news context");
          }
          // The store holds exactly the five suppressed rows and no more.
          expect(flagStore.size).toBe(PAIRS.length);
        },
      ),
      { numRuns: 200 },
    );

    // The arbitrary must have spanned all three modelled failure modes.
    for (const mode of NEWS_FEED_FAILURE_MODES) {
      expect(observedModes.has(mode)).toBe(true);
    }
  });

  it("ties 'failed validation' to the real ingestion path: ingestCalendar(invalid) → failSafeSuppressAll", async () => {
    // Arbitrary raw payloads that MUST fail ingestCalendar validation, so the
    // NewsFeedError with mode "invalid" originates from the real ingestion path
    // rather than being hand-built.
    const invalidPayloadArb: fc.Arbitrary<string | readonly unknown[]> = fc.oneof(
      // Unparseable JSON string.
      fc.constant("{ not json"),
      // Parseable JSON that is not an array.
      fc.constant('{"events":[]}'),
      // An array containing a malformed entry (missing/empty required fields).
      fc.constant([{ name: "", currency: "USD", impact: "high", timestamp: "2026-01-01T00:00:00Z" }]),
      fc.constant([{ name: "US CPI", currency: "USD", impact: "critical", timestamp: "2026-01-01T00:00:00Z" }]),
      fc.constant([42]),
    );

    await fc.assert(
      fc.asyncProperty(
        invalidPayloadArb,
        decisionDateArb,
        async (payload, decisionDate) => {
          const eventStore = new InMemoryCalendarEventStore();
          const flagStore = new InMemoryNewsRiskFlagStore();
          const errorRecorder = new InMemoryIngestionErrorRecorder();

          // Real ingestion path: this MUST fail with an invalid-mode NewsFeedError.
          const ingestResult = await ingestCalendar(payload, eventStore, {
            decisionDate,
            source: "forexfactory",
          });
          expect(ingestResult.ok).toBe(false);
          if (ingestResult.ok) return;
          expect(ingestResult.error.reason).toBe("news_feed_error");
          expect(ingestResult.error.mode).toBe("invalid");
          expect(ingestResult.error.decisionDate).toBe(decisionDate);
          // No events were persisted on the failed ingestion.
          expect(eventStore.size).toBe(0);

          // Route the ingestion failure into the fail-safe.
          const result = await failSafeSuppressAll(ingestResult.error, {
            flagStore,
            errorRecorder,
            clock: fixedClock,
          });

          // (1) Exactly one ingestion error logged, mode "invalid".
          expect(errorRecorder.size).toBe(1);
          expect(errorRecorder.all()[0]?.mode).toBe("invalid");
          expect(errorRecorder.all()[0]?.decisionDate).toBe(decisionDate);

          // (2)/(3) All five pairs suppressed with the missing-context flag.
          expect(result.suppressedFlags).toHaveLength(ALL_PAIRS.length);
          for (const pair of ALL_PAIRS) {
            const persisted = await flagStore.getFlag(decisionDate, pair);
            expect(persisted?.feedOk).toBe(false);
            expect(persisted?.level).toBe("high");
            expect(persisted?.reason).toContain("missing news context");
            expect(persisted?.reason).toContain("invalid");
          }
          expect(flagStore.size).toBe(PAIRS.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
