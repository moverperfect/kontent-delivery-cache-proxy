export interface CacheMetadata {
  schemaVersion: number;
  cacheKey: string;
  method: string;
  environmentId: string;
  mode: "delivery" | "preview";
  upstreamUrl: string;
  canonicalKeyInput: string;
  requestHeadersForReplay: Record<string, string>;
  status: number;
  responseHeaders: Record<string, string>;
  bodyFile: string;
  bodySha256: string;
  bodySizeBytes: number;
  createdAt: string;
  refreshedAt: string;
  expiresAt: string;
  staleUntil: string;
  dependencyKeys: string[];
}
