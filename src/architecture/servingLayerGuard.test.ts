// Serving-Layer Architecture-Guard Test — task 11.2 (Requirement 17.1, 17.3, 17.4).
//
// This is a STRUCTURAL / DOCUMENTATION guard, not a behavioural test. It builds
// NO serving layer (a read-only public website/API is explicitly out of v1
// scope). Instead it asserts, against the repository as it actually exists, the
// three architectural invariants of Requirement 17 that keep a future serving
// layer addable without rearchitecting:
//
//   17.1  Compute and storage NEVER depend on a serving layer.
//   17.3  v1 contains NO public API or website.
//   17.4  The read-only serving layer is architecturally RESERVED (documented),
//         reading storage only, so it can be added later with no change to the
//         compute or storage design.
//
// The guard is deliberately source-of-truth-driven: it reads package.json, the
// TypeScript sources under src/, the deployment Dockerfile, and the design doc,
// and fails loudly the moment any of them starts to smuggle in a serving layer.
// If someone later adds an HTTP server, a web framework dependency, or an
// `app.listen(...)` route table to the v1 tree, THIS test breaks — which is the
// early-warning the requirement wants.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { glob } from "./repoFiles.js";

const REPO_ROOT = resolve(process.cwd());
const SRC_DIR = resolve(REPO_ROOT, "src");

function read(relPath: string): string {
  return readFileSync(resolve(REPO_ROOT, relPath), "utf8");
}

/**
 * Web / HTTP-server / website frameworks whose presence would mean v1 ships a
 * public API or website. This list is the definition of "a serving layer" for
 * the purposes of Requirement 17.3 — a reserved (future) serving layer would
 * introduce exactly one of these, and it must not be present in v1.
 */
const SERVING_LAYER_PACKAGES = [
  "express",
  "fastify",
  "koa",
  "@hapi/hapi",
  "hapi",
  "restify",
  "next",
  "nuxt",
  "@nestjs/core",
  "@nestjs/common",
  "apollo-server",
  "@apollo/server",
  "graphql-yoga",
  "trpc",
  "@trpc/server",
  "connect",
  "body-parser",
  "serve-static",
  "http-server",
  "vite",
  "react",
  "react-dom",
  "vue",
  "svelte",
  "@sveltejs/kit",
  "socket.io",
  "ws",
] as const;

// All TypeScript source files in the v1 compute + storage tree (tests excluded:
// the guard is about what the SHIPPED code depends on, not what tests exercise).
const SOURCE_FILES = glob(SRC_DIR, (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));

