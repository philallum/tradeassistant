// Property-based test for the PURE provisioning command planner
// `planProvisionCommands` (spec Req 3.8; task 6.5, design Property 15).
//
// Validates: Requirements 3.8 — "WHEN a secret for a given Secret_Key already
// exists in Secret_Manager, THE System SHALL add a new secret version rather
// than creating a duplicate secret, so that re-running provisioning is
// idempotent."
//
// This is a TEST-ONLY task. It exercises the real pure `planProvisionCommands`
// from provisioner.ts (implemented in task 6.4) over a randomly generated
// name-only `SecretProvisionPlan` and a random subset of existing Secret
// Manager secret NAMES (including the FULL set, the EMPTY set, and partial
// overlaps). It asserts the per-secret create/add-version decision, that
// empty/absent values emit no command, that no secret VALUE ever appears in any
// argv, that every command marks its value for stdin via `--data-file=-`, and
// the IDEMPOTENCE guarantee: when every planned secret already exists (a re-run
// after a prior provision) EVERY emitted command is `add-version` and NONE is
// `create`. Style follows the property tests in src/ops/secret-manager/ and
// src/ops/safety/ (fast-check + Vitest, numRuns >= 100, tagged property).

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  DATA_FILE_STDIN_FLAG,
  planProvisionCommands,
  secretNameForEnvKey,
} from "./provisioner.js";
import type { PlannedSecret, SecretProvisionPlan } from "./types.js";

// Feature: operational-wiring, Property 15: Provisioning chooses version-add over duplicate-create

/** The distinct env-key base names the provisioner knows about. Each pairs with
 *  a secret suffix to form a classifying `Secret_Key` name, and maps to a
 *  deterministic Secret Manager secret name via `secretNameForEnvKey`. */
const SECRET_ENV_KEYS: readonly string[] = [
  "OHLC_API_KEY",
  "YIELD_API_KEY",
  "NEWS_CALENDAR_API_KEY",
  "EXTERNAL_SIGNAL_API_KEY",
  "TWELVE_DATA_API_KEY",
  "MASSIVE_API_KEY",
  "ALPHA_VANTAGE_API_KEY",
  "FINNHUB_API_KEY",
  "NEWS_API_KEY",
  "SUPABASE_HOSTED_URL",
  "SUPABASE_HOSTED_KEY",
  "SUPABASE_POOLER_URL",
  "GITHUB_TOKEN",
];

/** A sentinel that would only appear in an argv if a secret VALUE had leaked
 *  into the command. The planner is name-only, so it must never surface. */
const SECRET_VALUE_SENTINEL = "SECRET_VALUE_SENTINEL_SHOULD_NEVER_APPEAR";

/** A single generated `PlannedSecret`: a known env key, its derived secret
 *  name, and whether a non-empty value is present. */
const plannedSecretArb: fc.Arbitrary<PlannedSecret> = fc
  .tuple(fc.constantFrom(...SECRET_ENV_KEYS), fc.boolean())
  .map(([envKey, hasValue]) => ({
    envKey,
    secretName: secretNameForEnvKey(envKey),
    hasValue,
  }));

/** A name-only `SecretProvisionPlan`. `secrets` is de-duplicated by `envKey`
 *  (mirroring a real `.env`-derived plan where each key appears once); the
 *  `configKeys` / `missingValues` fields are irrelevant to the command planner
 *  but populated for realism (missingValues = the empty-value secret names). */
const planArb: fc.Arbitrary<SecretProvisionPlan> = fc
  .array(plannedSecretArb, { minLength: 0, maxLength: SECRET_ENV_KEYS.length })
  .map((secrets) => {
    const byKey = new Map<string, PlannedSecret>();
    for (const s of secrets) byKey.set(s.envKey, s);
    const deduped = [...byKey.values()];
    return {
      secrets: deduped,
      configKeys: [],
      missingValues: deduped.filter((s) => !s.hasValue).map((s) => s.envKey),
    } satisfies SecretProvisionPlan;
  });

/** An optional `GCP_PROJECT_ID` to thread through: absent, blank, or a real id
 *  (blank must behave like absent — no `--project` flag). */
const projectIdArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.constant(""),
  fc.constant("   "),
  fc.constantFrom("trade-assistant-508806", "my-proj-123"),
);

/** The secret names that WOULD be targeted by non-empty entries in a plan. */
function targetedSecretNames(plan: SecretProvisionPlan): string[] {
  return plan.secrets.filter((s) => s.hasValue).map((s) => s.secretName);
}

/**
 * Build an "existing secret names" set as a random subset of the plan's
 * targeted names. A boolean flag per secret decides membership, so the
 * generator naturally covers the empty set, the full set, and every partial
 * overlap in between.
 */
function existingSubsetArb(
  plan: SecretProvisionPlan,
): fc.Arbitrary<ReadonlySet<string>> {
  const names = targetedSecretNames(plan);
  if (names.length === 0) return fc.constant(new Set<string>());
  return fc
    .array(fc.boolean(), { minLength: names.length, maxLength: names.length })
    .map((flags) => {
      const set = new Set<string>();
      names.forEach((name, i) => {
        if (flags[i]) set.add(name);
      });
      return set;
    });
}

