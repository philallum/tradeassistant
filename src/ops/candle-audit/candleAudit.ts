// Read-only candle history audit (pure).
//
// Scans a pair's stored/seeded daily candles for the signature of the 2026-11 data-integrity
// incident (docs/state/RISKS.md): a partial / forming bar stored as a completed session, which
// shows up as an implausibly SMALL high-low range against the pair's own trailing history.
// It also flags structural defects (duplicate dates, weekend dates, invalid OHLC, long gaps).
//
// Deliberately NOT a vendor diff: the old CSV history comes from a different vendor than the
// hourly-derived canonical candles, so a raw price comparison would flag ordinary vendor noise.
// Pure and deterministic; writes nothing; uses only candles strictly before each candidate.
import { validateRange } from "../../ingestion/rangeGuard.js";

/** A range below this fraction of the trailing median is reported as a suspect partial bar. */
export const SUSPECT_RANGE_FRACTION = 0.25;
/** More calendar days than this between consecutive candles is reported as a gap. */
export const MAX_GAP_CALENDAR_DAYS = 5;

export interface AuditCandle {
  readonly date: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

export type FindingKind =
  | "partial_bar_suspect"
  | "range_too_small"
  | "range_too_large"
  | "ohlc_invalid"
  | "duplicate_date"
  | "weekend_date"
  | "gap";

export interface AuditFinding {
  readonly pair: string;
  readonly date: string;
  readonly kind: FindingKind;
  readonly detail: string;
}

export interface PairAuditReport {
  readonly pair: string;
  readonly candles: number;
  readonly firstDate: string | null;
  readonly lastDate: string | null;
  readonly findings: readonly AuditFinding[];
  /** Finding counts keyed `YYYY` then kind, for the by-year summary. */
  readonly byYear: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function median(values: readonly number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Audit one pair's candles (any order). Findings are sorted by date, then kind. */
export function auditPair(pair: string, input: readonly AuditCandle[]): PairAuditReport {
  const candles = [...input].sort((a, b) => a.date.localeCompare(b.date));
  const findings: AuditFinding[] = [];
  const add = (date: string, kind: FindingKind, detail: string): void => {
    findings.push({ pair, date, kind, detail });
  };

  const seen = new Set<string>();
  const unique: AuditCandle[] = [];
  for (const c of candles) {
    if (seen.has(c.date)) {
      add(c.date, "duplicate_date", "date appears more than once");
      continue;
    }
    seen.add(c.date);
    unique.push(c);
  }

  for (let i = 0; i < unique.length; i += 1) {
    const c = unique[i] as AuditCandle;
    const dow = dayOfWeek(c.date);
    if (dow === 0 || dow === 6) add(c.date, "weekend_date", "candle dated on a weekend");
    if (!(c.high >= c.low) || c.open > c.high || c.open < c.low || c.close > c.high || c.close < c.low) {
      add(c.date, "ohlc_invalid", "open/close outside [low, high] or high < low");
    }
    const prev = unique[i - 1];
    if (prev !== undefined) {
      const gap = daysBetween(prev.date, c.date);
      if (gap > MAX_GAP_CALENDAR_DAYS) add(c.date, "gap", `${gap} calendar days after ${prev.date}`);
    }
    const verdict = validateRange(c, unique);
    if (!verdict.ok) {
      add(c.date, verdict.kind, verdict.message);
    } else if (verdict.checked) {
      const prior = unique.filter((x) => x.date < c.date).slice(-60);
      const m = median(prior.map((x) => x.high - x.low));
      if (m > 0 && c.high - c.low < m * SUSPECT_RANGE_FRACTION) {
        add(
          c.date,
          "partial_bar_suspect",
          `range ${(c.high - c.low).toPrecision(4)} is ${(((c.high - c.low) / m) * 100).toFixed(0)}% of the trailing median`,
        );
      }
    }
  }

  findings.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const byYear: Record<string, Record<string, number>> = {};
  for (const f of findings) {
    const year = f.date.slice(0, 4);
    const row = (byYear[year] ??= {});
    row[f.kind] = (row[f.kind] ?? 0) + 1;
  }
  return {
    pair,
    candles: unique.length,
    firstDate: unique[0]?.date ?? null,
    lastDate: unique[unique.length - 1]?.date ?? null,
    findings,
    byYear,
  };
}
