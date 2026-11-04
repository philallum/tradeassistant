/**
 * Pure conviction shaper: turns one pair's confluence into a plain-English TIER plus the
 * VOTE TALLY behind it. It retires the bare "Neutral" label, which hid two very different
 * situations ("nobody has a view" and "strategies disagree").
 *
 * Tiers (the engine's own `status` is untouched; this is presentation only):
 *   - ALIGNED  the engine found a clear consensus (|score| at or above the alignment bar);
 *   - SPLIT    strong opposition (the engine's CONFLICT_FLAT), or an exact UP/DOWN tie;
 *   - LEAN     more voting strategies point one way than the other, below the alignment bar;
 *   - NO_VIEW  no voting strategy has a direction (or there is no usable data).
 *
 * "Voters" are the strategies that are available AND carry a positive weight; the
 * display-only third party never votes. The tally counts voters by direction, so
 * "1 up · 1 down · 3 flat" says exactly why a pair is split.
 *
 * Pure: no fetch, DOM, clock, or core import. Recomputes no score; it counts and labels.
 */
import type { ConfluencePair, ConfluenceStrategyId, Confluence, Direction } from "../api/types";

export type ConvictionTier = "ALIGNED" | "SPLIT" | "LEAN" | "NO_VIEW";

export interface VoteTally {
  readonly up: number;
  readonly down: number;
  readonly flat: number;
  /** Positive-weight strategies with no usable signal. */
  readonly unavailable: number;
}

export interface ConvictionVM {
  readonly tier: ConvictionTier;
  /** Direction of an ALIGNED or LEAN call; null for SPLIT and NO_VIEW. */
  readonly direction: "UP" | "DOWN" | null;
  /** Short label, e.g. "Aligned up", "Lean down", "Split", "No view". */
  readonly label: string;
  /** e.g. "1 up · 1 down · 3 flat" (appends "· 1 unavailable" when any). */
  readonly tallyText: string;
  readonly tally: VoteTally;
  /** One sentence saying what the tier means. */
  readonly explanation: string;
  /** Strategies that oppose each other in a SPLIT (empty otherwise). */
  readonly opposing: readonly ConfluenceStrategyId[];
}

/** Count the voters of a pair by direction. */
export function tallyVotes(
  pair: ConfluencePair,
  weights: Confluence["weights"],
): VoteTally {
  let up = 0;
  let down = 0;
  let flat = 0;
  let unavailable = 0;
  for (const cell of pair.cells) {
    if (weights[cell.strategyId] <= 0) continue; // display-only: never votes
    if (!cell.available) {
      unavailable += 1;
      continue;
    }
    if (cell.direction === "UP") up += 1;
    else if (cell.direction === "DOWN") down += 1;
    else flat += 1;
  }
  return { up, down, flat, unavailable };
}

/** "1 up · 1 down · 3 flat" (+ "· N unavailable" when relevant). */
export function formatTally(t: VoteTally): string {
  const parts = [`${t.up} up`, `${t.down} down`, `${t.flat} flat`];
  if (t.unavailable > 0) parts.push(`${t.unavailable} unavailable`);
  return parts.join(" \u00B7 ");
}

const word = (d: Direction): string => (d === "UP" ? "up" : "down");

export function shapeConviction(
  pair: ConfluencePair,
  weights: Confluence["weights"],
): ConvictionVM {
  const tally = tallyVotes(pair, weights);
  const tallyText = formatTally(tally);
  const base = { tally, tallyText, opposing: [] as readonly ConfluenceStrategyId[] };

  if (pair.status === "CONFLICT_FLAT") {
    return {
      ...base,
      tier: "SPLIT",
      direction: null,
      label: "Split",
      explanation: "Strategies strongly disagree. Stay flat until they line up.",
      opposing: pair.opposingStrategyIds,
    };
  }
  if (pair.status === "ALIGNED_UP" || pair.status === "ALIGNED_DOWN") {
    const direction = pair.status === "ALIGNED_UP" ? "UP" : "DOWN";
    return {
      ...base,
      tier: "ALIGNED",
      direction,
      label: `Aligned ${word(direction)}`,
      explanation: `Strategies broadly agree on ${word(direction)}.`,
    };
  }
  if (pair.status === "INSUFFICIENT_DATA" || tally.up + tally.down === 0) {
    return {
      ...base,
      tier: "NO_VIEW",
      direction: null,
      label: "No view",
      explanation:
        pair.status === "INSUFFICIENT_DATA"
          ? "Not enough data to read this pair."
          : "No strategy is calling a direction.",
    };
  }
  if (tally.up === tally.down) {
    return {
      ...base,
      tier: "SPLIT",
      direction: null,
      label: "Split",
      explanation: "An equal number of strategies point each way. No clear call.",
    };
  }
  const direction = tally.up > tally.down ? "UP" : "DOWN";
  return {
    ...base,
    tier: "LEAN",
    direction,
    label: `Lean ${word(direction)}`,
    explanation: `More strategies lean ${word(direction)} than ${word(direction === "UP" ? "DOWN" : "UP")}, but not enough for a clear consensus.`,
  };
}

/** Glyph for a tier (a non-colour cue; direction calls carry an arrow). */
export function tierGlyph(vm: Pick<ConvictionVM, "tier" | "direction">): string {
  if (vm.tier === "SPLIT") return "\u21C5"; // up-down arrows
  if (vm.tier === "NO_VIEW") return "\u2205"; // empty set
  return vm.direction === "UP" ? "\u25B2" : "\u25BC";
}
