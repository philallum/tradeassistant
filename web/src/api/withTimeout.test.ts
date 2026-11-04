import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./withTimeout";

const MESSAGE = "The dashboard data could not be loaded in time.";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the value when the promise settles before the deadline", async () => {
    const result = withTimeout(Promise.resolve("ok"), 1000);
    await expect(result).resolves.toBe("ok");
  });

  it("propagates the original rejection when the promise rejects before the deadline", async () => {
    const err = new Error("boom");
    await expect(withTimeout(Promise.reject(err), 1000)).rejects.toBe(err);
  });

  it("rejects with the non-secret timeout message at the deadline", async () => {
    const never = new Promise<string>(() => {});
    const result = withTimeout(never, 1000);
    const assertion = expect(result).rejects.toThrow(MESSAGE);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("does not reject before the deadline", async () => {
    const never = new Promise<string>(() => {});
    const onReject = vi.fn();
    withTimeout(never, 1000).catch(onReject);
    await vi.advanceTimersByTimeAsync(999);
    expect(onReject).not.toHaveBeenCalled();
  });

  it("timeout error carries no cause and only the fixed message", async () => {
    const result = withTimeout(new Promise<string>(() => {}), 50);
    const assertion = result.catch((e: unknown) => e as Error);
    await vi.advanceTimersByTimeAsync(50);
    const e = (await assertion) as Error;
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe(MESSAGE);
    expect((e as { cause?: unknown }).cause).toBeUndefined();
  });

  it("clears the timer once the promise resolves", async () => {
    await withTimeout(Promise.resolve(1), 1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer once the promise rejects", async () => {
    await withTimeout(Promise.reject(new Error("x")), 1000).catch(() => {});
    expect(vi.getTimerCount()).toBe(0);
  });
});
