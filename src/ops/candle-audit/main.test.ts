import { describe, expect, it } from "vitest";

import { parseArgs, runCandleAudit } from "./main.js";

const HEADER = "Time\tOpen\tHigh\tLow\tClose\tVolume";

function csv(rows: number): string {
  const lines = [HEADER];
  const d = new Date("2024-01-01T00:00:00Z");
  let n = 0;
  while (n < rows) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      lines.push(`${d.toISOString().slice(0, 10)} 00:00:00\t1.1\t1.104\t1.096\t1.101\t1\t1`);
      n += 1;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return lines.join("\n");
}

describe("candle-audit main", () => {
  it("audits all five pairs from CSV text without touching a database", async () => {
    const events: object[] = [];
    const reports = await runCandleAudit(
      { source: "csv", dir: "x" },
      { readText: () => Promise.resolve(csv(40)), log: (e) => events.push(e) },
    );
    expect(reports).toHaveLength(5);
    expect(reports.every((r) => r.candles === 40 && r.findings.length === 0)).toBe(true);
    expect(events.at(-1)).toMatchObject({ event: "candle_audit.complete", totalFindings: 0 });
  });

  it("limits the audit with --before", async () => {
    const reports = await runCandleAudit(
      { source: "csv", dir: "x", before: "2024-01-10" },
      { readText: () => Promise.resolve(csv(40)), log: () => undefined },
    );
    expect(reports[0]?.lastDate && reports[0].lastDate < "2024-01-10").toBe(true);
  });

  it("parses strict arguments", () => {
    expect(parseArgs([])).toEqual({ source: "csv", dir: "data" });
    expect(parseArgs(["--source", "store", "--before", "2026-10-12"])).toMatchObject({ source: "store", before: "2026-10-12" });
    expect(() => parseArgs(["--bogus"])).toThrow();
    expect(() => parseArgs(["--source", "x"])).toThrow();
  });
});
