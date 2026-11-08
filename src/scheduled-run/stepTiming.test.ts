import { describe, expect, it } from "vitest";
import { STEP_TIMING_EVENT, timed } from "./stepTiming.js";

/** A fake clock that advances by the given amounts on successive reads. */
function clock(...readings: number[]): () => number {
  let i = 0;
  return () => readings[Math.min(i++, readings.length - 1)] as number;
}

describe("timed", () => {
  it("returns the step's value unchanged and logs one ok line with the elapsed time", async () => {
    const lines: object[] = [];

    const value = await timed("track_record", () => Promise.resolve({ answer: 42 }), {
      log: (e) => lines.push(e),
      now: clock(100, 1350),
    });

    expect(value).toEqual({ answer: 42 });
    expect(lines).toEqual([
      { event: STEP_TIMING_EVENT, step: "track_record", durationMs: 1250, outcome: "ok" },
    ]);
  });

  it("logs outcome=error and re-throws the IDENTICAL error object", async () => {
    const lines: object[] = [];
    const boom = new Error("secret-bearing message");

    await expect(
      timed(
        "edge_slices",
        () => Promise.reject(boom),
        { log: (e) => lines.push(e), now: clock(0, 40) },
      ),
    ).rejects.toBe(boom);

    expect(lines).toEqual([
      { event: STEP_TIMING_EVENT, step: "edge_slices", durationMs: 40, outcome: "error" },
    ]);
  });

  it("never logs an error message or value (secret-safe by construction)", async () => {
    const lines: object[] = [];

    await expect(
      timed("x", () => Promise.reject(new Error("api_key=SHOULD-NOT-APPEAR")), {
        log: (e) => lines.push(e),
        now: clock(0, 1),
      }),
    ).rejects.toThrow();

    expect(JSON.stringify(lines)).not.toContain("SHOULD-NOT-APPEAR");
  });

  it("rounds the duration to whole milliseconds", async () => {
    const lines: Array<Record<string, unknown>> = [];

    await timed("s", () => Promise.resolve(undefined), {
      log: (e) => lines.push(e as Record<string, unknown>),
      now: clock(10, 10.6),
    });

    expect(lines[0]?.durationMs).toBe(1);
  });
});
