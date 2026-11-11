import { describe, expect, it } from "vitest";

import { InMemoryPatternVectorStore } from "../../encoder/types.js";
import type { Candle } from "../../guard/types.js";
import type { PipelineStores } from "../../pipeline/types.js";
import { buildVariantStores, VARIANTS, VARIANT_RETRIEVAL, variantEmbedding, type VariantSpec } from "./encodingVariants.js";

const spec = (id: string): VariantSpec => VARIANTS.find((v) => v.id === id) as VariantSpec;
const feats = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.1, 0.2, 0.3, 0.4];
const shape = Array.from({ length: 70 }, (_, i) => Math.sin(i));

describe("variantEmbedding", () => {
  it("has the pre-registered dimensions", () => {
    expect(variantEmbedding(spec("V0b"), shape, null)).toHaveLength(70);
    expect(variantEmbedding(spec("V1"), shape, feats)).toHaveLength(83);
    expect(variantEmbedding(spec("V2"), shape, feats)).toHaveLength(13);
    expect(variantEmbedding(spec("V3"), shape, feats)).toHaveLength(83);
    expect(variantEmbedding(spec("V4"), shape, null)).toHaveLength(70);
  });

  it("is null when features are required but missing", () => {
    expect(variantEmbedding(spec("V1"), shape, null)).toBeNull();
    expect(variantEmbedding(spec("V2"), shape, null)).toBeNull();
  });

  it("each part is unit length so shape and features carry equal weight", () => {
    const e = variantEmbedding(spec("V1"), shape, feats) as number[];
    const norm = (v: number[]): number => Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    expect(norm(e.slice(0, 70))).toBeCloseTo(1, 12);
    expect(norm(e.slice(70))).toBeCloseTo(1, 12);
  });

  it("uses a fixed k = 30 with no distance cutoff", () => {
    expect(VARIANT_RETRIEVAL).toEqual({ k: 30, epsilon: 2 });
  });

  it("the pre-registered comparisons reference only defined variants", () => {
    const ids = new Set(VARIANTS.map((v) => v.id));
    for (const v of VARIANTS) if (v.control !== null) expect(ids.has(v.control)).toBe(true);
  });
});

function makeCandles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    const c = 100 + 3 * Math.sin(i / 4);
    return { asset: "EURUSD", date: d, open: c - 0.2, high: c + 1, low: c - 1, close: c };
  });
}

describe("buildVariantStores", () => {
  it("keeps or removes the weekly-trend prefilter and skips dates without enough history for features", async () => {
    const candles = makeCandles(200);
    const base = new InMemoryPatternVectorStore();
    for (const c of candles) {
      await base.upsertVector("EURUSD", c.date, {
        scale10: shape.slice(0, 10),
        scale20: shape.slice(0, 20),
        scale40: shape.slice(0, 40),
        embedding: shape,
        weeklyTrendSign: "DOWN",
        dim: 70,
      });
    }
    const stores = {
      candleStore: { getCandles: (p: string) => Promise.resolve(p === "EURUSD" ? candles : []) },
      vectorStore: base,
      analogueStore: {},
    } as unknown as PipelineStores;

    const v1 = await buildVariantStores(stores, spec("V1"));
    const v3 = await buildVariantStores(stores, spec("V3"));
    const v4 = await buildVariantStores(stores, spec("V4"));

    const early = candles[10] as Candle;
    const late = candles[190] as Candle;
    expect(await v1.vectorStore.getVector("EURUSD", early.date)).toBeNull(); // too little history for features
    expect(await v4.vectorStore.getVector("EURUSD", early.date)).not.toBeNull(); // shape-only keeps it
    expect((await v1.vectorStore.getVector("EURUSD", late.date))?.weeklyTrendSign).toBe("DOWN");
    expect((await v3.vectorStore.getVector("EURUSD", late.date))?.weeklyTrendSign).toBe("UP");
    expect((await v1.vectorStore.getVector("EURUSD", late.date))?.embedding).toHaveLength(83);
    expect(v1.analogueStore).toBe(stores.analogueStore);
  });
});
