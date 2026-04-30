import appInsights from "applicationinsights";
import type { TelemetryClient } from "applicationinsights";
import type { AppConfig } from "../config.js";

let initialized = false;
let enabled = false;
let client: TelemetryClient | undefined;

function sanitizeUrl(url: string, redactQueryValues: boolean): string {
  if (!redactQueryValues) return url;
  const parsed = new URL(url);
  for (const key of parsed.searchParams.keys()) parsed.searchParams.set(key, "REDACTED");
  return parsed.toString();
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
    .setAutoCollectPerformance(false)
    .setUseDiskRetryCaching(true)
    .start();

  client = appInsights.defaultClient;
  client.config.samplingPercentage = config.APPINSIGHTS_SAMPLING_PERCENTAGE;
  client.context.tags[client.context.keys.cloudRole] = config.APPINSIGHTS_ROLE_NAME;
}

export function isAppInsightsEnabled(): boolean {
  return enabled && Boolean(client);
}

export function trackRequest(input: Parameters<TelemetryClient["trackRequest"]>[0]): void {
  if (!isAppInsightsEnabled()) return;
  client!.trackRequest(input);
}

export function trackDependency(
  input: Parameters<TelemetryClient["trackDependency"]>[0],
  redactQueryValues = true,
): void {
  if (!isAppInsightsEnabled()) return;
  client!.trackDependency({
    ...input,
    data: input.data ? sanitizeUrl(input.data, redactQueryValues) : input.data,
  });
}

export function trackAvailability(input: Parameters<TelemetryClient["trackAvailability"]>[0]): void {
  if (!isAppInsightsEnabled()) return;
  client!.trackAvailability(input);
}

export function trackException(input: Parameters<TelemetryClient["trackException"]>[0]): void {
  if (!isAppInsightsEnabled()) return;
  client!.trackException(input);
}

export async function flushTelemetry(): Promise<void> {
  if (!isAppInsightsEnabled()) return;
  await new Promise<void>((resolve) => client!.flush({ callback: () => resolve() }));
}
