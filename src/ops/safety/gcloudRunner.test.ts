// Unit tests for the DefaultGcloudRunner choke point (spec Req 6.2, 6.3;
// task 5.1).
//
// We substitute the `gcloud` binary with `node` running a tiny inline script so
// the test exercises the REAL spawn/stdin/stdout wiring without a gcloud install.
// The focus: a secret value supplied on stdin reaches the process, and the
// runner never needs (or allows) a secret in argv.

import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { DefaultGcloudRunner } from "./gcloudRunner.js";

/** Node script: echo argv (JSON) and whatever arrives on stdin, to stdout. */
const ECHO_SCRIPT = [
  "let data='';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data',c=>data+=c);",
  "process.stdin.on('end',()=>{",
  "  process.stdout.write(JSON.stringify({argv:process.argv.slice(2),stdin:data}));",
  "});",
].join("");

describe("DefaultGcloudRunner (spec Req 6.2, 6.3)", () => {
  it("passes argv verbatim as discrete arguments (no shell interpolation)", async () => {
    const runner = new DefaultGcloudRunner("node");
    // `SCRIPT_NAME` is the first positional node assigns to argv[1]; the
    // gcloud-style args follow and are reflected verbatim by the echo script.
    const argv = [
      "-e",
      ECHO_SCRIPT,
      "SCRIPT_NAME",
      "secrets",
      "versions",
      "add",
      "my-secret",
      "--data-file=-",
    ];
    const out = await runner.run(argv);

    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout) as { argv: string[]; stdin: string };
    // The gcloud-style args are passed through verbatim as discrete arguments
    // (no shell interpolation, no reordering).
    expect(parsed.argv).toEqual([
      "secrets",
      "versions",
      "add",
      "my-secret",
      "--data-file=-",
    ]);
  });

  it("pipes a secret value through stdin and never into argv", async () => {
    const runner = new DefaultGcloudRunner("node");
    const secret = "supersecret-value-123";
    const argv = ["-e", ECHO_SCRIPT, "secrets", "versions", "add", "my-secret", "--data-file=-"];

    const out = await runner.run(argv, {
      stdin: Readable.from([secret]),
    });

    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout) as { argv: string[]; stdin: string };

    // The secret arrived on stdin...
    expect(parsed.stdin).toBe(secret);
    // ...and never appears anywhere in argv.
    expect(parsed.argv).not.toContain(secret);
    expect(parsed.argv.join(" ")).not.toContain(secret);
  });

  it("closes stdin cleanly when no stdin stream is provided", async () => {
    const runner = new DefaultGcloudRunner("node");
    const argv = ["-e", ECHO_SCRIPT];
    const out = await runner.run(argv);

    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout) as { argv: string[]; stdin: string };
    expect(parsed.stdin).toBe("");
  });

  it("surfaces a non-zero exit code", async () => {
    const runner = new DefaultGcloudRunner("node");
    const out = await runner.run(["-e", "process.exit(7)"]);
    expect(out.exitCode).toBe(7);
  });
});
