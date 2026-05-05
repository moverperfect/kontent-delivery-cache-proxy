import * as appInsightsNamespace from "applicationinsights";
import type { TelemetryClient } from "applicationinsights";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config.js";

let initialized = false;
let enabled = false;
let client: TelemetryClient | undefined;

export interface TelemetryContext {
  operationId?: string;
  parentId?: string;
  traceFlags?: number;
}

interface MinimalSpanContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

const appInsights =
  (appInsightsNamespace as typeof appInsightsNamespace & { default?: typeof appInsightsNamespace }).default ??
  appInsightsNamespace;

function isTruthy(value?: string): boolean {
  return value !== "false" && value !== "0";
}

function parseDefaultTrue(value?: string): boolean {
  return value === undefined ? true : isTruthy(value);
}

function parseDefaultFalse(value?: string): boolean {
  return value === "true" || value === "1";
}

function redactRelativeUrl(url: string): string {
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  if (queryIndex === -1) return url;

  const path = beforeHash.slice(0, queryIndex);
  const searchParams = new URLSearchParams(beforeHash.slice(queryIndex + 1));
  searchParams.forEach((_value, key) => {
    searchParams.set(key, "REDACTED");
  });

  return `${path}?${searchParams.toString()}${hash}`;
}

export function sanitizeUrl(url: string, redactQueryValues: boolean): string {
  if (!redactQueryValues) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((_value, key) => {
      parsed.searchParams.set(key, "REDACTED");
    });
    return parsed.toString();
  } catch {
    return redactRelativeUrl(url);
  }
}

function withTelemetryContext<T>(context: TelemetryContext | undefined, fn: () => T): T {
  if (!context?.operationId || !context.parentId) return fn();

  const spanContext: MinimalSpanContext = {
    traceId: context.operationId,
    spanId: context.parentId,
    traceFlags: context.traceFlags ?? 1,
  };
  const operation = appInsights.startOperation(spanContext);
  if (!operation) return fn();

  return appInsights.wrapWithCorrelationContext(fn, operation)();
}

export function initAppInsights(config: AppConfig): void {
  if (initialized) return;
  initialized = true;
  enabled = Boolean(config.APPLICATIONINSIGHTS_CONNECTION_STRING) && config.APPINSIGHTS_ENABLED;
  if (!enabled) return;

  appInsights
    .setup(config.APPLICATIONINSIGHTS_CONNECTION_STRING)
    .setDistributedTracingMode(appInsights.DistributedTracingModes.AI_AND_W3C)
    .setAutoCollectRequests(false)
    .setAutoCollectDependencies(false)
    .setAutoCollectExceptions(false)
    .setAutoCollectPerformance(false, false)
    .setUseDiskRetryCaching(true)
    .start();

  client = appInsights.defaultClient;
  client.config.samplingPercentage = config.APPINSIGHTS_SAMPLING_PERCENTAGE;
  client.context.tags[client.context.keys.cloudRole] = config.APPINSIGHTS_ROLE_NAME;
}

