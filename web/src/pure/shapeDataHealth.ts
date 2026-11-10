/**
 * Pure shaper for the non-blocking "data feed delayed" banner.
 *
 * Moves candle-freshness health from backend logs to the SPA. Source of truth is the
 * `provenance` slice for the displayed Decision_Date (its `dataComplete` / `staleReason` are
 * already judged against the most recent COMPLETED trading day, so a weekend never trips it).
 * A declared market holiday is informational, not a delay. When the slice is empty, the
 * snapshot's own age is the fallback signal.
 *
 * Pure: no fetch, DOM, or ambient clock — `nowMs` is injected. Never touches scoring.
 */
import type { ProvenanceRow } from "../api/types";

/** A snapshot older than this (5 days) is flagged when there is no provenance to judge by. */
export const SNAPSHOT_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export const DATA_DELAYED_MESSAGE =
  "Data feed delayed; evaluating on the latest available session close.";

export interface DataHealthVM {
  /** Headline shown in the banner. */
  readonly message: string;
  /** Plain-language detail line (affected pairs and why), or null when there is none. */
  readonly detail: string | null;
  /** Pairs behind, in input order (empty for the snapshot-age fallback). */
  readonly pairs: readonly string[];
  readonly source: "provenance" | "snapshot_age";
}

export interface DataHealthInput {
  readonly provenance?: readonly ProvenanceRow[];
  readonly decisionDate: string;
  readonly generatedAt?: string;
  readonly nowMs: number;
}

const REASON_TEXT: Readonly<Record<string, string>> = {
  missing_candle: "latest session candle missing",
  weekend_gap: "latest session candle missing after the weekend",
  stale: "more than one session behind",
};

function reasonText(reason: string | null): string {
  if (reason === null) return "data incomplete";
  return REASON_TEXT[reason] ?? "data incomplete";
}

/** Null when data is healthy; otherwise the banner view model. */
export function shapeDataHealth(input: DataHealthInput): DataHealthVM | null {
  const rows = (input.provenance ?? []).filter((r) => r.decision_date === input.decisionDate);

  if (rows.length > 0) {
    // A declared holiday means the market was closed: not a feed delay.
    const behind = rows.filter((r) => !r.dataComplete && r.staleReason !== "holiday");
    if (behind.length === 0) return null;
    return {
      message: DATA_DELAYED_MESSAGE,
      detail: behind.map((r) => `${r.pair}: ${reasonText(r.staleReason)}`).join("; "),
      pairs: behind.map((r) => r.pair),
      source: "provenance",
    };
  }

  const generated = input.generatedAt === undefined ? Number.NaN : Date.parse(input.generatedAt);
  if (Number.isNaN(generated)) return null;
  const ageMs = input.nowMs - generated;
  if (ageMs <= SNAPSHOT_MAX_AGE_MS) return null;
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return {
    message: "Dashboard data may be out of date.",
    detail: `The last published snapshot is ${days} days old.`,
    pairs: [],
    source: "snapshot_age",
  };
}
