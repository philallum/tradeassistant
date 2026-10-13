import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ALLOW_HOSTED_HEAVY_OP_ENV,
  SUPABASE_ENV,
  SupabaseConfigError,
  assertHostedHeavyOpAllowed,
  hostedHeavyOpAllowed,
  loadSupabaseConfig,
  tryLoadSupabaseConfig,
  type EnvSource,
  type SupabaseConfig,
} from "./supabaseConfig.js";

/** Build an env record for a fully-configured local + hosted environment. */
function fullEnv(overrides: Record<string, string | undefined> = {}): EnvSource {
  return {
    [SUPABASE_ENV.local.url]: "http://127.0.0.1:54321",
    [SUPABASE_ENV.local.key]: "local-service-key",
    [SUPABASE_ENV.hosted.url]: "https://proj.supabase.co",
    [SUPABASE_ENV.hosted.key]: "hosted-service-key",
    ...overrides,
  };
}

describe("loadSupabaseConfig — target selection (Req 6.3, 17.2)", () => {
  it("defaults to the local target when SUPABASE_TARGET is unset", () => {
    const cfg = loadSupabaseConfig(fullEnv());
    expect(cfg.target).toBe("local");
    expect(cfg.url).toBe("http://127.0.0.1:54321");
    expect(cfg.key).toBe("local-service-key");
  });

  it("selects the local target's url/key when SUPABASE_TARGET=local", () => {
    const cfg = loadSupabaseConfig(
      fullEnv({ [SUPABASE_ENV.target]: "local" }),
    );
    expect(cfg).toEqual({
      target: "local",
      url: "http://127.0.0.1:54321",
      key: "local-service-key",
    });
  });

  it("selects the hosted target's url/key when SUPABASE_TARGET=hosted", () => {
    const cfg = loadSupabaseConfig(
      fullEnv({ [SUPABASE_ENV.target]: "hosted" }),
    );
    expect(cfg).toEqual({
      target: "hosted",
      url: "https://proj.supabase.co",
      key: "hosted-service-key",
    });
  });

  it("trims surrounding whitespace on the target selector", () => {
    const cfg = loadSupabaseConfig(
      fullEnv({ [SUPABASE_ENV.target]: "  hosted  " }),
    );
    expect(cfg.target).toBe("hosted");
  });
});

describe("loadSupabaseConfig — validation errors", () => {
  it("throws on an unknown target value", () => {
    expect(() =>
      loadSupabaseConfig(fullEnv({ [SUPABASE_ENV.target]: "staging" })),
    ).toThrow(SupabaseConfigError);
  });

  it("throws when the selected target's URL is missing", () => {
    expect(() =>
      loadSupabaseConfig(
        fullEnv({
          [SUPABASE_ENV.target]: "hosted",
          [SUPABASE_ENV.hosted.url]: undefined,
        }),
      ),
    ).toThrow(/SUPABASE_HOSTED_URL/);
  });

  it("throws when the selected target's key is missing", () => {
    expect(() =>
      loadSupabaseConfig(
        fullEnv({
          [SUPABASE_ENV.target]: "local",
          [SUPABASE_ENV.local.key]: undefined,
        }),
      ),
    ).toThrow(/SUPABASE_LOCAL_KEY/);
  });

  it("treats an empty-string value as missing (does not fabricate secrets)", () => {
    expect(() =>
      loadSupabaseConfig(
        fullEnv({
          [SUPABASE_ENV.target]: "local",
          [SUPABASE_ENV.local.key]: "   ",
        }),
      ),
    ).toThrow(SupabaseConfigError);
  });

  it("does not read the other target's variables when one target is selected", () => {
    // Only the local pair is present; selecting local must succeed even though
    // the hosted variables are entirely absent.
    const cfg = loadSupabaseConfig({
      [SUPABASE_ENV.target]: "local",
      [SUPABASE_ENV.local.url]: "http://127.0.0.1:54321",
      [SUPABASE_ENV.local.key]: "local-service-key",
    });
    expect(cfg.target).toBe("local");
  });
});

