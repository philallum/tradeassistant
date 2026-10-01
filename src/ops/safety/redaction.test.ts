// Unit tests for the Secret_Key redaction helper (spec Req 6.2, 6.3; task 5.1).
//
// These verify the pure redaction logic: every secret value is replaced with
// its `<from .env: NAME>` placeholder on a display/log surface, the raw value
// never survives, and the documented edge cases (empty/whitespace values,
// longer-before-shorter ordering) are handled.

import { describe, expect, it } from "vitest";

import {
  redactArgv,
  redactSecrets,
  redactionPlaceholder,
} from "./redaction.js";

describe("redactionPlaceholder", () => {
  it("formats the <from .env: NAME> placeholder", () => {
    expect(redactionPlaceholder("OHLC_API_KEY")).toBe("<from .env: OHLC_API_KEY>");
  });
});

describe("redactSecrets", () => {
  it("replaces every occurrence of a secret value with its placeholder", () => {
    const input = "token=abc123 retry token=abc123";
    const out = redactSecrets(input, { OHLC_API_KEY: "abc123" });
    expect(out).toBe(
      "token=<from .env: OHLC_API_KEY> retry token=<from .env: OHLC_API_KEY>",
    );
    expect(out).not.toContain("abc123");
  });

  it("redacts multiple distinct secrets", () => {
    const input = "a=SECRET1 b=SECRET2";
    const out = redactSecrets(input, {
      KEY_A: "SECRET1",
      KEY_B: "SECRET2",
    });
    expect(out).toBe("a=<from .env: KEY_A> b=<from .env: KEY_B>");
    expect(out).not.toContain("SECRET1");
    expect(out).not.toContain("SECRET2");
  });

  it("skips empty and whitespace-only values (no spurious global replacement)", () => {
    const input = "hello world";
    const out = redactSecrets(input, {
      EMPTY: "",
      BLANK: "   ",
      ABSENT: undefined,
    });
    // Nothing should be redacted; the string is untouched.
    expect(out).toBe("hello world");
  });

  it("redacts longer values before shorter ones to avoid partial leaks", () => {
    // SHORT ("abc") is a substring of LONG ("abcdef"). If SHORT were redacted
    // first, "def" of the long value would leak. Longer-first prevents that.
    const input = "value=abcdef other=abc";
    const out = redactSecrets(input, {
      LONG: "abcdef",
      SHORT: "abc",
    });
    expect(out).toContain("value=<from .env: LONG>");
    expect(out).toContain("other=<from .env: SHORT>");
    expect(out).not.toContain("abcdef");
    // No fragment of the long value leaks.
    expect(out).not.toMatch(/def/);
  });

  it("treats secret values literally, not as regular expressions", () => {
    const input = "pattern=a.*b and literal=a.*b";
    const out = redactSecrets(input, { RE: "a.*b" });
    // Only the literal "a.*b" is replaced; it is not interpreted as a regex.
    expect(out).toBe(
      "pattern=<from .env: RE> and literal=<from .env: RE>",
    );
  });
});

describe("redactArgv", () => {
  it("joins argv and redacts any secret value defensively", () => {
    const argv = ["secrets", "versions", "add", "my-secret", "value=supersecret"];
    const out = redactArgv(argv, { MY_SECRET: "supersecret" });
    expect(out).toContain("secrets versions add my-secret");
    expect(out).not.toContain("supersecret");
    expect(out).toContain("<from .env: MY_SECRET>");
  });
});
