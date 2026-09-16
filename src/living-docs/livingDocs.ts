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
