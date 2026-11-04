// dashboard-ui `web/` — selection store URL-sync unit tests.
//
// The behavioral core of the selection store is its two pure URL helpers:
// `parseSelectionFromSearch` (deep-link restore on load, Req 1.6) and `selectionToSearch`
// (mirror a selection into the query string, Req 1.6). These tests pin the default posture
// (EURUSD + latest date), the accepted/rejected query values (including the legacy
// `?pair=ALL` bookmark), the pair-always-written URL contract, and the parse∘serialize
// round-trip. The React provider/hook are thin wrappers around this logic and are exercised by
// the app-shell tests.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAIR,
  parseSelectionFromSearch,
  selectionToSearch,
  type SelectionState,
} from "./selection.js";

describe("parseSelectionFromSearch (deep-link restore, Req 1.6)", () => {
  it("defaults to EURUSD + latest (null date) for an empty query", () => {
    expect(DEFAULT_PAIR).toBe("EURUSD");
    expect(parseSelectionFromSearch("")).toEqual({ pair: DEFAULT_PAIR, date: null });
    expect(parseSelectionFromSearch("?")).toEqual({ pair: DEFAULT_PAIR, date: null });
  });

  it("reads a valid pair and ISO date from the query", () => {
    expect(parseSelectionFromSearch("?pair=GBPUSD&date=2026-09-16")).toEqual({
      pair: "GBPUSD",
      date: "2026-09-16",
    });
  });

  it("tolerates a leading '?' being absent", () => {
    expect(parseSelectionFromSearch("pair=USDJPY")).toEqual({ pair: "USDJPY", date: null });
  });

  it("falls back to the default pair for an unknown value, including the legacy ?pair=ALL", () => {
    expect(parseSelectionFromSearch("?pair=XAUUSD").pair).toBe(DEFAULT_PAIR);
    expect(parseSelectionFromSearch("?pair=").pair).toBe(DEFAULT_PAIR);
    expect(parseSelectionFromSearch("?pair=all").pair).toBe(DEFAULT_PAIR);
    expect(parseSelectionFromSearch("?pair=ALL&date=2026-09-16")).toEqual({
      pair: DEFAULT_PAIR,
      date: "2026-09-16",
    });
  });

  it("falls back to null for a malformed date value", () => {
    expect(parseSelectionFromSearch("?date=2026-9-1").date).toBeNull();
    expect(parseSelectionFromSearch("?date=not-a-date").date).toBeNull();
    expect(parseSelectionFromSearch("?date=").date).toBeNull();
  });
});

describe("selectionToSearch (URL mirror, Req 1.6)", () => {
  it("always writes the pair and omits a null (latest) date", () => {
    expect(selectionToSearch({ pair: "EURUSD", date: null })).toBe("pair=EURUSD");
    expect(selectionToSearch({ pair: "GBPUSD", date: null })).toBe("pair=GBPUSD");
  });

  it("writes both keys when both selections are explicit", () => {
    const params = new URLSearchParams(selectionToSearch({ pair: "USDCHF", date: "2026-09-16" }));
    expect(params.get("pair")).toBe("USDCHF");
    expect(params.get("date")).toBe("2026-09-16");
  });
});

describe("parse ∘ serialize round-trip", () => {
  const cases: readonly SelectionState[] = [
    { pair: "EURUSD", date: null },
    { pair: "GBPUSD", date: null },
    { pair: "EURUSD", date: "2026-09-16" },
    { pair: "USDCAD", date: "2020-01-01" },
  ];

  for (const state of cases) {
    it(`round-trips ${JSON.stringify(state)}`, () => {
      expect(parseSelectionFromSearch(selectionToSearch(state))).toEqual(state);
    });
  }
});
