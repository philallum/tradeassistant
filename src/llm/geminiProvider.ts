// Google Gemini LlmProvider adapter (Requirement 2.4; Design Component 9 — v1
// = Google Gemini via the Gemini API in Vertex AI, behind GCP IAM/ADC).
//
// This is the concrete, PRODUCTION backend for the `LlmProvider` port the
// `LlmInterface` depends on. It is the single place in the system that knows how
// to talk to a model — every caller still routes through the `LlmInterface`
// gateway (role gating + provenance tagging), so this adapter only ever sees an
// already-sanctioned role and returns the raw (untagged) output.
//
// IMPORTANT — AI/Deterministic + import boundaries:
//   - This adapter uses ONLY the global `fetch` against the Vertex AI REST
//     endpoint. It imports NO provider SDK package (`@google/genai` et al.), so
//     the LLM-import-boundary guard (src/llm/importBoundary.smoke.test.ts) stays
//     green: v1 ships no provider SDK, and the ONE sanctioned place that may
//     know a concrete backend (src/llm) reaches it over plain HTTPS.
//   - It produces values ONLY for the two outward-only display roles
//     (`signal_rationale`, `pattern_description`) and the advisory
//     `research_assistant` role. The `news_filter` role is intentionally NOT
//     served here (the deterministic news path stays LLM-free by default); a
//     caller that asks for it gets a safe, permissive `none` flag.
//
// Auth is Google Cloud IAM via Application Default Credentials — there is no
// standalone API key (see .env: GOOGLE_GENAI_USE_VERTEXAI=true, no key). The
// bearer token is obtained through an injected `AccessTokenProvider` so this
// module performs no process spawning / metadata I/O itself and stays unit-
// testable with a fake token + fake fetch.

import type { LlmProvider } from "./llmInterface.js";
import type { RoleInput, RoleOutput, SanctionedRole } from "./types.js";

/**
 * Resolves a short-lived GCP OAuth access token for the Vertex AI call. Injected
 * so the adapter never shells out or reads the metadata server directly; the
 * composition root supplies the real resolver (ADC / metadata), tests a fake.
 */
export interface AccessTokenProvider {
  getAccessToken(): Promise<string>;
}

/** Configuration for the Vertex AI Gemini backend. */
export interface GeminiProviderConfig {
  /** GCP project id (e.g. `trade-assistant-508806`). */
  readonly project: string;
  /** Vertex AI region/location (e.g. `europe-west1`). */
  readonly location: string;
  /** Publisher model id (e.g. `gemini-2.5-flash`). */
  readonly model: string;
  /** Upper bound on generated tokens per call. Defaults to 1024. */
  readonly maxOutputTokens?: number;
  /**
   * The model's internal "thinking" token budget (Gemini 2.5 thinking models).
   * `gemini-2.5-flash` spends output tokens on hidden reasoning BEFORE the
   * visible answer, so with a small `maxOutputTokens` the thinking can exhaust
   * the budget and truncate (or empty) the answer (`finishReason: MAX_TOKENS`).
   * For the short DISPLAY-ONLY roles this adapter serves, reasoning adds no value,
   * so the composition root sets this to `0` to disable thinking and spend the
   * whole budget on the visible prose. Omitted → the field is NOT sent and the
   * model uses its own default thinking behaviour (back-compat).
   */
  readonly thinkingBudget?: number;
  /** Per-call network timeout in ms. Defaults to 20_000. */
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1024 as const;
const DEFAULT_TIMEOUT_MS = 20_000 as const;

/** Minimal shape of the Vertex AI `generateContent` response we read. */
interface GenerateContentResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: { readonly parts?: ReadonlyArray<{ readonly text?: string }> };
    /** Why generation stopped. `MAX_TOKENS` means the answer was truncated. */
    readonly finishReason?: string;
  }>;
}

/**
 * Build the Vertex AI `generateContent` REST URL for the configured model. The
 * endpoint is region-pinned: `<location>-aiplatform.googleapis.com`.
 */
function generateContentUrl(config: GeminiProviderConfig): string {
  const host = `https://${config.location}-aiplatform.googleapis.com`;
  return (
    `${host}/v1/projects/${config.project}/locations/${config.location}` +
    `/publishers/google/models/${config.model}:generateContent`
  );
}

/**
 * Compose the plain-text prompt handed to the model for a sanctioned role. The
 * inputs are the deterministic numeric payloads the `LlmInterface` already
 * forwards; the prompt only ASKS for display text and never feeds anything back
 * into scoring (the output is provenance-tagged by the gateway).
 */
