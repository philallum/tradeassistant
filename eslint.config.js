// ESLint flat config (ESLint 9).
// The deprecation guard for Requirement 18.5 is the type-aware
// `@typescript-eslint/no-deprecated` rule, set to "error" so the build fails
// on any use of an API/syntax deprecated in the selected toolchain version.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build artifacts and vendored output are not linted. `web/` is a separate
    // SPA with its own tooling; its build output (`web/dist`) is a minified
    // bundle and must be excluded here exactly as the root `dist/` is.
    ignores: ["dist/**", "node_modules/**", "coverage/**", "web/dist/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  // Type-aware linting for the source tree (enables no-deprecated).
  {
    files: ["src/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Requirement 18.5: fail on deprecated APIs.
      "@typescript-eslint/no-deprecated": "error",
    },
  },
  // Root config files and Node scripts: plain (non-type-aware) linting with
  // Node globals available (e.g. the CI version-policy script under scripts/).
  {
    files: ["*.js", "*.ts", "scripts/**/*.{js,mjs,ts}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
      },
    },
  },
);
