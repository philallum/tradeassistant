import { describe, expect, it } from "vitest";

import { auditPair, type AuditCandle } from "./candleAudit.js";

/** 60 consecutive weekdays from 2024-01-01 with a steady ~80-pip range. */
function goodSeries(count = 60): AuditCandle[] {
  const out: AuditCandle[] = [];
  const d = new Date("2024-01-01T00:00:00Z");
  while (out.length < count) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      out.push({ date: d.toISOString().slice(0, 10), open: 1.1, high: 1.104, low: 1.096, close: 1.101 });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("auditPair", () => {
  it("reports nothing for a clean series", () => {
    const r = auditPair("EURUSD", goodSeries());
    expect(r.findings).toEqual([]);
    expect(r.candles).toBe(60);
  });

  it("flags a partial bar (tiny range) in the middle of history", () => {
    const s = goodSeries();
    s[40] = { ...(s[40] as AuditCandle), open: 1.1, high: 1.1002, low: 1.0999, close: 1.1001 };
    const r = auditPair("EURUSD", s);
    expect(r.findings.map((f) => f.kind)).toContain("range_too_small");
    expect(r.findings.find((f) => f.date === s[40]?.date)).toBeDefined();
  });

  it("flags a suspect (but not guard-rejected) small range", () => {
    const s = goodSeries();
    s[40] = { ...(s[40] as AuditCandle), open: 1.1, high: 1.1011, low: 1.0999, close: 1.1005 };
    const kinds = auditPair("EURUSD", s).findings.map((f) => f.kind);
    expect(kinds).toContain("partial_bar_suspect");
    expect(kinds).not.toContain("range_too_small");
  });

  it("flags duplicate dates, weekend dates, invalid OHLC and gaps", () => {
    const s = goodSeries();
    const kinds = auditPair("EURUSD", [
      ...s,
      s[3] as AuditCandle,
      { date: "2024-06-01", open: 1.1, high: 1.104, low: 1.096, close: 1.1 },
      { date: "2024-06-04", open: 1.2, high: 1.1, low: 1.3, close: 1.1 },
    ]).findings.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["duplicate_date", "weekend_date", "ohlc_invalid", "gap"]));
  });

  it("does not judge short history and summarises findings by year", () => {
    expect(auditPair("EURUSD", goodSeries(10)).findings).toEqual([]);
    const s = goodSeries();
    s[40] = { ...(s[40] as AuditCandle), high: 1.1002, low: 1.0999 };
    const r = auditPair("EURUSD", s);
    expect(r.byYear["2024"]?.range_too_small).toBe(1);
  });

  it("is order independent", () => {
    const s = goodSeries();
    expect(auditPair("EURUSD", [...s].reverse())).toEqual(auditPair("EURUSD", s));
  });
});
