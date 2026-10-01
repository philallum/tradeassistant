// Unit tests for the scheduled daily-run entry point (Requirement 16.7, 3.1).
//
// These verify that the scheduled runner reuses the EXACT deterministic
// `dailyRun` path and that a scheduled unattended run reproduces an equivalent
// local run over identical fixed inputs — the core of Requirement 16.7. The
// tests use in-memory fakes for the pipeline/storage seam, so no network or DB
// is touched.

import { describe, expect, it } from "vitest";

import { dailyRun, type PairEvaluation } from "../dashboard/index.js";
import type { Confidence } from "../confidence/types.js";
import type { SupabaseConfig } from "../storage/supabaseConfig.js";
import {
  loadScheduledRunConfig,
  resolveDecisionDate,
  resolveSupabaseOverIpv4,
  ScheduledRunConfigError,
  SCHEDULED_RUN_ENV,
} from "./config.js";
import { runScheduledDaily } from "./scheduledRun.js";

const SUPABASE: SupabaseConfig = {
  target: "hosted",
  url: "https://pooler.example.supabase.co",
  key: "test-key",
};

/** A single gate-passing, high-confidence, non-suppressed evaluation. */
function firingEvaluation(): PairEvaluation {
  return {
    pair: "EURUSD",
    gatePassing: true,
    earnedConfidence: 0.9 as Confidence,
    direction: "UP",
    horizon: 2,
    excursionProfile: { favorablePips: 40, adversePips: 15 },
    stopLossPips: 15,
    takeProfitPips: 40,
    newsSuppressed: false,
    rationale: "analogues resolved up",
    analogueLabels: ["trend-continuation"],
  };
}

describe("runScheduledDaily — reuses the exact dailyRun path (Req 16.7)", () => {
  it("produces the identical view a local dailyRun call produces over the same inputs", async () => {
    const decisionDate = "2024-03-15";
    const evaluations = [firingEvaluation()];

    const scheduled = await runScheduledDaily(
      { decisionDate, supabase: SUPABASE, gcpProject: undefined, gcpRegion: undefined, geminiModel: undefined },
      { loadEvaluations: () => Promise.resolve(evaluations) },
    );

    const local = dailyRun(decisionDate, evaluations);

    expect(scheduled.view).toEqual(local);
    expect(scheduled.decisionDate).toBe(decisionDate);
  });

  it("is reproducible: two runs over identical fixed inputs yield identical views", async () => {
    const decisionDate = "2024-03-15";
    const evaluations = [firingEvaluation()];
    const loader = () => Promise.resolve(evaluations);

    const first = await runScheduledDaily(
      { decisionDate, supabase: SUPABASE, gcpProject: undefined, gcpRegion: undefined, geminiModel: undefined },
      { loadEvaluations: loader },
    );
    const second = await runScheduledDaily(
      { decisionDate, supabase: SUPABASE, gcpProject: undefined, gcpRegion: undefined, geminiModel: undefined },
      { loadEvaluations: loader },
    );

    expect(second.view).toEqual(first.view);
  });

  it("persists the produced view when a persister is provided", async () => {
    const captured: unknown[] = [];
    const result = await runScheduledDaily(
      {
        decisionDate: "2024-03-15",
        supabase: SUPABASE,
        gcpProject: undefined,
        gcpRegion: undefined,
        geminiModel: undefined,
      },
      {
        loadEvaluations: () => Promise.resolve([firingEvaluation()]),
        persistView: (view) => {
          captured.push(view);
          return Promise.resolve();
        },
      },
    );

    expect(result.persisted).toBe(true);
    expect(captured).toHaveLength(1);
  });

  it("does not persist when no persister is provided (dry run)", async () => {
    const result = await runScheduledDaily(
      {
        decisionDate: "2024-03-15",
        supabase: SUPABASE,
        gcpProject: undefined,
        gcpRegion: undefined,
        geminiModel: undefined,
      },
      { loadEvaluations: () => Promise.resolve([]) },
    );
    expect(result.persisted).toBe(false);
    expect(result.view.cards).toHaveLength(0);
  });
});

