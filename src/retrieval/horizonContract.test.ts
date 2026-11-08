import { describe, expect, it } from "vitest";

import { earnedConfidence, selectHorizon } from "../confidence/confidenceSelector.js";
import { InMemoryPatternVectorStore } from "../encoder/types.js";
import { encodePatternVector } from "../encoder/patternEncoder.js";
import type { Candle } from "../guard/types.js";
import type { Pair } from "../ingestion/types.js";
import { dominantDirection } from "../pipeline/dailyPipeline.js";
import { retrieve } from "./retrieve.js";
import { InMemoryAnalogueStore } from "./types.js";
import type { AnalogueRecord, DirectionClass } from "./types.js";

// Characterization test (codebase-housekeeping Task 1, decision R1).
//
// CONTRACT BEING PINNED: the system is effectively HORIZON-1 ONLY.
//   - The AnalogueStore returns rows for ALL horizons (1, 2, 3) per analogue date.
//   - `retrieve` collapses them to ONE representative record per analogue date: the
//     smallest horizon (see the "representative record" comment in retrieve.ts).
//   - Every horizon-aware consumer (rawResolutionRate, analogueCount, dominantDirection,
//     excursionProfileAt, deriveRiskBoundaries) therefore sees n = 0 at horizons 2 and 3.
//   - Consequently `selectHorizon` returns 1 whenever the horizon-1 rate is above 0.5, and
//     a horizon-1 rate below 0.5 selects an EMPTY horizon whose Earned_Confidence is exactly
//     the 0.5 neutral prior and whose direction is FLAT - so that pair cannot fire.
//
// This test documents CURRENT behaviour. Making horizons 2/3 real is a separate future spec;
// if that work changes `retrieve`, this test is expected to change with it.

const PAIR: Pair = "EURUSD";
const DECISION_DATE = "2023-09-01";
const CONFIDENCE_THRESHOLD = 0.55;

/** A weekday-only candle window with a deterministic uptrend. */
function buildWindow(startDate: string, count: number): Candle[] {
  const candles: Candle[] = [];
  let price = 1.1;
  let offset = 0;
  while (candles.length < count) {
    const dt = new Date(new Date(`${startDate}T00:00:00Z`).getTime() + offset * 86_400_000);
    offset++;
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    price += 0.002;
    candles.push({
      asset: PAIR,
      date: dt.toISOString().slice(0, 10),
      open: price,
      high: price + 0.004,
      low: price - 0.004,
      close: price,
      source: "test",
    });
  }
  return candles;
}

function addDays(date: string, days: number): string {
  const dt = new Date(`${date}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function outcome(date: string, horizon: 1 | 2 | 3, direction: DirectionClass): AnalogueRecord {
  return {
    asset: PAIR,
    decisionDate: date,
    horizon,
    direction,
    mfePips: 20,
    maePips: 8,
    atr14: 0.009,
    matured: true,
  };
}

/**
 * Seed ten identical-shape analogue dates (distance 0 to the query), each with matured
 * outcomes at ALL THREE horizons. `h1Directions[i]` is the horizon-1 direction of the i-th
 * analogue; horizons 2 and 3 are always DOWN so any leak of them would be visible.
 */
async function seed(h1Directions: readonly DirectionClass[]) {
  const window = buildWindow("2023-01-02", 50); // ends well before every analogue date
  const vectorStore = new InMemoryPatternVectorStore();
  const analogueStore = new InMemoryAnalogueStore();
  const query = encodePatternVector(window, DECISION_DATE);

  for (const [i, h1] of h1Directions.entries()) {
    const date = addDays("2023-04-03", i);
    await vectorStore.upsertVector(PAIR, date, encodePatternVector(window, date));
    await analogueStore.upsertOutcome(outcome(date, 1, h1));
    await analogueStore.upsertOutcome(outcome(date, 2, "DOWN"));
    await analogueStore.upsertOutcome(outcome(date, 3, "DOWN"));
  }

  const neighborhood = await retrieve(
    query,
    PAIR,
    DECISION_DATE,
    DECISION_DATE,
    vectorStore,
    analogueStore,
    { k: 200, epsilon: 0.2 },
  );
  return { analogueStore, neighborhood };
}

const fires = (direction: DirectionClass, confidence: number): boolean =>
  direction !== "FLAT" && confidence >= CONFIDENCE_THRESHOLD;

describe("horizon contract: the system is horizon-1 only (R1)", () => {
  it("the store holds all three horizons per date, but retrieve returns only horizon 1", async () => {
    const { analogueStore, neighborhood } = await seed(Array<DirectionClass>(10).fill("UP"));

    const stored = await analogueStore.getMaturedOutcomes(PAIR, DECISION_DATE);
    expect(new Set(stored.map((r) => r.horizon))).toEqual(new Set([1, 2, 3]));
    expect(stored).toHaveLength(30);

    expect(neighborhood).toHaveLength(10);
    expect(new Set(neighborhood.map((r) => r.horizon))).toEqual(new Set([1]));
    // The representative record is the horizon-1 one, not the horizon-2/3 DOWN rows.
    expect(neighborhood.every((r) => r.direction === "UP")).toBe(true);
  });

  it("selects horizon 1 when the horizon-1 rate is above 0.5", async () => {
    // 8 UP / 2 DOWN at horizon 1 -> raw rate 0.8.
    const { neighborhood } = await seed([
      ...Array<DirectionClass>(8).fill("UP"),
      ...Array<DirectionClass>(2).fill("DOWN"),
    ]);

    expect(selectHorizon(neighborhood)).toBe(1);
    expect(dominantDirection(neighborhood, 1)).toBe("UP");
    expect(neighborhood.filter((r) => r.horizon === 2)).toHaveLength(0);
    expect(neighborhood.filter((r) => r.horizon === 3)).toHaveLength(0);
  });

  it("a horizon-1 rate below 0.5 selects an EMPTY horizon with the 0.5 prior and does not fire", async () => {
    // 4 UP / 3 DOWN / 3 FLAT at horizon 1 -> raw rate 0.4, below the 0.5 neutral prior.
    const { neighborhood } = await seed([
      ...Array<DirectionClass>(4).fill("UP"),
      ...Array<DirectionClass>(3).fill("DOWN"),
      ...Array<DirectionClass>(3).fill("FLAT"),
    ]);

    const horizon = selectHorizon(neighborhood);
    expect(horizon).toBe(2); // the empty horizon wins on the 0.5 prior; ties go to the shorter one
    expect(neighborhood.filter((r) => r.horizon === horizon)).toHaveLength(0);

    const confidence = earnedConfidence(neighborhood, horizon);
    const direction = dominantDirection(neighborhood, horizon);
    expect(confidence).toBe(0.5);
    expect(direction).toBe("FLAT");
    expect(fires(direction, confidence)).toBe(false);
  });
});
