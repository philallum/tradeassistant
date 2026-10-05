// Supabase Display-Only Persistence Integration Test — task 2.3
// (Dashboard_UI Requirement 20.3, 20.4).
//
// Proves `makeDisplayDataPersister` writes the two DISPLAY-ONLY tables
// (`signal_rationale`, `external_reference_comparison`) under the
// `pipeline_writer` write path against a REAL local Supabase backend (the same
// companion migration `20260916000003_dashboard_read_views_rls.sql` applied to
// local and hosted). It is an INTEGRATION test, not a property test: it uses 1–3
// representative fixtures rather than random iterations, and exercises the real
// REST transport end to end.
//
// Gating follows the existing repo convention (see
// supabaseStores.integration.test.ts): the suite runs only when
// `SUPABASE_TARGET=local` selects a fully-configured local target AND that
// backend is actually reachable AND the companion migration's two display-only
// tables are present. When no local Supabase is running (or the migration has
// not been applied) the suite skips cleanly so the offline suite stays green —
// but it is structured to run in full when a backend is available.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadSupabaseConfig,
  tryLoadSupabaseConfig,
  type SupabaseConfig,
} from "../supabaseConfig.js";
import { tagLlmOutput } from "../../llm/index.js";
import type { ResearchProposal } from "../../research-assistant/index.js";
import type { ExternalReferenceSignal } from "../../external-signal/index.js";
import { SupabaseRestClient } from "./client.js";
import {
  makeDisplayDataPersister,
  type DisplayOnlyWrite,
} from "./displayDataPersister.js";

// --- Gate: only run against a configured, reachable LOCAL Supabase ----------

const cfgResult = tryLoadSupabaseConfig();
const isLocalTarget = cfgResult.ok && cfgResult.config.target === "local";

// A stable test-data namespace so cleanup never touches real rows. The five
// PAIRS are real symbols; we scope by unique decision dates far in the future.
const TEST_DATE_1 = "2999-02-01";
const TEST_DATE_2 = "2999-02-02";
const TEST_DATES = [TEST_DATE_1, TEST_DATE_2];

const AT = "2020-01-01T00:00:00.000Z";

let reachable = false;
let config: SupabaseConfig | undefined;
let client: SupabaseRestClient | undefined;

async function cleanup(c: SupabaseRestClient): Promise<void> {
  const dateFilter = `decision_date=in.(${TEST_DATES.join(",")})`;
  await Promise.allSettled([
    c.delete("signal_rationale", dateFilter),
    c.delete("external_reference_comparison", dateFilter),
  ]);
}