function buildPrompt(role: SanctionedRole, input: RoleInput[SanctionedRole]): string {
  const payload = JSON.stringify(input, null, 2);
  switch (role) {
    case "signal_rationale":
      return (
        "You are a trading-desk analyst writing a concise, plain-language rationale " +
        "for ONE firing FX setup. Describe, in 2-3 sentences, why the setup looks the " +
        "way it does given the deterministic numeric signal below (pattern, trend " +
        "context, structural liquidity distance, selected horizon, direction, earned " +
        "confidence). Do NOT invent numbers, do NOT give trade advice, and do NOT " +
        "recommend a different direction. Return prose only.\n\n" +
        `Signal:\n${payload}`
      );
    case "pattern_description":
      return (
        "You label matched historical analogues for a trading dashboard. Given the " +
        "analogue summaries below, return a JSON array of short (2-4 word) qualitative " +
        'labels, one per analogue, e.g. ["sharp V-reversal","slow grind up"]. Return ' +
        "ONLY the JSON array, no prose.\n\n" +
        `Analogues:\n${payload}`
      );
    case "research_assistant":
      return (
        "You are a research assistant proposing (advisory-only, never auto-accepted) " +
        "feature hypotheses or interpretations for an FX pattern system. Respond with a " +
        "short paragraph.\n\n" +
        `Prompt:\n${payload}`
      );
    case "news_filter":
      // Not served by the LLM backend — kept exhaustive for the type checker.
      return payload;
    default: {
      const exhaustive: never = role;
      return String(exhaustive);
    }
  }
}

/** Extract the concatenated text of the first candidate, or "" when absent. */
function extractText(body: GenerateContentResponse): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

/**
 * Parse the `pattern_description` model output (a JSON array of label strings)
 * into `readonly string[]`. Falls back to splitting on newlines when the model
 * did not return strict JSON, and finally to a single-element array so the role
 * never throws on a well-formed-but-unexpected response.
 */
function parseLabels(text: string): readonly string[] {
  // Models frequently wrap JSON in a Markdown code fence (```json … ```).
  // Strip a leading/trailing fence before attempting to parse.
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v)).filter((s) => s.length > 0);
    }
  } catch {
    // Not JSON — fall through to a line-based parse below.
  }
  const lines = trimmed
    .split("\n")
    .map((l) => l.replace(/^[\s*\-\d.)]+/, "").trim())
    .filter((l) => l.length > 0 && l !== "[" && l !== "]");
  return lines.length > 0 ? lines : trimmed === "" ? [] : [trimmed];
}

/**
 * The error thrown when the Vertex AI call fails or returns an unusable body.
 * The `LlmInterface` does not catch this; the daily-run composition treats a
 * rationale failure as "no narrative for that pair" so a provider outage never
 * blocks the deterministic firing view.
 */
export class GeminiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiProviderError";
  }
}

/**
 * A real {@link LlmProvider} backed by the Gemini API in Vertex AI over REST.
 *
 * `complete(role, input)` is invoked by the `LlmInterface` ONLY after the role
 * is validated as sanctioned. It builds a role-specific prompt, POSTs it to the
 * region-pinned `generateContent` endpoint with an ADC bearer token, and maps
 * the response to the role's output type. No SDK is imported; the transport is
 * the global `fetch`, injectable for tests.
 */
export class GeminiLlmProvider implements LlmProvider {
  readonly #config: GeminiProviderConfig;
  readonly #tokens: AccessTokenProvider;
  readonly #fetch: typeof fetch;

  constructor(
    config: GeminiProviderConfig,
    tokens: AccessTokenProvider,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.#config = config;
    this.#tokens = tokens;
    this.#fetch = fetchImpl;
  }

  async complete<R extends SanctionedRole>(role: R, input: RoleInput[R]): Promise<RoleOutput[R]> {
    // The news filter is intentionally LLM-free: return a safe, permissive flag
    // rather than calling the model, so the deterministic news path is never
    // gated on a provider round-trip.
    if (role === "news_filter") {
      return { level: "none", reason: "news filter not served by the Gemini backend" } as RoleOutput[R];
    }

    const text = await this.#generate(buildPrompt(role, input));

    switch (role) {
      case "signal_rationale":
      case "research_assistant":
        return text as RoleOutput[R];
      case "pattern_description":
        return parseLabels(text) as RoleOutput[R];
      default:
        return text as RoleOutput[R];
    }
  }

  /** POST one prompt to Vertex AI and return the model's text. */
  async #generate(prompt: string): Promise<string> {
    const url = generateContentUrl(this.#config);
    const token = await this.#tokens.getAccessToken();
    // Include `thinkingConfig` ONLY when a budget is configured, so a run that
    // does not set one keeps the model's default behaviour (back-compat). For
    // this project's short display roles the composition root sets it to 0, which
    // disables hidden reasoning so the whole `maxOutputTokens` budget is spent on
    // the visible answer (otherwise the thinking tokens can truncate it).
    const thinkingBudget = this.#config.thinkingBudget;
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: this.#config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      temperature: 0.2,
      ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
    };
    const requestBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new GeminiProviderError(`Vertex AI request failed: ${detail}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new GeminiProviderError(
        `Vertex AI returned HTTP ${response.status}: ${errText.slice(0, 500)}`,
      );
    }

    const body = (await response.json()) as GenerateContentResponse;
    // Surface a truncated generation (`finishReason: MAX_TOKENS`) as a secret-free
    // warning so a regression in the token/thinking budget is diagnosable rather
    // than silently shipping a cut-off note. We still return whatever text came
    // back: this adapter is display-only and the caller degrades gracefully.
    const finishReason = body.candidates?.[0]?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      console.warn(
        JSON.stringify({
          event: "gemini.generation_truncated",
          finishReason,
          model: this.#config.model,
          maxOutputTokens: this.#config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          thinkingBudget: this.#config.thinkingBudget ?? null,
        }),
      );
    }
    return extractText(body);
  }
}
