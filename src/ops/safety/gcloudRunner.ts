// Default GcloudRunner — the single I/O choke point for `gcloud` (design
// Component 7, spec Req 6.2, 6.3).
//
// This is the ONLY place in the OperationalSafety module that performs I/O.
// Secret values reach `gcloud` exclusively on stdin (piped from `opts.stdin`,
// used by callers with the `--data-file=-` flag); the runner never places a
// secret value into `argv`. It is injectable (see `GcloudRunner`) so tests
// substitute a fake that records argv/stdin without a real binary.

import { spawn } from "node:child_process";

import type { CommandOutput, GcloudRunner } from "./types.js";

/** The executable the runner shells out to. */
export const GCLOUD_BIN = "gcloud";

/**
 * Concrete {@link GcloudRunner} that shells out to the `gcloud` CLI via
 * `child_process.spawn`.
 *
 * - `argv` is passed as discrete arguments (no shell), so there is no shell
 *   interpolation and no opportunity to inject a secret into the command line.
 * - When `opts.stdin` is provided it is piped straight into the child process
 *   stdin, which is how a `Secret_Key` value reaches `gcloud` without ever
 *   appearing in `argv` (spec Req 6.2, 6.3).
 */
export class DefaultGcloudRunner implements GcloudRunner {
  constructor(private readonly bin: string = GCLOUD_BIN) {}

  run(
    argv: readonly string[],
    opts?: { stdin?: NodeJS.ReadableStream },
  ): Promise<CommandOutput> {
    return new Promise<CommandOutput>((resolve, reject) => {
      const child = spawn(this.bin, [...argv], {
        // No shell: arguments are passed verbatim as a vector.
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (err) => {
        reject(err);
      });

      child.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      // Pipe the secret value (if any) in on stdin, never via argv.
      if (opts?.stdin !== undefined) {
        opts.stdin.pipe(child.stdin);
      } else {
        child.stdin.end();
      }
    });
  }
}
