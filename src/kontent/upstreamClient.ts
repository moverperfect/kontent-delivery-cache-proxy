import type { AppConfig } from "../config.js";

export interface UpstreamFetchParams {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  signal?: AbortSignal;
}

export interface UpstreamFetchResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function fetchUpstream(
  config: AppConfig,
  params: UpstreamFetchParams,
): Promise<UpstreamFetchResult> {
  const maxAttempts = config.UPSTREAM_RETRY_COUNT + 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.UPSTREAM_TIMEOUT_MS);
    const mergedHeaders: Record<string, string> = { ...params.headers };
    if (config.UPSTREAM_WAIT_FOR_NEW_CONTENT) {
      mergedHeaders["x-kc-wait-for-loading-new-content"] = "true";
    }
    try {
      const res = await fetch(params.url, {
        method: params.method,
        headers: mergedHeaders,
        body:
          params.method !== "GET" && params.method !== "HEAD"
            ? params.body
            : undefined,
        signal: params.signal ?? controller.signal,
      });

      clearTimeout(timeout);

      const buf = params.method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });

      return {
        status: res.status,
        headers,
        body: buf,
      };
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      if (attempt < maxAttempts - 1) {
        await sleep(config.UPSTREAM_RETRY_BACKOFF_MS * Math.pow(2, attempt));
      }
    }
  }
  throw lastErr ?? new Error("upstream_fetch_failed");
}
