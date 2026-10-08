// Unit tests for the GCS-backed Public_Read_Path snapshot uploader
// (simplify-to-cloud-minimal R5.1, R5.2; design Decision 2 / C3).
//
// These verify the concrete {@link SnapshotSink} produced by
// `makeGcsSnapshotSink`:
//   - uploads to the GCS media-upload endpoint with the right URL (bucket +
//     url-encoded object name), method, and headers (bearer token from the
//     injected AccessTokenProvider, JSON content-type, no-cache),
//   - sends the serialised snapshot body verbatim,
//   - THROWS on a non-2xx response (so the fail-safe wrapper swallows it), and
//   - NEVER logs or leaks the bearer token.
//
// An injected `fetch` + injected token provider keep the test offline.

import { describe, expect, it, vi } from "vitest";

import type { AccessTokenProvider } from "../llm/geminiProvider.js";
import { gcsUploadUrl, makeGcsSnapshotSink } from "./gcsSnapshotSink.js";

const BUCKET = "fx-dashboard-public";
const TOKEN = "ya29.super-secret-token-value";
const FILE = "dashboard.json";
const BODY = '{"schemaVersion":1,"decisionDate":"2024-03-15"}';

/** A token provider that returns a fixed secret token. */
function fixedTokens(token = TOKEN): AccessTokenProvider {
  return { getAccessToken: () => Promise.resolve(token) };
}

/** A capturing fetch that records the call and returns the given response. */
function capturingFetch(
  response: Response,
  captured: Array<{ url: string; init: RequestInit | undefined }>,
): typeof fetch {
  return ((url: string | URL, init?: RequestInit) => {
    captured.push({ url: String(url), init });
    return Promise.resolve(response);
  }) as unknown as typeof fetch;
}

describe("gcsUploadUrl", () => {
  it("builds the media-upload URL with url-encoded bucket + object name", () => {
    expect(gcsUploadUrl(BUCKET, FILE)).toBe(
      `https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=dashboard.json`,
    );
  });

  it("url-encodes an object name containing reserved characters", () => {
    expect(gcsUploadUrl(BUCKET, "a/b dashboard.json")).toContain(
      "name=a%2Fb%20dashboard.json",
    );
  });
});

describe("makeGcsSnapshotSink — uploads to GCS with the correct request", () => {
  it("POSTs to the media endpoint with bearer token, JSON content-type, no-cache, and the body verbatim", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sink = makeGcsSnapshotSink({
      bucket: BUCKET,
      tokens: fixedTokens(),
      fetchImpl: capturingFetch(new Response("", { status: 200 }), captured),
    });

    await sink(FILE, BODY);

    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(call.url).toBe(gcsUploadUrl(BUCKET, FILE));
    expect(call.init?.method).toBe("POST");
    expect(call.init?.body).toBe(BODY);

    const headers = (call.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Cache-Control"]).toBe("no-cache, max-age=0");
  });

  it("resolves a fresh token from the injected provider on each upload", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const getAccessToken = vi.fn().mockResolvedValue(TOKEN);
    const sink = makeGcsSnapshotSink({
      bucket: BUCKET,
      tokens: { getAccessToken },
      fetchImpl: capturingFetch(new Response(null, { status: 204 }), captured),
    });

    await sink(FILE, BODY);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });
});

describe("makeGcsSnapshotSink — throws on non-2xx (fail-safe wrapper swallows it)", () => {
  it("throws a secret-free Error carrying only the HTTP status", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sink = makeGcsSnapshotSink({
      bucket: BUCKET,
      tokens: fixedTokens(),
      fetchImpl: capturingFetch(new Response("forbidden details", { status: 403 }), captured),
    });

    const err = await sink(FILE, BODY).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toContain("403");
    // The error must leak NEITHER the token NOR the raw response body.
    expect(message).not.toContain(TOKEN);
    expect(message).not.toContain("forbidden details");
  });

  it("throws on a 500 too", async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const sink = makeGcsSnapshotSink({
      bucket: BUCKET,
      tokens: fixedTokens(),
      fetchImpl: capturingFetch(new Response("", { status: 500 }), captured),
    });

    await expect(sink(FILE, BODY)).rejects.toThrow(/500/);
  });
});

describe("makeGcsSnapshotSink — never leaks the bearer token to the console", () => {
  it("does not log the token on success or failure", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const captured: Array<{ url: string; init: RequestInit | undefined }> = [];

      // Success path.
      const okSink = makeGcsSnapshotSink({
        bucket: BUCKET,
        tokens: fixedTokens(),
        fetchImpl: capturingFetch(new Response("", { status: 200 }), captured),
      });
      await okSink(FILE, BODY);

      // Failure path.
      const failSink = makeGcsSnapshotSink({
        bucket: BUCKET,
        tokens: fixedTokens(),
        fetchImpl: capturingFetch(new Response("", { status: 401 }), captured),
      });
      await failSink(FILE, BODY).catch(() => undefined);

      const everyLoggedArg = [
        ...logSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...errorSpy.mock.calls,
      ]
        .flat()
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      expect(everyLoggedArg).not.toContain(TOKEN);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
