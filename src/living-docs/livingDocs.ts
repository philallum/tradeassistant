// Living-Docs Writer (Requirement 5).
//
// Maintains the three living-documentation files that let the project's state,
// research history, and hard-won lessons survive context resets:
//   - PROJECT-STATE.md  current project state          (Requirement 5.1)
//   - RESEARCH-LOG.md   every experiment + gate verdict (Requirement 5.2)
//   - LESSONS.md        the constraints (PROJECT-PLAN §0) (Requirement 5.3)
//
// Kill-gate verdicts and cuts are auto-appended to the Research_Log
// (Requirements 5.4, 5.5), and a templated Research_Log entry can be
// structurally validated before it is written (Requirement 6.5).
//
// Compute/storage separation (Requirement 17.1): all file I/O goes through a
// narrow `DocStore` PORT (read/write/append). The deterministic writer logic
// depends only on that port, never on the `node:fs` module directly. A real
// filesystem adapter is provided for production; an in-memory adapter makes the
// writer fully testable offline and serves as the reference behavior.

/**
 * Minimal shape of a Kill_Gate verdict needed by the Living-Docs Writer.
 *
 * This mirrors the `GateVerdict` declared in the design (§7); the kill-gate
 * harness (task 6) produces the full value. The writer only reads the fields it
 * renders, so it is declared structurally here to avoid a premature dependency
 * on the not-yet-built harness module.
 */
export interface GateOutcome {
  readonly modelAccuracy: number;
  readonly baselineAccuracy: number;
  readonly deltaPp: number;
  readonly passed: boolean;
}

/** Risk-adjusted (Gate 2) outcome fields rendered into a log entry. */
export interface RiskAdjOutcome {
  readonly modelRiskAdj: number;
  readonly baselineRiskAdj: number;
  readonly margin: number;
  readonly passed: boolean;
}

/**
 * The subset of a Kill_Gate `GateVerdict` the writer renders (Requirements 5.4,
 * 5.5). Structurally compatible with the design's `GateVerdict`.
 */
export interface GateVerdictSummary {
  readonly configId: string;
  readonly verdict: "PASS" | "CUT";
  readonly gate1: GateOutcome;
  readonly gate2: RiskAdjOutcome;
  readonly sampleSize: number;
  /** Freeform metrics summary appended verbatim to the entry (Req 5.4). */
  readonly metrics: string;
}

/**
 * The subset of an {@link EvaluationReport} the writer renders into a
 * RESEARCH-LOG evaluation entry (simplify-to-cloud-minimal Requirements 2.2,
 * 2.4). Structurally compatible with the kill-gate `EvaluationReport` — the
 * writer reads only the fields it renders, declared structurally here to avoid
 * a dependency on the kill-gate module (mirrors {@link GateVerdictSummary}).
 *
 * There is NO verdict and NO PASS/CUT field: the Evaluation_Report is evidence
 * for human interpretation and is NEVER annotated with an automated alive/dead
 * verdict (Requirement 2.4).
 */
export interface EvaluationReportSummary {
  readonly configId: string;
  readonly split: {
    readonly trainEnd: string;
    readonly testStart: string;
    readonly testEnd: string;
  };
  readonly sampleSize: number;
  readonly predictionsCount: number;
  readonly modelAccuracy: number;
  readonly baselineAccuracy: number;
  readonly deltaVsBaseline: number;
  readonly frictionAdjustedModel: number;
  readonly frictionAdjustedBaseline: number;
  readonly mfeMaeSummary: {
    readonly modelMfe: number;
    readonly modelMae: number;
    readonly baselineMfe: number;
    readonly baselineMae: number;
  };
  readonly strengthBreakdown: {
    readonly weak: number;
    readonly moderate: number;
    readonly strong: number;
  };
  readonly uncertainty: {
    readonly accuracyDeltaCI: readonly [number, number];
    readonly note: string;
  };
  /** Non-binding annotation flags; descriptive only, never a verdict (Req 2.4). */
  readonly annotations: {
    readonly deltaExceeds3pp: boolean;
    readonly riskAdjNonNegative: boolean;
  };
}

/** Current project state rendered into PROJECT-STATE.md (Requirement 5.1). */
export interface ProjectState {
  /** Short phase label, e.g. "Bootstrap (Task 1)". */
  readonly phase: string;
  /** One-line human summary of where the project stands. */
  readonly summary: string;
  /** ISO-8601 timestamp of this state; injectable for deterministic tests. */
  readonly updatedAt: string;
}

