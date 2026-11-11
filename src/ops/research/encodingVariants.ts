// Part B of docs/research/PRE-REGISTRATION-2.md: alternative analogue embeddings (offline only).
//
// Builds in-memory pattern-vector stores whose embeddings mix the live 70-number shape with the
// fixed-scaling chart-feature vector. Outcomes (the analogue store) and candles are shared with the
// live pipeline, so only the encoding and the retrieval policy differ. Nothing here touches live
// code, hosted data or the holdout: retrieval for a date only ever sees strictly earlier dates.
import type { PatternVector, WeeklyTrendSign } from "../../encoder/types.js";
import { InMemoryPatternVectorStore } from "../../encoder/types.js";
import { PAIRS } from "../../ingestion/types.js";
import type { PipelineStores } from "../../pipeline/types.js";
import type { RetrievalConfig } from "../../retrieval/types.js";
import { computeChartFeatures, featureVector } from "./chartFeatures.js";

export type VariantId = "V0b" | "V1" | "V2" | "V3" | "V4";

export interface VariantSpec {
  readonly id: VariantId;
  readonly description: string;
  readonly usesShape: boolean;
  readonly usesFeatures: boolean;
  /** Keep the weekly-trend-sign prefilter (live behaviour). False = compare with all past days. */
  readonly prefilter: boolean;
  /** The control this variant is compared with in the pre-registered comparisons. */
  readonly control: VariantId | null;
}

export const VARIANTS: readonly VariantSpec[] = [
  { id: "V0b", description: "live shape, k=30, no cutoff, weekly-trend prefilter (control)", usesShape: true, usesFeatures: false, prefilter: true, control: null },
  { id: "V1", description: "shape + chart features, k=30, prefilter", usesShape: true, usesFeatures: true, prefilter: true, control: "V0b" },
  { id: "V2", description: "chart features only, k=30, prefilter", usesShape: false, usesFeatures: true, prefilter: true, control: "V0b" },
  { id: "V3", description: "shape + chart features, k=30, NO prefilter", usesShape: true, usesFeatures: true, prefilter: false, control: "V1" },
  { id: "V4", description: "live shape, k=30, NO prefilter (control for dropping the prefilter)", usesShape: true, usesFeatures: false, prefilter: false, control: "V0b" },
];

/** Fixed-k retrieval for the variants: the 30 nearest analogues, no distance cutoff (cosine distance <= 2). */
export const VARIANT_RETRIEVAL: RetrievalConfig = { k: 30, epsilon: 2 };

function unit(v: readonly number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s);
  return n === 0 ? v.map(() => 0) : v.map((x) => x / n);
}

/** The variant's embedding, or null when a required input is unavailable. */
export function variantEmbedding(
  spec: VariantSpec,
  shape: readonly number[],
  features: readonly number[] | null,
): number[] | null {
  if (spec.usesFeatures && features === null) return null;
  const parts: number[][] = [];
  if (spec.usesShape) parts.push(unit(shape));
  if (spec.usesFeatures) parts.push(unit(features as readonly number[]));
  return parts.flat();
}

/** Build a variant's stores from the live stores. Outcomes and candles are shared, not copied. */
export async function buildVariantStores(base: PipelineStores, spec: VariantSpec): Promise<PipelineStores> {
  const vectorStore = new InMemoryPatternVectorStore();
  for (const pair of PAIRS) {
    const candles = await base.candleStore.getCandles(pair);
    const indexByDate = new Map<string, number>();
    candles.forEach((c, i) => indexByDate.set(c.date, i));
    const stored = await base.vectorStore.getVectorsByAsset(pair);
    for (const v of stored) {
      const i = indexByDate.get(v.decisionDate);
      if (i === undefined) continue;
      let fv: number[] | null = null;
      if (spec.usesFeatures) {
        const f = computeChartFeatures(candles.slice(Math.max(0, i - 130), i));
        fv = f === null ? null : featureVector(f);
      }
      const embedding = variantEmbedding(spec, v.embedding, fv);
      if (embedding === null) continue;
      const sign: WeeklyTrendSign = spec.prefilter ? v.weeklyTrendSign : "UP";
      const pv: PatternVector = {
        scale10: v.scaleDims.scale10,
        scale20: v.scaleDims.scale20,
        scale40: v.scaleDims.scale40,
        embedding,
        weeklyTrendSign: sign,
        dim: embedding.length,
      };
      await vectorStore.upsertVector(pair, v.decisionDate, pv);
    }
  }
  return { candleStore: base.candleStore, vectorStore, analogueStore: base.analogueStore };
}
