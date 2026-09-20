// Tiny recursive file walker used by the architecture guard tests.
//
// This is deliberately dependency-free (Node fs only): the serving-layer guard
// must be able to enumerate the source tree without pulling in any package that
// could itself look like a serving-layer dependency.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Directories never worth walking for source inspection. */
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".hypothesis", ".pytest_cache"]);

/**
 * Recursively collect absolute file paths under `dir` for which `predicate`
 * returns true. `predicate` receives the file's base name. Traversal order is
 * directory-entry order made deterministic by sorting, so results are stable
 * across runs and platforms.
 */
export function glob(dir: string, predicate: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    const entries = readdirSync(current).sort();
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile() && predicate(entry)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}
