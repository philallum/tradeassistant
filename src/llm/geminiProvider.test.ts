import { describe, expect, it, vi } from "vitest";

import {
  GeminiLlmProvider,
  type AccessTokenProvider,
  type GeminiProviderConfig,
} from "./geminiProvider.js";

// Unit tests for the Gemini adapter's request shaping + truncation surfacing.
// They assert the generationConfig the adapter sends — specifically that the
// `thinkingConfig.thinkingBudget` is included ONLY when configured (the fix for
// the truncated daily note: gemini-2.5-flash spent the whole output budget on
// hidden thinking, so disabling it is what lets the visible answer complete) —
// and that a `finishReason: MAX_TOKENS` response is logged. A fake token + fake
// fetch keep it offline; no SDK, no network, no secret.

const CONFIG_BASE: GeminiProviderConfig = {
  project: "proj",
  location: "europe-west1",
  model: "gemini-2.5-flash",
};

const tokens: AccessTokenProvider = { getAccessToken: () => Promise.resolve("fake-token") };

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

/** A fetch stub that captures the request and returns a canned generateContent body. */
function stubFetch(
  captured: Captured[],
  responseBody: unknown,
  status = 200,
): typeof fetch {
  return ((url: string | URL, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>,
    });
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
}

function okBody(text: string, finishReason = "STOP"): unknown {
  return { candidates: [{ content: { parts: [{ text }] }, finishReason }] };
}

describe("GeminiLlmProvider request shaping", () => {
  it("includes thinkingConfig.thinkingBudget ONLY when configured", async () => {
    const captured: Captured[] = [];
    const provider = new GeminiLlmProvider(
      { ...CONFIG_BASE, thinkingBudget: 0, maxOutputTokens: 1024 },
      tokens,
      stubFetch(captured, okBody("A complete rationale.")),
    );
    await provider.complete("signal_rationale", { pattern: "p" });

    const gen = captured[0]!.body.generationConfig as Record<string, unknown>;
    expect(gen.maxOutputTokens).toBe(1024);
    expect(gen.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("omits thinkingConfig when no budget is configured (back-compat), using the default token cap", async () => {
    const captured: Captured[] = [];
    const provider = new GeminiLlmProvider(
      CONFIG_BASE,
      tokens,
      stubFetch(captured, okBody("A complete rationale.")),
    );
    await provider.complete("signal_rationale", { pattern: "p" });

    const gen = captured[0]!.body.generationConfig as Record<string, unknown>;
    expect("thinkingConfig" in gen).toBe(false);
    expect(gen.maxOutputTokens).toBe(1024); // DEFAULT_MAX_OUTPUT_TOKENS
  });

  it("tells the model every horizon is in trading days, never minutes or hours", async () => {
    for (const role of ["signal_rationale", "pattern_description"] as const) {
      const captured: Captured[] = [];
      const provider = new GeminiLlmProvider(
        CONFIG_BASE,
        tokens,
        stubFetch(captured, okBody(role === "pattern_description" ? '["x"]' : "ok")),
      );
      await provider.complete(
        role,
        role === "pattern_description" ? { analogues: [] } : { selectedHorizon: 1 },
      );
      const contents = captured[0]!.body.contents as Array<{ parts: Array<{ text: string }> }>;
      const prompt = contents[0]!.parts[0]!.text;
      expect(prompt).toContain("TRADING DAYS");
      expect(prompt).toContain("Never describe a horizon in minutes or hours");
    }
  });

  it("returns the model's text for signal_rationale", async () => {
    const provider = new GeminiLlmProvider(
      { ...CONFIG_BASE, thinkingBudget: 0 },
      tokens,
      stubFetch([], okBody("Today's scan found no setups above threshold.")),
    );
    const out = await provider.complete("signal_rationale", { pattern: "p" });
    expect(out).toBe("Today's scan found no setups above threshold.");
  });

  it("logs a secret-free warning when the generation is truncated (finishReason MAX_TOKENS)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const provider = new GeminiLlmProvider(
        { ...CONFIG_BASE, thinkingBudget: 0, maxOutputTokens: 1024 },
        tokens,
        stubFetch([], okBody("truncated…", "MAX_TOKENS")),
      );
      await provider.complete("signal_rationale", { pattern: "p" });

      expect(warn).toHaveBeenCalled();
      const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("gemini.generation_truncated");
      expect(logged).toContain("MAX_TOKENS");
      expect(logged).not.toContain("fake-token");
    } finally {
      warn.mockRestore();
    }
  });

  it("does not warn on a normal STOP finish", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const provider = new GeminiLlmProvider(
        { ...CONFIG_BASE, thinkingBudget: 0 },
        tokens,
        stubFetch([], okBody("Complete.", "STOP")),
      );
      await provider.complete("signal_rationale", { pattern: "p" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
