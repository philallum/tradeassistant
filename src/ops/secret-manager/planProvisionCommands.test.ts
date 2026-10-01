// Sanity unit test for the PURE create-or-version command planner (task 6.4,
// spec Req 3.2, 3.8). The exhaustive property test is task 6.5 (Property 15);
// this covers the three representative cases: absent -> create, existing ->
// add-version, empty value -> skipped. It asserts no secret VALUE ever reaches
// argv (spec Req 3.3) — argv is names/flags only, the value rides stdin.

import { describe, expect, it } from "vitest";

import { planProvisionCommands } from "./provisioner.js";
import type { SecretProvisionPlan } from "./types.js";

const PLAN: SecretProvisionPlan = {
  secrets: [
    { envKey: "OHLC_API_KEY", secretName: "ohlc-api-key", hasValue: true },
    { envKey: "YIELD_API_KEY", secretName: "yield-api-key", hasValue: true },
    { envKey: "NEWS_API_KEY", secretName: "news-api-key", hasValue: false },
  ],
  configKeys: ["GCP_PROJECT_ID"],
  missingValues: ["NEWS_API_KEY"],
};

describe("planProvisionCommands (pure)", () => {
  it("creates absent secrets and adds a version to existing ones (idempotent)", () => {
    const existing = new Set<string>(["yield-api-key"]);
    const commands = planProvisionCommands(PLAN, existing);

    // The empty-valued NEWS_API_KEY is skipped entirely (spec Req 3.9).
    expect(commands).toHaveLength(2);

    const create = commands.find((c) => c.envKey === "OHLC_API_KEY");
    const version = commands.find((c) => c.envKey === "YIELD_API_KEY");

    expect(create).toMatchObject({
      action: "create",
      secretName: "ohlc-api-key",
      valueOnStdin: true,
      argv: ["secrets", "create", "ohlc-api-key", "--data-file=-"],
    });
    expect(version).toMatchObject({
      action: "add-version",
      secretName: "yield-api-key",
      valueOnStdin: true,
      argv: ["secrets", "versions", "add", "yield-api-key", "--data-file=-"],
    });
  });

  it("re-running over an unchanged state produces only add-version (no duplicate create)", () => {
    const existing = new Set<string>(["ohlc-api-key", "yield-api-key"]);
    const commands = planProvisionCommands(PLAN, existing);

    expect(commands).toHaveLength(2);
    expect(commands.every((c) => c.action === "add-version")).toBe(true);
  });

  it("appends --project only when a project id is supplied, never a secret value in argv", () => {
    const commands = planProvisionCommands(PLAN, new Set(), "trade-assistant-508806");
    for (const c of commands) {
      expect(c.argv).toContain("--data-file=-");
      expect(c.argv).toContain("--project=trade-assistant-508806");
      // Names/flags only — argv entries are the subcommand, the secret NAME,
      // and flags; the value never appears, it rides stdin (valueOnStdin).
      expect(c.valueOnStdin).toBe(true);
      expect(c.argv).toContain(c.secretName);
    }
  });
});
