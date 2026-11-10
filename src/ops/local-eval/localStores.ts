// Local evaluation stores (offline, no database, no network, no secrets).
//
// WHY: heavy evaluations (edge-eval, slicing, FLAT A/B) read the full pattern-vector and
// analogue history; against the hosted Supabase project that blew the free-plan egress quota
// (docs/state/RISKS.md), so the hosted target refuses them. This builds the SAME three storage
// ports (`PipelineStores`) from the seed CSVs entirely in memory by running the project's own
// encoder and resolver, so evaluation code runs unchanged and cannot touch hosted data.
//
// It re-implements nothing: CSV -> `CsvLoader`/`OhlcIngestion` -> `encodeAllForPair` ->
// `resolveHistoricalOutcomes` are the production code paths. Cosine ranking is client-side in
// both backends, so retrieval results do not depend on which store is used.
import { InMemoryPatternVectorStore } from "../../encoder/types.js";
import { encodeAllForPair } from "../../encoder/encodeStoredCandles.js";
import { CsvLoader } from "../../csv-loader/csvLoader.js";
import type { TradingDate } from "../../guard/types.js";
import { OhlcIngestion } from "../../ingestion/ohlcIngestion.js";
import { InMemoryCandleStore, PAIRS } from "../../ingestion/types.js";
import type { PipelineStores } from "../../pipeline/types.js";
import type { FlatBandMode, LabelAlignment } from "../../retrieval/resolver.js";
import { InMemoryAnalogueStore } from "../../retrieval/types.js";
import { resolveHistoricalOutcomes } from "../outcome-resolution/outcomeResolution.js";

export interface LocalEvalStoresOptions {
  /** Directory holding the five `<PAIR>_D1.csv` seed files. */
  readonly dataDir: string;
  /**
   * Evaluation date stamped on resolved outcomes (drives their `matured` flag). Defaults to the
   * day after the latest stored candle, so every outcome with forward candles is matured.
   */
  readonly evalDate?: TradingDate;
  /** FLAT dead-band definition for the resolved outcomes. Omitted = legacy (the live behaviour). */
  readonly flatBandMode?: FlatBandMode;
  /** Which session outcomes measure. Omitted = the live convention (after the decision date). */
  readonly labelAlignment?: LabelAlignment;
  readonly log?: (event: object) => void;
}

export interface LocalEvalStores {
  readonly stores: PipelineStores;
  readonly evalDate: TradingDate;
  readonly candlesLoaded: number;
}

function nextDay(date: TradingDate): TradingDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function buildLocalEvalStores(options: LocalEvalStoresOptions): Promise<LocalEvalStores> {
  const log = options.log ?? ((e: object) => console.log(JSON.stringify(e)));
  const candleStore = new InMemoryCandleStore();
  const vectorStore = new InMemoryPatternVectorStore();
  const analogueStore = new InMemoryAnalogueStore();
  const stores: PipelineStores = { candleStore, vectorStore, analogueStore };

  // Quiet ingestion logger: the ingestion module logs per-batch; the summary below is enough.
  const loader = new CsvLoader(new OhlcIngestion(candleStore, () => undefined));
  const { reports } = await loader.loadAll(options.dataDir, "backfill");
  const unreadable = reports.filter((r) => "reason" in r);
  if (unreadable.length > 0) {
    throw new Error(`local-eval: ${unreadable.length} CSV file(s) could not be loaded`);
  }

  let latest = "";
  let candlesLoaded = 0;
  for (const pair of PAIRS) {
    const candles = await candleStore.getCandles(pair);
    candlesLoaded += candles.length;
    const last = candles[candles.length - 1]?.date;
    if (last !== undefined && last > latest) latest = last;
  }
  if (candlesLoaded === 0) throw new Error("local-eval: no candles loaded from " + options.dataDir);
  log({ event: "local_eval.candles_loaded", candles: candlesLoaded, latest });

  for (const pair of PAIRS) {
    await encodeAllForPair(candleStore, vectorStore, pair);
  }
  log({ event: "local_eval.vectors_encoded" });

  const evalDate = options.evalDate ?? nextDay(latest);
  const resolved = await resolveHistoricalOutcomes({
    stores,
    evalDate,
    ...(options.flatBandMode !== undefined ? { flatBandMode: options.flatBandMode } : {}),
    ...(options.labelAlignment !== undefined ? { labelAlignment: options.labelAlignment } : {}),
  });
  log({ event: "local_eval.outcomes_resolved", evalDate, outcomesWritten: resolved.totalOutcomesWritten, flatBandMode: options.flatBandMode ?? "legacy", labelAlignment: options.labelAlignment ?? "after_decision_date" });

  return { stores, evalDate, candlesLoaded };
}
