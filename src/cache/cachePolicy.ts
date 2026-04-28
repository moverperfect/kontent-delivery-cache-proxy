import type { AppConfig } from "../config.js";

const DEFAULT_CACHEABLE_STATUS = new Set([200, 203, 300, 301]);

export function isMethodCacheable(method: string): boolean {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD";
}

export function isStatusCacheable(
  status: number,
  config: AppConfig,
): boolean {
  if (status === 404) {
    return config.CACHE_404_RESPONSES === true;
  }
  return DEFAULT_CACHEABLE_STATUS.has(status);
}

export function isContentTypeSupported(
  contentType: string | undefined,
  method?: string,
): boolean {
  if ((method ?? "").toUpperCase() === "HEAD") return true;
  if (!contentType) return false;
  const ct = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return ct === "application/json" || ct === "application/hal+json";
}
