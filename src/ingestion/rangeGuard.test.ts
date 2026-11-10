import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { OhlcIngestion } from "./ohlcIngestion.js";
import {
  MIN_HISTORY_FOR_RANGE_GUARD,
  validateRange,
} from "./rangeGuard.js";
import { InMemoryCandleStore } from "./types.js";
import type { RawCandle } from "./types.js";

/** `n` consecutive weekday dates starting at 2026-09-01 (a Tuesday). */
function weekdays(n: number): string[] {
  const out: string[] = [];
  let ms = Date.parse("2026-09-01T00:00:00Z");
  while (out.length < n) {
    const day = new Date(ms).getUTCDay();
    if (day >= 1 && day <= 5) out.push(new Date(ms).toISOString().slice(0, 10));
    ms += 86_400_000;
  }
  return out;
}

/** A normal EURUSD-like day: ~80 pip range centred on 1.1500. */
function normalDay(date: string, rangePips = 80): RawCandle {
  const half = (rangePips / 10_000) / 2;
  return {
    asset: "EURUSD",
    date,
    open: 1.15 - half / 2,
    high: 1.15 + half,
    low: 1.15 - half,
    close: 1.15 + half / 2,
    source: "test",
  };
}

describe("validateRange", () => {
  const history = weekdays(30).map((date) => ({ date, high: 1.154, low: 1.146 })); // 80 pips

  it("rejects a 2.4-pip day (the 2026-11-04 incident shape)", () => {
    const v = validateRange({ date: "2026-11-04", high: 1.15012, low: 1.14988 }, history);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("range_too_small");
  });

  it("accepts a normal day", () => {
    expect(validateRange({ date: "2026-11-04", high: 1.154, low: 1.146 }, history)).toEqual({
      ok: true,
      checked: true,
    });
  });

  it("accepts a genuine high-volatility day (3x median)", () => {
    expect(validateRange({ date: "2026-11-04", high: 1.162, low: 1.138 }, history).ok).toBe(true);
  });

  it("rejects an absurdly large range", () => {
    const v = validateRange({ date: "2026-11-04", high: 1.25, low: 1.1 }, history);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("range_too_large");
  });

  it("skips (does not judge) when history is short", () => {
    const short = history.slice(0, MIN_HISTORY_FOR_RANGE_GUARD - 1);
    expect(validateRange({ date: "2026-11-04", high: 1.15001, low: 1.14999 }, short)).toEqual({
      ok: true,
      checked: false,
    });
  });

  it("never looks at candles dated on or after the candidate (no look-ahead)", () => {
    const rangeArb = fc.double({ min: 0.0001, max: 0.02, noNaN: true });
    fc.assert(
      fc.property(
        rangeArb,
        fc.array(rangeArb, { minLength: 0, maxLength: 30 }),
        (candidateRange, futureRanges) => {
          const candidate = { date: "2026-10-30", high: 1.15 + candidateRange, low: 1.15 };
          const futureDates = weekdays(60).filter((d) => d >= "2026-10-30");
          const future = futureRanges.map((r, i) => ({
            date: futureDates[i] as string,
            high: 1.15 + r,
            low: 1.15,
          }));
          const prior = history.filter((c) => c.date < candidate.date);
          expect(validateRange(candidate, [...prior, ...future])).toEqual(
            validateRange(candidate, prior),
          );
        },
      ),
    );
  });
});

describe("OhlcIngestion range guard", () => {
  async function seeded(): Promise<{ store: InMemoryCandleStore; ingestion: OhlcIngestion; events: object[] }> {
    const store = new InMemoryCandleStore();
    const events: object[] = [];
    const ingestion = new OhlcIngestion(store, (e) => events.push(e));
    const seed = weekdays(30).map((d) => normalDay(d));
    const report = await ingestion.ingest("EURUSD", seed);
    expect(report.rejected).toBe(0); // seeding itself is never blocked
    return { store, ingestion, events };
  }

  it("rejects the 2.4-pip bad day, reports it, logs it, and leaves the store unchanged", async () => {
    const { store, ingestion, events } = await seeded();
    const before = (await store.getCandles("EURUSD")).length;
    const badDate = weekdays(31)[30] as string;

    const report = await ingestion.ingest("EURUSD", [normalDay(badDate, 2.4)]);

    expect(report.totalReceived).toBe(1);
    expect(report.accepted).toBe(0);
    expect(report.rejected).toBe(1);
    expect(report.errors[0]?.reason).toBe("ohlc_validity_error");
    expect(report.errors[0]?.message).toMatch(/Implausible range/);
    expect((await store.getCandles("EURUSD")).length).toBe(before);
    expect(events).toEqual([
      expect.objectContaining({ event: "candle_ingest.range_rejected", pair: "EURUSD", date: badDate }),
    ]);
  });

  it("accepts a normal next day", async () => {
    const { store, ingestion } = await seeded();
    const date = weekdays(31)[30] as string;
    const report = await ingestion.ingest("EURUSD", [normalDay(date, 95)]);
    expect(report.accepted).toBe(1);
    expect(report.rejected).toBe(0);
    expect((await store.getCandles("EURUSD")).some((c) => c.date === date)).toBe(true);
  });
});
