import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { REDACTED, redactSecrets } from "./redactSecrets.js";

const KEY = "sk_live_ABC123xyz789";

describe("redactSecrets", () => {
  it("replaces a known secret value wherever it appears", () => {
    const out = redactSecrets(`provider said: invalid key ${KEY}, retry with ${KEY}`, [KEY]);
    expect(out).not.toContain(KEY);
    expect(out).toBe(`provider said: invalid key ${REDACTED}, retry with ${REDACTED}`);
  });

  it("also replaces the URL-encoded form of the secret", () => {
    const secret = "a+b/c=d&e";
    const out = redactSecrets(`GET /x?k=${encodeURIComponent(secret)} failed`, [secret]);
    expect(out).not.toContain(encodeURIComponent(secret));
    expect(out).toContain(REDACTED);
  });

  it("masks credential query parameters even when the secret is not known", () => {
    expect(redactSecrets("request to https://h/forex/latest?symbol=EURUSD&access_key=SECRET1 failed")).toBe(
      `request to https://h/forex/latest?symbol=EURUSD&access_key=${REDACTED} failed`,
    );
    expect(redactSecrets("https://h/time_series?apikey=SECRET2&format=JSON")).toBe(
      `https://h/time_series?apikey=${REDACTED}&format=JSON`,
    );
    expect(redactSecrets("https://h/v2/aggs?adjusted=true&apiKey=SECRET3")).toBe(
      `https://h/v2/aggs?adjusted=true&apiKey=${REDACTED}`,
    );
  });

  it("leaves harmless text and non-credential parameters untouched", () => {
    const text = "FCS returned HTTP 503 for https://h/forex/latest?symbol=EURUSD&period=1d";
    expect(redactSecrets(text, [KEY])).toBe(text);
  });

  it("ignores undefined and very short secrets for value replacement", () => {
    expect(redactSecrets("abc is fine", [undefined, "abc"])).toBe("abc is fine");
  });

  it("property: a known secret never survives, whatever surrounds it", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.string({ minLength: 0, maxLength: 20 }),
        fc.stringMatching(/^[A-Za-z0-9_-]{8,24}$/),
        (before, after, secret) => {
          const out = redactSecrets(`${before}${secret}${after}`, [secret]);
          // The secret may legitimately remain only if the surrounding text re-forms it by chance,
          // which the replacement of every occurrence rules out.
          expect(out.includes(secret)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
