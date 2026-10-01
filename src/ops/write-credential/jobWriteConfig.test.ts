// Unit tests for the Job write-path config wiring (task 12.3, spec Req 8.5, 8.6).
//
// These verify the NAME/CONFIG-only wiring that connects `supabaseConfig.ts`'s
// hosted env-key to the pure write-credential selector: the Job's write path
// resolves to the Scoped_Write_Credential (`SUPABASE_HOSTED_KEY`), never the
// publishable (anon) read-only key (spec Req 8.5) or the operator-only
// service-role key (spec Req 8.4), and no secret value appears on any surface
// (spec Req 8.8).

import { describe, expect, it } from "vitest";

import { SUPABASE_ENV } from "../../storage/supabaseConfig.js";
import type { SupabaseConfig } from "../../storage/supabaseConfig.js";

import {
  JOB_HOSTED_WRITE_ENV_KEY,
  JOB_HOSTED_CREDENTIAL_CANDIDATES,
  OPERATOR_SERVICE_ROLE_ENV_KEY,
  SERVING_LAYER_PUBLISHABLE_ENV_KEY,
  assertJobWriteCredentialScoped,
  resolveJobWriteCredential,
} from "./jobWriteConfig.js";

describe("Job write-path config wiring (task 12.3)", () => {
  it("binds the hosted write env-key to supabaseConfig's single source of truth", () => {
    // The write-path env-key MUST be exactly the one supabaseConfig reads the
    // hosted key from, so config and the selector can never drift.
    expect(JOB_HOSTED_WRITE_ENV_KEY).toBe(SUPABASE_ENV.hosted.key);
    expect(JOB_HOSTED_WRITE_ENV_KEY).toBe("SUPABASE_HOSTED_KEY");
  });

  it("models the hosted write-key as scoped-write and the others as forbidden kinds", () => {
    const byName = new Map(
      JOB_HOSTED_CREDENTIAL_CANDIDATES.map((c) => [c.envKeyName, c.kind]),
    );
    expect(byName.get(JOB_HOSTED_WRITE_ENV_KEY)).toBe("scoped-write");
    expect(byName.get(SERVING_LAYER_PUBLISHABLE_ENV_KEY)).toBe("publishable");
    expect(byName.get(OPERATOR_SERVICE_ROLE_ENV_KEY)).toBe("service-role");
  });

  it("resolves the Job write credential to the scoped-write hosted key (Req 8.3)", () => {
    const result = resolveJobWriteCredential();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.kind).toBe("scoped-write");
      expect(result.selection.envKeyName).toBe(JOB_HOSTED_WRITE_ENV_KEY);
    }
  });

  it("accepts a hosted config and reports the scoped-write env-key (Req 8.5, 8.6)", () => {
    const config: SupabaseConfig = {
      target: "hosted",
      url: "https://example.supabase.co",
      // A value is present on the config, but the assertion must NOT read it.
      key: "sb_scoped_write_jwt_value_do_not_leak",
    };
    const result = assertJobWriteCredentialScoped(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envKeyName).toBe(JOB_HOSTED_WRITE_ENV_KEY);
    }
    // The assertion is value-free: the secret value never surfaces (Req 8.8).
    expect(JSON.stringify(result)).not.toContain("sb_scoped_write_jwt_value");
  });

  it("rejects a non-hosted (local) config as outside the scoped write path", () => {
    const config: SupabaseConfig = {
      target: "local",
      url: "http://127.0.0.1:54321",
      key: "local_key",
    };
    const result = assertJobWriteCredentialScoped(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("hosted");
    }
  });

  it("never routes the publishable or service-role key into the write path (Req 8.4, 8.5)", () => {
    // The selected credential NAME is the scoped-write hosted key and nothing
    // else — the publishable/service-role env-keys are never chosen.
    const result = resolveJobWriteCredential();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.selection.envKeyName).not.toBe(
        SERVING_LAYER_PUBLISHABLE_ENV_KEY,
      );
      expect(result.selection.envKeyName).not.toBe(
        OPERATOR_SERVICE_ROLE_ENV_KEY,
      );
    }
  });
});
