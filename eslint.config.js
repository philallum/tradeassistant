// ESLint flat config (ESLint 9).
// The deprecation guard for Requirement 18.5 is the type-aware
// `@typescript-eslint/no-deprecated` rule, set to "error" so the build fails
// on any use of an API/syntax deprecated in the selected toolchain version.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
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
