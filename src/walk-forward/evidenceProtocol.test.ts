import { describe, expect, it } from "vitest";

import { EDGE_EVAL_WINDOWS } from "../ops/edge-eval/main.js";
import {
  CONFIRMATION_HOLDOUT,
  DISCOVERY_WINDOW,
  FORWARD_TEST_PARAMETERS,
  FORWARD_TEST_START,
  PRE_REGISTERED_QUESTIONS,
  PRE_REGISTERED_SLICE_DIMENSIONS,
  inWindow,
  windowsOverlap,
} from "./evidenceProtocol.js";
import { captureLiveParameterSet } from "./parameterSet.js";

describe("evidence protocol", () => {
  it("the live parameters equal the set frozen for the forward test (tuning must reset the clock)", () => {
    expect(captureLiveParameterSet()).toEqual(FORWARD_TEST_PARAMETERS);
  });

  it("the forward-test start is a valid calendar date", () => {
    expect(FORWARD_TEST_START).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(FORWARD_TEST_START))).toBe(false);
  });

  it("the confirmation holdout is disjoint from, and later than, the discovery window", () => {
    expect(windowsOverlap(DISCOVERY_WINDOW, CONFIRMATION_HOLDOUT)).toBe(false);
    expect(CONFIRMATION_HOLDOUT.start > DISCOVERY_WINDOW.end).toBe(true);
    expect(CONFIRMATION_HOLDOUT.start <= CONFIRMATION_HOLDOUT.end).toBe(true);
  });

  it("no default edge-eval window consumes the holdout", () => {
    for (const w of EDGE_EVAL_WINDOWS) {
      expect(windowsOverlap(w.inSample, CONFIRMATION_HOLDOUT)).toBe(false);
      expect(windowsOverlap(w.outOfSample, CONFIRMATION_HOLDOUT)).toBe(false);
    }
  });

  it("window helpers are inclusive", () => {
    expect(inWindow("2025-01-02", CONFIRMATION_HOLDOUT)).toBe(true);
    expect(inWindow("2026-09-15", CONFIRMATION_HOLDOUT)).toBe(true);
    expect(inWindow("2024-12-31", CONFIRMATION_HOLDOUT)).toBe(false);
  });

  it("registers its slice dimensions and questions up front", () => {
    expect(PRE_REGISTERED_SLICE_DIMENSIONS.length).toBeGreaterThan(0);
    expect(new Set(PRE_REGISTERED_QUESTIONS.map((q) => q.id)).size).toBe(PRE_REGISTERED_QUESTIONS.length);
  });
});
