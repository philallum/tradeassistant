import { describe, expect, it } from "vitest";
import { InMemoryFrozenBaselineStore } from "./frozenBaselineStore.js";
import { captureFrozenBaseline } from "./parameterSet.js";

// Feature: trader-edge-validation, Task 9: in-memory FrozenBaselineStore reference.

const at = (iso: string, id: string) =>
  captureFrozenBaseline({ id, now: () => new Date(iso) });

describe("InMemoryFrozenBaselineStore (R11.1, R11.2)", () => {
  it("appends and reads back by id", async () => {
    const b = at("2026-02-01T00:00:00.000Z", "params-v1");
    const store = new InMemoryFrozenBaselineStore();
    await store.append([b]);
    expect(await store.getById("params-v1")).toEqual(b);
    expect(await store.getById("missing")).toBeNull();
  });

  it("is idempotent on id (re-append replaces)", async () => {
    const store = new InMemoryFrozenBaselineStore();
    await store.append([at("2026-02-01T00:00:00.000Z", "params-v1")]);
    await store.append([at("2026-03-01T00:00:00.000Z", "params-v1")]);
    expect(store.size()).toBe(1);
    const got = await store.getById("params-v1");
    expect(got!.capturedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("getAll orders by capturedAt ascending (newest last)", async () => {
    const store = new InMemoryFrozenBaselineStore([
      at("2026-03-01T00:00:00.000Z", "c"),
      at("2026-01-01T00:00:00.000Z", "a"),
      at("2026-02-01T00:00:00.000Z", "b"),
    ]);
    const all = await store.getAll();
    expect(all.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