beforeAll(async () => {
  if (!isLocalTarget) {
    return;
  }
  config = loadSupabaseConfig();
  const probe = new SupabaseRestClient(config);
  try {
    // A trivial select proves the REST endpoint is up AND the companion
    // migration's two display-only tables exist. If either is absent the suite
    // skips cleanly (the tables ship in migration 20260916000003).
    await probe.select("signal_rationale", "limit=1");
    await probe.select("external_reference_comparison", "limit=1");
    reachable = true;
    client = probe;
    await cleanup(probe);
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (client) {
    await cleanup(client);
  }
});

const shouldRun = (): boolean => isLocalTarget && reachable;

function proposalFixture(): ResearchProposal {
  return {
    proposalId: "prop-1",
    kind: "feature_hypothesis",
    proposalText: tagLlmOutput("investigate weekly trend persistence", "research_assistant", AT),
    at: AT,
  };
}

function referenceFixture(pair: "EURUSD"): ExternalReferenceSignal {
  return {
    pair,
    decisionDate: TEST_DATE_1,
    direction: "BUY",
    score: 0.7,
    provider: "acme-signals",
    fetchedAt: AT,
  };
}

describe.skipIf(!isLocalTarget)(
  "makeDisplayDataPersister — display-only tables against local Supabase (Req 20.3, 20.4)",
  () => {
    it("round-trips a DisplayOnlyWrite into signal_rationale with provenance + is_display_only", async () => {
      if (!shouldRun() || !config || !client) return;
      const persist = makeDisplayDataPersister(config);

      const data: DisplayOnlyWrite = {
        rationales: [
          {
            decisionDate: TEST_DATE_1,
            pair: "EURUSD",
            rationale: tagLlmOutput("analogues resolved up", "signal_rationale", AT),
            analogueLabels: tagLlmOutput(["trend-continuation", "pullback"], "pattern_description", AT),
            proposals: [proposalFixture()],
          },
        ],
      };
      await persist(data);

      const rows = await client.select<{
        pair: string;
        rationale_text: string;
        analogue_labels: string[];
        proposals: { proposalText: string }[];
        provenance: string;
        is_display_only: boolean;
      }>("signal_rationale", `decision_date=eq.${TEST_DATE_1}&order=pair.asc`);

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      // Rationale/labels are unwrapped from their LlmTagged markers (verbatim).
      expect(row.rationale_text).toBe("analogues resolved up");
      expect(row.analogue_labels).toEqual(["trend-continuation", "pullback"]);
      // Research proposal text is unwrapped from its LlmTagged marker too.
      expect(row.proposals[0]?.proposalText).toBe("investigate weekly trend persistence");
      // is_display_only is forced true and the producing role is the provenance.
      expect(row.is_display_only).toBe(true);
      expect(row.provenance).toBe("signal_rationale");
    });

    it("round-trips a DisplayOnlyWrite into external_reference_comparison with provenance + is_display_only", async () => {
      if (!shouldRun() || !config || !client) return;
      const persist = makeDisplayDataPersister(config);

      const data: DisplayOnlyWrite = {
        comparisons: [
          {
            decisionDate: TEST_DATE_1,
            pair: "EURUSD",
            ownDirection: "UP",
            reference: referenceFixture("EURUSD"),
            comparison: "agree",
          },
          {
            decisionDate: TEST_DATE_1,
            pair: "GBPUSD",
            ownDirection: "DOWN",
            reference: null,
            comparison: "unavailable",
          },
        ],
      };
      await persist(data);

      const rows = await client.select<{
        pair: string;
        own_direction: string | null;
        reference_direction: string | null;
        reference_score: number | null;
        provider: string | null;
        comparison: string;
        provenance: string;
        is_display_only: boolean;
        fetched_at: string | null;
      }>("external_reference_comparison", `decision_date=eq.${TEST_DATE_1}&order=pair.asc`);

      const byPair = new Map(rows.map((r) => [r.pair, r]));
      const eur = byPair.get("EURUSD")!;
      expect(eur.own_direction).toBe("UP");
      expect(eur.reference_direction).toBe("BUY");
      expect(eur.reference_score).toBe(0.7);
      expect(eur.provider).toBe("acme-signals");
      expect(eur.comparison).toBe("agree");
      expect(eur.provenance).toBe("acme-signals");
      expect(eur.is_display_only).toBe(true);
      expect(eur.fetched_at).not.toBeNull();

      // An unavailable reference persists nulls for provider fields but still
      // records is_display_only=true and the comparison verbatim.
      const gbp = byPair.get("GBPUSD")!;
      expect(gbp.reference_direction).toBeNull();
      expect(gbp.provider).toBeNull();
      expect(gbp.fetched_at).toBeNull();
      expect(gbp.comparison).toBe("unavailable");
      expect(gbp.provenance).toBe("external_provider");
      expect(gbp.is_display_only).toBe(true);
    });

    it("is idempotent on each table's primary key (INSERT/UPDATE only — no duplicate rows)", async () => {
      if (!shouldRun() || !config || !client) return;
      const persist = makeDisplayDataPersister(config);

      const data: DisplayOnlyWrite = {
        rationales: [
          {
            decisionDate: TEST_DATE_2,
            pair: "USDJPY",
            rationale: tagLlmOutput("first", "signal_rationale", AT),
            analogueLabels: tagLlmOutput(["a"], "pattern_description", AT),
          },
        ],
        comparisons: [
          {
            decisionDate: TEST_DATE_2,
            pair: "USDJPY",
            ownDirection: "FLAT",
            reference: null,
            comparison: "neutral",
          },
        ],
      };

      // First write inserts; the second with changed text UPDATEs in place
      // (merge-duplicates on the PK) rather than inserting a second row —
      // demonstrating the writer uses only INSERT/UPDATE on the base tables.
      await persist(data);
      const rewrite: DisplayOnlyWrite = {
        rationales: [
          {
            ...data.rationales![0]!,
            rationale: tagLlmOutput("second", "signal_rationale", AT),
          },
        ],
        ...(data.comparisons !== undefined ? { comparisons: data.comparisons } : {}),
      };
      await persist(rewrite);

      const rationaleRows = await client.select<{ rationale_text: string }>(
        "signal_rationale",
        `decision_date=eq.${TEST_DATE_2}&pair=eq.USDJPY`,
      );
      expect(rationaleRows).toHaveLength(1);
      expect(rationaleRows[0]?.rationale_text).toBe("second");

      const comparisonRows = await client.select<{ comparison: string }>(
        "external_reference_comparison",
        `decision_date=eq.${TEST_DATE_2}&pair=eq.USDJPY`,
      );
      expect(comparisonRows).toHaveLength(1);
      expect(comparisonRows[0]?.comparison).toBe("neutral");
    });
  },
);
