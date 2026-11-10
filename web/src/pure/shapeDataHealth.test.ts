import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProvenanceRow } from "../api/types";
import { DATA_DELAYED_MESSAGE, SNAPSHOT_MAX_AGE_MS, expectedLatestDecisionDate, shapeDataHealth } from "./shapeDataHealth";

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

describe("run health and missed-run detection (schema v9)", () => {
  const NOW = Date.parse("2026-11-12T10:00:00Z"); // Thursday morning UTC
  const base = { decisionDate: "2026-11-12", nowMs: NOW };

  it("flags pairs the freshness stage left behind, when viewing the latest run", () => {
    const vm = shapeDataHealth({
      ...base,
      latestDecisionDate: "2026-11-12",
      runHealth: { rows: [], degradedPairs: ["USDCHF"], confidenceThreshold: 0.55 },
    });
    expect(vm?.source).toBe("run_health");
    expect(vm?.pairs).toEqual(["USDCHF"]);
  });

  it("does not apply the latest run's stale pairs to an older browsed date", () => {
    const vm = shapeDataHealth({
      decisionDate: "2026-11-10",
      latestDecisionDate: "2026-11-12",
      runHealth: { rows: [], degradedPairs: ["USDCHF"], confidenceThreshold: 0.55 },
      nowMs: NOW,
    });
    expect(vm).toBeNull();
  });

  it("flags a missed daily run when the latest published run is older than the one due", () => {
    // Thursday 10:00 UTC: Wednesday's run (22:30 UTC) is due and should have published Thursday.
    const vm = shapeDataHealth({ ...base, latestDecisionDate: "2026-11-11" });
    expect(vm?.source).toBe("missed_run");
    expect(vm?.message).toContain("may not have published");
    expect(vm?.detail).toContain("2026-11-12");
  });

  it("is healthy when the latest run is the one due", () => {
    expect(shapeDataHealth({ ...base, latestDecisionDate: "2026-11-12" })).toBeNull();
  });

  it("does not cry wolf over a weekend or before the day's run is due", () => {
    // Saturday: the Friday run published Monday's date.
    expect(
      shapeDataHealth({ decisionDate: "2026-11-16", latestDecisionDate: "2026-11-16", nowMs: Date.parse("2026-11-14T12:00:00Z") }),
    ).toBeNull();
    // Wednesday 20:00 UTC: today's run (22:30 UTC) is not yet due, Tuesday's run published Wednesday.
    expect(
      shapeDataHealth({ decisionDate: "2026-11-11", latestDecisionDate: "2026-11-11", nowMs: Date.parse("2026-11-11T20:00:00Z") }),
    ).toBeNull();
  });
});

describe("expectedLatestDecisionDate", () => {
  it("labels a Friday run as the following Monday and skips weekends", () => {
    expect(expectedLatestDecisionDate(Date.parse("2026-11-14T12:00:00Z"))).toBe("2026-11-16"); // Sat
    expect(expectedLatestDecisionDate(Date.parse("2026-11-15T12:00:00Z"))).toBe("2026-11-16"); // Sun
    expect(expectedLatestDecisionDate(Date.parse("2026-11-16T10:00:00Z"))).toBe("2026-11-16"); // Mon morning
    expect(expectedLatestDecisionDate(Date.parse("2026-11-16T23:00:00Z"))).toBe("2026-11-16"); // Mon, run not yet due (00:30 grace)
    expect(expectedLatestDecisionDate(Date.parse("2026-11-17T01:00:00Z"))).toBe("2026-11-17"); // Mon run published Tue
  });
});

describe("schedule constants stay in step with the heartbeat check", () => {
  it("uses the same run hour and grace as src/ops/heartbeat", () => {
    const mine = readFileSync(join(__dirname, "shapeDataHealth.ts"), "utf8");
    const backend = readFileSync(join(__dirname, "..", "..", "..", "src", "ops", "heartbeat", "heartbeat.ts"), "utf8");
    const grab = (src: string, name: string): string => new RegExp(`${name}\\s*=\\s*([0-9.]+)`).exec(src)?.[1] ?? "missing";
    expect(grab(mine, "RUN_HOUR_UTC")).toBe(grab(backend, "RUN_HOUR_UTC"));
    expect(grab(mine, "RUN_GRACE_HOURS")).toBe(grab(backend, "RUN_GRACE_HOURS"));
    expect(grab(mine, "RUN_HOUR_UTC")).not.toBe("missing");
  });
});