/**
 * The Living-Docs storage PORT: the minimal surface needed to maintain the
 * markdown docs. Implementations perform real I/O and may reject.
 */
export interface DocStore {
  /** Read a document's full contents, or `null` if it does not exist. */
  read(doc: string): Promise<string | null>;
  /** Overwrite a document's full contents. */
  write(doc: string, contents: string): Promise<void>;
}

/** The three living-documentation file names (Requirements 5.1, 5.2, 5.3). */
export const LIVING_DOCS = {
  state: "PROJECT-STATE.md",
  researchLog: "RESEARCH-LOG.md",
  lessons: "LESSONS.md",
} as const;

// Markers that delimit machine-managed regions inside otherwise human-authored
// documents, so prose outside them is preserved across updates.
const STATE_BEGIN = "<!-- BEGIN STATE -->";
const STATE_END = "<!-- END STATE -->";
const ENTRIES_BEGIN = "<!-- BEGIN ENTRIES -->";
const ENTRIES_END = "<!-- END ENTRIES -->";

/** Kind tag distinguishing a routine verdict entry from a cut entry. */
type EntryKind = "VERDICT" | "CUT";

function num(value: number): string {
  return Number.isFinite(value) ? String(value) : "NaN";
}

/**
 * Render a Kill_Gate verdict into the canonical Research_Log entry structure.
 *
 * The produced string is exactly what {@link LivingDocs.validateLogEntry}
 * accepts, so every auto-appended entry is guaranteed structurally valid.
 */
function renderLogEntry(kind: EntryKind, v: GateVerdictSummary): string {
  return [
    `## [${kind}] ${v.configId} — ${v.verdict}`,
    `- Date: ${new Date().toISOString()}`,
    `- Verdict: ${v.verdict}`,
    `- Gate 1: modelAccuracy=${num(v.gate1.modelAccuracy)} baselineAccuracy=${num(v.gate1.baselineAccuracy)} deltaPp=${num(v.gate1.deltaPp)} passed=${String(v.gate1.passed)}`,
    `- Gate 2: modelRiskAdj=${num(v.gate2.modelRiskAdj)} baselineRiskAdj=${num(v.gate2.baselineRiskAdj)} margin=${num(v.gate2.margin)} passed=${String(v.gate2.passed)}`,
    `- Sample size: ${num(v.sampleSize)}`,
    `- Metrics: ${v.metrics}`,
  ].join("\n");
}

/**
 * Render an {@link EvaluationReportSummary} into the canonical RESEARCH-LOG
 * evaluation-entry structure (simplify-to-cloud-minimal Requirements 2.2, 2.4).
 *
 * The produced string is exactly what
 * {@link LivingDocs.validateEvaluationLogEntry} accepts, so every auto-appended
 * evaluation entry is guaranteed structurally valid. It renders the measured
 * metrics only — there is NO Verdict line and no PASS/CUT token: the report is
 * evidence for human interpretation, never an automated alive/dead verdict
 * (Requirement 2.4). The non-binding annotation flags are rendered as
 * descriptive context, explicitly labelled non-binding.
 */
function renderEvaluationEntry(r: EvaluationReportSummary): string {
  const [ciLo, ciHi] = r.uncertainty.accuracyDeltaCI;
  return [
    `## [EVALUATION] ${r.configId}`,
    `- Date: ${new Date().toISOString()}`,
    `- Split: trainEnd=${r.split.trainEnd} testStart=${r.split.testStart} testEnd=${r.split.testEnd}`,
    `- Sample size: ${num(r.sampleSize)}`,
    `- Predictions count: ${num(r.predictionsCount)}`,
    `- Accuracy: model=${num(r.modelAccuracy)} baseline=${num(r.baselineAccuracy)} delta=${num(r.deltaVsBaseline)}`,
    `- Friction-adjusted: model=${num(r.frictionAdjustedModel)} baseline=${num(r.frictionAdjustedBaseline)}`,
    `- MFE/MAE: modelMfe=${num(r.mfeMaeSummary.modelMfe)} modelMae=${num(r.mfeMaeSummary.modelMae)} baselineMfe=${num(r.mfeMaeSummary.baselineMfe)} baselineMae=${num(r.mfeMaeSummary.baselineMae)}`,
    `- Strength: weak=${num(r.strengthBreakdown.weak)} moderate=${num(r.strengthBreakdown.moderate)} strong=${num(r.strengthBreakdown.strong)}`,
    `- Uncertainty: accuracyDeltaCI=[${num(ciLo)}, ${num(ciHi)}] note=${r.uncertainty.note}`,
    `- Annotations (non-binding): deltaExceeds3pp=${String(r.annotations.deltaExceeds3pp)} riskAdjNonNegative=${String(r.annotations.riskAdjNonNegative)}`,
  ].join("\n");
}

