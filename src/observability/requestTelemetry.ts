import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { isAppInsightsEnabled, trackRequest } from "./appInsights.js";
import type { AppConfig } from "../config.js";

function parseTraceparent(value?: string): {
  traceId: string;
  parentSpanId?: string;
  traceFlags?: string;
} {
  const m = value?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
  if (
    m &&
    m[1] !== "00000000000000000000000000000000" &&
    m[2] !== "0000000000000000"
  ) {
    return { traceId: m[1], parentSpanId: m[2], traceFlags: m[3].toLowerCase() };
  }
  return { traceId: randomBytes(16).toString("hex") };
}

function parseTraceFlags(traceFlags?: string): number {
  return Number.parseInt(traceFlags ?? "01", 16);
}

export const requestTelemetryPlugin = fp(async (app: FastifyInstance, config: AppConfig) => {
  app.addHook("onRequest", async (request) => {
    const parsed = parseTraceparent(
      typeof request.headers.traceparent === "string" ? request.headers.traceparent : undefined,
    );
    request.telemetry = {
      traceId: parsed.traceId,
      spanId: randomBytes(8).toString("hex"),
      parentSpanId: parsed.parentSpanId,
      traceFlags: parsed.traceFlags,
      startTimeMs: Date.now(),
      properties: {},
    };
  });

  app.addHook("onResponse", async (request, reply) => {
    if (!isAppInsightsEnabled()) return;
    if (!config.APPINSIGHTS_ENABLE_REQUEST_TRACKING) return;
    if (!request.telemetry) return;
    const url = request.url.split("?")[0] ?? request.url;
    const isHealth = url === "/healthz" || url === "/readyz";
    if (url === "/metrics") return;
    if (isHealth && !config.APPINSIGHTS_TRACK_HEALTH_ENDPOINTS) return;

    trackRequest(
      {
        id: request.telemetry.traceId,
        name: `${request.method} ${request.routeOptions.url ?? url}`,
        url,
        duration: Date.now() - request.telemetry.startTimeMs,
        resultCode: String(reply.statusCode),
        success: reply.statusCode < 500,
        properties: request.telemetry.properties,
      },
      {
        operationId: request.telemetry.traceId,
        ...(request.telemetry.parentSpanId ? { parentId: request.telemetry.parentSpanId } : {}),
        traceFlags: parseTraceFlags(request.telemetry.traceFlags),
      },
    );
  });
});
