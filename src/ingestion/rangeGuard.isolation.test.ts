// The range guard is an INGESTION-time storage gate only. This structural test pins that the
// deterministic scoring/firing modules never import it, so it cannot change how a decision is
// computed from stored candles: it can only decide whether a bad candle is stored at all.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCORING_DIRS = [
  "pipeline",
  "encoder",
  "retrieval",
  "confidence",
  "baseline",
  "risk-boundaries",
  "kill-gate",
  "dashboard",
  "strategies",
  "guard",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("range guard isolation", () => {
  it("is not imported by any deterministic scoring/firing module", () => {
    const offenders = SCORING_DIRS.flatMap((d) => sourceFiles(join(SRC, d))).filter((file) =>
      /rangeGuard(\.js)?["']/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