describe("Serving-layer architecture guard (Requirement 17)", () => {
  it("has at least one source file to inspect (guards against a degenerate scan)", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(0);
  });

  // --- 17.3: no public API or website in v1 --------------------------------

  describe("v1 contains no public API or website (Requirement 17.3)", () => {
    it("declares no web/HTTP-server/website framework as a dependency", () => {
      const pkg = JSON.parse(read("package.json")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const declared = new Set<string>([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.optionalDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ]);
      const found = SERVING_LAYER_PACKAGES.filter((p) => declared.has(p));
      expect(
        found,
        `v1 must ship no serving-layer framework, but package.json declares: ${found.join(", ")}`,
      ).toEqual([]);
    });

    it("imports no web/HTTP-server/website framework from any source file", () => {
      // A serving layer would surface as an import of one of the framework
      // packages, or of Node's own `http`/`https`/`net` server primitives.
      const importOffenders: string[] = [];
      const importRe = /(?:import[^;]*from\s*|require\()\s*["']([^"']+)["']/g;
      for (const file of SOURCE_FILES) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(importRe)) {
          const spec = m[1]!;
          const bare = spec.replace(/^node:/, "");
          if (
            (SERVING_LAYER_PACKAGES as readonly string[]).includes(spec) ||
            bare === "http" ||
            bare === "https" ||
            bare === "http2" ||
            bare === "net"
          ) {
            importOffenders.push(`${file}: ${spec}`);
          }
        }
      }
      expect(
        importOffenders,
        `No source file may import a server framework or HTTP-server primitive:\n${importOffenders.join("\n")}`,
      ).toEqual([]);
    });

    it("stands up no HTTP server or route table anywhere in the source tree", () => {
      // Patterns that would indicate a listening server / public route surface.
      const serverPatterns: readonly { re: RegExp; label: string }[] = [
        { re: /\.listen\s*\(/, label: "server .listen(" },
        { re: /createServer\s*\(/, label: "createServer(" },
        { re: /\bapp\.(get|post|put|patch|delete|use)\s*\(/, label: "route handler app.<verb>(" },
        { re: /\brouter\.(get|post|put|patch|delete)\s*\(/, label: "router.<verb>(" },
        { re: /new\s+(Server|WebSocketServer|WebSocket\.Server)\b/, label: "new Server(" },
      ];
      const offenders: string[] = [];
      for (const file of SOURCE_FILES) {
        const src = readFileSync(file, "utf8");
        for (const { re, label } of serverPatterns) {
          if (re.test(src)) offenders.push(`${file}: ${label}`);
        }
      }
      expect(
        offenders,
        `No source file may open a network listener or define a public route:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });

    it("exposes no server start-up npm script (the only runnable entry is the batch daily-run)", () => {
      const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      // The scheduled-run script is a run-to-completion batch job, not a server.
      const serverish = Object.entries(scripts).filter(([, cmd]) =>
        /\b(serve|server|dev-server|preview)\b/.test(cmd),
      );
      expect(
        serverish.map(([k]) => k),
        "No npm script may start a long-running server; v1 runs only batch compute.",
      ).toEqual([]);
    });

    it("packages the deployment image as a run-to-completion batch job, not a listening server", () => {
      // The Dockerfile (GCP Cloud Run Job) must invoke the deterministic
      // daily-run entry point once and exit — never bind a port / EXPOSE a
      // service. That keeps the container a compute job, not a serving layer.
      const dockerfile = read("Dockerfile");
      expect(dockerfile).not.toMatch(/^\s*EXPOSE\b/m);
      expect(dockerfile).toMatch(/CMD \["node", "dist\/scheduled-run\/main\.js"\]/);
    });
  });

  // --- 17.1: compute and storage never depend on a serving layer -----------

  describe("compute and storage never depend on a serving layer (Requirement 17.1)", () => {
    it("has no serving-layer module/directory in the v1 source tree", () => {
      // A serving layer would live in an obviously-named module. None must exist
      // in v1; when one is added later (17.4) it is a NEW consumer of storage,
      // not something compute/storage import.
      const servingDirNames = ["serving", "server", "api", "web", "website", "http", "rest", "graphql"];
      const dirs = glob(SRC_DIR, (name) => name.endsWith(".ts")).map((f) =>
        f.slice(SRC_DIR.length + 1).split(/[/\\]/)[0],
      );
      const present = servingDirNames.filter((d) => dirs.includes(d));
      expect(
        present,
        `v1 compute/storage tree must contain no serving-layer module, found: ${present.join(", ")}`,
      ).toEqual([]);
    });

    it("routes storage access only through the compute layer's storage ports, never a serving layer", () => {
      // The storage layer (src/storage) parses config and defines ports; it must
      // not import back into any serving concern. Confirm it depends only
      // inward (on nothing serving-related) — reuse the framework/import guard,
      // scoped to storage, so a serving dependency creeping into storage fails.
      const storageFiles = SOURCE_FILES.filter((f) => /[/\\]storage[/\\]/.test(f));
      expect(storageFiles.length).toBeGreaterThan(0);
      const offenders: string[] = [];
      const importRe = /from\s*["']([^"']+)["']/g;
      for (const file of storageFiles) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(importRe)) {
          const spec = m[1]!;
          if ((SERVING_LAYER_PACKAGES as readonly string[]).includes(spec)) {
            offenders.push(`${file}: ${spec}`);
          }
        }
      }
      expect(offenders, `Storage must not depend on a serving layer:\n${offenders.join("\n")}`).toEqual([]);
    });
  });

  // --- 17.4: the read-only serving layer is architecturally reserved -------

  describe("the future read-only serving layer is architecturally reserved (Requirement 17.4)", () => {
    const designPath = ".kiro/specs/fx-daily-pattern-assistant/design.md";
    const requirementsPath = ".kiro/specs/fx-daily-pattern-assistant/requirements.md";

    it("documents the future serving layer as read-only over storage, out of v1 scope", () => {
      const design = read(designPath).toLowerCase();
      // The design must reserve a FUTURE serving layer that READS storage only
      // and is explicitly NOT part of v1 — that reservation is what makes it
      // addable later without rearchitecting compute or storage.
      expect(design).toContain("serving layer");
      expect(design).toMatch(/not in v1|out of v1|future/);
      expect(design).toMatch(/read[- ]only/);
    });

    it("records in requirements that a public serving layer is out of v1 scope but reserved", () => {
      const requirements = read(requirementsPath).toLowerCase();
      expect(requirements).toContain("serving layer");
      expect(requirements).toMatch(/out of v1|architecturally reserved|without rearchitecting/);
    });
  });
});
