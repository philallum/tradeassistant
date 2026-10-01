// Unit tests for the PURE accessor-grant verify predicate (task 6.9,
// spec Req 3.4). `verifyAccessorGranted` must treat provisioning complete ONLY
// when the `roles/secretmanager.secretAccessor` grant for the
// `Runtime_Service_Account` is actually present in the read-back IAM policy.

import { describe, expect, it } from "vitest";

import {
  parseIamPolicy,
  planGetIamPolicyCommand,
  planGrantCommand,
  serviceAccountMember,
  verifyAccessorGranted,
} from "./grantVerify.js";
import { SECRET_ACCESSOR_ROLE, type IamPolicy } from "./types.js";

const SA = "runtime-sa@trade-assistant-508806.iam.gserviceaccount.com";
const SECRET = "ohlc-api-key";

describe("verifyAccessorGranted (spec Req 3.4)", () => {
  it("returns true when the accessor role binding includes the runtime SA", () => {
    const policy: IamPolicy = {
      bindings: [
        {
          role: SECRET_ACCESSOR_ROLE,
          members: [`serviceAccount:${SA}`],
        },
      ],
      etag: "BwABCD",
      version: 1,
    };
    expect(verifyAccessorGranted(policy, SECRET, SA)).toBe(true);
  });

  it("accepts an already-prefixed serviceAccount: member argument", () => {
    const policy: IamPolicy = {
      bindings: [{ role: SECRET_ACCESSOR_ROLE, members: [`serviceAccount:${SA}`] }],
    };
    expect(verifyAccessorGranted(policy, SECRET, `serviceAccount:${SA}`)).toBe(
      true,
    );
  });

  it("returns false when the policy has no bindings", () => {
    expect(verifyAccessorGranted({}, SECRET, SA)).toBe(false);
    expect(verifyAccessorGranted({ bindings: [] }, SECRET, SA)).toBe(false);
  });

  it("returns false when the accessor role is present but the SA is not a member", () => {
    const policy: IamPolicy = {
      bindings: [
        {
          role: SECRET_ACCESSOR_ROLE,
          members: ["serviceAccount:other-sa@proj.iam.gserviceaccount.com"],
        },
      ],
    };
    expect(verifyAccessorGranted(policy, SECRET, SA)).toBe(false);
  });

  it("returns false when the SA is granted only under a different role", () => {
    const policy: IamPolicy = {
      bindings: [
        {
          role: "roles/secretmanager.viewer",
          members: [`serviceAccount:${SA}`],
        },
      ],
    };
    expect(verifyAccessorGranted(policy, SECRET, SA)).toBe(false);
  });

  it("returns false when a binding for the role omits members entirely", () => {
    const policy: IamPolicy = {
      bindings: [{ role: SECRET_ACCESSOR_ROLE }],
    };
    expect(verifyAccessorGranted(policy, SECRET, SA)).toBe(false);
  });
});

describe("planGrantCommand (spec Req 3.4)", () => {
  it("builds names-only argv with member + accessor role, no secret value", () => {
    const argv = planGrantCommand(SECRET, SA);
    expect(argv).toEqual([
      "secrets",
      "add-iam-policy-binding",
      SECRET,
      `--member=serviceAccount:${SA}`,
      `--role=${SECRET_ACCESSOR_ROLE}`,
    ]);
  });

  it("appends --project when provided", () => {
    const argv = planGrantCommand(SECRET, SA, "trade-assistant-508806");
    expect(argv).toContain("--project=trade-assistant-508806");
  });

  it("does not duplicate the serviceAccount: prefix", () => {
    const argv = planGrantCommand(SECRET, `serviceAccount:${SA}`);
    expect(argv).toContain(`--member=serviceAccount:${SA}`);
  });
});

describe("planGetIamPolicyCommand (spec Req 3.4)", () => {
  it("builds the json read-back argv", () => {
    expect(planGetIamPolicyCommand(SECRET)).toEqual([
      "secrets",
      "get-iam-policy",
      SECRET,
      "--format=json",
    ]);
  });
});

describe("serviceAccountMember", () => {
  it("prefixes a bare email", () => {
    expect(serviceAccountMember(SA)).toBe(`serviceAccount:${SA}`);
  });
  it("leaves an already-prefixed member unchanged", () => {
    expect(serviceAccountMember(`serviceAccount:${SA}`)).toBe(
      `serviceAccount:${SA}`,
    );
  });
});

describe("parseIamPolicy", () => {
  it("parses valid get-iam-policy json", () => {
    const json = JSON.stringify({
      bindings: [{ role: SECRET_ACCESSOR_ROLE, members: [`serviceAccount:${SA}`] }],
    });
    expect(verifyAccessorGranted(parseIamPolicy(json), SECRET, SA)).toBe(true);
  });

  it("returns an empty policy (not granted) for empty or invalid output", () => {
    expect(parseIamPolicy("")).toEqual({});
    expect(parseIamPolicy("not json")).toEqual({});
    expect(verifyAccessorGranted(parseIamPolicy("not json"), SECRET, SA)).toBe(
      false,
    );
  });
});
