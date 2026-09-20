import { describe, expect, it } from "vitest";
import { ingestCalendar } from "./newsFilter.js";
import {
  CALENDAR_IMPACTS,
  InMemoryCalendarEventStore,
  isCalendarImpact,
} from "./types.js";

// Calendar JSON FIELD-VALIDATION smoke tests (Task 9.11; Requirement 14.1).
//
// These are deliberately NON-OVERLAPPING with the happy-path wiring tests in
// newsFilter.test.ts (which cover ingest upsert + idempotency and the
// unparseable-JSON case). Here the focus is the per-FIELD validation contract:
// every required field (`name`, `currency`, `timestamp`) must be a non-empty
// string and `impact` must be one of the known ratings; a well-formed entry
// maps the feed field names to storage (`name` -> eventName,
// `timestamp` -> eventTs); and non-array / non-object payloads fail with a
// news_feed_error of mode "invalid" (the fail-safe trigger, Requirement 14.6).

const DECISION_DATE = "2026-03-16";
const OPTIONS = { decisionDate: DECISION_DATE, source: "forexfactory" } as const;

/** A single well-formed raw calendar entry, spread + overridden per case. */
const VALID_ENTRY = {
  name: "US CPI",
  currency: "USD",
  impact: "high",
  timestamp: "2026-03-16T12:30:00Z",
} as const;

/** Ingest a single raw entry (as a parsed array) and return the Result. */
async function ingestOne(entry: Record<string, unknown>) {
  const store = new InMemoryCalendarEventStore();
  const result = await ingestCalendar([entry], store, OPTIONS);
  return { result, store };
}

describe("ingestCalendar field validation (Requirement 14.1)", () => {
  it("accepts a well-formed entry and maps name->eventName, timestamp->eventTs", async () => {
    const { result, store } = await ingestOne({ ...VALID_ENTRY });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.value[0]!;
    expect(event.eventName).toBe("US CPI");
    expect(event.eventTs).toBe("2026-03-16T12:30:00Z");
    expect(event.currency).toBe("USD");
    expect(event.impact).toBe("high");
    expect(store.size).toBe(1);
  });

  it.each([
    ["name missing", { currency: "USD", impact: "high", timestamp: "2026-03-16T12:30:00Z" }],
    ["name blank", { ...VALID_ENTRY, name: "   " }],
    ["name non-string", { ...VALID_ENTRY, name: 42 }],
    ["currency missing", { name: "US CPI", impact: "high", timestamp: "2026-03-16T12:30:00Z" }],
    ["currency blank", { ...VALID_ENTRY, currency: "" }],
    ["currency non-string", { ...VALID_ENTRY, currency: null }],
    ["timestamp missing", { name: "US CPI", currency: "USD", impact: "high" }],
    ["timestamp blank", { ...VALID_ENTRY, timestamp: "  " }],
    ["timestamp non-string", { ...VALID_ENTRY, timestamp: 1710592200 }],
    ["impact missing", { name: "US CPI", currency: "USD", timestamp: "2026-03-16T12:30:00Z" }],
    ["impact out of set", { ...VALID_ENTRY, impact: "critical" }],
    ["impact non-string", { ...VALID_ENTRY, impact: true }],
  ])("rejects a malformed entry with mode \"invalid\" (%s)", async (_label, entry) => {
    const { result, store } = await ingestOne(entry);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("news_feed_error");
    expect(result.error.mode).toBe("invalid");
    expect(result.error.decisionDate).toBe(DECISION_DATE);
    // A rejected feed never partially persists.
    expect(store.size).toBe(0);
  });

  it("rejects a non-object entry element with mode \"invalid\"", async () => {
    const store = new InMemoryCalendarEventStore();
    const result = await ingestCalendar([null], store, OPTIONS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.mode).toBe("invalid");
    expect(store.size).toBe(0);
  });

  it("rejects a non-array JSON payload with mode \"invalid\"", async () => {
    const store = new InMemoryCalendarEventStore();
    const result = await ingestCalendar(
      JSON.stringify({ name: "US CPI", currency: "USD", impact: "high", timestamp: "t" }),
      store,
      OPTIONS,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.mode).toBe("invalid");
    expect(store.size).toBe(0);
  });

  it("rejects unparseable JSON with mode \"invalid\"", async () => {
    const store = new InMemoryCalendarEventStore();
    const result = await ingestCalendar("not: valid json", store, OPTIONS);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.mode).toBe("invalid");
    expect(store.size).toBe(0);
  });
});

describe("isCalendarImpact (Requirement 14.1)", () => {
  it("accepts exactly the known ratings", () => {
    for (const impact of CALENDAR_IMPACTS) {
      expect(isCalendarImpact(impact)).toBe(true);
    }
    expect(CALENDAR_IMPACTS).toEqual(["low", "medium", "high"]);
  });

  it.each([
    "critical",
    "LOW",
    "High",
    "",
    "none",
    42,
    null,
    undefined,
    {},
  ])("rejects a value outside the impact set (%o)", (value) => {
    expect(isCalendarImpact(value)).toBe(false);
  });
});
