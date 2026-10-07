// Shared test helpers for the outcome-resolution property tests.
//
// Minimal fast-check generators for an ascending-date OHLC candle series and a
// helper to build a PipelineStores backed by the in-memory reference stores.
// No disk I/O or network required.

import fc from "fast-check";
import type { Candle, TradingDate } from "../../guard/types.js";
import type { Pair } from "../../ingestion/types.js";
import { InMemoryCandleStore } from "../../ingestion/types.js";
import { InMemoryPatternVectorStore } from "../../encoder/types.js";
import { InMemoryAnalogueStore } from "../../retrieval/types.js";
import type { PipelineStores } from "../../pipeline/types.js";
import type { PatternVector, WeeklyTrendSign } from "../../encoder/types.js";
import { EMBEDDING_DIM } from "../../encoder/patternEncoder.js";

/** A base epoch (a Monday, UTC) from which trading-day offsets are measured. */
const BASE_EPOCH_MS = Date.UTC(2015, 0, 5); // 2015-01-05 is a Monday.

/** Format a day-offset from the base epoch as a YYYY-MM-DD TradingDate. */
export function dateFromOffset(dayOffset: number): TradingDate {
  const dt = new Date(BASE_EPOCH_MS + dayOffset * 86_400_000);
  return dt.toISOString().slice(0, 10);
}

/**
 * A single generated candle (OHLC-valid: low <= open/close <= high). The exact
 * prices are irrelevant to the properties under test (which concern WHICH dates
 * get rows, idempotence of the writes, and the maturity flag), so a simple band
 * around a mid price keeps generation cheap and always valid.
 */
export interface GenCandle {
  readonly dayOffset: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
}

/** fast-check arbitrary for one OHLC-valid candle at a given day-offset. */
function genCandleAt(dayOffset: number): fc.Arbitrary<GenCandle> {
  return fc
    .record({
      mid: fc.double({ min: 0.5, max: 2.0, noNaN: true }),
      spread: fc.double({ min: 0.0001, max: 0.05, noNaN: true }),
      openFrac: fc.double({ min: 0, max: 1, noNaN: true }),
      closeFrac: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    .map(({ mid, spread, openFrac, closeFrac }) => {
      const low = mid - spread;
      const high = mid + spread;
      const open = low + openFrac * (high - low);
      const close = low + closeFrac * (high - low);
      return { dayOffset, open, high, low, close };
    });
}

/**
 * Arbitrary for an ascending, strictly-increasing-date candle series of length
 * `[minLength, maxLength]`. Day-offsets are chosen as a strictly increasing
 * sequence so dates are unique and chronologically ordered.
 */
export function ascendingCandleSeries(options?: {
  minLength?: number;
  maxLength?: number;
}): fc.Arbitrary<readonly GenCandle[]> {
  const minLength = options?.minLength ?? 1;
  const maxLength = options?.maxLength ?? 30;
  return fc
    .uniqueArray(fc.integer({ min: 0, max: 2000 }), {
      minLength,
      maxLength,
    })
    .chain((offsets) => {
      const sorted = [...offsets].sort((a, b) => a - b);
      if (sorted.length === 0) {
        return fc.constant<readonly GenCandle[]>([]);
      }
      return fc.tuple(...sorted.map((off) => genCandleAt(off)));
    });
}

/** Convert generated candles into stored {@link Candle}s for a pair. */
export function toCandles(
  pair: Pair,
  gen: readonly GenCandle[],
): readonly Candle[] {
  return gen.map((c) => ({
    asset: pair,
    date: dateFromOffset(c.dayOffset),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

/** A minimal, well-formed pattern vector (values irrelevant to these tests). */
function makeVector(weeklyTrendSign: WeeklyTrendSign = "UP"): PatternVector {
  const scale10 = Array<number>(10).fill(0.1);
  const scale20 = Array<number>(20).fill(0.2);
  const scale40 = Array<number>(40).fill(0.4);
  return {
    scale10,
    scale20,
    scale40,
    embedding: [...scale10, ...scale20, ...scale40],
    weeklyTrendSign,
    dim: EMBEDDING_DIM,
  };
}

/** A PipelineStores backed by fresh in-memory stores, exposing the concretes. */
export interface InMemoryStoresBundle {
  readonly stores: PipelineStores;
  readonly candleStore: InMemoryCandleStore;
  readonly vectorStore: InMemoryPatternVectorStore;
  readonly analogueStore: InMemoryAnalogueStore;
}

/** Build a fresh in-memory PipelineStores bundle. */
export function makeInMemoryStores(): InMemoryStoresBundle {
  const candleStore = new InMemoryCandleStore();
  const vectorStore = new InMemoryPatternVectorStore();
  const analogueStore = new InMemoryAnalogueStore();
  return {
    stores: { candleStore, vectorStore, analogueStore },
    candleStore,
    vectorStore,
    analogueStore,
  };
}

/** Seed candles for a pair, and optionally a pattern vector per candle date. */
export async function seedPair(
  bundle: InMemoryStoresBundle,
  pair: Pair,
  candles: readonly Candle[],
  options?: { withVectors?: boolean },
): Promise<void> {
  await bundle.candleStore.upsertCandles(candles);
  if (options?.withVectors === true) {
    for (const candle of candles) {
      await bundle.vectorStore.upsertVector(pair, candle.date, makeVector());
    }
  }
}

/**
 * Snapshot every stored analogue outcome across the given pairs/dates as a
 * stable, JSON-serializable map keyed by (asset:date:horizon). Deterministic
 * ordering is irrelevant because the map key encodes identity; deep-comparing
 * two snapshots proves the `analogue_outcomes` state is identical.
 */
export async function snapshotAnalogueOutcomes(
  analogueStore: InMemoryAnalogueStore,
  pairs: readonly Pair[],
  dates: readonly TradingDate[],
): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {};
  for (const pair of pairs) {
    for (const date of dates) {
      const outcomes = await analogueStore.getOutcomes(pair, date);
      for (const record of outcomes) {
        const key = `${record.asset}:${record.decisionDate}:${record.horizon}`;
        snapshot[key] = JSON.parse(JSON.stringify(record)) as unknown;
      }
    }
  }
  return snapshot;
}
