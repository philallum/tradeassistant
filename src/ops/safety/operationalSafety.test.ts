// Unit tests for the OperationalSafety guard pure logic (spec Req 6.1, 6.4,
// 6.5, 6.6, 3.7; task 5.1).
//
// These verify reconcileTarget match/mismatch (project AND account), confirm
// gating on operator approval, and the destructive-warning framing — all with
// an injected fake GcloudRunner and confirm callback (no live gcloud/prompt).

import { describe, expect, it, vi } from "vitest";

import type {
  CommandOutput,
  CommandPresentation,
  GcloudRunner,
} from "./types.js";
import {
  DefaultOperationalSafety,
  GET_ACCOUNT_ARGV,
  GET_PROJECT_ARGV,
  denyByDefault,
  formatPresentation,
} from "./operationalSafety.js";

/** A fake GcloudRunner returning canned stdout keyed by the argv it receives. */
function fakeConfigRunner(values: {
  project: string;
  account: string;
}): GcloudRunner & { calls: Array<readonly string[]>; stdinSeen: boolean } {
  const calls: Array<readonly string[]> = [];
  let stdinSeen = false;
  return {
    calls,
    get stdinSeen() {
      return stdinSeen;
    },
    run(argv, opts): Promise<CommandOutput> {
      calls.push(argv);
      if (opts?.stdin !== undefined) stdinSeen = true;
      const key = argv.join(" ");
      let stdout = "";
      if (key === GET_PROJECT_ARGV.join(" ")) stdout = values.project;
      else if (key === GET_ACCOUNT_ARGV.join(" ")) stdout = values.account;
      return Promise.resolve({ stdout, stderr: "", exitCode: 0 });
    },
  };
}

describe("reconcileTarget (spec Req 6.4, 6.6, 3.7)", () => {
  it("permits when project AND account both match/present", async () => {
    const runner = fakeConfigRunner({
      project: "trade-assistant-508806\n",
      account: "ci@example.com\n",
    });
    const guard = new DefaultOperationalSafety(runner);

    const result = await guard.reconcileTarget("trade-assistant-508806");
    expect(result).toEqual({ ok: true });
    // Never pipes anything through stdin while reconciling.
    expect(runner.stdinSeen).toBe(false);
  });

  it("aborts on a project mismatch and surfaces the discrepancy", async () => {
    const runner = fakeConfigRunner({
      project: "some-other-project",
      account: "ci@example.com",
    });
    const guard = new DefaultOperationalSafety(runner);

    const result = await guard.reconcileTarget("trade-assistant-508806");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatch).toContain("some-other-project");
      expect(result.mismatch).toContain("trade-assistant-508806");
    }
  });

  it("aborts when no account is authenticated", async () => {
    const runner = fakeConfigRunner({
      project: "trade-assistant-508806",
      account: "(unset)",
    });
    const guard = new DefaultOperationalSafety(runner);

    const result = await guard.reconcileTarget("trade-assistant-508806");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatch).toMatch(/account/i);
    }
  });

  it("aborts when the expected project is empty", async () => {
    const runner = fakeConfigRunner({ project: "", account: "" });
    const guard = new DefaultOperationalSafety(runner);

    const result = await guard.reconcileTarget("   ");
    expect(result.ok).toBe(false);
    // Should not even query gcloud when the expected target is unknown.
    expect(runner.calls).toHaveLength(0);
  });
});

describe("confirm (spec Req 6.1, 6.5)", () => {
  const presentation: CommandPresentation = {
    displayCommand: "gcloud secrets create my-secret",
    destructive: false,
  };

  it("does not approve by default (deny-by-default callback)", async () => {
    const runner = fakeConfigRunner({ project: "p", account: "a" });
    const guard = new DefaultOperationalSafety(runner);
    await expect(guard.confirm(presentation)).resolves.toBe(false);
  });

  it("returns true only when the injected callback approves", async () => {
    const runner = fakeConfigRunner({ project: "p", account: "a" });
    const approve = vi.fn().mockResolvedValue(true);
    const guard = new DefaultOperationalSafety(runner, approve);

    await expect(guard.confirm(presentation)).resolves.toBe(true);
    expect(approve).toHaveBeenCalledWith(presentation);
  });

  it("returns false when the injected callback declines", async () => {
    const runner = fakeConfigRunner({ project: "p", account: "a" });
    const guard = new DefaultOperationalSafety(runner, () => Promise.resolve(false));
    await expect(guard.confirm(presentation)).resolves.toBe(false);
  });

  it("denyByDefault always refuses", async () => {
    await expect(denyByDefault(presentation)).resolves.toBe(false);
  });
});

describe("formatPresentation (spec Req 6.5)", () => {
  it("includes the redacted display command", () => {
    const msg = formatPresentation({
      displayCommand: "gcloud secrets versions add x --data-file=-",
      destructive: false,
    });
    expect(msg).toContain("gcloud secrets versions add x --data-file=-");
  });

  it("carries a distinguishable warning naming the affected resource for destructive ops", () => {
    const msg = formatPresentation({
      displayCommand: "gcloud secrets versions add my-secret --data-file=-",
      destructive: true,
      affectedResource: "my-secret",
    });
    expect(msg).toMatch(/DESTRUCTIVE/i);
    expect(msg).toContain("my-secret");
  });

  it("never leaks a secret because the display command is pre-redacted", () => {
    // The caller redacts before building the presentation; formatPresentation
    // only frames the already-safe string.
    const msg = formatPresentation({
      displayCommand: "value=<from .env: MY_SECRET>",
      destructive: false,
    });
    expect(msg).toContain("<from .env: MY_SECRET>");
  });

  it("uses a placeholder when a destructive op names no resource", () => {
    const msg = formatPresentation({
      displayCommand: "gcloud run jobs execute job",
      destructive: true,
    });
    expect(msg).toContain("(unnamed resource)");
  });
});
