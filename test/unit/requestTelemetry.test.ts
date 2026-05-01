import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../src/config.js";

const { trackRequestMock } = vi.hoisted(() => ({
  trackRequestMock: vi.fn(),
}));

vi.mock("../../src/observability/appInsights.js", () => ({
  isAppInsightsEnabled: () => true,
  trackRequest: trackRequestMock,
}));

const config: AppConfig = {
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

describe("requestTelemetryPlugin", () => {
  beforeEach(() => {
    trackRequestMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts query parameters from request telemetry and leaves root parent unset", async () => {
    const { requestTelemetryPlugin } = await import("../../src/observability/requestTelemetry.js");
    const app = Fastify();

    await app.register(requestTelemetryPlugin, config);
    app.get("/items/:id", async (request) => {
      request.telemetry!.properties = { source: "unit-test" };
      return { ok: true };
    });

    await app.inject({ method: "GET", url: "/items/123?token=secret&user=jack" });

    expect(trackRequestMock).toHaveBeenCalledTimes(1);
    const [telemetry, context] = trackRequestMock.mock.calls[0];
    expect(telemetry.url).toBe("/items/123");
    expect(telemetry.name).toBe("GET /items/:id");
    expect(telemetry.properties).toEqual({ source: "unit-test" });
    expect(context.operationId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.parentId).toBeUndefined();
    expect(context.traceFlags).toBe(1);

    await app.close();
  });

  it("preserves inbound traceparent as the request parent span", async () => {
    const { requestTelemetryPlugin } = await import("../../src/observability/requestTelemetry.js");
    const app = Fastify();

    await app.register(requestTelemetryPlugin, config);
    app.get("/items/:id", async () => ({ ok: true }));

    await app.inject({
      method: "GET",
      url: "/items/123",
      headers: {
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      },
    });

    expect(trackRequestMock).toHaveBeenCalledTimes(1);
    const [, context] = trackRequestMock.mock.calls[0];
    expect(context).toEqual({
      operationId: "0123456789abcdef0123456789abcdef",
      parentId: "0123456789abcdef",
      traceFlags: 1,
    });

    await app.close();
  });

  it("preserves inbound unsampled trace flags in request telemetry context", async () => {
    const { requestTelemetryPlugin } = await import("../../src/observability/requestTelemetry.js");
    const app = Fastify();

    await app.register(requestTelemetryPlugin, config);
    app.get("/items/:id", async () => ({ ok: true }));

    await app.inject({
      method: "GET",
      url: "/items/123",
      headers: {
        traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-00",
      },
    });

    expect(trackRequestMock).toHaveBeenCalledTimes(1);
    const [, context] = trackRequestMock.mock.calls[0];
    expect(context).toEqual({
      operationId: "0123456789abcdef0123456789abcdef",
      parentId: "0123456789abcdef",
      traceFlags: 0,
    });

    await app.close();
  });

  it("rejects all-zero traceparent ids and starts a fresh trace", async () => {
    const { requestTelemetryPlugin } = await import("../../src/observability/requestTelemetry.js");
    const app = Fastify();

    await app.register(requestTelemetryPlugin, config);
    app.get("/items/:id", async () => ({ ok: true }));

    await app.inject({
      method: "GET",
      url: "/items/123",
      headers: {
        traceparent: "00-00000000000000000000000000000000-0000000000000000-01",
      },
    });

    expect(trackRequestMock).toHaveBeenCalledTimes(1);
    const [, context] = trackRequestMock.mock.calls[0];
    expect(context.operationId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.operationId).not.toBe("00000000000000000000000000000000");
    expect(context.parentId).toBeUndefined();
    expect(context.traceFlags).toBe(1);

    await app.close();
  });
});
