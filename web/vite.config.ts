/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone SPA build config. React/Vite/Recharts are confined to web/ (Req 1.1, 1.2).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    // Pure modules are property-tested without a browser (default `node` env); component
    // render tests opt into jsdom. The default stays `node` so the pure/property suite keeps
    // running without a DOM, and only files that need the DOM pay for jsdom. A test file can
    // opt in two ways:
    //   1. the `// @vitest-environment jsdom` docblock pragma at the top of the file, or
    //   2. matching the `*.dom.test.tsx` glob below (component render tests use this).
    environment: "node",
    environmentMatchGlobs: [["src/**/*.dom.test.{ts,tsx}", "jsdom"]],
    include: [
      "src/**/*.{test,property.test}.ts",
      "src/**/*.{test,property.test}.tsx",
      "src/**/*.dom.test.{ts,tsx}",
    ],
  },
});