describe("Property 15: provisioning chooses version-add over duplicate-create (spec Req 3.8)", () => {
  it("emits add-version for existing secrets, create for absent, nothing for empty values, and never leaks a value", () => {
    fc.assert(
      fc.property(
        planArb.chain((plan) =>
          fc.tuple(
            fc.constant(plan),
            existingSubsetArb(plan),
            projectIdArb,
          ),
        ),
        ([plan, existing, projectId]) => {
          const commands = planProvisionCommands(plan, existing, projectId);

          const hasProject =
            projectId !== undefined && projectId.trim() !== "";

          // --- Per-secret decision oracle ---------------------------------
          for (const secret of plan.secrets) {
            const emitted = commands.filter(
              (c) => c.secretName === secret.secretName,
            );
            if (!secret.hasValue) {
              // Empty/absent value -> NO command at all (spec Req 3.9).
              expect(emitted).toHaveLength(0);
              continue;
            }
            // Non-empty value -> exactly one command for this secret.
            expect(emitted).toHaveLength(1);
            const cmd = emitted[0]!;
            const exists = existing.has(secret.secretName);

            if (exists) {
              // Already exists -> add-version, never a duplicate create.
              expect(cmd.action).toBe("add-version");
              expect(cmd.argv.slice(0, 5)).toEqual([
                "secrets",
                "versions",
                "add",
                secret.secretName,
                DATA_FILE_STDIN_FLAG,
              ]);
            } else {
              // Absent -> create.
              expect(cmd.action).toBe("create");
              expect(cmd.argv.slice(0, 4)).toEqual([
                "secrets",
                "create",
                secret.secretName,
                DATA_FILE_STDIN_FLAG,
              ]);
            }

            // Every command sources its value on stdin, never in argv.
            expect(cmd.valueOnStdin).toBe(true);
            expect(cmd.argv).toContain(DATA_FILE_STDIN_FLAG);
            // argv carries NAMES and FLAGS only — never a secret value.
            expect(cmd.argv).not.toContain(SECRET_VALUE_SENTINEL);
            expect(cmd.envKey).toBe(secret.envKey);

            // Project flag threading: present iff a non-blank id was supplied.
            const hasProjectFlag = cmd.argv.some((a) =>
              a.startsWith("--project="),
            );
            expect(hasProjectFlag).toBe(hasProject);
            if (hasProject) {
              expect(cmd.argv).toContain(`--project=${projectId.trim()}`);
            }
          }

          // --- Global invariants over every emitted command ----------------
          const nonEmptyTargets = new Set(targetedSecretNames(plan));
          for (const cmd of commands) {
            // Only non-empty-valued secrets ever produce a command.
            expect(nonEmptyTargets.has(cmd.secretName)).toBe(true);
            expect(cmd.valueOnStdin).toBe(true);
            expect(cmd.argv).toContain(DATA_FILE_STDIN_FLAG);
          }
          // Command count equals the number of non-empty-valued planned secrets.
          expect(commands).toHaveLength(nonEmptyTargets.size);

          // Confidentiality: no value sentinel anywhere in the serialized plan.
          expect(JSON.stringify(commands)).not.toContain(SECRET_VALUE_SENTINEL);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is idempotent: when every planned secret already exists, every command is add-version and none is create", () => {
    fc.assert(
      fc.property(planArb, projectIdArb, (plan, projectId) => {
        // Simulate a RE-RUN after a prior provision: every planned secret's
        // name is already present in Secret Manager.
        const existingAll = new Set(
          plan.secrets.map((s) => s.secretName),
        );

        const commands = planProvisionCommands(plan, existingAll, projectId);

        // Not a single create command: re-running never duplicate-creates.
        expect(commands.some((c) => c.action === "create")).toBe(false);
        // Every emitted command is an add-version.
        for (const cmd of commands) {
          expect(cmd.action).toBe("add-version");
          expect(cmd.argv.slice(0, 3)).toEqual(["secrets", "versions", "add"]);
          expect(cmd.argv).toContain(DATA_FILE_STDIN_FLAG);
          expect(cmd.valueOnStdin).toBe(true);
        }
        // Exactly one command per non-empty-valued planned secret.
        expect(commands).toHaveLength(targetedSecretNames(plan).length);
      }),
      { numRuns: 200 },
    );
  });

  it("creates (never version-adds) when no secret yet exists (empty existing set)", () => {
    fc.assert(
      fc.property(planArb, projectIdArb, (plan, projectId) => {
        const commands = planProvisionCommands(
          plan,
          new Set<string>(),
          projectId,
        );
        expect(commands.some((c) => c.action === "add-version")).toBe(false);
        for (const cmd of commands) {
          expect(cmd.action).toBe("create");
          expect(cmd.argv.slice(0, 2)).toEqual(["secrets", "create"]);
        }
        expect(commands).toHaveLength(targetedSecretNames(plan).length);
      }),
      { numRuns: 200 },
    );
  });
});
