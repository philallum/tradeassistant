// Property-based test for Secret_Key confidentiality across every output
// surface (spec Req 3.3, 4.6, 6.2, 6.3; task 5.4, design Property 23).
//
// Validates: Requirements 3.3, 4.6, 6.2, 6.3
// - 3.3: when populating a secret from .env, read the value directly without
//   committing or echoing it to logs/terminal/chat/Research_Log.
// - 4.6: record a Deploy_Verification outcome without recording any Secret_Key value.
// - 6.2: never commit, echo, or log any Secret_Key value during secret creation,
//   deployment, verification, or scheduling.
// - 6.3: when a command handles a Secret_Key, reference it by name only and source
//   its value from .env/Secret_Manager, not reproduced in command output/chat/files.
//
// This is a TEST-ONLY task. It threads randomly generated secret values through
// EVERY presentation / log / record surface the module exposes:
//   - the redaction helper (`redactSecrets` / `redactArgv`),
//   - `CommandPresentation.displayCommand` built via `redactArgv`,
//   - the operator-facing `formatPresentation` string (confirm presentation),
//   - a logged command string, a recorded provisioning result, and a recorded
//     Deploy_Verification outcome, all passed through the same redaction helper.
// It then asserts the raw secret value NEVER appears as a substring in any of
// those strings, that every reference is by name only (`<from .env: NAME>`), and
// that the value travels ONLY on the command's stdin — never interpolated into
// argv. The real `DefaultGcloudRunner` is exercised (with `node` standing in for
// `gcloud`) to confirm the stdin-only transport without a live gcloud binary.

import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { CommandPresentation } from "./types.js";
import { formatPresentation } from "./operationalSafety.js";
import {
  redactArgv,
  redactSecrets,
  redactionPlaceholder,
} from "./redaction.js";
import { DefaultGcloudRunner } from "./gcloudRunner.js";

// Feature: operational-wiring, Property 23: No Secret_Key value ever appears on any output surface

/** Node script standing in for `gcloud`: echoes argv (JSON) and stdin to stdout. */
const ECHO_SCRIPT = [
  "let data='';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data',c=>data+=c);",
  "process.stdin.on('end',()=>{",
  "  process.stdout.write(JSON.stringify({argv:process.argv.slice(2),stdin:data}));",
  "});",
].join("");

/**
 * Arbitrary Secret_Key NAME: an env-style identifier (A–Z, 0–9, underscore,
 * starting with a letter). These are the names that must survive as references.
 */
const secretNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")),
    fc.stringMatching(/^[A-Z0-9_]{0,24}$/),
  )
  .map(([head, tail]) => `${head}${tail}`);

/**
 * Arbitrary Secret_Key VALUE: a non-empty, non-whitespace-only string across a
 * wide character space (including regex metacharacters, spaces, and symbols
 * that commonly appear in API keys / credential JSON) so the redaction is
 * stressed on literal matching rather than regex interpretation.
 */
const secretValueArb: fc.Arbitrary<string> = fc
  .string({ minLength: 3, maxLength: 48 })
  .filter((v) => v.trim().length > 0);

/**
 * A set of distinct (NAME, VALUE) secrets. Both names AND values are forced
 * unique: distinct Secret_Keys hold distinct values in reality, and uniqueness
 * keeps the per-name placeholder assertion well-defined. (When two names shared
 * one value, the helper would still scrub the raw value — the confidentiality
 * guarantee — but could only emit one of the two name placeholders for that
 * literal occurrence, which is not a leak.)
 */
const secretSetArb: fc.Arbitrary<ReadonlyArray<{ name: string; value: string }>> =
  fc
    .uniqueArray(
      fc.record({ name: secretNameArb, value: secretValueArb }),
      {
        minLength: 1,
        maxLength: 5,
        selector: (s) => s.name,
      },
    )
    .filter((set) => new Set(set.map((s) => s.value)).size === set.length);

/** Build the NAME -> VALUE mapping the redaction helper consumes. */
function toSecretValues(
  secrets: ReadonlyArray<{ name: string; value: string }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { name, value } of secrets) map[name] = value;
  return map;
}

