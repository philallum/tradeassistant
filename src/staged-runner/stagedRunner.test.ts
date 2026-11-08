// StagedRunner: the retained `backfill` stage and the `hasBacktestData` prerequisite check.
//
// Validates: Requirements 2.1, 2.2, 2.7
//
// EXAMPLE-BASED unit tests (not property tests). The legacy `backtest` (PASS/CUT verdict),
// `forwardLook` and `runAll` stages were removed in codebase-housekeeping Task 5; the live
// evaluation write path is `src/ops/evaluation-run/main.ts`, which reuses `buildFoldInputs`
// and `hasBacktestData` from this module. Backfill's vector/candle correspondence is also
// covered by the Property 7 test.

import { describe, it, expect } from "vitest";
import { backfill, hasBacktestData } from "./stagedRunner.js";
import { buildCsvContent, makeTestDeps } from "./testHelpers.js";

/** A chronological run of trading dates long enough to seed candles+vectors. */
const DATES: readonly string[] = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2015, 0, 5) + i * 86_400_000).toISOString().slice(0, 10),
);

describe("StagedRunner - retained backfill stage and prerequisite check", () => {
  it("backfill runs standalone and stores candles + vectors (Req 2.1, 2.2)", async () => {
    const deps = makeTestDeps({ EURUSD: buildCsvContent([...DATES]) });

    const result = await backfill(deps, "backfill");

    expect(result.ok).toBe(true);
    const candles = await deps.ingestion.getCandles("EURUSD");
    const vectors = await deps.vectorStore.getVectorsByAsset("EURUSD");
    expect(candles.length).toBeGreaterThan(0);
    expect(vectors.length).toBeGreaterThan(0);
  });

  it("hasBacktestData is false before backfill and true once candles + vectors exist (Req 2.7)", async () => {
    const deps = makeTestDeps({ EURUSD: buildCsvContent([...DATES]) });

    expect(await hasBacktestData(deps)).toBe(false);

    await backfill(deps, "backfill");

    expect(await hasBacktestData(deps)).toBe(true);
  });
});