/**
 * Replace the region between `begin` and `end` markers with `replacement`.
 * If the markers are absent, the block (with fresh markers) is appended so the
 * document self-heals into the managed format.
 */
function replaceRegion(
  contents: string,
  begin: string,
  end: string,
  replacement: string,
): string {
  const startIdx = contents.indexOf(begin);
  const endIdx = contents.indexOf(end);
  const block = `${begin}\n${replacement}\n${end}`;

  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    const base = contents.trimEnd();
    return base.length === 0 ? `${block}\n` : `${base}\n\n${block}\n`;
  }

  const before = contents.slice(0, startIdx);
  const after = contents.slice(endIdx + end.length);
  return `${before}${block}${after}`;
}

/**
 * The Living-Docs Writer (Requirement 5). Deterministic given its inputs and
 * the injected {@link DocStore}; performs no I/O of its own beyond the port.
 */
export class LivingDocs {
  readonly #store: DocStore;

  constructor(store: DocStore) {
    this.#store = store;
  }

  /**
   * Write/update the current project state in PROJECT-STATE.md (Requirement
   * 5.1). Only the machine-managed state block is rewritten; surrounding prose
   * is preserved.
   */
  async updateState(state: ProjectState): Promise<void> {
    const existing = (await this.#store.read(LIVING_DOCS.state)) ?? "";
    const block = [
      `- **Phase:** ${state.phase}`,
      `- **Updated:** ${state.updatedAt}`,
      `- **Summary:** ${state.summary}`,
    ].join("\n");
    const next = replaceRegion(existing, STATE_BEGIN, STATE_END, block);
    await this.#store.write(LIVING_DOCS.state, next);
  }

  /**
   * Append a Kill_Gate verdict + its metrics to RESEARCH-LOG.md (Requirements
   * 5.2, 5.4). Existing entries are never rewritten; the new entry is inserted
   * immediately before the entries-end marker.
   */
  async appendVerdict(verdict: GateVerdictSummary): Promise<void> {
    await this.#appendEntry(renderLogEntry("VERDICT", verdict));
  }

  /**
   * Append a cut feature/pattern + its metrics to RESEARCH-LOG.md (Requirement
   * 5.5). A cut is a verdict whose outcome is a failure; it is logged with the
   * same structure, tagged `[CUT]`.
   */
  async appendCut(verdict: GateVerdictSummary): Promise<void> {
    await this.#appendEntry(renderLogEntry("CUT", verdict));
  }

  /**
   * Structural check of a templated Research_Log entry (Requirement 6.5).
   *
   * Accepts an entry that conforms to the canonical template (a heading line
   * plus the required `Date`, `Verdict`, `Gate 1`, `Gate 2`, `Sample size`, and
   * `Metrics` fields, in order); rejects anything malformed. Purely functional —
   * performs no I/O — so it is safe to call before writing.
   */
  validateLogEntry(entry: string): boolean {
    if (typeof entry !== "string" || entry.trim().length === 0) return false;
    const lines = entry.trim().split("\n").map((l) => l.trimEnd());
    if (lines.length < 7) return false;

    const [heading, ...rest] = lines;
    if (heading === undefined) return false;
    if (!/^## \[(VERDICT|CUT)\] .+ — (PASS|CUT)$/.test(heading)) return false;

    const patterns: readonly RegExp[] = [
      /^- Date: .+$/,
      /^- Verdict: (PASS|CUT)$/,
      /^- Gate 1: modelAccuracy=\S+ baselineAccuracy=\S+ deltaPp=\S+ passed=(true|false)$/,
      /^- Gate 2: modelRiskAdj=\S+ baselineRiskAdj=\S+ margin=\S+ passed=(true|false)$/,
      /^- Sample size: \S+$/,
      /^- Metrics: .*$/,
    ];
    return patterns.every((re, i) => {
      const line = rest[i];
      return line !== undefined && re.test(line);
    });
  }

  /**
   * Append an {@link EvaluationReportSummary} as an evaluation entry to
   * RESEARCH-LOG.md (simplify-to-cloud-minimal Requirements 2.2, 2.4). This is
   * the report-path successor to {@link appendVerdict} / {@link appendCut}: it
   * records the measured metrics with NO PASS/CUT and no verdict, so the
   * recorded evidence carries no automated alive/dead decision. Existing entries
   * are never rewritten; the new entry is inserted immediately before the
   * entries-end marker.
   */
  async appendEvaluationReport(report: EvaluationReportSummary): Promise<void> {
    await this.#appendEntry(renderEvaluationEntry(report));
  }

  /**
   * Structural check of a templated RESEARCH-LOG evaluation entry
   * (simplify-to-cloud-minimal Requirements 2.2, 2.4). Analogous to
   * {@link validateLogEntry} but for the evaluation-report entry shape: a
   * heading line plus the required `Date`, `Split`, `Sample size`,
   * `Predictions count`, `Accuracy`, `Friction-adjusted`, `MFE/MAE`,
   * `Strength`, `Uncertainty`, and `Annotations (non-binding)` fields, in order.
   *
   * It additionally REJECTS any entry carrying a verdict (a `Verdict` field or a
   * `PASS`/`CUT`/`KILL` token in the heading), so a verdict can never slip into
   * an evaluation entry (Requirement 2.4). Purely functional — performs no I/O —
   * so it is safe to call before writing.
   */
  validateEvaluationLogEntry(entry: string): boolean {
    if (typeof entry !== "string" || entry.trim().length === 0) return false;
    const lines = entry.trim().split("\n").map((l) => l.trimEnd());
    if (lines.length < 11) return false;

    const [heading, ...rest] = lines;
    if (heading === undefined) return false;
    // Heading names the config under an [EVALUATION] tag and carries NO verdict.
    if (!/^## \[EVALUATION\] .+$/.test(heading)) return false;
    if (/\b(PASS|CUT|KILL)\b/.test(heading)) return false;

    const patterns: readonly RegExp[] = [
      /^- Date: .+$/,
      /^- Split: trainEnd=\S+ testStart=\S+ testEnd=\S+$/,
      /^- Sample size: \S+$/,
      /^- Predictions count: \S+$/,
      /^- Accuracy: model=\S+ baseline=\S+ delta=\S+$/,
      /^- Friction-adjusted: model=\S+ baseline=\S+$/,
      /^- MFE\/MAE: modelMfe=\S+ modelMae=\S+ baselineMfe=\S+ baselineMae=\S+$/,
      /^- Strength: weak=\S+ moderate=\S+ strong=\S+$/,
      /^- Uncertainty: accuracyDeltaCI=\[\S+ \S+\] note=.*$/,
      /^- Annotations \(non-binding\): deltaExceeds3pp=(true|false) riskAdjNonNegative=(true|false)$/,
    ];
    if (!patterns.every((re, i) => {
      const line = rest[i];
      return line !== undefined && re.test(line);
    })) {
      return false;
    }

    // No "Verdict:" field anywhere in the entry (Requirement 2.4).
    return !rest.some((line) => /^- Verdict:/.test(line));
  }

  async #appendEntry(entry: string): Promise<void> {
    const existing = (await this.#store.read(LIVING_DOCS.researchLog)) ?? "";
    const startIdx = existing.indexOf(ENTRIES_BEGIN);
    const endIdx = existing.indexOf(ENTRIES_END);

    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      // No managed region yet: create one holding this entry.
      const region = `${ENTRIES_BEGIN}\n\n${entry}\n\n${ENTRIES_END}`;
      const base = existing.trimEnd();
      const next = base.length === 0 ? `${region}\n` : `${base}\n\n${region}\n`;
      await this.#store.write(LIVING_DOCS.researchLog, next);
      return;
    }

    const before = existing.slice(0, endIdx);
    const after = existing.slice(endIdx);
    const next = `${before.trimEnd()}\n\n${entry}\n\n${after}`;
    await this.#store.write(LIVING_DOCS.researchLog, next);
  }
}

/**
 * In-memory {@link DocStore}. Deterministic and dependency-free; used to
 * exercise the writer offline and as a reference for the filesystem adapter.
 */
export class InMemoryDocStore implements DocStore {
  readonly #docs = new Map<string, string>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [k, v] of Object.entries(initial)) this.#docs.set(k, v);
  }

  read(doc: string): Promise<string | null> {
    return Promise.resolve(this.#docs.get(doc) ?? null);
  }

  write(doc: string, contents: string): Promise<void> {
    this.#docs.set(doc, contents);
    return Promise.resolve();
  }

  /** Test/inspection helper: current contents of a doc, or `null`. */
  peek(doc: string): string | null {
    return this.#docs.get(doc) ?? null;
  }
}
