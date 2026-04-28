import { hashTokenIdentity, sha256Hex } from "../utils/hashing.js";
import { canonicalQueryString, normaliseUpstreamPath } from "../utils/canonicalUrl.js";

export interface CacheKeyInput {
  schemaVersion: number;
  method: string;
  environmentId: string;
  mode: "delivery" | "preview";
  path: string;
  query: URLSearchParams;
  /** Lowercase header name -> value for vary-relevant headers */
  varyHeaders: Record<string, string>;
  bodySha256?: string;
}

export interface CacheKeyResult {
  canonicalInput: string;
  cacheKey: string;
}

const VARY_HEADER_NAMES = [
  "authorization",
  "x-kc-secured-production-api-key",
  "x-kc-secured-preview-api-key",
  "accept",
  "accept-language",
] as const;

export function collectVaryHeaders(
  getHeader: (name: string) => string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of VARY_HEADER_NAMES) {
    const v = getHeader(name);
    if (v !== undefined && v.length > 0) {
      const lower = name.toLowerCase();
      let value = v.trim();
      if (lower === "authorization" && value.toLowerCase().startsWith("bearer ")) {
        value = `Bearer ${hashTokenIdentity(value.slice(7).trim()) ?? ""}`;
      } else if (
        lower === "x-kc-secured-production-api-key" ||
        lower === "x-kc-secured-preview-api-key"
      ) {
        value = hashTokenIdentity(value) ?? "";
      }
      out[lower] = value;
    }
  }
  return out;
}

function canonicalVary(varyHeaders: Record<string, string>): string {
  const keys = Object.keys(varyHeaders).sort();
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}=${varyHeaders[k]}`).join("&");
}

export function buildCacheKey(input: CacheKeyInput): CacheKeyResult {
  const method = input.method.toUpperCase();
  const path = normaliseUpstreamPath(input.path);
  const query = canonicalQueryString(input.query);
  const vary = canonicalVary(input.varyHeaders);
  const parts = [
    `v${input.schemaVersion}`,
    method,
    `env:${input.environmentId}`,
    `mode:${input.mode}`,
    `path:${path}`,
    `query:${query}`,
  ];
  if (vary.length > 0) {
    parts.push(`vary:${vary}`);
  }
  if (input.bodySha256) {
    parts.push(`body:${input.bodySha256}`);
  }
  const canonicalInput = parts.join("|");
  const cacheKey = sha256Hex(canonicalInput);
  return { canonicalInput, cacheKey };
}
