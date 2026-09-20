import { describe, expect, it } from "vitest";
import { LlmInterface, type LlmProvider } from "../llm/llmInterface.js";
import {
  InMemoryRoleRejectionRecorder,
  type RiskFlag,
  type RoleInput,
  type RoleOutput,
  type SanctionedRole,
} from "../llm/types.js";
import {
  ingestCalendar,
  riskFlag,
  suppress,
  failSafeSuppressAll,
} from "./newsFilter.js";
import {
  ALL_PAIRS,
  InMemoryCalendarEventStore,
  InMemoryIngestionErrorRecorder,
  InMemoryNewsRiskFlagStore,
  PAIRS,
  type NewsFeedError,
} from "./types.js";

// Focused unit tests for the News Filter (task 9.3 self-validation).
//
// These are deliberately NON-OVERLAPPING with the property tests owned by later
// subtasks — Property 28 (suppression is a pure fn of the flag, never a
// direction, 9.8), Property 29 (elevated risk suppresses, 9.9), Property 30
// (fail-safe suppresses all five pairs, 9.10) — and with the 9.11 smoke tests
// (calendar-JSON field validation / RiskFlag shape). They exercise the wiring:
// ingest upsert + idempotency, riskFlag routing through the LLM_Interface and
// per-pair persistence, the suppress policy mapping, and the fail-safe
// persistence contract (feed_ok = false for all five pairs).

const DECISION_DATE = "2026-03-16";

/** A clock that returns a fixed timestamp for deterministic assertions. */
const fixedClock = { now: () => "2026-03-16T12:00:00.000Z" };

/** Build a real LlmInterface backed by a fake provider that returns `flag`. */
function llmReturning(flag: RiskFlag): LlmInterface {
  const provider: LlmProvider = {
    complete<R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]> {
      void role;
      void input;
      return Promise.resolve(flag as RoleOutput[R]);
    },
  };
  return new LlmInterface({
    provider,
    rejectionRecorder: new InMemoryRoleRejectionRecorder(),
    clock: fixedClock,
  });
}

describe("ingestCalendar", () => {
  it("parses valid entries, maps feed fields, and upserts to the store", async () => {
    const store = new InMemoryCalendarEventStore();
    const json = JSON.stringify([
      { name: "US CPI", currency: "USD", impact: "high", timestamp: "2026-03-16T12:30:00Z" },
    ]);

    const result = await ingestCalendar(json, store, {
      decisionDate: DECISION_DATE,
      source: "forexfactory",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const event = result.value[0]!;
    // Feed field mapping: name -> eventName, timestamp -> eventTs.
    expect(event.eventName).toBe("US CPI");
    expect(event.eventTs).toBe("2026-03-16T12:30:00Z");
    expect(event.currency).toBe("USD");
    expect(event.impact).toBe("high");
    expect(event.source).toBe("forexfactory");

    const stored = await store.getEvents(DECISION_DATE);
    expect(stored).toHaveLength(1);
  });

  it("is idempotent — ingesting the same events twice yields no duplicate rows", async () => {
    const store = new InMemoryCalendarEventStore();
    const entries = [
      { name: "ECB Rate", currency: "EUR", impact: "high", timestamp: "2026-03-16T13:15:00Z" },
    ];

    await ingestCalendar(entries, store, { decisionDate: DECISION_DATE, source: "fmp" });
    await ingestCalendar(entries, store, { decisionDate: DECISION_DATE, source: "fmp" });

    expect(store.size).toBe(1);
  });

  it("fails with a news_feed_error(invalid) on unparseable JSON", async () => {
    const store = new InMemoryCalendarEventStore();
    const result = await ingestCalendar("{ not json", store, {
      decisionDate: DECISION_DATE,
      source: "fmp",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.mode).toBe("invalid");
    expect(store.size).toBe(0);
  });
});

describe("riskFlag", () => {
  it("routes through the LLM_Interface and persists one flag per pair (feedOk=true)", async () => {
    const flag: RiskFlag = { level: "elevated", reason: "US CPI within window" };
    const llm = llmReturning(flag);
    const store = new InMemoryNewsRiskFlagStore();

    const returned = await riskFlag(DECISION_DATE, [], llm, store);

    // The unwrapped { level, reason } data is returned (not the tagged wrapper).
    expect(returned).toEqual(flag);

    const rows = await store.all();
    expect(rows).toHaveLength(PAIRS.length);
    for (const pair of ALL_PAIRS) {
      const row = await store.getFlag(DECISION_DATE, pair);
      expect(row?.feedOk).toBe(true);
      expect(row?.level).toBe("elevated");
      expect(row?.reason).toBe("US CPI within window");
    }
  });
});

describe("suppress", () => {
  it("suppresses on elevated/high and records the flag reason", () => {
    expect(suppress({ level: "elevated", reason: "CPI" })).toEqual({
      suppressed: true,
      reason: "CPI",
    });
    expect(suppress({ level: "high", reason: "FOMC" })).toEqual({
      suppressed: true,
      reason: "FOMC",
    });
  });

  it("permits on none and never carries a direction field", () => {
    const decision = suppress({ level: "none", reason: "quiet day" });
    expect(decision.suppressed).toBe(false);
    expect(Object.keys(decision).sort()).toEqual(["reason", "suppressed"]);
  });
});

describe("failSafeSuppressAll", () => {
  it("logs the ingestion error and suppresses all five pairs with feedOk=false", async () => {
    const flagStore = new InMemoryNewsRiskFlagStore();
    const errorRecorder = new InMemoryIngestionErrorRecorder();
    const feedError: NewsFeedError = {
      reason: "news_feed_error",
      mode: "timeout",
      decisionDate: DECISION_DATE,
      message: "calendar feed timed out",
    };

    const result = await failSafeSuppressAll(feedError, {
      flagStore,
      errorRecorder,
      clock: fixedClock,
    });

    expect(result.suppressedFlags).toHaveLength(PAIRS.length);
    expect(errorRecorder.size).toBe(1);
    expect(errorRecorder.all()[0]?.mode).toBe("timeout");

    // Every one of the five pairs is suppressed with feed_ok = false.
    for (const pair of ALL_PAIRS) {
      const row = await flagStore.getFlag(DECISION_DATE, pair);
      expect(row).not.toBeNull();
      expect(row?.feedOk).toBe(false);
      expect(row?.level).toBe("high");
    }
  });
});
