// Filesystem-backed DocStore adapter for the Living-Docs Writer.
//
// This is the production adapter that implements the `DocStore` port against
// the real repository files (PROJECT-STATE.md, RESEARCH-LOG.md, LESSONS.md). It
// is isolated from the deterministic writer logic so that `livingDocs.ts` never
// depends on `node:fs`; the writer depends only on the port (Requirement 17.1).

import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { DocStore } from "./livingDocs.js";

/**
 * A {@link DocStore} that reads and writes markdown files under a base
 * directory (defaults to the current working directory, i.e. the repo root).
 *
 * Document names are treated as repo-relative paths (e.g. `PROJECT-STATE.md`).
 * Absolute names are used as-is. Reading a missing file yields `null` rather
 * than throwing, matching the port contract used by {@link LivingDocs}.
 */
export class FsDocStore implements DocStore {
  readonly #baseDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.#baseDir = baseDir;
  }

  #resolve(doc: string): string {
    return isAbsolute(doc) ? doc : join(this.#baseDir, doc);
  }

  async read(doc: string): Promise<string | null> {
    try {
      return await readFile(this.#resolve(doc), "utf8");
    } catch (err) {
      if (
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw err;
    }
  }

  async write(doc: string, contents: string): Promise<void> {
    await writeFile(this.#resolve(doc), contents, "utf8");
  }
}
