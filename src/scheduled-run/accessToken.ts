// GCP access-token resolver for the scheduled run (Requirement 2.4 auth; the
// Gemini backend uses Google Cloud IAM via ADC, no standalone API key).
//
// The Gemini adapter (src/llm/geminiProvider.ts) depends on an injected
// `AccessTokenProvider` so it never spawns a process or reads the metadata
// server itself. This module provides the two production resolvers:
//
//   1. In Cloud Run, the attached service account's token is available from the
//      GCE/Cloud Run metadata server over plain HTTP (no gcloud needed). This is
//      the path the scheduled Job uses in production.
//   2. Locally, the token comes from Application Default Credentials via
//      `gcloud auth application-default print-access-token`.
//
// `resolveAccessTokenProvider()` prefers the metadata server when it is present
// (so the deployed Job needs no gcloud binary) and falls back to gcloud for
// local runs. Tokens are short-lived and cached until shortly before expiry so a
// single daily run reuses one token across its handful of model calls.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AccessTokenProvider } from "../llm/geminiProvider.js";

const execFileAsync = promisify(execFile);

/** The GCE/Cloud Run metadata endpoint for the service-account access token. */
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** Refresh a cached token this many ms before its stated expiry. */
const EXPIRY_SKEW_MS = 60_000;

/** A cached token with its absolute expiry (ms epoch). */
interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

/**
 * Wrap a raw "fetch one fresh token" function with short-lived caching so a
 * single daily run reuses one token across its model calls. The default TTL is
 * conservative when the source does not report one.
 */
function withCache(
  fetchFresh: () => Promise<{ token: string; expiresInSec: number }>,
): AccessTokenProvider {
  let cached: CachedToken | undefined;
  return {
    async getAccessToken(): Promise<string> {
      const now = Date.now();
      if (cached !== undefined && now < cached.expiresAtMs - EXPIRY_SKEW_MS) {
        return cached.token;
      }
      const fresh = await fetchFresh();
      cached = {
        token: fresh.token,
        expiresAtMs: now + Math.max(0, fresh.expiresInSec) * 1000,
      };
      return cached.token;
    },
  };
}

/** True when the GCE/Cloud Run metadata server is reachable. */
async function metadataServerAvailable(fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("http://metadata.google.internal/computeMetadata/v1/", {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Token provider backed by the Cloud Run / GCE metadata server. */
export function metadataAccessTokenProvider(fetchImpl: typeof fetch = fetch): AccessTokenProvider {
  return withCache(async () => {
    const res = await fetchImpl(METADATA_TOKEN_URL, {
      method: "GET",
      headers: { "Metadata-Flavor": "Google" },
    });
    if (!res.ok) {
      throw new Error(`metadata token request failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof body.access_token !== "string" || body.access_token === "") {
      throw new Error("metadata token response had no access_token");
    }
    return { token: body.access_token, expiresInSec: body.expires_in ?? 3000 };
  });
}

/** Token provider backed by local Application Default Credentials via gcloud. */
export function gcloudAccessTokenProvider(): AccessTokenProvider {
  return withCache(async () => {
    const { stdout } = await execFileAsync("gcloud", [
      "auth",
      "application-default",
      "print-access-token",
    ]);
    const token = stdout.trim();
    if (token === "") {
      throw new Error("gcloud returned an empty access token");
    }
    // gcloud does not report an expiry here; ADC tokens live ~1h. Cache ~55m.
    return { token, expiresInSec: 3300 };
  });
}

/**
 * Resolve the production access-token provider: prefer the metadata server (the
 * deployed Cloud Run Job path, which needs no gcloud binary), falling back to
 * local ADC via gcloud for developer runs.
 */
export async function resolveAccessTokenProvider(
  fetchImpl: typeof fetch = fetch,
): Promise<AccessTokenProvider> {
  if (await metadataServerAvailable(fetchImpl)) {
    return metadataAccessTokenProvider(fetchImpl);
  }
  return gcloudAccessTokenProvider();
}
