import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  InMemoryDocStore,
  LIVING_DOCS,
  LivingDocs,
  type GateVerdictSummary,
} from "./livingDocs.js";

/** Repo root, resolved from this test file's location (src/living-docs). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A structurally conforming Research_Log entry matching the writer template. */
const CONFORMING_ENTRY = [
  "## [VERDICT] cfg-001 — PASS",
  "- Date: 2024-01-02T03:04:05.000Z",
  "- Verdict: PASS",
  "- Gate 1: modelAccuracy=0.61 baselineAccuracy=0.5 deltaPp=11 passed=true",
  "- Gate 2: modelRiskAdj=1.2 baselineRiskAdj=0.9 margin=0.3 passed=true",
  "- Sample size: 250",
  "- Metrics: sharpe=1.2 hitRate=0.61",
].join("\n");

/** A sample verdict used to exercise the writer's auto-generated entries. */
const SAMPLE_VERDICT: GateVerdictSummary = {
  configId: "cfg-001",
  verdict: "PASS",
  gate1: {
    modelAccuracy: 0.61,
    baselineAccuracy: 0.5,
    deltaPp: 11,
    passed: true,
  },
  gate2: {
    modelRiskAdj: 1.2,
    baselineRiskAdj: 0.9,
    margin: 0.3,
    passed: true,
  },
  sampleSize: 250,
  metrics: "sharpe=1.2 hitRate=0.61",
};

describe("LivingDocs.validateLogEntry — conforming entries (Req 6.5)", () => {
  it("accepts a canonical templated Research_Log entry", () => {
    const docs = new LivingDocs(new InMemoryDocStore());
    expect(docs.validateLogEntry(CONFORMING_ENTRY)).toBe(true);
  });

  it("accepts a [CUT] entry with verdict CUT", () => {
    const docs = new LivingDocs(new InMemoryDocStore());
    const cut = CONFORMING_ENTRY.replace(
      "## [VERDICT] cfg-001 — PASS",
      "## [CUT] cfg-001 — CUT",
    ).replace("- Verdict: PASS", "- Verdict: CUT");
    expect(docs.validateLogEntry(cut)).toBe(true);
  });

  it("accepts an entry with trailing whitespace on lines", () => {
    const docs = new LivingDocs(new InMemoryDocStore());
    const withTrailing = CONFORMING_ENTRY.split("\n")
      .map((l) => `${l}   `)
      .join("\n");
    expect(docs.validateLogEntry(withTrailing)).toBe(true);
  });

  it("accepts an entry surrounded by blank lines (trimmed before parsing)", () => {
    const docs = new LivingDocs(new InMemoryDocStore());
    expect(docs.validateLogEntry(`\n\n${CONFORMING_ENTRY}\n\n`)).toBe(true);
  });

  it("accepts entries produced by the writer itself (round-trip)", async () => {
    const store = new InMemoryDocStore();
    const docs = new LivingDocs(store);
    await docs.appendVerdict(SAMPLE_VERDICT);

    const log = store.peek(LIVING_DOCS.researchLog);
    expect(log).not.toBeNull();
    // Extract the rendered entry (heading through the Metrics line).
    const match = log?.match(/## \[VERDICT\][\s\S]*?- Metrics: .*/);
    expect(match).not.toBeNull();
    expect(docs.validateLogEntry(match![0])).toBe(true);
  });
});

describe("LivingDocs.validateLogEntry — malformed entries (Req 6.5)", () => {
  const docs = new LivingDocs(new InMemoryDocStore());

  it("rejects an empty string", () => {
    expect(docs.validateLogEntry("")).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    expect(docs.validateLogEntry("   \n  \t ")).toBe(false);
  });

  it("rejects an entry with too few lines", () => {
    const truncated = CONFORMING_ENTRY.split("\n").slice(0, 4).join("\n");
    expect(docs.validateLogEntry(truncated)).toBe(false);
  });

  it("rejects an entry missing the heading line", () => {
    const noHeading = CONFORMING_ENTRY.split("\n").slice(1).join("\n");
    expect(docs.validateLogEntry(noHeading)).toBe(false);
  });

  it("rejects a heading with an invalid kind tag", () => {
    const bad = CONFORMING_ENTRY.replace("[VERDICT]", "[NOTE]");
    expect(docs.validateLogEntry(bad)).toBe(false);
  });

  it("rejects a heading with an invalid verdict token", () => {
    const bad = CONFORMING_ENTRY.replace(
      "## [VERDICT] cfg-001 — PASS",
      "## [VERDICT] cfg-001 — MAYBE",
    );
    expect(docs.validateLogEntry(bad)).toBe(false);
  });

  it("rejects when the Date field is missing", () => {
    const bad = CONFORMING_ENTRY.split("\n")
      .filter((l) => !l.startsWith("- Date:"))
      .join("\n");
    expect(docs.validateLogEntry(bad)).toBe(false);
  });

  it("rejects when the required fields are out of order", () => {
    const lines = CONFORMING_ENTRY.split("\n");
    // Swap the Verdict and Date lines.
    [lines[1], lines[2]] = [lines[2]!, lines[1]!];
    expect(docs.validateLogEntry(lines.join("\n"))).toBe(false);
  });

  it("rejects a Verdict field with an invalid value", () => {
    const bad = CONFORMING_ENTRY.replace("- Verdict: PASS", "- Verdict: OK");
    expect(docs.validateLogEntry(bad)).toBe(false);
  });

  it("rejects a Gate 1 line missing a required subfield", () => {
    const bad = CONFORMING_ENTRY.replace(
      "- Gate 1: modelAccuracy=0.61 baselineAccuracy=0.5 deltaPp=11 passed=true",
      "- Gate 1: modelAccuracy=0.61 baselineAccuracy=0.5 passed=true",
    );
    expect(docs.validateLogEntry(bad)).toBe(false);
  });

  it("rejects a Gate 2 line with a non-boolean passed value", () => {
    const bad = CONFORMING_ENTRY.replace(
      "margin=0.3 passed=true",
      "margin=0.3 passed=yes",
    );
    expect(docs.validateLogEntry(bad)).toBe(false);
  });

  it("rejects when the Sample size field is missing its value", () => {
    const bad = CONFORMING_ENTRY.replace("- Sample size: 250", "- Sample size:");
    expect(docs.validateLogEntry(bad)).toBe(false);
  });

  it("rejects when a bullet prefix is missing on a field", () => {
    const bad = CONFORMING_ENTRY.replace("- Metrics:", "Metrics:");
    expect(docs.validateLogEntry(bad)).toBe(false);
  });
});

describe("Living-docs existence smoke test (Req 5.1, 5.3)", () => {
  it("PROJECT-STATE.md exists at the repo root (Req 5.1)", () => {
    expect(existsSync(join(REPO_ROOT, LIVING_DOCS.state))).toBe(true);
  });

  it("RESEARCH-LOG.md exists at the repo root (Req 5.2)", () => {
    expect(existsSync(join(REPO_ROOT, LIVING_DOCS.researchLog))).toBe(true);
  });

  it("LESSONS.md exists at the repo root (Req 5.3)", () => {
    expect(existsSync(join(REPO_ROOT, LIVING_DOCS.lessons))).toBe(true);
  });
});