describe("resolveDecisionDate", () => {
  it("uses an explicit valid RUN_DECISION_DATE verbatim", () => {
    const date = resolveDecisionDate({ [SCHEDULED_RUN_ENV.decisionDate]: "2024-03-15" });
    expect(date).toBe("2024-03-15");
  });

  it("defaults to the current UTC date when unset", () => {
    const now = new Date(Date.UTC(2024, 2, 15, 21, 0, 0));
    expect(resolveDecisionDate({}, now)).toBe("2024-03-15");
  });

  it("rejects an invalid RUN_DECISION_DATE", () => {
    expect(() =>
      resolveDecisionDate({ [SCHEDULED_RUN_ENV.decisionDate]: "15-03-2024" }),
    ).toThrow(ScheduledRunConfigError);
  });
});

describe("resolveSupabaseOverIpv4 — PostgREST/HTTPS path (IPv4-reachable, never a Postgres DSN)", () => {
  it("overrides the resolved URL with SUPABASE_POOLER_URL when it is an http(s) REST URL", () => {
    const cfg = resolveSupabaseOverIpv4({
      [SCHEDULED_RUN_ENV.supabasePoolerUrl]: "https://pooler.example.supabase.co:6543",
      SUPABASE_TARGET: "hosted",
      SUPABASE_HOSTED_URL: "https://direct.example.supabase.co",
      SUPABASE_HOSTED_KEY: "k",
    });
    expect(cfg.url).toBe("https://pooler.example.supabase.co:6543");
    expect(cfg.key).toBe("k");
  });

  it("IGNORES a postgresql:// pooler DSN and keeps the hosted REST URL", () => {
    // Regression: the Supabase pooler secret is a Postgres connection string
    // with embedded credentials. It is NOT a PostgREST endpoint; feeding it to
    // the REST client makes fetch throw "URL that includes credentials". The
    // override must be ignored so the IPv4-reachable HTTPS REST URL is used.
    const cfg = resolveSupabaseOverIpv4({
      [SCHEDULED_RUN_ENV.supabasePoolerUrl]:
        "postgresql://postgres.ref:p%40ss@aws-1-eu-west-1.pooler.supabase.com:5432/postgres",
      SUPABASE_TARGET: "hosted",
      SUPABASE_HOSTED_URL: "https://project.supabase.co",
      SUPABASE_HOSTED_KEY: "k",
    });
    expect(cfg.url).toBe("https://project.supabase.co");
    expect(cfg.key).toBe("k");
  });

  it("falls back to the resolved Supabase URL when no pooler override is set", () => {
    const cfg = resolveSupabaseOverIpv4({
      SUPABASE_TARGET: "hosted",
      SUPABASE_HOSTED_URL: "https://project.supabase.co",
      SUPABASE_HOSTED_KEY: "k",
    });
    expect(cfg.url).toBe("https://project.supabase.co");
  });
});

describe("loadScheduledRunConfig — non-secret env config", () => {
  it("reads project/region/model as non-secret config", () => {
    const cfg = loadScheduledRunConfig(
      {
        [SCHEDULED_RUN_ENV.decisionDate]: "2024-03-15",
        [SCHEDULED_RUN_ENV.gcpProject]: "my-project",
        [SCHEDULED_RUN_ENV.gcpRegion]: "us-central1",
        [SCHEDULED_RUN_ENV.geminiModel]: "gemini-flash",
        SUPABASE_TARGET: "hosted",
        SUPABASE_HOSTED_URL: "https://project.supabase.co",
        SUPABASE_HOSTED_KEY: "k",
      },
    );
    expect(cfg.gcpProject).toBe("my-project");
    expect(cfg.gcpRegion).toBe("us-central1");
    expect(cfg.geminiModel).toBe("gemini-flash");
    expect(cfg.decisionDate).toBe("2024-03-15");
  });
});
