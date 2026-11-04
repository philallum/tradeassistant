import { describe, expect, it } from "vitest";

import type { ConfluenceCell, ConfluencePair, TrackRecord } from "../api/types";
import { EMPTY_CONFLUENCE, EMPTY_TRACK_RECORD } from "../api/snapshot";
import { SMALL_SAMPLE_CALLS, shapeStrategyCards } from "./shapeStrategyCards";

const W = EMPTY_CONFLUENCE.weights;
const avail = (id: ConfluenceCell["strategyId"], d: "UP" | "DOWN" | "FLAT", s = 0.7): ConfluenceCell => ({
  strategyId: id,
  available: true,
  direction: d,
  strength: d === "FLAT" ? 0 : s,
  rationale: `${id} technical rationale`,
});
const ids = ["trend", "breakout", "range", "reversal", "custom_pattern", "third_party"] as const;
const pairRow = (
  cells: Partial<Record<(typeof ids)[number], ConfluenceCell>>,
  status: ConfluencePair["status"] = "NEUTRAL",
  opposing: ConfluencePair["opposingStrategyIds"] = [],
): ConfluencePair => ({
  pair: "EURUSD",
  score: 0,
  status,
  opposingStrategyIds: opposing,
  cells: ids.map((id) => cells[id] ?? avail(id, "FLAT")),
});

describe("shapeStrategyCards", () => {
  it("always yields six cards in the fixed order", () => {
    const cards = shapeStrategyCards(pairRow({}), "EURUSD", W, EMPTY_TRACK_RECORD);
    expect(cards.map((c) => c.strategyId)).toEqual([...ids]);
    expect(cards.map((c) => c.title)).toEqual(["Trend", "Breakout", "Range", "Reversal", "Pattern", "Third party"]);
  });

  it("a pair with no confluence row still yields six unavailable cards", () => {
    const cards = shapeStrategyCards(null, "EURUSD", W, EMPTY_TRACK_RECORD);
    expect(cards).toHaveLength(6);
    expect(cards.every((c) => !c.available && c.direction === null)).toBe(true);
  });

  it("copies direction and strength, and gives a plain-English meaning plus the technical detail", () => {
    const [trend] = shapeStrategyCards(
      pairRow({ trend: avail("trend", "DOWN", 0.97) }),
      "EURUSD",
      W,
      EMPTY_TRACK_RECORD,
    );
    expect(trend).toMatchObject({
      directionLabel: "Down",
      glyph: "\u25BC",
      strengthText: "Strength 0.97",
      meaning: "Short-term average is below the long-term average and falling.",
      detail: "trend technical rationale",
    });
  });

  it("a FLAT card shows no strength and a 'nothing happening' meaning", () => {
    const [trend] = shapeStrategyCards(pairRow({}), "EURUSD", W, EMPTY_TRACK_RECORD);
    expect(trend!.strengthText).toBe("");
    expect(trend!.meaning).toBe("No clear trend.");
  });

  it("an unavailable cell carries its reason, never a direction", () => {
    const cards = shapeStrategyCards(
      pairRow({ range: { strategyId: "range", available: false, reason: "insufficient_data" } }),
      "EURUSD",
      W,
      EMPTY_TRACK_RECORD,
    );
    const range = cards[2]!;
    expect(range).toMatchObject({ available: false, direction: null, directionLabel: "Unavailable", detail: "insufficient_data" });
  });

  it("the third party is display-only and has no track record", () => {
    const cards = shapeStrategyCards(pairRow({}), "EURUSD", W, EMPTY_TRACK_RECORD);
    const third = cards[5]!;
    expect(third.displayOnly).toBe(true);
    expect(third.record.kind).toBe("display-only");
    expect(third.accessibleName).toContain("display-only");
  });

  it("states the track record in words, flagging a small sample", () => {
    const track: TrackRecord = {
      lookbackDays: 60,
      strategies: [
        { pair: "EURUSD", strategyId: "trend", calls: 31, correct: 12 },
        { pair: "EURUSD", strategyId: "breakout", calls: SMALL_SAMPLE_CALLS - 1, correct: 5 },
        { pair: "EURUSD", strategyId: "range", calls: 0, correct: 0 },
      ],
      rangeForecast: [],
    };
    const cards = shapeStrategyCards(pairRow({}), "EURUSD", W, track);
    expect(cards[0]!.record).toMatchObject({ kind: "measured", smallSample: false, text: "Right 12 of 31 recent calls." });
    expect(cards[1]!.record).toMatchObject({ kind: "measured", smallSample: true });
    expect(cards[1]!.record.text).toContain("small sample");
    expect(cards[2]!.record).toMatchObject({ kind: "no-calls", text: "No recent calls." });
    // Reversal has no row at all: stated as not measured, never defaulted to a number.
    expect(cards[3]!.record).toMatchObject({ kind: "not-measured", calls: 0 });
  });

  it("does not leak another pair's record", () => {
    const track: TrackRecord = {
      lookbackDays: 60,
      strategies: [{ pair: "GBPUSD", strategyId: "trend", calls: 40, correct: 30 }],
      rangeForecast: [],
    };
    expect(shapeStrategyCards(pairRow({}), "EURUSD", W, track)[0]!.record.kind).toBe("not-measured");
  });

  it("marks exactly the opposing cards of a Split as conflicting", () => {
    const cards = shapeStrategyCards(
      pairRow({ trend: avail("trend", "DOWN"), custom_pattern: avail("custom_pattern", "UP") }, "CONFLICT_FLAT", [
        "trend",
        "custom_pattern",
      ]),
      "EURUSD",
      W,
      EMPTY_TRACK_RECORD,
    );
    expect(cards.filter((c) => c.conflicting).map((c) => c.strategyId)).toEqual(["trend", "custom_pattern"]);
  });
});
