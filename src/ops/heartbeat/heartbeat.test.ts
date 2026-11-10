import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { checkHeartbeat, expectedLatestDecisionDate } from "./heartbeat.js";
import { runHeartbeat } from "./main.js";

const at = (iso: string): number => Date.parse(iso);

describe("expectedLatestDecisionDate", () => {
  it("labels a Friday run as Monday and skips weekends", () => {
    expect(expectedLatestDecisionDate(at("2026-11-14T12:00:00Z"))).toBe("2026-11-16"); // Sat
    expect(expectedLatestDecisionDate(at("2026-11-16T10:00:00Z"))).toBe("2026-11-16"); // Mon morning
    expect(expectedLatestDecisionDate(at("2026-11-17T01:00:00Z"))).toBe("2026-11-17"); // Mon run published Tue
  });

  it("uses the same schedule constants as the SPA's own check (web test pins the other side)", () => {
    const web = readFileSync(join(__dirname, "..", "..", "..", "web", "src", "pure", "shapeDataHealth.ts"), "utf8");
    const mine = readFileSync(join(__dirname, "heartbeat.ts"), "utf8");
    const grab = (src: string, name: string): string => new RegExp(`${name}\\s*=\\s*([0-9.]+)`).exec(src)?.[1] ?? "missing";
    expect(grab(web, "RUN_HOUR_UTC")).toBe(grab(mine, "RUN_HOUR_UTC"));
    expect(grab(web, "RUN_GRACE_HOURS")).toBe(grab(mine, "RUN_GRACE_HOURS"));
    expect(grab(mine, "RUN_HOUR_UTC")).not.toBe("missing");
  });
});

describe("checkHeartbeat", () => {
  const now = at("2026-11-12T02:00:00Z"); // Thursday 02:00 UTC: Wednesday's run is due, should publish Thursday
  it("is healthy when the published Decision_Date is the one due", () => {
    expect(checkHeartbeat({ decisionDate: "2026-11-12" }, now)).toMatchObject({ ok: true, expected: "2026-11-12" });
  });
  it("reports a missed run when the published date is older", () => {
    const r = checkHeartbeat({ decisionDate: "2026-11-11" }, now);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain("Missed daily run");
  });
  it("is not fooled by an intraday republish: only the Decision_Date counts", () => {
    expect(checkHeartbeat({ decisionDate: "2026-11-11", generatedAt: "2026-11-12T01:30:00Z" }, now).ok).toBe(false);
  });
  it("fails closed on a malformed body", () => {
    expect(checkHeartbeat(null, now).ok).toBe(false);
    expect(checkHeartbeat({ decisionDate: "" }, now).ok).toBe(false);
  });
});

describe("runHeartbeat", () => {
  const now = at("2026-11-12T02:00:00Z");
  const okFetch = (body: unknown): typeof fetch => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  it("passes on a current snapshot and fails on a stale one", async () => {
    expect((await runHeartbeat("https://x/dashboard.json", now, okFetch({ decisionDate: "2026-11-12" }))).ok).toBe(true);
    expect((await runHeartbeat("https://x/dashboard.json", now, okFetch({ decisionDate: "2026-11-10" }))).ok).toBe(false);
  });
  it("treats an unreachable or non-200 snapshot as a failure", async () => {
    expect((await runHeartbeat("https://x", now, () => Promise.resolve(new Response("", { status: 503 })))).ok).toBe(false);
    expect((await runHeartbeat("https://x", now, () => Promise.reject(new Error("boom")))).ok).toBe(false);
  });
});

describe("workflow file", () => {
  const yml = readFileSync(join(__dirname, "..", "..", "..", ".github", "workflows", "heartbeat.yml"), "utf8");
  it("runs on weekday nights, needs no secrets and only reads", () => {
    expect(yml).toContain('cron: "0 2 * * 2-6"');
    expect(yml).not.toMatch(/secrets\./);
    expect(yml).toContain("contents: read");
    expect(yml).toContain("DASHBOARD_SNAPSHOT_URL");
  });
});
