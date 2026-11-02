// Feature: trader-edge-validation, Task 21: standing-guard verification (R12 scope
// discipline). Static + constant assertions that the spec added an evidence layer
// only: no execution/broker/LLM/new provider/new tunable (R12.2), the
// Confidence_Threshold is untouched (R12.3), every new artifact is deterministic
// and LLM-free, and the live decision path does not depend on any of them
// (R12.1, R12.4).
//
// **Validates: Requirements 12.1, 12.2, 12.3, 12.4**

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { captureFrozenBaseline, captureLiveParameterSet } from "../../walk-forward/parameterSet.js";
import { DEFAULT_CONFIDENCE_THRESHOLD } from "../../dashboard/types.js";
import { RISK_BOUNDARY_FLOOR } from "../../risk-boundaries/types.js";
import {
  DEFAULT_STOP_LOSS_PERCENTILE,
  DEFAULT_TAKE_PROFIT_PERCENTILE,
} from "../../risk-boundaries/types.js";
import { FIXED_PRIOR_WEIGHT } from "../../confidence/types.js";

const SRC = join(__dirname, "..", "..");

const NEW_MODULES = [
  "trade-sim",
  "trade-ledger",
  "performance",
  "walk-forward",
  "exposure",
  "provenance",
  "ops/edge-eval",
] as const;

const LIVE_PATH_MODULES = [
  "retrieval",
  "confidence",
  "risk-boundaries",
  "pipeline",
  "dashboard",
  "encoder",
  "baseline",
  "guard",
  "kill-gate",
] as const;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs: string[] = [];
  const re = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) specs.push(m[1] ?? m[2] ?? "");
  return specs;
}

/** Resolve a relative specifier to a path under src (e.g. "llm/types.js"). */
function resolveUnderSrc(file: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  return relative(SRC, join(file, "..", spec)).split("\\").join("/");
}

const FORBIDDEN_PREFIXES = ["llm/", "rationale/", "external-signal/"];
const FORBIDDEN_BARE = /broker|oanda|metatrader|ccxt|ibkr|alpaca|axios|node-fetch|undici|^node:(http|https|net|tls|dgram)$|^https?$|gemini|openai|anthropic/i;

describe("R12.2/R12.1 new artifacts are deterministic and LLM/broker/network free", () => {
  for (const mod of NEW_MODULES) {
    it(`${mod} has no LLM, rationale, third-party provider, broker or network imports`, () => {
      const files = sourceFiles(join(SRC, mod));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        for (const spec of importSpecifiers(file)) {
          const rel = resolveUnderSrc(file, spec);
          if (rel !== null) {
            for (const p of FORBIDDEN_PREFIXES) {
              expect(rel.startsWith(p), `${file} imports ${spec}`).toBe(false);
            }
          } else {
            expect(FORBIDDEN_BARE.test(spec), `${file} imports ${spec}`).toBe(false);
          }
        }
        const text = readFileSync(file, "utf8");
        expect(/\bfetch\s*\(/.test(text), `${file} calls fetch`).toBe(false);
        expect(/Math\.random\s*\(/.test(text), `${file} uses Math.random`).toBe(false);
      }
    });
  }

  it("no broker / execution module directory was added under src", () => {
    const dirs = readdirSync(SRC).filter((n) => statSync(join(SRC, n)).isDirectory());
    for (const d of dirs) expect(/broker|order|execution-engine|autotrade/i.test(d)).toBe(false);
  });
});

describe("R12.1/R12.4 live decision path does not import the new modules", () => {
  const newTargets = NEW_MODULES.map((m) => `${m}/`);
  for (const mod of LIVE_PATH_MODULES) {
    it(`${mod} imports none of the new modules`, () => {
      for (const file of sourceFiles(join(SRC, mod))) {
        for (const spec of importSpecifiers(file)) {
          const rel = resolveUnderSrc(file, spec);
          if (rel === null) continue;
          // The one sanctioned dependency: the resolver's lifted pure pip helper
          // (task 1, proven byte-identical by its parity test).
          if (rel === "trade-sim/pip.js" && file.endsWith("retrieval/resolver.ts")) continue;
          expect(
            newTargets.some((t) => rel.startsWith(t)),
            `${file} imports ${spec}`,
          ).toBe(false);
        }
      }
    });
  }

});

describe("R12.2/R12.3 live constants are unchanged", () => {
  it("Confidence_Threshold is still 0.55", () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.55);
  });

  it("risk floor, percentiles and shrinkage weight are unchanged", () => {
    expect(RISK_BOUNDARY_FLOOR).toBe(30);
    expect(DEFAULT_STOP_LOSS_PERCENTILE).toBe(75);
    expect(DEFAULT_TAKE_PROFIT_PERCENTILE).toBe(50);
    expect(FIXED_PRIOR_WEIGHT).toBe(10);
  });

  it("captureFrozenBaseline() reports exactly the pre-spec live values", () => {
    const { params } = captureFrozenBaseline({ now: () => new Date(0) });
    expect(params.confidenceThreshold).toBe(0.55);
    expect(params.stopLossPercentile).toBe(75);
    expect(params.takeProfitPercentile).toBe(50);
    expect(params.shrinkageWeight).toBe(10);
    expect(params.analogueFloor).toBe(30);
    expect(params.weeklyTrendFilter).toBe(false);
    expect(params.horizonSelection).toBe("best_resolution");
  });

  it("the ParameterSet holds no field beyond the already-existing tunables (no new knob)", () => {
    expect(Object.keys(captureLiveParameterSet()).sort()).toEqual(
      [
        "analogueFloor",
        "confidenceThreshold",
        "horizonSelection",
        "patternScales",
        "retrievalK",
        "shrinkageWeight",
        "similarityEpsilon",
        "stopLossPercentile",
        "takeProfitPercentile",
        "weeklyTrendFilter",
        "windowSize",
      ].sort(),
    );
  });
});
