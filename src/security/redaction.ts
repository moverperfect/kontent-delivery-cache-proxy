const REDACT_KEYS = new Set([
  "authorization",
  "x-kc-secured-production-api-key",
  "x-kc-secured-preview-api-key",
]);

export function redactHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!v) continue;
    const lk = k.toLowerCase();
    out[lk] = REDACT_KEYS.has(lk) ? "[REDACTED]" : v;
  }
  return out;
}
