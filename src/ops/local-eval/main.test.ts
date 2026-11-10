import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { LivingDocs, InMemoryDocStore } from "../../living-docs/livingDocs.js";
import { PAIRS } from "../../ingestion/types.js";
import { buildLocalEvalStores } from "./localStores.js";
import { parseArgs, runLocalEdgeEval } from "./main.js";

const dir = mkdtempSync(join(tmpdir(), "local-eval-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Deterministic pseudo-random walk (LCG) so the fixture is reproducible. */
function writeCsv(pair: string, seed: number, days: number): void {
  let x = seed;
  const rnd = (): number => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
  const lines = ["Time\tOpen\tHigh\tLow\tClose\tVolume"];
  const d = new Date("2022-01-03T00:00:00Z");
  let price = pair.endsWith("JPY") ? 110 : 1.2;
  let n = 0;
  while (n < days) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const open = price;
      const close = price * (1 + (rnd() - 0.5) * 0.01);
      const high = Math.max(open, close) * (1 + rnd() * 0.003);
      const low = Math.min(open, close) * (1 - rnd() * 0.003);
      lines.push(`${d.toISOString().slice(0, 10)} 00:00:00\t${open}\t${high}\t${low}\t${close}\t1\t1`);
      price = close;
      n += 1;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  writeFileSync(join(dir, `${pair}_D1.csv`), lines.join("\n"));
}
PAIRS.forEach((p, i) => writeCsv(p, 1000 + i, 520));

describe("local evaluation", () => {
  it("builds all three stores from CSV without any network or database", async () => {
    const { stores, evalDate, candlesLoaded } = await buildLocalEvalStores({ dataDir: dir, log: () => undefined });
    expect(candlesLoaded).toBeGreaterThan(5 * 500); // the range guard may reject a few synthetic days
    expect(evalDate > "2023-12-01").toBe(true);
    const vectors = await stores.vectorStore.getVectorsByAsset("EURUSD");
    expect(vectors.length).toBeGreaterThan(400);
    const outcomes = await stores.analogueStore.getMaturedOutcomes("EURUSD", evalDate);
    expect(outcomes.length).toBeGreaterThan(400);
  }, 120_000);

  it("edge-eval completes end to end on a small seeded set", async () => {
    const result = await runLocalEdgeEval({
      dataDir: dir,
      log: () => undefined,
      edgeEval: {
        docs: new LivingDocs(new InMemoryDocStore()),
        windows: [
          {
            id: "smoke",
            inSample: { start: "2022-01-03", end: "2022-12-30" },
            outOfSample: { start: "2023-01-02", end: "2023-06-30" },
          },
        ],
      },
    });
    expect(result.completed).toBe(true);
  }, 300_000);

  it("parses strict arguments", () => {
    expect(parseArgs(["--dir", "x"])).toEqual({ dataDir: "x" });
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});

describe("flat A/B", () => {
  it("runs every arm on a small seeded set and reports comparable, bounded numbers", async () => {
    const { runFlatAb, renderFlatAbLines } = await import("./flatAb.js");
    const window = { start: "2023-01-02", end: "2023-06-30" };
    const results = await runFlatAb({ dataDir: dir, window, log: () => undefined });
    expect(results.map((r) => r.arm.id)).toEqual(["live_legacy", "atr_band", "aligned_label", "atr_band_aligned"]);
    const legacy = results[0]!;
    const atr = results[1]!;
    // Legacy band is ~0, so analogues are essentially never FLAT; the ATR band makes many FLAT.
    expect(legacy.analogueClassBalance.FLAT).toBeLessThan(0.02);
    expect(atr.analogueClassBalance.FLAT).toBeGreaterThan(0.3);
    for (const r of results) {
      expect(r.directional.model.rate).toBeGreaterThanOrEqual(0);
      expect(r.directional.model.rate).toBeLessThanOrEqual(1);
    }
    expect(renderFlatAbLines(results, window).join("\n")).not.toMatch(/PASS|CUT|KILL/);
  }, 600_000);
});

describe("look-ahead safety of day records", () => {
  it("a record for date D is unchanged when candles long after D are altered", async () => {
    const { collectDayRecords } = await import("./dayRecords.js");
    const { readFileSync } = await import("node:fs");
    const { mkdirSync } = await import("node:fs");
    const cutoff = "2023-02-01"; // alter everything after this date
    const checkWindow = { start: "2022-09-01", end: "2022-11-30" }; // well before the cutoff (> 3 sessions)
    const altered = mkdtempSync(join(tmpdir(), "local-eval-alt-"));
    mkdirSync(altered, { recursive: true });
    for (const pair of PAIRS) {
      const lines = readFileSync(join(dir, `${pair}_D1.csv`), "utf8").split("\n");
      const out = lines.map((line, i) => {
        if (i === 0 || line.length === 0) return line;
        const cols = line.split("\t");
        if ((cols[0] ?? "").slice(0, 10) <= cutoff) return line;
        for (const k of [1, 2, 3, 4]) cols[k] = String(Number(cols[k]) * 1.07);
        return cols.join("\t");
      });
      writeFileSync(join(altered, `${pair}_D1.csv`), out.join("\n"));
    }
    try {
      const a = await buildLocalEvalStores({ dataDir: dir, log: () => undefined });
      const b = await buildLocalEvalStores({ dataDir: altered, log: () => undefined });
      const ra = await collectDayRecords(a.stores, { window: checkWindow });
      const rb = await collectDayRecords(b.stores, { window: checkWindow });
      expect(ra.length).toBeGreaterThan(100);
      expect(rb.length).toBe(ra.length);
      for (let i = 0; i < ra.length; i += 1) {
        const withoutRealized = (r: object): object =>
          Object.fromEntries(Object.entries(r).filter(([k]) => k !== "realizedAfter" && k !== "realizedOn"));
        expect(withoutRealized(rb[i]!)).toEqual(withoutRealized(ra[i]!));
      }
    } finally {
      rmSync(altered, { recursive: true, force: true });
    }
  }, 300_000);
});

describe("evidence run", () => {
  it("renders baselines and slices on a small seeded set without consulting the holdout", async () => {
    const { runEvidence } = await import("./evidenceRun.js");
    const result = await runEvidence({
      dataDir: dir,
      discovery: { start: "2022-09-01", end: "2023-06-30" },
      log: () => undefined,
    });
    const text = result.lines.join("\n");
    expect(text).toContain("NOT consulted");
    expect(text).toContain("always_long");
    expect(text).toContain("follow_yesterday");
    expect(text).toContain("random_direction");
    expect(text).toMatch(/cells examined=\d+/);
    expect(text).not.toMatch(/PASS|CUT|KILL/);
    expect(result.slicesTested).toBeGreaterThan(0);
  }, 300_000);
});

describe("ATR filter default-off identity", () => {
  it("collecting with no filter is identical to the baseline, and a filter never raises n", async () => {
    const { collectDayRecords } = await import("./dayRecords.js");
    const { atrSimilarityFilter } = await import("./atrFilterExperiment.js");
    const built = await buildLocalEvalStores({ dataDir: dir, log: () => undefined });
    const window = { start: "2023-01-02", end: "2023-03-31" };
    const base = await collectDayRecords(built.stores, { window });
    const again = await collectDayRecords(built.stores, { window });
    expect(again).toEqual(base);
    const filtered = await collectDayRecords(built.stores, { window, neighbourhoodFilter: atrSimilarityFilter(1.5) });
    expect(filtered.length).toBe(base.length);
    for (let i = 0; i < base.length; i += 1) expect(filtered[i]!.n).toBeLessThanOrEqual(base[i]!.n);
  }, 300_000);
});
