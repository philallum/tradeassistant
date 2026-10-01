// Secret_Key redaction helper (spec Req 6.2, 6.3; design Component 7).
//
// Pure function. Substitutes any `Secret_Key` value with a `<from .env: NAME>`
// placeholder on EVERY display/log surface so the raw secret value never
// survives in any string shown to the operator, written to a log, recorded in
// an outcome, or committed. The actual value only ever travels on stdin into
// `gcloud` via `--data-file=-` (handled by the GcloudRunner choke point).

/** Build the placeholder shown in place of a redacted secret value. */
export function redactionPlaceholder(name: string): string {
  return `<from .env: ${name}>`;
}

/**
 * A mapping of env-key NAME -> secret VALUE used to redact a display/log string.
 * This is only ever consumed to search-and-replace; the values are never
 * emitted — they are replaced by their name placeholders.
 */
export type SecretValues = Readonly<Record<string, string | undefined>>;

/**
 * Replace every occurrence of each secret value in `input` with the
 * corresponding `<from .env: NAME>` placeholder (spec Req 6.2, 6.3).
 *
 * Edge cases, per the design's confidentiality guarantee:
 * - Empty / whitespace-only secret values are skipped: a blank value would
 *   otherwise match everywhere and corrupt the output (spurious global
 *   replacement). A `Secret_Key` with no value simply has nothing to redact.
 * - Longer values are redacted BEFORE shorter ones. If one secret's value is a
 *   substring of another's, redacting the shorter one first would leave a
 *   partial fragment of the longer value exposed; ordering by descending
 *   length closes that partial-overlap leak.
 * - All occurrences of a value are replaced, not just the first.
 *
 * @param input   The string to sanitize (a command, log line, or record).
 * @param secrets Mapping of env-key NAME -> secret VALUE.
 */
export function redactSecrets(input: string, secrets: SecretValues): string {
  // Collect only the entries that have a non-empty, non-whitespace value.
  const entries: Array<{ name: string; value: string }> = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (value === undefined) continue;
    if (value.trim() === "") continue; // skip empty / whitespace-only
    entries.push({ name, value });
  }

  // Redact longer values first to avoid partial-overlap leaks.
  entries.sort((a, b) => b.value.length - a.value.length);

  let output = input;
  for (const { name, value } of entries) {
    output = replaceAllLiteral(output, value, redactionPlaceholder(name));
  }
  return output;
}

/**
 * Build a redacted display command from an argv plus a secret mapping
 * (spec Req 6.1, 6.2). The argv itself should never contain a secret value
 * (secrets travel on stdin), but this applies the same redaction defensively so
 * a value can never leak into a presented/logged command string.
 */
export function redactArgv(
  argv: readonly string[],
  secrets: SecretValues,
): string {
  return redactSecrets(argv.join(" "), secrets);
}

/**
 * Replace every literal occurrence of `search` in `subject` with `replacement`.
 * `search` is treated as a plain string, not a regular expression, so secret
 * values containing regex metacharacters are handled correctly.
 */
function replaceAllLiteral(
  subject: string,
  search: string,
  replacement: string,
): string {
  // `String.prototype.replaceAll` with a string argument performs a literal
  // (non-regex) global replacement on Node 22.
  return subject.replaceAll(search, replacement);
}
