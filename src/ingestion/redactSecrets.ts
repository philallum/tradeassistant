// Credential redaction for provider failure messages.
//
// Several provider clients authenticate with an API key carried in the REQUEST URL's query
// string (`access_key=` for FCS, `apikey=` for Twelve Data, `apiKey=` for Massive). Their
// failure messages embed the underlying error text (`cause.message`) or the provider's own
// error body, and some runtimes / HTTP libraries put the full request URL - key included -
// into such text (e.g. a malformed-URL error, or a provider echoing the rejected key). Those
// messages are logged and persisted into typed errors, so they must be scrubbed at the
// moment they are built.
//
// Two complementary layers, both pure:
//   1. every occurrence of a KNOWN secret value (raw and URL-encoded form) is replaced;
//   2. any credential-looking query parameter is masked regardless of its value, which also
//      covers a key the caller did not know about (e.g. a different provider's URL).

export const REDACTED = "[redacted]" as const;

/** Query parameters whose value is a credential, masked wherever they appear in a message. */
const CREDENTIAL_QUERY_PARAM = /([?&;\s](?:access_key|api_?key|apikey|token|key)=)[^&\s"'<>)]*/gi;

/**
 * Return `text` with every known secret value, and every credential-looking query parameter
 * value, replaced by {@link REDACTED}. Empty/short secrets (< 4 chars) are ignored for the
 * value-replacement layer so a trivial secret cannot shred unrelated text; the query-param
 * layer still applies.
 */
export function redactSecrets(text: string, secrets: readonly (string | undefined)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret === undefined || secret.length < 4) continue;
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      out = out.split(form).join(REDACTED);
    }
  }
  return out.replace(CREDENTIAL_QUERY_PARAM, `$1${REDACTED}`);
}
