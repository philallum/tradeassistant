import { describe, expect, it } from "vitest";
import type { ProvenanceRow } from "../api/types";
import { DATA_DELAYED_MESSAGE, SNAPSHOT_MAX_AGE_MS, shapeDataHealth } from "./shapeDataHealth";

const DATE = "2026-11-10";
const NOW = Date.parse("2026-11-10T18:00:00Z");

function prov(pair: string, over: Partial<ProvenanceRow> = {}): ProvenanceRow {
  return {
    decision_date: DATE,
    pair,
    lastCandleTimestamp: "2026-11-09T17:00:00-05:00",
    computedAt: "2026-11-10T17:30:00.000Z",
    earliestEntryRef: "2026-11-10T17:00:00-05:00",
    horizonStart: "2026-11-10T17:00:00-05:00",
    horizonEnd: "2026-11-10T17:00:00-05:00",
    dataComplete: true,
    staleReason: null,
    ...over,
  };
}

describe("shapeDataHealth", () => {
  it("is null when every pair is complete", () => {
    expect(
      shapeDataHealth({ provenance: [prov("EURUSD"), prov("GBPUSD")], decisionDate: DATE, nowMs: NOW }),
    ).toBeNull();
  });

  it("flags a pair with a missing candle and names it", () => {
    const vm = shapeDataHealth({
      provenance: [prov("EURUSD", { dataComplete: false, staleReason: "missing_candle" }), prov("GBPUSD")],
      decisionDate: DATE,
      nowMs: NOW,
    });
    expect(vm?.message).toBe(DATA_DELAYED_MESSAGE);
    expect(vm?.pairs).toEqual(["EURUSD"]);
    expect(vm?.detail).toBe("EURUSD: latest session candle missing");
    expect(vm?.source).toBe("provenance");
  });

  it("does not treat a declared holiday as a delay", () => {
    expect(
      shapeDataHealth({
        provenance: [prov("EURUSD", { dataComplete: false, staleReason: "holiday" })],
        decisionDate: DATE,
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("describes stale and weekend-gap reasons", () => {
    const vm = shapeDataHealth({
      provenance: [
        prov("EURUSD", { dataComplete: false, staleReason: "stale" }),
        prov("USDJPY", { dataComplete: false, staleReason: "weekend_gap" }),
      ],
      decisionDate: DATE,
      nowMs: NOW,
    });
    expect(vm?.pairs).toEqual(["EURUSD", "USDJPY"]);
    expect(vm?.detail).toContain("more than one session behind");
    expect(vm?.detail).toContain("after the weekend");
  });

  it("ignores provenance rows for other decision dates", () => {
    expect(
      shapeDataHealth({
        provenance: [prov("EURUSD", { decision_date: "2026-11-06", dataComplete: false, staleReason: "stale" })],
        decisionDate: DATE,
        generatedAt: "2026-11-10T17:31:00Z",
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("falls back to snapshot age when provenance is empty", () => {
    const old = new Date(NOW - SNAPSHOT_MAX_AGE_MS - 24 * 3600_000).toISOString();
    const vm = shapeDataHealth({ provenance: [], decisionDate: DATE, generatedAt: old, nowMs: NOW });
    expect(vm?.source).toBe("snapshot_age");
    expect(vm?.detail).toContain("6 days old");
  });

  it("is null for a fresh snapshot with empty provenance, or an unparseable/absent timestamp", () => {
    expect(shapeDataHealth({ provenance: [], decisionDate: DATE, generatedAt: "2026-11-10T17:31:00Z", nowMs: NOW })).toBeNull();
    expect(shapeDataHealth({ provenance: [], decisionDate: DATE, generatedAt: "", nowMs: NOW })).toBeNull();
    expect(shapeDataHealth({ decisionDate: DATE, nowMs: NOW })).toBeNull();
  });

  it("does not mutate its input", () => {
    const provenance = [prov("EURUSD", { dataComplete: false, staleReason: "missing_candle" })];
    const frozen = JSON.stringify(provenance);
    shapeDataHealth({ provenance, decisionDate: DATE, nowMs: NOW });
    expect(JSON.stringify(provenance)).toBe(frozen);
  });
});