describe("loadSupabaseConfig — optional gateway apiKey (spec Req 8.5)", () => {
  it("resolves apiKey from SUPABASE_PUBLISHABLE_KEY on the hosted target", () => {
    const cfg = loadSupabaseConfig(
      fullEnv({
        [SUPABASE_ENV.target]: "hosted",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xyz",
      }),
    );
    expect(cfg).toEqual({
      target: "hosted",
      url: "https://proj.supabase.co",
      key: "hosted-service-key",
      apiKey: "sb_publishable_xyz",
    });
  });

  it("omits apiKey when SUPABASE_PUBLISHABLE_KEY is absent (legacy single-key behavior)", () => {
    const cfg = loadSupabaseConfig(fullEnv({ [SUPABASE_ENV.target]: "hosted" }));
    expect(cfg.apiKey).toBeUndefined();
  });

  it("treats an empty-string publishable key as absent", () => {
    const cfg = loadSupabaseConfig(
      fullEnv({
        [SUPABASE_ENV.target]: "hosted",
        SUPABASE_PUBLISHABLE_KEY: "   ",
      }),
    );
    expect(cfg.apiKey).toBeUndefined();
  });

  it("never resolves a gateway apiKey for the local target", () => {
    const cfg = loadSupabaseConfig(
      fullEnv({
        [SUPABASE_ENV.target]: "local",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xyz",
      }),
    );
    expect(cfg.apiKey).toBeUndefined();
  });
});

describe("tryLoadSupabaseConfig — non-throwing variant", () => {
  it("returns ok with config for a valid environment", () => {
    const res = tryLoadSupabaseConfig(fullEnv());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.config.target).toBe("local");
    }
  });

  it("returns an error result for an invalid environment", () => {
    const res = tryLoadSupabaseConfig({ [SUPABASE_ENV.target]: "nope" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/SUPABASE_TARGET/);
    }
  });
});

describe("loadSupabaseConfig — property: reads values verbatim (Req 6.3)", () => {
  it("returns exactly the URL/key present in the environment for the chosen target", () => {
    const nonEmpty = fc
      .string({ minLength: 1, maxLength: 40 })
      .filter((s) => s.trim() !== "");
    fc.assert(
      fc.property(
        fc.constantFrom("local", "hosted"),
        nonEmpty,
        nonEmpty,
        (target, url, key) => {
          const names = SUPABASE_ENV[target];
          const cfg = loadSupabaseConfig({
            [SUPABASE_ENV.target]: target,
            [names.url]: url,
            [names.key]: key,
          });
          return (
            cfg.target === target && cfg.url === url && cfg.key === key
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("assertHostedHeavyOpAllowed — hosted egress guard", () => {
  const localConfig: SupabaseConfig = {
    target: "local",
    url: "http://127.0.0.1:54321",
    key: "local-service-key",
  };
  const hostedConfig: SupabaseConfig = {
    target: "hosted",
    url: "https://proj.supabase.co",
    key: "hosted-service-key",
  };

  it("always allows the local target (no override needed)", () => {
    expect(() => assertHostedHeavyOpAllowed(localConfig, "gate-run backtest", {})).not.toThrow();
  });

  it("REFUSES the hosted target by default, naming the op and the override", () => {
    try {
      assertHostedHeavyOpAllowed(hostedConfig, "gate-run backtest", {});
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(SupabaseConfigError);
      const message = (err as Error).message;
      expect(message).toContain("gate-run backtest");
      expect(message).toContain("HOSTED");
      expect(message).toContain(ALLOW_HOSTED_HEAVY_OP_ENV);
      // The error must never leak the secret key.
      expect(message).not.toContain(hostedConfig.key);
    }
  });

  it("allows the hosted target when the override is set to an affirmative value", () => {
    for (const value of ["1", "true", "TRUE", "yes", " true "]) {
      expect(() =>
        assertHostedHeavyOpAllowed(hostedConfig, "evaluation-run backtest", {
          [ALLOW_HOSTED_HEAVY_OP_ENV]: value,
        }),
      ).not.toThrow();
    }
  });

  it("still refuses hosted when the override is falsy/garbage", () => {
    for (const value of ["0", "false", "no", "", "maybe"]) {
      expect(() =>
        assertHostedHeavyOpAllowed(hostedConfig, "evaluation-run backtest", {
          [ALLOW_HOSTED_HEAVY_OP_ENV]: value,
        }),
      ).toThrow(SupabaseConfigError);
    }
  });

  it("hostedHeavyOpAllowed reflects the override flag", () => {
    expect(hostedHeavyOpAllowed({})).toBe(false);
    expect(hostedHeavyOpAllowed({ [ALLOW_HOSTED_HEAVY_OP_ENV]: "1" })).toBe(true);
    expect(hostedHeavyOpAllowed({ [ALLOW_HOSTED_HEAVY_OP_ENV]: "0" })).toBe(false);
  });
});
