import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RISK_NOTE } from "./riskNote";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/riskNote\.test\.ts$/.test(name) ? [full] : [];
  });
}

describe("honest copy", () => {
  it("the risk note is generic and not advisory", () => {
    expect(RISK_NOTE).toMatch(/not advice/i);
    expect(RISK_NOTE).toMatch(/USD/);
  });

  it("no web source claims a 1-3 day horizon", () => {
    const offenders = sourceFiles(join(__dirname, "..")).filter((f) =>
      /1\s*[-\u2013]\s*3[ -]days?|1 to 3 days?/i.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
