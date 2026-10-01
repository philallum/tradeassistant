// Unit tests for the Scheduler_Job config VALUES carried on the pure command
// planners (task 8.3, spec Req 5.2, 5.6, 5.7). These assert specific, pinned
// values rather than universal properties: the daily `0 17 * * *` schedule and
// `America/New_York` timezone (Req 5.2), the `--max-retry-attempts=3` retry
// count (Req 5.6), and the LEAST-PRIVILEGE invoker grant of exactly
// `roles/run.invoker` and no broader role (Req 5.7). The exhaustive property
// tests live elsewhere; this covers the concrete config surface.

import { describe, expect, it } from "vitest";

import {
  buildSchedulerPlan,
  planCreateJobCommand,
  planGrantInvokerCommand,
} from "./provisioner.js";
import type { SchedulerTarget } from "./types.js";

const PLAN = buildSchedulerPlan(
  "committed-config",
  "scheduler-invoker@trade-assistant-508806.iam.gserviceaccount.com",
);

const TARGET: SchedulerTarget = {
  projectId: "trade-assistant-508806",
  region: "us-central1",
  jobName: "trade-assistant-job",
  schedulerJobName: "trade-assistant-session-close",
};

/** Extract the value of a single `--flag=value` entry from an argv, or
 *  `undefined` when the flag is absent. Fails if the flag appears more than
 *  once (the config flags under test are expected exactly once). */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const matches = argv.filter((arg) => arg.startsWith(`${flag}=`));
  expect(matches.length).toBeLessThanOrEqual(1);
  const match = matches[0];
  return match === undefined ? undefined : match.slice(flag.length + 1);
}

describe("planCreateJobCommand config values (spec Req 5.2, 5.6)", () => {
  const command = planCreateJobCommand(PLAN, TARGET);

  it("carries the daily `0 17 * * *` schedule (Req 5.2)", () => {
    expect(flagValue(command.argv, "--schedule")).toBe("0 17 * * *");
  });

  it("carries the `America/New_York` timezone (Req 5.2)", () => {
    expect(flagValue(command.argv, "--time-zone")).toBe("America/New_York");
  });

  it("carries `--max-retry-attempts=3` (Req 5.6)", () => {
    expect(command.argv).toContain("--max-retry-attempts=3");
    expect(flagValue(command.argv, "--max-retry-attempts")).toBe("3");
  });
});

describe("planGrantInvokerCommand least-privilege role (spec Req 5.7)", () => {
  const command = planGrantInvokerCommand(PLAN, TARGET);

  it("grants exactly `roles/run.invoker`", () => {
    expect(flagValue(command.argv, "--role")).toBe("roles/run.invoker");
  });

  it("grants NO other or broader role — only a single `--role=` flag appears", () => {
    const roleFlags = command.argv.filter((arg) => arg.startsWith("--role="));
    expect(roleFlags).toEqual(["--role=roles/run.invoker"]);
  });
});
