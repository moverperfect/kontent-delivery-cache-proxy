import type { FastifyInstance } from "fastify";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import type { AppConfig } from "../config.js";
import { trackAvailability } from "../observability/appInsights.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  app.get("/healthz", async (_request, reply) => {
    const started = Date.now();
    if (config.APPINSIGHTS_TRACK_HEALTH_ENDPOINTS) {
      trackAvailability({ name: "GET /healthz", duration: Date.now() - started, success: true, runLocation: "service", message: "healthy", properties: { endpoint: "/healthz", status: "ready", failedChecks: "" } });
    }
    await reply.send({
      status: "ok",
      service: "kontent-cache-proxy",
      version: "0.1.0",
    });
  });

  app.get("/readyz", async (_request, reply) => {
    const started = Date.now();
    let cacheDirReadable = false;
    let cacheDirWritable = false;
    try {
      await access(config.CACHE_DIR, constants.R_OK);
      cacheDirReadable = true;
    } catch {
      cacheDirReadable = false;
    }
    try {
      await mkdir(config.CACHE_DIR, { recursive: true });
      await access(config.CACHE_DIR, constants.W_OK);
      cacheDirWritable = true;
    } catch {
      cacheDirWritable = false;
    }

    const configValid = true;

    const status = cacheDirReadable && cacheDirWritable && configValid ? "ready" : "not_ready";
    if (config.APPINSIGHTS_TRACK_HEALTH_ENDPOINTS) {
      const failedChecks = [!cacheDirReadable && "cacheDirReadable", !cacheDirWritable && "cacheDirWritable", !configValid && "configValid"].filter(Boolean).join(",");
      trackAvailability({ name: "GET /readyz", duration: Date.now() - started, success: status === "ready", runLocation: "service", message: status, properties: { endpoint: "/readyz", status, failedChecks } });
    }
    await reply.code(status === "ready" ? 200 : 503).send({
      status,
      checks: {
        cacheDirReadable,
        cacheDirWritable,
        configValid,
      },
    });
  });
}
