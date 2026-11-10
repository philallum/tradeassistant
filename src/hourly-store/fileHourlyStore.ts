// File-backed hourly archive for OFFLINE use: one JSON-lines file per pair, sorted by openMs.
// Used by the local backfill and the hourly simulation; the live Job never touches it.
// Writes are whole-file and atomic enough for a single operator process.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { PAIRS, type Pair } from "../ingestion/types.js";
import type { HourlyBarRow, HourlyBarStore } from "./types.js";

function fileFor(dir: string, pair: Pair): string {
  return join(dir, `${pair}_H1.jsonl`);
}

function parse(pair: Pair, text: string): HourlyBarRow[] {
  const rows: HourlyBarRow[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line) as Partial<HourlyBarRow>;
    if (
      typeof r.openMs === "number" &&
      typeof r.open === "number" &&
      typeof r.high === "number" &&
      typeof r.low === "number" &&
      typeof r.close === "number"
    ) {
      rows.push({ pair, openMs: r.openMs, open: r.open, high: r.high, low: r.low, close: r.close, source: r.source ?? "file" });
    }
  }
  return rows;
}

export class FileHourlyBarStore implements HourlyBarStore {
  readonly #dir: string;
  readonly #cache = new Map<Pair, Map<number, HourlyBarRow>>();

  constructor(dir: string) {
    this.#dir = dir;
  }

  async #load(pair: Pair): Promise<Map<number, HourlyBarRow>> {
    const cached = this.#cache.get(pair);
    if (cached !== undefined) return cached;
    const map = new Map<number, HourlyBarRow>();
    try {
      for (const r of parse(pair, await readFile(fileFor(this.#dir, pair), "utf8"))) map.set(r.openMs, r);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.#cache.set(pair, map);
    return map;
  }

  async upsert(rows: readonly HourlyBarRow[]): Promise<void> {
    const touched = new Set<Pair>();
    for (const r of rows) {
      (await this.#load(r.pair)).set(r.openMs, r);
      touched.add(r.pair);
    }
    await mkdir(this.#dir, { recursive: true });
    for (const pair of touched) {
      const sorted = [...(await this.#load(pair)).values()].sort((a, b) => a.openMs - b.openMs);
      const text = sorted
        .map((r) => JSON.stringify({ openMs: r.openMs, open: r.open, high: r.high, low: r.low, close: r.close, source: r.source }))
        .join("\n");
      await writeFile(fileFor(this.#dir, pair), `${text}\n`, "utf8");
    }
  }

  async getRange(pair: Pair, fromMs: number, toMs: number): Promise<readonly HourlyBarRow[]> {
    return [...(await this.#load(pair)).values()]
      .filter((r) => r.openMs >= fromMs && r.openMs < toMs)
      .sort((a, b) => a.openMs - b.openMs);
  }

  /** Range covered per pair, for reporting. */
  async coverage(): Promise<readonly { readonly pair: Pair; readonly bars: number; readonly firstMs: number | null; readonly lastMs: number | null }[]> {
    const out = [];
    for (const pair of PAIRS) {
      const rows = [...(await this.#load(pair)).keys()].sort((a, b) => a - b);
      out.push({ pair, bars: rows.length, firstMs: rows[0] ?? null, lastMs: rows[rows.length - 1] ?? null });
    }
    return out;
  }
}
