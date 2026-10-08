// GCS-backed Public_Read_Path snapshot uploader (simplify-to-cloud-minimal
// R5.1, R5.2; design Decision 2 / C3, operator-approved Option A).
//
// Under the public-data decision the `dashboard.json` snapshot is published to a
// PUBLIC-READ Google Cloud Storage bucket; the hosted SPA fetches that object's
// public URL directly (cross-origin). This module is the concrete {@link
// SnapshotSink} that uploads the already-serialised snapshot body to that
// bucket.
//
// IMPORTANT — zero-runtime-dep + import boundary:
//   - This uploader uses ONLY the built-in global `fetch` against the GCS JSON
//     API media-upload endpoint. It imports NO google-cloud SDK package, so the
//     project stays zero-runtime-dependency and the LLM/SDK import-boundary
//     guard is unaffected.
//   - Auth reuses the EXISTING `AccessTokenProvider` (the same seam the Gemini
//     adapter uses): the runtime service account's metadata token in Cloud Run,
//     local ADC via gcloud otherwise. No new auth mechanism is introduced.
//
// SECRET HYGIENE: the bearer token is attached to the request `Authorization`
// header and is NEVER logged. On a non-2xx response this throws an Error whose
// message carries ONLY the HTTP status (no token, no response body), so the
// fail-safe wrapper `writeDashboardSnapshot` logs+swallows a secret-free message
// and the daily run is never broken.

import type { AccessTokenProvider } from "../llm/geminiProvider.js";
import type { SnapshotSink } from "./snapshot.js";

/** The GCS JSON API upload host (media upload for a single object). */
const GCS_UPLOAD_HOST = "https://storage.googleapis.com";

/**
 * Build the GCS media-upload URL for an object named `fileName` in `bucket`.
 *
 * The JSON API simple (media) upload is:
 *   POST /upload/storage/v1/b/<bucket>/o?uploadType=media&name=<urlencoded name>
 * The object name is URL-encoded so a name containing `/` or other reserved
 * characters is uploaded as the literal object name rather than a path.
 */
export function gcsUploadUrl(bucket: string, fileName: string): string {
  return (
    `${GCS_UPLOAD_HOST}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(fileName)}`
  );
}

/** Options for {@link makeGcsSnapshotSink}. */
export interface GcsSnapshotSinkConfig {
  /** The target public-read bucket name (non-secret config). */
  readonly bucket: string;
  /** Provider of the short-lived GCP OAuth bearer token (reused, injectable). */
  readonly tokens: AccessTokenProvider;
  /** The `fetch` implementation (injectable for tests). Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Build a {@link SnapshotSink} that uploads the serialised snapshot body to the
 * configured public-read GCS bucket via the JSON API media upload.
 *
 * The returned sink:
 *   - resolves a bearer token from the injected {@link AccessTokenProvider},
 *   - POSTs the `body` as the object `fileName` with `Content-Type:
 *     application/json` and `Cache-Control: no-cache, max-age=0` (so the SPA
 *     always gets the latest; the SPA also cache-busts), and
 *   - THROWS on a non-2xx response (status only, no secret) so the fail-safe
 *     wrapper logs+swallows it and the run never breaks.
 *
 * It holds no secret and never logs the token.
 */
export function makeGcsSnapshotSink(config: GcsSnapshotSinkConfig): SnapshotSink {
  const fetchImpl = config.fetchImpl ?? fetch;
  return async (fileName: string, body: string): Promise<void> => {
    const token = await config.tokens.getAccessToken();
    const res = await fetchImpl(gcsUploadUrl(config.bucket, fileName), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Always serve the freshest snapshot; the SPA additionally cache-busts.
        "Cache-Control": "no-cache, max-age=0",
      },
      body,
    });
    if (!res.ok) {
      // Secret-free: carry ONLY the status. Never include the token or body.
      throw new Error(
        `GCS snapshot upload to bucket "${config.bucket}" failed: HTTP ${res.status}`,
      );
    }
  };
}