export function initAppInsightsFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (initialized) return;
  if (!env.APPLICATIONINSIGHTS_CONNECTION_STRING) return;

  const appInsightsEnabled = env.APPINSIGHTS_ENABLED
    ? isTruthy(env.APPINSIGHTS_ENABLED)
    : Boolean(env.APPLICATIONINSIGHTS_CONNECTION_STRING);

  initAppInsights({
    PORT: Number(env.PORT ?? 8080),
    NODE_ENV: env.NODE_ENV === "production" || env.NODE_ENV === "test" ? env.NODE_ENV : "development",
    LOG_LEVEL:
      env.LOG_LEVEL === "fatal" ||
      env.LOG_LEVEL === "error" ||
      env.LOG_LEVEL === "warn" ||
      env.LOG_LEVEL === "info" ||
      env.LOG_LEVEL === "debug" ||
      env.LOG_LEVEL === "trace" ||
      env.LOG_LEVEL === "silent"
        ? env.LOG_LEVEL
        : "info",
    KONTENT_DELIVERY_BASE_URL: env.KONTENT_DELIVERY_BASE_URL ?? "https://deliver.kontent.ai",
    KONTENT_PREVIEW_BASE_URL: env.KONTENT_PREVIEW_BASE_URL ?? "https://preview-deliver.kontent.ai",
    CACHE_DIR: env.CACHE_DIR ?? "./.cache-proxy",
    CACHE_SCHEMA_VERSION: Number(env.CACHE_SCHEMA_VERSION ?? 1),
    CACHE_DEFAULT_TTL_SECONDS: Number(env.CACHE_DEFAULT_TTL_SECONDS ?? 86400),
    CACHE_STALE_WHILE_REVALIDATE_SECONDS: Number(env.CACHE_STALE_WHILE_REVALIDATE_SECONDS ?? 3600),
    CACHE_STALE_IF_ERROR_SECONDS: Number(env.CACHE_STALE_IF_ERROR_SECONDS ?? 86400),
    CACHE_MAX_BODY_BYTES: Number(env.CACHE_MAX_BODY_BYTES ?? 10485760),
    CACHE_404_RESPONSES: parseDefaultTrue(env.CACHE_404_RESPONSES),
    UPSTREAM_WAIT_FOR_NEW_CONTENT: parseDefaultTrue(env.UPSTREAM_WAIT_FOR_NEW_CONTENT),
    UPSTREAM_TIMEOUT_MS: Number(env.UPSTREAM_TIMEOUT_MS ?? 30000),
    UPSTREAM_RETRY_COUNT: Number(env.UPSTREAM_RETRY_COUNT ?? 2),
    UPSTREAM_RETRY_BACKOFF_MS: Number(env.UPSTREAM_RETRY_BACKOFF_MS ?? 500),
    PURGE_TOKEN: env.PURGE_TOKEN ?? randomBytes(16).toString("hex"),
    DEBUG_HEADERS: parseDefaultFalse(env.DEBUG_HEADERS),
    ENABLE_WARM_ENDPOINT: parseDefaultFalse(env.ENABLE_WARM_ENDPOINT),
    ENABLE_GRAPHQL: parseDefaultFalse(env.ENABLE_GRAPHQL),
    APPLICATIONINSIGHTS_CONNECTION_STRING: env.APPLICATIONINSIGHTS_CONNECTION_STRING,
    APPINSIGHTS_ENABLED: appInsightsEnabled,
    APPINSIGHTS_SAMPLING_PERCENTAGE: Number(env.APPINSIGHTS_SAMPLING_PERCENTAGE ?? 100),
    APPINSIGHTS_ROLE_NAME: env.APPINSIGHTS_ROLE_NAME ?? "kontent-cache-proxy",
    APPINSIGHTS_ENABLE_REQUEST_TRACKING: parseDefaultTrue(env.APPINSIGHTS_ENABLE_REQUEST_TRACKING),
    APPINSIGHTS_ENABLE_DEPENDENCY_TRACKING: parseDefaultTrue(env.APPINSIGHTS_ENABLE_DEPENDENCY_TRACKING),
    APPINSIGHTS_ENABLE_AVAILABILITY_TRACKING: parseDefaultTrue(env.APPINSIGHTS_ENABLE_AVAILABILITY_TRACKING),
    APPINSIGHTS_TRACK_HEALTH_ENDPOINTS: parseDefaultFalse(env.APPINSIGHTS_TRACK_HEALTH_ENDPOINTS),
    APPINSIGHTS_REDACT_QUERY_VALUES: parseDefaultTrue(env.APPINSIGHTS_REDACT_QUERY_VALUES),
  });
}

export function isAppInsightsEnabled(): boolean {
  return enabled && Boolean(client);
}

export function trackRequest(
  input: Parameters<TelemetryClient["trackRequest"]>[0],
  context?: TelemetryContext,
): void {
  if (!isAppInsightsEnabled()) return;
  withTelemetryContext(context, () => {
    client!.trackRequest(input);
  });
}

export function trackDependency(
  input: Parameters<TelemetryClient["trackDependency"]>[0],
  redactQueryValues = true,
  context?: TelemetryContext,
): void {
  if (!isAppInsightsEnabled()) return;
  withTelemetryContext(context, () => {
    client!.trackDependency({
        ...input,
        data: input.data ? sanitizeUrl(input.data, redactQueryValues) : input.data,
    });
  });
}

export function trackAvailability(input: Parameters<TelemetryClient["trackAvailability"]>[0]): void {
  if (!isAppInsightsEnabled()) return;
  client!.trackAvailability(input);
}

export function trackException(
  input: Parameters<TelemetryClient["trackException"]>[0],
  context?: TelemetryContext,
): void {
  if (!isAppInsightsEnabled()) return;
  withTelemetryContext(context, () => {
    client!.trackException(input);
  });
}

export async function flushTelemetry(): Promise<void> {
  if (!isAppInsightsEnabled()) return;
  await client!.flush();
}
