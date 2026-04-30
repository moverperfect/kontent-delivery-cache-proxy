import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { isAppInsightsEnabled, trackRequest } from "./appInsights.js";
import type { AppConfig } from "../config.js";

declare module "fastify" {
  interface FastifyRequest {
    telemetry?: { traceId: string; spanId: string; parentSpanId?: string; startTimeMs: number; routeName?: string; properties?: Record<string, string> };
  }
}

function parseTraceparent(value?: string): { traceId: string; parentSpanId?: string } {
  const m = value?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i);
  if (m) return { traceId: m[1], parentSpanId: m[2] };
  return { traceId: randomBytes(16).toString("hex") };
}

export const requestTelemetryPlugin = fp(async (app: FastifyInstance, config: AppConfig) => {
  app.addHook("onRequest", async (request) => {
    const parsed = parseTraceparent(typeof request.headers.traceparent === "string" ? request.headers.traceparent : undefined);
    request.telemetry = { traceId: parsed.traceId, spanId: randomBytes(8).toString("hex"), parentSpanId: parsed.parentSpanId, startTimeMs: Date.now(), properties: {} };
  });

  app.addHook("onResponse", async (request, reply) => {
    if (!isAppInsightsEnabled()) return;
    if (!config.APPINSIGHTS_ENABLE_REQUEST_TRACKING) return;
    if (!request.telemetry) return;
    const url = request.url.split("?")[0] ?? request.url;
    const isHealth = url === "/healthz" || url === "/readyz";
    if (url === "/metrics") return;
    if (isHealth && !config.APPINSIGHTS_TRACK_HEALTH_ENDPOINTS) return;

    trackRequest({
      name: `${request.method} ${request.routeOptions.url ?? url}`,
      url: request.url,
      duration: Date.now() - request.telemetry.startTimeMs,
      resultCode: String(reply.statusCode),
      success: reply.statusCode < 500,
      properties: request.telemetry.properties,
      tagOverrides: {
        "ai.operation.id": request.telemetry.traceId,
        "ai.operation.parentId": request.telemetry.parentSpanId ?? request.telemetry.spanId,
      },
    });
  });
});
