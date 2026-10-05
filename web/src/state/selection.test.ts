// dashboard-ui `web/` — selection store URL-sync unit tests (task 8.3).
//
// The behavioral core of the selection store is its two pure URL helpers:
// `parseSelectionFromSearch` (deep-link restore on load, Req 1.6) and `selectionToSearch`
// (mirror a selection into the query string, Req 1.6). These tests pin the default posture
// ("All pairs" + latest date, Req 8.4), the accepted/rejected query values, the clean-URL
// omission of defaults, and the parse∘serialize round-trip. The React provider/hook are
// thin wrappers around this logic and are exercised by the task 9 app-shell tests.

import { describe, expect, it } from "vitest";

import {
  ALL_PAIRS,
  parseSelectionFromSearch,
  selectionToSearch,
  type SelectionState,
} from "./selection.js";

describe("parseSelectionFromSearch (deep-link restore, Req 1.6/8.4)", () => {
  it("defaults to All pairs + latest (null date) for an empty query", () => {
    expect(parseSelectionFromSearch("")).toEqual({
      pair: ALL_PAIRS,
      date: null,
    });
    expect(parseSelectionFromSearch("?")).toEqual({
      pair: ALL_PAIRS,
      date: null,
    });
  });

  it("reads a valid pair and ISO date from the query", () => {
    expect(parseSelectionFromSearch("?pair=EURUSD&date=2026-09-16")).toEqual({
      pair: "EURUSD",
      date: "2026-09-16",
    });
  });

  it("tolerates a leading '?' being absent", () => {
    expect(parseSelectionFromSearch("pair=USDJPY")).toEqual({
      pair: "USDJPY",
      date: null,
    });
  });

  it("falls back to All pairs for an unknown pair value", () => {
    expect(parseSelectionFromSearch("?pair=XAUUSD").pair).toBe(ALL_PAIRS);
    expect(parseSelectionFromSearch("?pair=").pair).toBe(ALL_PAIRS);
    expect(parseSelectionFromSearch("?pair=all").pair).toBe(ALL_PAIRS);
  });

  it("falls back to null for a malformed date value", () => {
    expect(parseSelectionFromSearch("?date=2026-9-1").date).toBeNull();
    expect(parseSelectionFromSearch("?date=not-a-date").date).toBeNull();
    expect(parseSelectionFromSearch("?date=").date).toBeNull();
  });
});

describe("selectionToSearch (URL mirror, Req 1.6)", () => {
  it("omits both defaults so an All-pairs/latest view has a clean URL", () => {
    expect(selectionToSearch({ pair: ALL_PAIRS, date: null })).toBe("");
  });

  it("writes only the pair when the date is latest (null)", () => {
    expect(selectionToSearch({ pair: "GBPUSD", date: null })).toBe(
      "pair=GBPUSD",
    );
  });

  it("writes only the date when the pair is All pairs", () => {
    expect(selectionToSearch({ pair: ALL_PAIRS, date: "2026-09-16" })).toBe(
      "date=2026-09-16",
    );
  });

  it("writes both keys when both selections are explicit", () => {
    const search = selectionToSearch({ pair: "USDCHF", date: "2026-09-16" });
    const params = new URLSearchParams(search);
    expect(params.get("pair")).toBe("USDCHF");
    expect(params.get("date")).toBe("2026-09-16");
  });
});

describe("parse ∘ serialize round-trip", () => {
  const cases: readonly SelectionState[] = [
    { pair: ALL_PAIRS, date: null },
    { pair: "EURUSD", date: null },
    { pair: ALL_PAIRS, date: "2026-09-16" },
    { pair: "USDCAD", date: "2020-01-01" },
  ];

  for (const state of cases) {
    it(`round-trips ${JSON.stringify(state)}`, () => {
      expect(parseSelectionFromSearch(selectionToSearch(state))).toEqual(state);
    });
  }
});
