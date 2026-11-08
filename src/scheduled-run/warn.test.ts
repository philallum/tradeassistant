import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, warnEvent } from "./warn.js";

describe("warnEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs one JSON line with event, the fields in order, then message", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnEvent("scheduled_run.edge_slice_failed", { slice: "calibration" }, new Error("boom"));

    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toBe('{"event":"scheduled_run.edge_slice_failed","slice":"calibration","message":"boom"}');
  });

  it("logs only the error MESSAGE - never the stack or a wrapped cause", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = new Error("outer", { cause: new Error("inner-secret-cause") });

    warnEvent("scheduled_run.x", {}, err);

    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toBe('{"event":"scheduled_run.x","message":"outer"}');
    expect(line).not.toContain("inner-secret-cause");
    expect(line).not.toContain("at ");
  });

  it("stringifies a non-Error throwable", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(new Error("e"))).toBe("e");
  });
});
