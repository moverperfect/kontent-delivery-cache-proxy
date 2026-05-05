import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUpstream } from "../../src/kontent/upstreamClient.js";
import type { AppConfig } from "../../src/config.js";

const baseConfig: AppConfig = {
  PORT: 8080,
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  KONTENT_DELIVERY_BASE_URL: "https://deliver.kontent.ai",
  KONTENT_PREVIEW_BASE_URL: "https://preview-deliver.kontent.ai",
  CACHE_DIR: "/tmp/cache-proxy-tests",
  CACHE_SCHEMA_VERSION: 1,
  CACHE_DEFAULT_TTL_SECONDS: 86400,
  CACHE_STALE_WHILE_REVALIDATE_SECONDS: 3600,
  CACHE_STALE_IF_ERROR_SECONDS: 86400,
  CACHE_MAX_BODY_BYTES: 10485760,
  CACHE_404_RESPONSES: true,
  UPSTREAM_WAIT_FOR_NEW_CONTENT: true,
  UPSTREAM_TIMEOUT_MS: 500,
  UPSTREAM_RETRY_COUNT: 0,
  UPSTREAM_RETRY_BACKOFF_MS: 1,
  PURGE_TOKEN: "test-secret",
  DEBUG_HEADERS: false,
  ENABLE_WARM_ENDPOINT: false,
  ENABLE_GRAPHQL: false,
  APPLICATIONINSIGHTS_CONNECTION_STRING: undefined,
  APPINSIGHTS_ENABLED: false,
  APPINSIGHTS_SAMPLING_PERCENTAGE: 100,
  APPINSIGHTS_ROLE_NAME: "kontent-cache-proxy",
  APPINSIGHTS_ENABLE_REQUEST_TRACKING: true,
  APPINSIGHTS_ENABLE_DEPENDENCY_TRACKING: true,
  APPINSIGHTS_ENABLE_AVAILABILITY_TRACKING: true,
  APPINSIGHTS_TRACK_HEALTH_ENDPOINTS: false,
  APPINSIGHTS_REDACT_QUERY_VALUES: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchUpstream telemetry", () => {
  it("does not let telemetry callback failures break successful requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ),
    );

    const result = await fetchUpstream(baseConfig, {
      url: "https://example.com/items",
      method: "GET",
      headers: {},
      telemetry: {
        onAttempt: () => {
          throw new Error("telemetry exploded");
        },
      },
    });

    expect(result.status).toBe(200);
    expect(result.body.toString("utf8")).toBe("ok");
  });

  it("preserves the original upstream error when telemetry callback throws on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("upstream failed");
      }),
    );

    await expect(
      fetchUpstream(baseConfig, {
        url: "https://example.com/items",
        method: "GET",
        headers: {},
        telemetry: {
          onAttempt: () => {
            throw new Error("telemetry exploded");
          },
        },
      }),
    ).rejects.toThrow("upstream failed");
  });
});