describe("Property 23: no Secret_Key value ever appears on any output surface (spec Req 3.3, 4.6, 6.2, 6.3)", () => {
  it("threads random secret values through every presentation/log/record surface; the raw value never appears and every reference is by name only", () => {
    fc.assert(
      fc.property(secretSetArb, (secrets) => {
        const secretValues = toSecretValues(secrets);

        // Pick the primary secret this command handles (the others co-exist in
        // the same env and must likewise never leak on any surface).
        const primary = secrets[0];
        // `secretSetArb` is built with `minLength: 1`, so `secrets[0]` is always
        // present; this guard only narrows the type under
        // `noUncheckedIndexedAccess` (returning true is a valid no-op predicate
        // result and is never actually reached).
        if (primary === undefined) return true;

        // The argv references the secret by NAME only; the value NEVER appears
        // in argv — it is destined for stdin via `--data-file=-`.
        const argv: readonly string[] = [
          "secrets",
          "versions",
          "add",
          primary.name, // Secret Manager secret id, derived from the NAME
          "--data-file=-",
        ];

        // Surface 1: the redacted display command built from argv.
        const displayCommand = redactArgv(argv, secretValues);

        // Surface 2: the operator-facing confirm presentation string. Mark it
        // destructive to also route through the warning/affected-resource path.
        const presentation: CommandPresentation = {
          displayCommand,
          destructive: true,
          affectedResource: `secret:${primary.name}`,
        };
        const confirmText = formatPresentation(presentation);

        // Surface 3: a logged command string. In production a logger would be
        // handed an already-redacted string; here we defensively redact a line
        // that (incorrectly) tried to interpolate the raw value, proving the
        // helper strips it before anything is logged.
        const naiveLogLine = `running: gcloud ${argv.join(" ")} <<< ${primary.value}`;
        const loggedCommand = redactSecrets(naiveLogLine, secretValues);

        // Surface 4: a recorded provisioning result (spec Req 6.2) that names
        // the secret and (naively) embeds its value; redaction scrubs it.
        const provisioningRecord = redactSecrets(
          `provisioned ${primary.name} version=2 value=${primary.value} status=OK`,
          secretValues,
        );

        // Surface 5: a recorded Deploy_Verification outcome (spec Req 4.6) that
        // references the secret; redaction scrubs any embedded value.
        const deployVerificationOutcome = redactSecrets(
          `deploy-verify ok=true execution=exec-123 secretsUsed=${primary.name} probe=${primary.value}`,
          secretValues,
        );

        const surfaces = [
          displayCommand,
          confirmText,
          loggedCommand,
          provisioningRecord,
          deployVerificationOutcome,
          argv.join(" "),
        ];

        // No raw secret value — for ANY secret in the surrounding env, not just
        // the one this command handles — ever appears on ANY surface.
        for (const { value } of secrets) {
          for (const surface of surfaces) {
            expect(surface.includes(value)).toBe(false);
          }
        }

        // The secret this command actually references is referenced by NAME
        // only, via its `<from .env: NAME>` placeholder, on every surface that
        // mentioned it (its value having been scrubbed in favour of the name).
        const primaryPlaceholder = redactionPlaceholder(primary.name);
        expect(displayCommand).toContain(primary.name);
        expect(confirmText).toContain(primary.name);
        expect(loggedCommand).toContain(primaryPlaceholder);
        expect(provisioningRecord).toContain(primaryPlaceholder);
        expect(deployVerificationOutcome).toContain(primaryPlaceholder);

        // The argv itself NEVER contains any secret value (value is stdin-only).
        for (const { value } of secrets) {
          expect(argv.join(" ").includes(value)).toBe(false);
          for (const arg of argv) expect(arg.includes(value)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("the secret value travels only on stdin — it reaches the process via stdin and never via argv", async () => {
    await fc.assert(
      fc.asyncProperty(
        secretNameArb,
        secretValueArb,
        async (name, value) => {
          const runner = new DefaultGcloudRunner("node");

          // argv references the secret by NAME only (+ the stdin transport flag);
          // the leading `-e <script>` makes `node` behave like the gcloud binary.
          const gcloudArgs = [
            "secrets",
            "versions",
            "add",
            name,
            "--data-file=-",
          ];
          const argv = ["-e", ECHO_SCRIPT, ...gcloudArgs];

          const out = await runner.run(argv, {
            stdin: Readable.from([value]),
          });

          expect(out.exitCode).toBe(0);
          const parsed = JSON.parse(out.stdout) as {
            argv: string[];
            stdin: string;
          };

          // The secret value arrived ONLY on stdin...
          expect(parsed.stdin).toBe(value);
          // ...and never appears anywhere in the argv the process received.
          expect(parsed.argv.join(" ").includes(value)).toBe(false);
          for (const arg of parsed.argv) {
            expect(arg.includes(value)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
