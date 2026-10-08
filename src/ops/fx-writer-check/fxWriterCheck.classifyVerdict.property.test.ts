// Property + unit tests for the PURE fx_writer-check verdict classifier
// (task 5.2a.4). No network: these exercise classifyVerdict over the full
// space of op outcomes and assert the GREEN invariant.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classifyVerdict } from "./fxWriterCheck.js";
import type { OpOutcome } from "./types.js";

const DENIAL = [401, 403, 405] as const;
const isDenial = (s: number): boolean => (DENIAL as readonly number[]).includes(s);

describe("classifyVerdict", () => {
  it("is GREEN exactly when INSERT+UPDATE succeed and DELETE is denied", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        // delete outcome: either succeeded, denied (401/403/405), or other-status
        fc.oneof(
          fc.constant<OpOutcome>({ op: "delete", ok: true }),
          fc.constantFrom(...DENIAL).map((s): OpOutcome => ({ op: "delete", ok: false, status: s })),
          fc.integer({ min: 400, max: 599 }).filter((s) => !isDenial(s)).map((s): OpOutcome => ({ op: "delete", ok: false, status: s })),
        ),
        (insertOk, updateOk, del) => {
          const outcomes: OpOutcome[] = [
            { op: "insert", ok: insertOk },
            { op: "update", ok: updateOk },
            del,
          ];
          const v = classifyVerdict(outcomes);
          const expectedDeleteRefused =
            del.ok === false && del.status !== undefined && isDenial(del.status);
          expect(v.deleteRefused).toBe(expectedDeleteRefused);
          expect(v.green).toBe(insertOk && updateOk && expectedDeleteRefused);
        },
      ),
    );
  });

  it("treats a SUCCEEDED delete as a hard failure (invariant broken)", () => {
    const v = classifyVerdict([
      { op: "insert", ok: true },
      { op: "update", ok: true },
      { op: "delete", ok: true },
    ]);
    expect(v.green).toBe(false);
    expect(v.deleteRefused).toBe(false);
    expect(v.reasons.some((r) => r.includes("no-DELETE invariant BROKEN"))).toBe(true);
  });

  it("is GREEN on the canonical happy path (insert+update ok, delete 403)", () => {
    const v = classifyVerdict([
      { op: "insert", ok: true },
      { op: "update", ok: true },
      { op: "delete", ok: false, status: 403 },
    ]);
    expect(v).toMatchObject({ insertSucceeded: true, updateSucceeded: true, deleteRefused: true, green: true });
  });

  it("is not green when a transport error (no status) hits DELETE", () => {
    const v = classifyVerdict([
      { op: "insert", ok: true },
      { op: "update", ok: true },
      { op: "delete", ok: false },
    ]);
    expect(v.green).toBe(false);
    expect(v.deleteRefused).toBe(false);
  });
});
