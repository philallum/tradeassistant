// Serving-Layer Architecture-Guard Test — Requirement 17.1/17.3/17.4,
// reconciled with dashboard-ui Requirement 20.2/20.5/20.6.
//
// This is a STRUCTURAL / DOCUMENTATION guard, not a behavioural test. The
// reserved read-only serving layer has now been REALIZED, outside the
// deterministic core, as two standalone downstream deployables: the `web/` SPA
// and the `services/read-proxy/` Read_Proxy. This guard's job is therefore no
// longer "no serving layer exists anywhere" — it is the sharper invariant that
// the serving layer stays a pure downstream CONSUMER of storage and never leaks
// back into the deterministic core (`src/`). It asserts, against the repository
// as it actually exists:
//
//   17.1 / 20.5  Compute and storage (`src/`) NEVER depend on a serving layer —
//                no serving framework, no HTTP listener, no `web/`-style module
//                in the core tree, AND no source file imports from `web/` or
//                `services/read-proxy/` (the serving layer is downstream only).
//   17.3         The deterministic core ships NO public API or website of its
//                own; its one runnable entry is the batch daily-run.
//   17.4 / 20.6  The read-only serving layer, once reserved as "future / out of
//                v1", is now documented as REALIZED as those two read-only
//                deployables — so the guard and the parent design posture agree.
//
// The guard is deliberately source-of-truth-driven: it reads package.json, the
// TypeScript sources under src/, the deployment Dockerfile, and the design doc,
// and fails loudly the moment the deterministic core starts to smuggle in a
// serving layer or take a dependency ON the serving layer. If someone later
// adds an HTTP server, a web framework dependency, an `app.listen(...)` route
// table, or an `import ... from "web/..."` to the core tree, THIS test breaks —
// which is the early-warning the requirement wants.

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

    it("imports nothing from the realized serving layer (web/ or services/read-proxy/) in any core source file", () => {
      // The serving layer (the `web/` SPA + the `services/read-proxy/` Read_Proxy)
      // is a DOWNSTREAM consumer of storage. The deterministic core must never
      // import from it — that would invert the dependency and make compute/
      // storage depend on serving, breaking 17.1 / 20.5. Catch any import whose
      // specifier reaches into those trees, whether relative (`../../web/...`,
      // `../services/read-proxy/...`) or path-mapped (`web/...`,
      // `services/read-proxy/...`).
      const servingLayerRe = /(?:^|[/\\])(?:web|services[/\\]read-proxy)[/\\]/;
      const offenders: string[] = [];
      const importRe = /(?:import[^;]*from\s*|require\()\s*["']([^"']+)["']/g;
      for (const file of SOURCE_FILES) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(importRe)) {
          const spec = m[1]!;
          // Normalize separators so the single regex matches on all platforms,
          // and only treat `web`/`services/read-proxy` as a path segment (never
          // a substring of some unrelated package name).
          const normalized = spec.replace(/\\/g, "/");
          if (
            servingLayerRe.test(normalized) ||
            normalized === "web" ||
            normalized.startsWith("web/") ||
            normalized === "services/read-proxy" ||
            normalized.startsWith("services/read-proxy/")
          ) {
            offenders.push(`${file}: ${spec}`);
          }
        }
      }
      expect(
        offenders,
        `No core source file may import from the serving layer (web/ or services/read-proxy/); it is a downstream consumer only:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  });

  // --- 17.4 / 20.6: the reserved read-only serving layer is now realized ---

  describe("the reserved read-only serving layer is documented as realized (Requirement 17.4, dashboard-ui Req 20.6)", () => {
    const designPath = ".kiro/specs/fx-daily-pattern-assistant/design.md";
    const requirementsPath = ".kiro/specs/fx-daily-pattern-assistant/requirements.md";

    it("documents the read-only serving layer and that it has been realized as the two downstream deployables", () => {
      const design = read(designPath).toLowerCase();
      // The design must still describe a READ-ONLY serving layer, and must now
      // record that the reserved seam has been REALIZED as the two read-only
      // deployables (web/ + the Read_Proxy) added as downstream consumers of
      // storage — so the parent posture and this guard no longer contradict
      // (the guard enforces that the core does not depend on that serving layer,
      // while the parent text acknowledges the serving layer now exists).
      expect(design).toContain("serving layer");
      expect(design).toMatch(/read[- ]only/);
      expect(design).toMatch(/realized|realised/);
      expect(design).toContain("web/");
      expect(design).toMatch(/read_proxy|read proxy|read-proxy/);
    });

    it("records in requirements that the serving layer is architecturally reserved without rearchitecting", () => {
      const requirements = read(requirementsPath).toLowerCase();
      // The parent requirement that reserves the seam remains the anchor: the
      // serving layer must be addable without rearchitecting compute/storage,
      // which is precisely the property the realized deployables preserve.
      expect(requirements).toContain("serving layer");
      expect(requirements).toMatch(/out of v1|architecturally reserved|without rearchitecting/);
    });
  });
});
