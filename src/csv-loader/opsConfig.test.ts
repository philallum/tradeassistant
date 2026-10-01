// Unit tests for the CSV loader operational config + run cadence (spec Req 1.8,
// task 1.10).
//
// These verify (a) the committed `ops.config.json` records a valid
// Data_Source_Role, (b) config parse/validation accepts the two valid roles and
// rejects everything else, and (c) the CadenceGuard enforces run-once for
// `backfill` and recurring runs for `feed`, in accordance with the recorded role.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ConfigFileReader } from "./opsConfig.js";
import {
  CadenceGuard,
  DATA_SOURCE_ROLES,
  OPS_CONFIG_FILE,
  OpsConfigError,
  isDataSourceRole,
  loadDataSourceRole,
  loadOpsConfig,
  validateOpsConfig,
} from "./opsConfig.js";

/** A ConfigFileReader backed by an in-memory map of path -> contents. */
function fakeReader(files: Record<string, string>): ConfigFileReader {
  return (path) => {
    const contents = files[path];
    if (contents === undefined) {
      return Promise.reject(new Error(`ENOENT: ${path}`));
    }
    return Promise.resolve(contents);
  };
}

describe("committed ops.config.json", () => {
  it("records the csv.role as exactly one of the valid Data_Source_Roles", async () => {
    // The repo root committed file must exist and record a valid role.
    const config = await loadOpsConfig(process.cwd(), (p) => readFile(p, "utf8"));
    expect(DATA_SOURCE_ROLES).toContain(config.csv.role);
  });

  it("does not live in .env (role is sourced from the committed JSON file)", () => {
    // The role is a Config value, never a secret in .env (design "Data Models").
    expect(process.env.CSV_ROLE).toBeUndefined();
    expect(process.env.DATA_SOURCE_ROLE).toBeUndefined();
  });
});

describe("isDataSourceRole", () => {
  it("accepts exactly backfill and feed", () => {
    expect(isDataSourceRole("backfill")).toBe(true);
    expect(isDataSourceRole("feed")).toBe(true);
  });

  it("rejects any other value", () => {
    for (const bad of ["", "Backfill", "FEED", "live", "csv", undefined, null, 1, {}]) {
      expect(isDataSourceRole(bad)).toBe(false);
    }
  });
});

describe("validateOpsConfig", () => {
  it("accepts a valid backfill config", () => {
    expect(validateOpsConfig({ csv: { role: "backfill" } })).toEqual({
      csv: { role: "backfill" },
    });
  });

  it("accepts a valid feed config", () => {
    expect(validateOpsConfig({ csv: { role: "feed" } })).toEqual({
      csv: { role: "feed" },
    });
  });

  it("rejects a missing csv section", () => {
    expect(() => validateOpsConfig({})).toThrow(OpsConfigError);
  });

  it("rejects a non-object top level", () => {
    expect(() => validateOpsConfig("backfill")).toThrow(OpsConfigError);
    expect(() => validateOpsConfig(null)).toThrow(OpsConfigError);
  });

  it("rejects an invalid role", () => {
    expect(() => validateOpsConfig({ csv: { role: "live" } })).toThrow(OpsConfigError);
    expect(() => validateOpsConfig({ csv: {} })).toThrow(OpsConfigError);
  });
});

describe("loadOpsConfig / loadDataSourceRole", () => {
  it("reads and validates a config from the injected reader", async () => {
    const path = join("/repo", OPS_CONFIG_FILE);
    const read = fakeReader({ [path]: JSON.stringify({ csv: { role: "feed" } }) });

    await expect(loadOpsConfig("/repo", read)).resolves.toEqual({
      csv: { role: "feed" },
    });
    await expect(loadDataSourceRole("/repo", read)).resolves.toBe("feed");
  });

  it("throws OpsConfigError when the file is unreadable", async () => {
    await expect(loadOpsConfig("/repo", fakeReader({}))).rejects.toBeInstanceOf(
      OpsConfigError,
    );
  });

  it("throws OpsConfigError on invalid JSON", async () => {
    const path = join("/repo", OPS_CONFIG_FILE);
    await expect(
      loadOpsConfig("/repo", fakeReader({ [path]: "{ not json" })),
    ).rejects.toBeInstanceOf(OpsConfigError);
  });

  it("throws OpsConfigError on a valid-JSON but invalid role", async () => {
    const path = join("/repo", OPS_CONFIG_FILE);
    await expect(
      loadOpsConfig("/repo", fakeReader({ [path]: JSON.stringify({ csv: { role: "x" } }) })),
    ).rejects.toBeInstanceOf(OpsConfigError);
  });
});

describe("CadenceGuard — run cadence enforcement (spec Req 1.8)", () => {
  it("backfill runs exactly once, then refuses further runs", () => {
    const guard = new CadenceGuard("backfill");
    expect(guard.dataSourceRole).toBe("backfill");

    expect(guard.canRun()).toBe(true);
    expect(guard.beginRun()).toBe(true); // first run permitted
    expect(guard.runCount).toBe(1);

    expect(guard.canRun()).toBe(false);
    expect(guard.beginRun()).toBe(false); // run-once: second refused
    expect(guard.beginRun()).toBe(false);
    expect(guard.runCount).toBe(1); // no additional run recorded
  });

  it("feed runs on the recurring cadence, permitting repeated runs", () => {
    const guard = new CadenceGuard("feed");
    expect(guard.dataSourceRole).toBe("feed");

    for (let i = 1; i <= 5; i++) {
      expect(guard.canRun()).toBe(true);
      expect(guard.beginRun()).toBe(true);
      expect(guard.runCount).toBe(i);
    }
  });
});
